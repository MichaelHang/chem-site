#!/usr/bin/env node
// 题库完整性校验：node check-bank.mjs
// 检查项：id 唯一（含跨库）、答案索引越界、选项数、缺题干/解析、module 与 MODULES 匹配。
import { readFileSync } from 'node:fs';

const MODULES = {
  knowledge: ['必修一·基本概念', '必修二', '选择性必修1·反应原理', '选择性必修2·物质结构与性质', '选择性必修3·有机化学'],
  experiment: ['必修一', '必修二', '选择性必修1', '选择性必修2', '选择性必修3'],
};

const src = readFileSync(new URL('./bank.js', import.meta.url), 'utf8');
const RAW_BANK = new Function(src + '\n;return RAW_BANK;')();

// kp 字段校验依赖图谱仓库（同机 ../chem-knowledge-graph）；不存在时跳过该组检查
// 图谱数据地址：默认本地图谱服务器，可用环境变量覆盖（如已部署的图谱网址）
const GRAPH_BASE = process.env.GRAPH_BASE || 'http://127.0.0.1:8930';
let GRAPH_IDS = null;
try {
  const res = await fetch(GRAPH_BASE + '/graph.json');
  if (!res.ok) throw new Error(res.status);
  GRAPH_IDS = new Set((await res.json()).nodes.map(n => n.id));
} catch { /* 图谱不可达则跳过 kp 存在性校验（联机后重跑即可） */ }

const problems = [];
let total = 0;
for (const [bank, qs] of Object.entries(RAW_BANK)) {
  total += qs.length;
  const ids = new Set();
  for (const q of qs) {
    const at = msg => problems.push(`[${bank}] ${q.id ?? '(无id)'}: ${msg}`);
    if (!q.id) problems.push(`[${bank}] 存在无 id 的题目`);
    if (ids.has(q.id)) at('id 重复');
    ids.add(q.id);
    if (!q.q) at('缺题干');
    if (!Array.isArray(q.options) || q.options.length < 2) at('options 不是数组或少于 2 项');
    else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) at(`answer 越界: ${q.answer}`);
    if (!q.explain) at('缺解析');
    if (!q.module) at('缺 module');
    else if (!MODULES[bank] || !MODULES[bank].includes(q.module)) at(`module "${q.module}" 不在模块表中`);
    if (q.kp !== undefined) {
      if (!Array.isArray(q.kp) || !q.kp.length) at('kp 应为非空数组');
      else {
        if (GRAPH_IDS) for (const id of q.kp) if (!GRAPH_IDS.has(id)) at(`kp 节点不存在于图谱: ${id}`);
        const dup = q.kp.filter((x, i) => q.kp.indexOf(x) !== i);
        if (dup.length) at(`kp 重复: ${[...new Set(dup)].join(',')}`);
      }
    }
  }
  console.log(`${bank}: ${qs.length} 题`);
}
const kIds = new Set(RAW_BANK.knowledge.map(q => q.id));
const cross = RAW_BANK.experiment.filter(q => kIds.has(q.id));
if (cross.length) problems.push('跨库重复 id: ' + cross.map(q => q.id).join(','));

console.log(`共 ${total} 题`);
if (problems.length) {
  console.error('\n发现问题:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('题库校验通过 ✓');
