import { send, newToken, hashCred, CONFIG } from './_utils.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return send({ ok: false, msg: '请求体不是合法 JSON' }, 400); }
  const user = body.user, cred = body.cred;  const u = await env.DB.prepare('SELECT salt, hash FROM users WHERE username = ?').bind(user).first();
  if (!u) return send({ ok: false, msg: '未知用户' }, 404); // 前端提示用户不存在（不再自动注册）

  const hash = await hashCred(cred, u.salt);
  if (hash !== u.hash) return send({ ok: false, msg: '用户名或密码错误' }, 401);

  const now = Date.now();
  const token = newToken();
  const orphanPh = CONFIG.DATA_KEYS.map(() => '?').join(',');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token, username, expires) VALUES (?, ?, ?)').bind(token, user, now + CONFIG.TOKEN_TTL_MS),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now), // 顺手清理过期会话
    // 清理历史版本遗留的孤儿数据分片（rewards/flash/practice 等已停用键）
    env.DB.prepare(`DELETE FROM user_data WHERE username = ? AND key NOT IN (${orphanPh})`).bind(user, ...CONFIG.DATA_KEYS),
  ]);

  return send({ ok: true, token });
}
