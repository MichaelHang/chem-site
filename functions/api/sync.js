import { send, authUser, CONFIG } from './_utils.js';

export async function onRequestGet({ request, env }) {
  const user = await authUser(env, request.headers.get('authorization'));
  if (!user) return send({ ok: false, msg: '未登录' }, 401);

  const rows = await env.DB.prepare('SELECT key, value, updated_at FROM user_data WHERE username = ?')
    .bind(user).all();
  const data = {};
  let updated_at = 0;
  for (const k of CONFIG.DATA_KEYS) data[k] = [];
  for (const r of (rows.results || [])) {
    try { data[r.key] = JSON.parse(r.value || '[]'); } catch { data[r.key] = []; }
    if (r.updated_at > updated_at) updated_at = r.updated_at;
  }
  return send({ ok: true, updated_at, data });
}

export async function onRequestPost({ request, env }) {
  const user = await authUser(env, request.headers.get('authorization'));
  if (!user) return send({ ok: false, msg: '未登录' }, 401);

  let body;
  try { body = await request.json(); } catch { return send({ ok: false, msg: '请求体不是合法 JSON' }, 400); }
  const client_ts = Number(body.client_ts) || 0;

  const cur = await env.DB.prepare('SELECT MAX(updated_at) AS m FROM user_data WHERE username = ?').bind(user).first();
  const server_ts = cur?.m || 0;

  // 仅当客户端数据比服务端新才覆盖（按 key last-write-wins）
  if (client_ts >= server_ts) {
    const now = Date.now();
    for (const k of CONFIG.DATA_KEYS) {
      if (body.data && body.data[k] !== undefined) {
        const v = JSON.stringify(body.data[k]);
        await env.DB.prepare(
          'INSERT INTO user_data (username, key, value, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(username, key) DO UPDATE SET value = ?, updated_at = ?'
        ).bind(user, k, v, now, v, now).run();
      }
    }
  }

  const after = await env.DB.prepare('SELECT MAX(updated_at) AS m FROM user_data WHERE username = ?').bind(user).first();
  return send({ ok: true, updated_at: after?.m || 0 });
}
