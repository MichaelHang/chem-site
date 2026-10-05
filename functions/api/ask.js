// Cloudflare Pages Function：POST /api/ask —— AI 问答端点（无自有服务器部署用）。
// 路径约定：functions/api/ask.js 自动映射为站点路由 /api/ask，前端无需任何修改。
// BYOK 模式：Key 只来自用户浏览器端配置（随请求传入），服务器/函数不持有、不保存任何 Key。
import {
  retrieveNodes, buildContext, buildIndex, callLLM, CHAT_SYSTEM_PROMPT,
} from '../../lib/qa-core.js';

// 图谱数据与邻接索引在同一个 Worker 实例内缓存
let cached = null;
async function loadGraph(env) {
  if (cached) return cached;
  const assets = env.ASSETS;
  if (!assets) throw new Error('ASSETS 绑定不可用（请在 Cloudflare Pages 部署，而非独立 Worker）');
  const res = await assets.fetch(new URL('/graph.json', 'https://assets.local'));
  if (!res.ok) throw new Error(`无法加载 graph.json（${res.status}）——请确认已执行 npm run build 生成 app/graph.json`);
  const graph = await res.json();
  const { byId, adj } = buildIndex(graph);
  cached = { graph, byId, adj };
  return cached;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request, env }) {
  let parsed;
  try {
    parsed = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }
  try {
    const { graph, byId, adj } = await loadGraph(env);
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (!question) return json({ error: '缺少 question' }, 400);
    // BYOK：协议/地址/Key/模型全部来自用户浏览器配置，函数不做任何兜底
    const src = parsed.llm && typeof parsed.llm === 'object' ? parsed.llm : {};
    const cfg = {
      provider: src.provider === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: typeof src.baseUrl === 'string' ? src.baseUrl.trim().slice(0, 300) : '',
      apiKey: typeof src.apiKey === 'string' ? src.apiKey.trim().slice(0, 300) : '',
      model: typeof src.model === 'string' ? src.model.trim().slice(0, 120) : '',
    };
    const history = Array.isArray(parsed.history) ? parsed.history : [];
    const hits = retrieveNodes(graph, question);
    const context = buildContext(byId, adj, hits);
    const systemText = CHAT_SYSTEM_PROMPT + (context ? `\n\n【图谱知识】\n${context}` : '\n\n（图谱中未检索到相关节点。）');
    const llmHistory = [
      ...history.slice(-6).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'),
      { role: 'user', content: question },
    ];
    try {
      const answer = await callLLM(cfg, llmHistory, systemText);
      return json({ answer, model: cfg.model || '（界面配置）', context: hits.map(n => ({ id: n.id, label: n.label, type: n.type })) });
    } catch (e) {
      if (e.code === 'NO_KEY') return json({ error: '未配置 API Key：点右上角 ⚙ 设置，填入你自己的兼容服务 Key（保存在你浏览器本地，本站只转发、不保存）。' }, 503);
      if (e.code === 'NO_BASE') return json({ error: '未配置接口地址：点问答页的「设置」填写 Base URL（任何 OpenAI 或 Anthropic 兼容服务）。' }, 503);
      if (e.code === 'NO_MODEL') return json({ error: '未配置模型名称：点问答页的「设置」填写模型名。' }, 503);
      if (e.code === 'HTTP') return json({ error: e.message }, 502);
      return json({ error: e.message, raw: e.raw }, 502);
    }
  } catch (e) {
    return json({ error: `问答处理失败：${e.message}` }, 500);
  }
}
