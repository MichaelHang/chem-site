// 共享工具：与 server.js 保持同一套契约（scrypt + Bearer token）
// 仅在 functions/ 内被 import，文件名以 _ 开头，不作为路由暴露。
import { scrypt, randomBytes } from 'node:crypto';

export const CONFIG = {
  TOKEN_TTL_MS: 30 * 24 * 3600 * 1000,
  USER_RE: /^[a-zA-Z0-9_]{3,20}$/,
  DATA_KEYS: ['records', 'points', 'levels', 'rewards', 'flash', 'practice', 'timed'],
};

export function send(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const newSalt = () => randomBytes(16).toString('hex');
export const newToken = () => randomBytes(32).toString('hex');

export function hashCred(cred, salt) {
  return new Promise((res, rej) =>
    scrypt(cred, salt, 64, (e, buf) => (e ? rej(e) : res(buf.toString('hex')))));
}

// Bearer token -> username（过期即失效）。滑动续期：剩余有效期不足一半时顺延一个完整周期，
// 活跃用户（15 天内至少同步一次）不再被强制重登；已过期的不复活。
export async function authUser(env, authHeader) {
  const m = (authHeader || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const row = await env.DB.prepare('SELECT username, expires FROM sessions WHERE token = ?')
    .bind(m[1]).first();
  if (!row || row.expires < Date.now()) return null;
  if (row.expires - Date.now() < CONFIG.TOKEN_TTL_MS / 2) {
    await env.DB.prepare('UPDATE sessions SET expires = ? WHERE token = ?')
      .bind(Date.now() + CONFIG.TOKEN_TTL_MS, m[1]).run();
  }
  return row.username;
}
