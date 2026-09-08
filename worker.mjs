import { DurableObject } from 'cloudflare:workers';
import { createExchange } from './lib/exchange.mjs';
import { createApi, securityHeaders } from './lib/api.mjs';

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
