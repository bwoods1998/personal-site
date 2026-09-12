import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './lib/database.mjs';
import { createExchange } from './lib/exchange.mjs';
import { createApi, securityHeaders } from './lib/api.mjs';

export function createServer(api, { built = false, origin = 'http://localhost:4173' } = {}) {
  const root = new URL(built ? './dist/' : './', import.meta.url);
  return http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    const url = new URL(req.url, origin);
    if (url.origin !== origin) { res.writeHead(400); res.end(); return; }
    try {
      if (url.pathname.startsWith('/api/')) {
        const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: req, duplex: 'half' } : {}) });
        const response = await api(request, req.socket.remoteAddress || 'unknown');
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      if (url.pathname === '/admin') { res.writeHead(308, { Location: './admin/' }); res.end(); return; }
      if (url.pathname === '/portfolio') { res.writeHead(308, { Location: './portfolio/' }); res.end(); return; }
      const path = url.pathname;
      let filename = path === '/' ? 'index.html' : path === '/admin/' ? 'admin/index.html' : path === '/portfolio/' ? 'portfolio/index.html' : path.slice(1);
      const allowed = built ? /^(index\.html|(?:admin|portfolio)\/index\.html|portfolio\/(?:snapshot|investigations|evaluations)\.json|assets\/(?:(?:styles|portfolio)\.[a-f0-9]{12}\.css|(?:app|admin|chart|portfolio|investigations|evaluations)\.[a-f0-9]{12}\.js|favicon\.[a-f0-9]{12}\.svg))$/ : /^(index\.html|styles\.css|app\.js|chart\.js|favicon\.svg|admin\/(index\.html|admin\.js)|portfolio\/(index\.html|portfolio\.(?:css|js)|(?:investigations|evaluations)\.js|(?:snapshot|investigations|evaluations)\.json))$/;
      if (!allowed.test(filename)) { res.writeHead(404); res.end('Not found'); return; }
      const content = await readFile(new URL(filename, root));
      const type = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : 'image/svg+xml';
      res.writeHead(200, { ...securityHeaders, 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 503); res.end('Unable to load. Please retry.'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === 'production') throw new Error('Use npm run deploy for persistent Cloudflare hosting. This server is local development only.');
  await import('./scripts/setup.mjs');
  const vars = Object.fromEntries((await readFile(new URL('./.dev.vars', import.meta.url), 'utf8')).trim().split('\n').map(line => line.split('=')));
  const database = await openDatabase({ filename: new URL('./.data/exchange.sqlite', import.meta.url).pathname });
  const api = createApi(await createExchange(database), { sessionSecret: vars.SESSION_SECRET, adminKey: vars.ADMIN_KEY });
  const port = Number(process.env.PORT || 4173), origin = `http://localhost:${port}`;
  const server = createServer(api, { built: process.argv.includes('--built'), origin });
  server.listen(port, '127.0.0.1', () => console.log(`Blake's site → ${origin}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await database.close(); process.exit(0); }));
}
