import { timingSafeEqual } from 'node:crypto';
import { validRuntime } from '../portfolio/runtime.js';

export const MAX_STATE_BYTES = 512 * 1024;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
function reply(value, status = 200, extra = {}) { return new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } }); }
function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get('Authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function emptyBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 0) return false;
  const reader = request.body?.getReader();
  if (!reader) return true;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      if (value?.byteLength) { await reader.cancel(); return false; }
    }
  } catch { return false; }
}
export function createPortfolioState(storage, secret, now = () => Date.now(), notifier = null) {
  // Serialize the compare-and-write so two publishers cannot overwrite newer state.
  let tail = Promise.resolve();
  return async function handle(request) {
    const url = new URL(request.url);
    if (['/api/portfolio/notifications', '/api/portfolio/notifications/test'].includes(url.pathname)) {
      if (url.search) return reply({ error: 'Not found.' }, 404);
      if (!authorized(request, secret)) return reply({ error: 'Unauthorized.' }, 401);
      const testing = url.pathname.endsWith('/test');
      if (request.method !== (testing ? 'POST' : 'GET')) return reply({ error: 'Method not allowed.' }, 405);
      if (testing && !await emptyBody(request)) return reply({ error: 'Test accepts no message or recipient.' }, 400);
      if (!notifier) return reply({ error: 'Notifications unavailable.' }, 503);
      try { return reply(await notifier[testing ? 'test' : 'status'](), testing ? 202 : 200); }
      catch { return reply({ error: 'Notification journal unavailable.' }, 503); }
    }
    if (url.pathname !== '/api/portfolio/state' || url.search) return reply({ error: 'Not found.' }, 404);
    if (request.method === 'GET' || request.method === 'HEAD') {
      const saved = await storage.get('state');
      if (!saved) return reply({ error: 'No published checkpoint.' }, 404);
      const extra = { ETag: saved.etag, 'Cache-Control': 'public, max-age=15, must-revalidate' };
      if (request.headers.get('If-None-Match') === saved.etag) return new Response(null, { status: 304, headers: extra });
      return new Response(request.method === 'HEAD' ? null : saved.body, { headers: { ...headers, ...extra } });
    }
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, POST' });
    if (!authorized(request, secret)) return reply({ error: 'Unauthorized.' }, 401);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return reply({ error: 'JSON required.' }, 415);
    if (Number(request.headers.get('Content-Length') || 0) > MAX_STATE_BYTES) return reply({ error: 'Payload too large.' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'Invalid checkpoint.' }, 400);
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_STATE_BYTES) { await reader.cancel(); return reply({ error: 'Payload too large.' }, 413); }
      chunks.push(value);
    }
    let state;
    try { state = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply({ error: 'Invalid JSON.' }, 400); }
    if (!validRuntime(state) || Date.parse(state.published_at) > now() + 60_000) return reply({ error: 'Invalid checkpoint.' }, 400);
    const body = JSON.stringify(state);
    const bytes = new TextEncoder().encode(body);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const etag = '"' + Buffer.from(hash).toString('hex') + '"';
    const operation = tail.then(async () => {
      const previous = await storage.get('state');
      if (previous && previous.etag === etag) {
        try { await notifier?.checkpoint(); } catch { /* Saved publication remains valid. Alarm retries notification work. */ }
        return reply({ published_at: state.published_at });
      }
      if (previous && state.published_at <= previous.published_at) return reply({ error: 'A newer checkpoint is already published.' }, 409);
      await storage.put('state', { body, etag, published_at: state.published_at });
      try { await notifier?.checkpoint(); } catch { /* Notifications must not reject a saved checkpoint. */ }
      return reply({ published_at: state.published_at });
    });
    tail = operation.catch(() => {});
    return operation;
  };
}
