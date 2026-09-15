// Portfolio Agent is retired: Long Term Capital Management is the one project now. Its pages
// redirect to the floor and its API answers 410, so a stale publisher fails loudly instead of
// writing into an endpoint nobody reads. The Worker and the development server share this table.
export const RETIRED_MESSAGE = 'The Portfolio Agent API is retired. Long Term Capital Management publishes to /api/capital/.';
export const RETIRED_TARGET = '/capital/';

export function retiredRoute(pathname) {
  if (typeof pathname !== 'string') return null;
  if (pathname === '/api/portfolio' || pathname.startsWith('/api/portfolio/')) {
    return {
      status: 410,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      body: JSON.stringify({ error: RETIRED_MESSAGE }),
    };
  }
  if (pathname === '/portfolio' || pathname.startsWith('/portfolio/')) {
    return { status: 301, headers: { Location: RETIRED_TARGET, 'Cache-Control': 'public, max-age=3600' }, body: '' };
  }
  return null;
}
