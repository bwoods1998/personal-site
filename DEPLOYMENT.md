# Live deployment

Public URL: https://blakewoods.us (also available at https://www.blakewoods.us).

Published September 7, 2026 to Cloudflare Workers with SQLite Durable Objects. The custom domain is registered with Cloudflare; hosting remains on the Free plan. The original workers.dev address is disabled in Wrangler configuration. Both custom hostnames use the same existing Worker and databases, separate from local test databases.

Update: `npm run deploy` from this directory.

## Long Term Capital Management publication

Public page: https://blakewoods.us/capital/ (AI agents trading options; schema 2 since September 26, 2026). `/capital/desk/*` and `/capital/committee/*` redirect to it.

The record lives in its own SQLite Durable Object: binding `CAPITAL`, class `Capital`, migration tag `v3`, singleton object `capital-v1` (test tapes: `capital-tape-test`, `capital-tape-canary`). Keep all four intact on every later deployment or the tape, the checkpoint and the roster are orphaned. The existing `EXCHANGE` (`v1`) and retired `PORTFOLIO_STATE` (`v2`) objects are untouched by this project.

Create the publication secret once, with a value of at least 32 characters:

```sh
npx wrangler secret put CAPITAL_PUBLISH_TOKEN
```

The runtime sends that token as `Authorization: Bearer <token>` to `POST /api/capital/events`, `/history`, `/checkpoint` and `/reset`. All compare in constant time and refuse a token under 32 characters. Never put the token in a URL, a page, or a browser request. Reads are public and unauthenticated: `GET /api/capital/checkpoint` (ETag, 5 s; 404 until the first checkpoint), `GET /api/capital/events?stream=&kind=&after=&limit=` (ETag, 3 s, limit ≤200), `GET /api/capital/history` and `GET /api/capital/agents[/<id>]` (ETag, 5 s). Public GETs are also cached at the edge for their max-age; the WebSocket route is never cached.

Events are immutable and idempotent by `id`. Replaying a batch is safe; reusing an `id` with a different `digest` returns 409 and stores nothing from that batch, so a publisher crash cannot rewrite public history. Checkpoints only move forward; an older `published_at` returns 409.

### Starting over (the reset)

The owner's reset erases one record's tape, balance history, checkpoint and roster. It needs the publish token and the confirmation in the query, and it touches nothing else:

```sh
curl -fsS -X POST -H "Authorization: Bearer $CAPITAL_PUBLISH_TOKEN" -H 'Content-Type: application/json' \
  'https://blakewoods.us/api/capital/reset?confirm=erase-everything'
```

and the same under `/api/capital/t/test/reset` and `/api/capital/t/canary/reset`. Afterwards `GET /api/capital/checkpoint` answers 404 until the House publishes again; the page reads "stopped" with every number a dash. Deploy the schema-2 site before the House publishes schema 2: an older site refuses the whole checkpoint. The positions ledger (Sept 28, 2026) is the exception: either may deploy first. An older site answers 400 to a checkpoint carrying `positions`; the House then posts the same checkpoint without it (one warning per distinct reply, quoting it) and offers the ledger again half an hour later, so Profit and everything else keep publishing. The planned order for this first release is the House, then the site: until the site deploys, the page shows the House's new Profit (calibration round trips and account activity included) under the older "options trading P&L" tooltip and no Positions table; within half an hour of the site deploying, the House offers the ledger again and the table appears. Already-open pages are unaffected either way: only `?progress=1&positions=1` reads carry the block. The same holds for the practice league, Claude's own compute part and the incubator route (Sept 30, 2026): an older site answers 400, the House sends the checkpoint without the practice block and with Claude inside `other_usd`, and offers them again half an hour later; the new site takes either shape, and only `?progress=1&positions=1&practice=1` reads (the new page) carry them. Deploy the site before the House switches the incubator on: its label must be live first.

### What the publisher must send

Schema 2, exactly: see the README's checkpoint section and the runtime's `league/tests/fixtures/site_contract.md`. Every block is an allowlist; every sentence is quote-free and names no venue. The House's publisher (`league/publish.py`) masks both before it sends.

`GET /api/capital/stream?streams=agent:condor-vrp-3,swarm` upgrades to a WebSocket served by the Durable Object Hibernation API. It accepts only the blakewoods.us, www.blakewoods.us and localhost origins, at most 200 concurrent sockets, and treats client messages as keepalives only. Durable Object WebSockets bill for duration while connected: sustained WebSocket work is documented under Workers Paid. Hibernation keeps that cost near zero between events, and the page falls back to polling automatically if the socket is refused, so a plan limit degrades the tape instead of breaking the page.

Current Durable Object pricing and limits:
https://developers.cloudflare.com/durable-objects/platform/pricing/
https://developers.cloudflare.com/durable-objects/best-practices/websockets/

The current page accepts the optional schema-2 `trading {as_of, pnl_usd}` block. Deploy the site before enabling that publisher field; older checkpoints remain accepted, but the Profit headline is a dash until a fresh options total arrives. This field is the complete live-options P&L, not account equity or profit after compute.

The swarm window (Oct 1, 2026) adds the optional `levels` and `rationale` checkpoint blocks, read only by `?progress=1&positions=1&practice=1&window=1`, the additive `score_history` table behind `GET /api/capital/score`, and `/api/capital/events?agent=<id>` with its `events_news_agent` index. Either side may deploy first: an older site answers 400 to a checkpoint carrying the window, and the House sends it without the window and offers it again half an hour later. The Worker refuses a window whose thesis or tag carries a number in words by the House's own rule (schema.js `numbered`, mirrored from the House's `league/swarm/public.py`), so the two sides must ship the same rule; the House's case list and a parity test hold them together.

The page that drew the window was rolled back to its prior design the same day (PR "Capital: restore the prior design"): `/capital/` reads `?progress=1&positions=1&practice=1` again, which a stored window never changes, so this Worker and the House stay exactly as they are and the House keeps publishing the window. The window read, `GET /api/capital/score` and `?agent=` stay in place, read by no page until a later change draws them. Deploying that rollback is a plain site deploy, not the rollback below: the Worker is unchanged.

**Rolling the site back past the swarm window is not a plain revert.** Once a checkpoint with the window is stored, the older Worker (420a7de or before) spreads every stored block it does not take out into each read (`const { positions, practice, ...checkpoint } = JSON.parse(saved.body)`), so `levels` and `rationale` reach every page read and the older page refuses the whole checkpoint: every number a dash until the House's next publish replaces the stored body (the older Worker refuses the window and the House sends the checkpoint without it), and for as long as the House is paused. Re-posting a checkpoint by hand cannot repair it: the stored `published_at` refuses an equal or older one (409). To roll back safely, deploy 420a7de with one line changed in `readCheckpoint` (`lib/capital.mjs`): `const { positions, practice, levels: _levels, rationale: _rationale, ...checkpoint } = JSON.parse(saved.body);`. The older Worker then serves the stored checkpoint without the window at once and refuses the House's next one with it, which the House then sends without it. `score_history` and the new index stay behind unused; redeploying this site reads them again. Pages already open on the new page read `window=1`, which the older Worker answers 404: they recover on reload.

`agent_names` is an additive SQLite table in the existing `Capital` object. On first startup the current roster and retained tape receive stable partner aliases; subsequent publication allocates names transactionally. Names survive clipping and restarts and are removed only by the explicit record reset. Public reads and WebSocket delivery add a validated `display_name`, while the original checkpoint/event bodies and IDs remain intact. Keep the object identity and `v3` migration unchanged; do not reset production to deploy this update.

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
