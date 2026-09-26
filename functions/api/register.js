import { send, newSalt, newToken, hashCred, CONFIG } from './_utils.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return send({ ok: false, msg: '请求体不是合法 JSON' }, 400); }
  const user = body.user, cred = body.cred;
  if (!CONFIG.USER_RE.test(user || '')) return send({ ok: false, msg: '用户名需 3-20 位字母数字下划线' }, 400);
  if (!cred || typeof cred !== 'string') return send({ ok: false, msg: '凭证无效' }, 400);

  const exists = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(user).first();
  if (exists) return send({ ok: false, msg: '用户名已存在' }, 409);

  const salt = newSalt();
  const hash = await hashCred(cred, salt);
  const now = Date.now();
  const token = newToken();
  // 原子批次：建用户 + 初始化数据分片 + 发会话 + 清理过期会话。
  // 并发注册撞 users 唯一约束时整体回滚，返回 409（此前 check-then-insert 有竞态且会写出一半数据）。
  const stmts = [
    env.DB.prepare('INSERT INTO users (username, salt, hash, created) VALUES (?, ?, ?, ?)').bind(user, salt, hash, now),
    ...CONFIG.DATA_KEYS.map(k =>
      env.DB.prepare('INSERT INTO user_data (username, key, value, updated_at) VALUES (?, ?, ?, ?)').bind(user, k, '[]', now)),
    env.DB.prepare('INSERT INTO sessions (token, username, expires) VALUES (?, ?, ?)').bind(token, user, now + CONFIG.TOKEN_TTL_MS),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
  ];
  try { await env.DB.batch(stmts); }
  catch (e) { return send({ ok: false, msg: '用户名已存在' }, 409); }

  return send({ ok: true, token });
}
