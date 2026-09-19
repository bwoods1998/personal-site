import { DurableObject } from 'cloudflare:workers';
import { createExchange } from './lib/exchange.mjs';
import { createApi, securityHeaders } from './lib/api.mjs';
import { Capital, capitalRoute } from './lib/capital.mjs';
import { retiredRoute } from './lib/retired.mjs';

export { Capital };

export class Exchange extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    let tail = Promise.resolve();
    const database = {
      kind: 'sqlite',
      transaction(callback) {
        const operation = tail.then(() => ctx.storage.transaction(() => callback((sql, params = []) => ctx.storage.sql.exec(sql, ...params).toArray())));
        tail = operation.catch(() => {});
        return operation;
      },
    };
    ctx.blockConcurrencyWhile(async () => {
      this.market = await createExchange(database);
      await this.market.dailyBuy();
      this.api = createApi(this.market, { sessionSecret: env.SESSION_SECRET, adminKey: env.ADMIN_KEY });
    });
  }
  dailyBuy() { return this.market.dailyBuy(); }
  fetch(request) { return this.api(request, request.headers.get('CF-Connecting-IP') || 'unknown'); }
}

const retired = pathname => {
  const route = retiredRoute(pathname);
  return route ? new Response(route.body || null, { status: route.status, headers: route.headers }) : null;
};

// Retired. Portfolio Agent is now Long-Term Capital Management and nothing routes here, but the
// binding and its v2 migration stay declared so the deployment keeps its existing stored object.
export class PortfolioState extends DurableObject {
  fetch(request) { return retired(new URL(request.url).pathname) ?? retired('/api/portfolio'); }
  async alarm() { await this.ctx.storage.deleteAlarm(); }
}

export default {
  async scheduled(controller, env) {
    await env.EXCHANGE.get(env.EXCHANGE.idFromName('bw-exchange-v1')).dailyBuy();
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      url.protocol = 'https:';
      return Response.redirect(url.href, 308);
    }
    // The Portfolio Agent pages and API are retired: one project, one address.
    const gone = retired(url.pathname);
    if (gone) return gone;
    if (url.pathname === '/api/capital' || url.pathname.startsWith('/api/capital/')) {
      // A test tape (/api/capital/t/<tape>/...) is the same floor under another object's name.
      const route = capitalRoute(url.pathname);
      if (!route) return Response.json({ error: 'Not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
      // The live tape upgrades to a WebSocket; only the public JSON reads are cacheable. The key
      // is the address as asked, so a test tape and the real floor never share an entry.
      const floorRead = ['GET', 'HEAD'].includes(request.method) && route.path !== '/api/capital/stream';
      const cacheKey = floorRead ? new Request(url.href) : null;
      if (cacheKey) {
        const hit = await caches.default.match(cacheKey);
        if (hit) {
          if (request.headers.get('If-None-Match') === hit.headers.get('ETag')) return new Response(null, { status: 304, headers: hit.headers });
          return request.method === 'HEAD' ? new Response(null, hit) : hit;
        }
      }
      // The tape's object is shown the ordinary path: same method, headers, body and query.
      let forwarded = request;
      if (route.tape) {
        const inner = new URL(url);
        inner.pathname = route.path;
        forwarded = new Request(inner.href, request);
      }
      const response = await env.CAPITAL.get(env.CAPITAL.idFromName(route.object)).fetch(forwarded);
      if (cacheKey && request.method === 'GET' && response.status === 200) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      return response;
    }
    if (url.pathname.startsWith('/api/')) {
      if (!env.ADMIN_KEY || !env.SESSION_SECRET) return Response.json({ error: 'Exchange setup is incomplete.' }, { status: 503 });
      // Only the public snapshot is cached. Visitor text is projected on the server.
      const cacheable = url.pathname === '/api/exchange' && request.method === 'GET' && !url.search;
      const key = new Request(url.origin + '/api/exchange');
      if (cacheable) { const hit = await caches.default.match(key); if (hit) return hit; }
      const response = await env.EXCHANGE.get(env.EXCHANGE.idFromName('bw-exchange-v1')).fetch(request);
      if (cacheable && response.ok) {
        const cached = new Response(response.body, response);
        cached.headers.set('Cache-Control', 'public, max-age=0, s-maxage=3');
        ctx.waitUntil(caches.default.put(key, cached.clone()));
        return cached;
      }
      return response;
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    return response;
  },
};
