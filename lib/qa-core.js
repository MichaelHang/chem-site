// 图谱问答核心逻辑（厂商无关、纯 JS、无 Node/浏览器 API 依赖）。
// 同时被两端使用：server.js（本地 Node 服务器）与 functions/api/ask.js（Cloudflare Pages Functions）。
// 修改时两端同步生效。

const TYPE_NAME = { concept: '概念', substance: '物质', reaction: '反应', category: '类别', experiment: '实验', pitfall: '易错点' };

const CHAT_SYSTEM_PROMPT = `你是一位严谨、亲切的高中化学老师，正在用「化学知识图谱」辅助学生复习。规则：
1. 优先依据下方【图谱知识】回答；图谱覆盖到的内容不要与其矛盾。
2. 图谱未覆盖的内容可以补充，但需说明"这是图谱之外的拓展"。
3. 若题目涉及方程式，保持配平、条件、气体/沉淀符号正确。
4. 回答用简体中文，条理清晰、适合高中生，先给结论再给解释，控制在 400 字以内。
5. 如果图谱知识明显不足以回答，直接指出并给出通用化学解释。
6. 禁止使用任何 LaTeX 或数学记号（如 $...$、\\xrightarrow、\\Delta、\\times 等）。化学方程式的条件直接写在等号中间，风格与【图谱知识】中的方程式保持一致，例如：2KClO₃ =(MnO₂、加热)= 2KCl + 3O₂↑。`;

// 检索归一化：小写 + 上下标转 ASCII（Fe³⁺ ↔ fe3+）
const SUP_MAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
function normText(s) {
  return s.toLowerCase()
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, c => SUP_MAP[c])
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => String('0123456789'.indexOf('₀₁₂₃₄₅₆₇₈₉'.indexOf(c) >= 0 ? '₀₁₂₃₄₅₆₇₈₉'.indexOf(c) : 0)));
}

// 关键词检索：整标签 / 标签词元 / 俗名 命中问题，短前缀与 bigram 兜底
function retrieveNodes(g, q) {
  const qn = normText(q);
  const bigrams = new Set();
  for (let i = 0; i + 1 < qn.length; i++) {
    const a = qn[i], b = qn[i + 1];
    if (/[\u4e00-\u9fff]/.test(a) && /[\u4e00-\u9fff]/.test(b)) bigrams.add(a + b);
  }
  const scored = [];
  for (const n of g.nodes) {
    let score = 0;
    const names = [n.label.replace(/\s*[（(][^）)]*[）)]\s*$/, '')];
    for (const tok of n.label.split(/\s+/)) if (tok.length >= 2) names.push(tok);
    if (n.props) for (const v of Object.values(n.props)) {
      if (typeof v === 'string' && v.length >= 2 && v.length <= 12) names.push(v);
    }
    for (const raw of names) {
      const name = normText(raw);
      if (name.length < 2) continue;
      if (qn.includes(name)) { score += 10 + name.length; continue; }
      if (qn.length >= 2 && name.startsWith(qn)) { score += 4 + qn.length; continue; }
      let hits = 0;
      for (let i = 0; i + 1 < name.length; i++) {
        const a = name[i], b = name[i + 1];
        if (/[\u4e00-\u9fff]/.test(a) && /[\u4e00-\u9fff]/.test(b) && bigrams.has(a + b)) hits++;
      }
      score += Math.min(hits, 4) * 1.5;
    }
    if (score >= 3) scored.push({ n, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map(s => s.n);
}

// 子图展开：每个命中节点一行简介 + 邻接关系
function buildContext(byId, adj, nodes) {
  const lines = [];
  const seen = new Set();
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const head = `【${TYPE_NAME[n.type] || n.type}】${n.label}${n.equation ? `｜方程式：${n.equation}` : ''}`;
    const desc = (n.desc || n.purpose || '').slice(0, 220);
    lines.push(desc ? `${head}：${desc}` : head);
    const rels = (adj.get(n.id) || []).slice(0, 16);
    for (const { edge, dir, other } of rels) {
      const o = byId.get(other);
      if (!o || seen.has(o.id)) continue;
      lines.push(`   ${dir === 'out' ? '→' : '←'} ${edge.relation} ${o.label}${edge.note ? `（${edge.note}）` : ''}`);
    }
  }
  return lines.join('\n');
}

// 由图数据构建邻接索引（可缓存复用）
function buildIndex(g) {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const adj = new Map(g.nodes.map(n => [n.id, []]));
  for (const e of g.edges) {
    if (byId.has(e.source)) adj.get(e.source).push({ edge: e, dir: 'out', other: e.target });
    if (byId.has(e.target)) adj.get(e.target).push({ edge: e, dir: 'in', other: e.source });
  }
  return { byId, adj };
}

const normBase = (b) => String(b || '').trim().replace(/\/+$/, '');

// 统一的双协议 LLM 调用：provider = openai（/chat/completions，Bearer）| anthropic（/messages，x-api-key）
// 入参 cfg 四个字段都应为最终值（调用方先做好服务器端默认值兜底），Key 解析（文件/环境变量）留在各宿主。
async function callLLM(cfg, history, systemText) {
  const provider = cfg.provider === 'anthropic' ? 'anthropic' : 'openai';
  const key = (cfg.apiKey || '').trim();
  if (!key) { const err = new Error('NO_KEY'); err.code = 'NO_KEY'; throw err; }
  const base = normBase(cfg.baseUrl);
  if (!base) { const err = new Error('NO_BASE'); err.code = 'NO_BASE'; throw err; }
  const model = (cfg.model || '').trim();
  if (!model) { const err = new Error('NO_MODEL'); err.code = 'NO_MODEL'; throw err; }
  let url, headers, body;
  if (provider === 'anthropic') {
    url = base.endsWith('/messages') ? base : base + (base.endsWith('/v1') ? '/messages' : '/v1/messages');
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': key,
      Authorization: `Bearer ${key}`, // 兼容两种鉴权实现
      'anthropic-version': '2023-06-01',
    };
    body = { model, max_tokens: 2000, system: systemText, messages: history.map(({ role, content }) => ({ role, content })) };
  } else {
    url = base.endsWith('/chat/completions') ? base : base + (base.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions');
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    body = { model, max_tokens: 2000, messages: [{ role: 'system', content: systemText }, ...history] };
  }
  const resp = await (async () => {
    // 429 限流自动重试：退避 1.5s / 3s，最多 3 次尝试
    let r;
    for (let attempt = 0; ; attempt++) {
      r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      if (r.status !== 429 || attempt >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    return r;
  })();
  if (!resp.ok) {
    const t = await resp.text();
    const err = new Error(resp.status === 429
      ? 'AI 服务限流（429）：当前套餐的每分钟请求/Token 配额用完了，等几秒再试一次即可。'
      : `LLM 调用失败（HTTP ${resp.status}）：${t.slice(0, 300)}`);
    err.code = 'HTTP'; throw err;
  }
  const data = await resp.json();
  if (provider === 'anthropic') {
    const text = (Array.isArray(data.content) ? data.content : []).filter(b => b && b.type === 'text').map(b => b.text || '').join('');
    if (!text) { const err = new Error('LLM 返回了空回答'); err.raw = JSON.stringify(data).slice(0, 300); throw err; }
    return text;
  }
  const answer = data?.choices?.[0]?.message?.content ?? '';
  if (!answer) { const err = new Error('LLM 返回了空回答'); err.raw = JSON.stringify(data).slice(0, 300); throw err; }
  return answer;
}

module.exports = { TYPE_NAME, CHAT_SYSTEM_PROMPT, normText, retrieveNodes, buildContext, buildIndex, normBase, callLLM };
