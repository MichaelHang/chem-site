import { send } from './_utils.js';

// 吊销当前 Bearer token 对应的服务端会话。不校验有效期：过期 token 也可借此清理。
// 安全性：删除以 token 为主键，只有持有 token 的人能删，无枚举风险。
export async function onRequestPost({ request, env }) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return send({ ok: false, msg: '缺少凭证' }, 401);
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(m[1]).run();
  return send({ ok: true });
}
