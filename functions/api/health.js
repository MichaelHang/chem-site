import { send } from './_utils.js';

export async function onRequestGet() {
  return send({ ok: true });
}
