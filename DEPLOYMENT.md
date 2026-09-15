# Live deployment

Public URL: https://blakewoods.us (also available at https://www.blakewoods.us).

Published September 7, 2026 to Cloudflare Workers with SQLite Durable Objects. The custom domain is registered with Cloudflare; hosting remains on the Free plan. The original workers.dev address is disabled in Wrangler configuration. Both custom hostnames use the same existing Worker and databases, separate from local test databases.

Update: `npm run deploy` from this directory.

## Long Term Capital Management publication

Public pages: https://blakewoods.us/capital/, https://blakewoods.us/capital/desk/?id=&lt;desk&gt;, https://blakewoods.us/capital/committee/.

The floor lives in its own SQLite Durable Object: binding `CAPITAL`, class `Capital`, migration tag `v3`, singleton object `capital-v1`. Keep all four intact on every later deployment or the event log, the checkpoint and the desk roster are orphaned. The existing `EXCHANGE` (`v1`) and retired `PORTFOLIO_STATE` (`v2`) objects are untouched by this project.

Create the publication secret once, with a value of at least 32 characters:

```sh
npx wrangler secret put CAPITAL_PUBLISH_TOKEN
```

The runtime sends that token as `Authorization: Bearer <token>` to `POST /api/capital/events` and `POST /api/capital/checkpoint`. Both are compared in constant time and both refuse a token under 32 characters. Never put the token in a URL, a page, or a browser request. Reads are public and unauthenticated: `GET /api/capital/checkpoint` (ETag, 5 s), `GET /api/capital/events?stream=&kind=&after=&limit=` (ETag, 3 s, limit ≤200) and `GET /api/capital/desks[/<id>]` (ETag, 5 s). Public GETs are also cached at the edge for their max-age; the WebSocket route is never cached.

Events are immutable and idempotent by `id`. Replaying a batch is safe; reusing an `id` with a different `digest` returns 409 and stores nothing from that batch, so a publisher crash cannot rewrite public history. Checkpoints only move forward; an older `published_at` returns 409.

### What the publisher must send

Desk ids are the partner surnames in lower case: `merton`, `rosenfeld`, `hawkins`, `krasker`, `mullins`, `hilibrand`. A desk publishes on `desk:<id>` and its marks on `ledger:<id>`; the committee publishes on `committee` and renders as Meriwether. Any other desk id still publishes and renders, using the `name` from the checkpoint; a bred variant named `<surname>-NN` keeps the partner's name with its suffix beside it.

`risk.review` is the one kind with a fixed payload: exactly `{intent_id, desk_id, verdict, reason, model}`, `verdict` either `approve` or `block`, on the `risk` stream. Any extra or missing field returns 400 for the whole batch. Every other kind keeps a free-form payload under the shared safety rules.

Card sparklines and the desk equity chart read `payload.equity` from `ledger.mark`; the card's "now" line reads `payload.text` from `desk.thought` and `payload.title` from `desk.memo`; the Playbook panel reads `payload.version`, `payload.reason` and `payload.diff` from `desk.playbook_updated`, where the diff may be a newline-separated string or an array of lines; the committee's allocations-over-time table reads `payload.allocations` from `committee.allocation`.

`GET /api/capital/stream?streams=desk:merton,risk` upgrades to a WebSocket served by the Durable Object Hibernation API. It accepts only the blakewoods.us, www.blakewoods.us and localhost origins, at most 200 concurrent sockets, and treats client messages as keepalives only. Durable Object WebSockets bill for duration while connected: review the plan before announcing the floor, since sustained WebSocket work is documented under Workers Paid. Hibernation keeps that cost near zero between events, and the pages fall back to polling automatically if the socket is refused, so a plan limit degrades the tape instead of breaking the page.

Current Durable Object pricing and limits:
https://developers.cloudflare.com/durable-objects/platform/pricing/
https://developers.cloudflare.com/durable-objects/best-practices/websockets/

Site assets for `/capital/` are hashed at build time and served under the same self-only policy as the rest of the site, with `wss://blakewoods.us` named in `connect-src` so the tape does not depend on how a browser reads `'self'` for WebSockets. No external script, font or analytics is loaded.

## Retired: Portfolio Agent

Portfolio Agent is folded into Long Term Capital Management. On the live site:

- `/portfolio`, `/portfolio/` and everything below answer **301** to `/capital/`, cached an hour.
- `/api/portfolio`, `/api/portfolio/state`, `/api/portfolio/research*` and `/api/portfolio/notifications*` answer **410** with a JSON body naming `/api/capital/`, uncached.

Both live in `lib/retired.mjs` and are shared by `worker.mjs` and the development server, so local and hosted behaviour cannot drift. Any still-running publisher will now fail loudly on 410 rather than writing into an endpoint nobody reads; retire its token on the publisher side.

The `PORTFOLIO_STATE` binding, its `v2` migration entry and an inert exported `PortfolioState` class stay in place so the deployment stays valid and the existing stored object is not orphaned. Nothing routes to it, its alarm handler only clears itself, and `PORTFOLIO_PUBLISH_TOKEN` can be deleted from Cloudflare secrets whenever convenient. The `send_email` binding stays declared but is no longer used by any code path; the research journal, the notifier and the bundled runtime checkpoint are removed from the tree and preserved in Git history.

Moderation: https://blakewoods.us/admin/

Print your private sign-in link locally:

```sh
npm run admin:live
```

Do not share the generated link or `.dev.vars`. All visitor text requires approval; approved memos can be hidden or permanently deleted; numeric trades are immediate. Free-tier quotas apply.
