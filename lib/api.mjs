import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './exchange.mjs';

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const hash = value => createHash('sha256').update(value).digest();
export function createApi(exchange, { sessionSecret, adminKey }) {
  if (sessionSecret?.length < 32 || adminKey?.length < 32 || !sessionSecret || !adminKey) throw new Error('Strong session and admin secrets are required.');
  const sign = value => createHmac('sha256', sessionSecret).update(value).digest('base64url');
  const cookieValue = (request, name) => (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  function visitor(request) {
    const value = cookieValue(request, 'bw_visitor');
    const [id, signature] = value.split('.');
    return /^[A-Za-z0-9_-]{32}$/.test(id || '') && signature === sign(id) ? id : null;
  }
  const cookie = (request, name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  return async function api(request, networkAddress) {
    const url = new URL(request.url);
    const path = url.pathname;
    const headers = { ...securityHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    try {
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'Please use the form on this website.');
        if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new ApiError(415, 'JSON required.');
        await exchange.checkRequestRate(sign(`network:${networkAddress}`), path === '/api/admin/login' ? 'login' : 'write');
      }
      async function body() {
        if (Number(request.headers.get('content-length')) > 4096) throw new ApiError(413, 'Request too large.');
        const reader = request.body?.getReader();
        let text = '', size = 0;
        const decoder = new TextDecoder();
        if (reader) while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) { await reader.cancel(); throw new ApiError(413, 'Request too large.'); }
          text += decoder.decode(value, { stream: true });
        }
        try { const parsed = JSON.parse(text + decoder.decode()); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed; }
        catch { throw new ApiError(400, 'Invalid request.'); }
      }
      if (path === '/api/exchange' && request.method === 'GET') return response(await exchange.snapshot());
      if (path === '/api/visitor' && request.method === 'POST') {
        const id = visitor(request) || randomBytes(24).toString('base64url');
        headers['Set-Cookie'] = cookie(request, 'bw_visitor', `${id}.${sign(id)}`, 31536000);
        return response({ nextOrderAt: await exchange.nextOrderAt(sign(`visitor:${id}`)) });
      }
      if (path === '/api/orders' && request.method === 'POST') {
        const id = visitor(request);
        if (!id) throw new ApiError(401, 'Please enable cookies and reopen the ticket.');
        return response(await exchange.submit(await body(), sign(`visitor:${id}`), sign(`network:${networkAddress}`)), 201);
      }
      if (path === '/api/admin/login' && request.method === 'POST') {
        const input = await body();
        if (typeof input.key !== 'string' || !timingSafeEqual(hash(input.key), hash(adminKey))) throw new ApiError(401, 'Invalid admin key.');
        headers['Set-Cookie'] = cookie(request, 'bw_admin', await exchange.createAdminSession(), 28800);
        return response({ ok: true });
      }
      if (path.startsWith('/api/admin/')) {
        const token = cookieValue(request, 'bw_admin');
        if (!await exchange.authenticated(token)) throw new ApiError(401, 'Sign in to review notes.');
        if (path === '/api/admin/logout' && request.method === 'POST') {
          await exchange.logout(token);
          headers['Set-Cookie'] = cookie(request, 'bw_admin', '', 0);
          return response({ ok: true });
        }
        if (path === '/api/admin/orders' && request.method === 'GET') {
          const before = Number(url.searchParams.get('before') || 2147483647);
          if (!Number.isSafeInteger(before) || before < 1) throw new ApiError(400, 'Invalid cursor.');
          return response(await exchange.reviewQueue(url.searchParams.get('status') || 'pending', before));
        }
        const match = path.match(/^\/api\/admin\/orders\/(\d+)\/moderate$/);
        if (match && request.method === 'POST') return response(await exchange.moderate(Number(match[1]), (await body()).action));
      }
      throw new ApiError(404, 'Not found.');
    } catch (error) {
      if (error.retryAt) headers['Retry-After'] = String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
      if (!(error instanceof ApiError)) console.error('Exchange request failed:', error.name);
      return response({ error: error instanceof ApiError ? error.message : 'Exchange unavailable. Please try again.', retryAt: error.retryAt }, error.status || 503);
    }
  };
}
