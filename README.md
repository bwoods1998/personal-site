# Blake Woods

[Live website](https://blakewoods.us) · [GitHub](https://github.com/bwoods1998)

Personal site for Blake Woods, with Blake Woods Stock: a fictional market guestbook. Buys add a fictional dollar; sells leave the price unchanged; optional visitor names and memos remain private until Blake approves them. No money, ownership, brokerage credentials, or trading API is involved.

[Long-Term Capital Management](https://blakewoods.us/capital/) is the other half of the site: AI agents trading options, in public. A swarm of agents trains around the clock on recorded markets, and the ones whose evidence holds trade the Brokerage Account. Their decisions, trades and the swarm's news stream to the site as they happen.

## Long-Term Capital Management

`/capital/` shows the swarm. The [runtime](https://github.com/bwoods1998/long-term-capital-management) owns the agents, the Gym, the money and the orders; the website only renders its publications. Visiting the page never starts a model call, an agent or a trade. The old desk and committee pages redirect to this single view. The page started over on September 26, 2026 (schema 2); [`capital/DESIGN.md`](capital/DESIGN.md) is its brief.

Five sections: the masthead (the Brokerage Account balance, total profit since the reset net of deposits and withdrawals, profit after compute, and the running clock), live (an agent's newest decision typed out, then the feed), the Brokerage Account (the balance chart and the reconciliation of every number), the swarm (the Gym's pace, the count in each band, and each agent's family, mechanism, band and record), and open structures (what each is, its maximum loss and its P&L).

**Never a quote.** The data licenses behind the swarm forbid publishing quotes, bids, asks, spreads, implied vols, greeks, surfaces or fitted parameters. The checkpoint has no field for any of them: every block is an allowlist, and the Worker refuses a key it does not name. Every sentence published must be quote-free (no decimal number, no dollar or cent price, no number beside a quote word) and name no venue; the runtime's publisher masks both before it sends (`league/publish.py`), and `capital/schema.js` refuses what it missed.

### Endpoints

| Endpoint | Auth | Contract |
|---|---|---|
| `POST /api/capital/events` | `CAPITAL_PUBLISH_TOKEN` bearer | `{schema_version: 2, events: [...]}`, 1–100 events, ≤512 KiB. Replies `{stored, replayed}`. Every `account.mark` is also archived as the balance history. |
| `POST /api/capital/history` | bearer | A backfill of `account.mark` events: archived, never rebroadcast. |
| `POST /api/capital/checkpoint` | bearer | One schema-2 checkpoint, ≤512 KiB. Replies `{published_at, agents}`. |
| `POST /api/capital/reset?confirm=erase-everything` | bearer | Erases the tape, the balance history, the checkpoint and the roster of that record. |
| `GET /api/capital/checkpoint` | public | Latest checkpoint, ETag, cached 5 s. 404 until the first one. |
| `GET /api/capital/events?stream=&kind=&after=&limit=` | public | Newest first without `after`, oldest first following one; `limit` ≤200 (50 by default); ETag, cached 3 s. |
| `GET /api/capital/history` | public | The Brokerage Account's balance marks, at most 2,048 points keeping the first and last. |
| `GET /api/capital/agents`, `GET /api/capital/agents/<id>` | public | The agents of the latest checkpoint. |
| `GET /api/capital/stream?streams=agent:condor-vrp-3,swarm` | public, same-origin | WebSocket. Sends `{"type":"hello","latest_seq":N}`, then each stored event to matching subscriptions. |

**Test tape.** Every endpoint above also answers under `/api/capital/t/test/...` and `/api/capital/t/canary/...`: a separate Durable Object with its own tape, history and checkpoint, published to with the same token. `/capital/?tape=test` shows that tape on the ordinary page. Any other tape name is a 404 that wakes no object (`TAPES` in `capital/schema.js`).

Events are append-only and idempotent by `id`: replaying an identical event is a no-op, and the same `id` with a different `digest` returns 409 without storing any event in that batch. Checkpoints move forward only: an older `published_at` returns 409, an identical body is a no-op, and more than a minute into the future is refused.

### The checkpoint and the tape

`validCheckpoint` requires exactly `{schema_version: 2, published_at, run, account, performance, compute, gym, agents, structures}`; a block the House does not have yet is `null` and a list is empty, and the page says so. The tape has four kinds, each with one exact payload: `agent.note {text}` on `agent:<id>`, `agent.trade {action, real, underlying, structure, legs, expiry, quantity, max_loss_usd, pnl_usd, why}` on `agent:<id>`, `swarm.news {agent, text}` on `swarm` (the agent a sentence is about rides its own field, never the words), and `account.mark {equity, cash, as_of}` on `account`. The runtime's contract, with every field, is [`league/tests/fixtures/site_contract.md`](https://github.com/bwoods1998/long-term-capital-management/blob/main/league/tests/fixtures/site_contract.md); its two fixtures are the publisher's own output, and `test/league-contract.test.mjs` publishes and draws them (`LTCM_FIXTURES=<runtime>/league/tests/fixtures/`).

**Total profit** is the account's equity less its equity at the reset less the owner's net deposits, shown only on a fresh, non-stale balance and a funding check under ten minutes old. **After compute** subtracts Sail, OpenAI, ThetaData, market data and anything else, shown only when every part is metered. The basis is the checkpoint's `performance` block, never one dated before `PERFORMANCE_START_AT` in `capital/capital.js`; that constant and `START_EQUITY` are the fallback, set at deploy time to the runtime's `performance` config.

### The live tape

The page opens one WebSocket per visitor through the Durable Object Hibernation API (`ctx.acceptWebSocket`), so the object sleeps between events without dropping listeners. It accepts at most 200 sockets and only from blakewoods.us, www.blakewoods.us and localhost. When the socket is unavailable the page falls back to polling `/api/capital/events?after=` every eight seconds. Sustained WebSocket connections are a Workers Paid consideration; see [deployment](DEPLOYMENT.md).

Storage stays bounded: the record keeps the newest 20,000 events. Stored events are never edited; corrections are new events.

## Retired: Portfolio Agent

Portfolio Agent is retired and folded into Long-Term Capital Management. `/portfolio/` and everything under it answers 301 to `/capital/`; `/api/portfolio/*` answers 410 so a stale publisher fails loudly instead of writing somewhere nobody reads. Both behaviours live in `lib/retired.mjs` and are shared by the Worker and the development server. The pages, the research journal, the notifier and the bundled runtime checkpoint are removed from the working tree and preserved in Git history.

The `PORTFOLIO_STATE` binding and its `v2` migration stay declared in `wrangler.jsonc`, with an inert exported class in `worker.mjs`, so the deployment keeps its existing stored object instead of orphaning it. Nothing routes to it.

## Local

Node 24 or newer:

```sh
npm ci
npm run dev
```

Open http://localhost:4173. `npm run admin` prints the private review sign-in link. Generated keys live in ignored `.dev.vars` (owner-readable only). Local orders live in ignored `.data/exchange.sqlite`.

For the published site, `npm run admin:live` prints your private sign-in link. Choose **Pending → Approve** to publish a name and memo. **Reject** keeps text private; **Approved → Hide** unpublishes text; **Delete** erases the name and memo without undoing the trade. Do not share the key or private link.

To test the actual cloud runtime: `npm run dev:cloud` (http://localhost:4175). Its local database is separate from Node development and the public database. Use `SITE_URL=http://localhost:4175 npm run admin` for its review link.

The Node development server serves the `/capital/` pages but not the floor API, which lives in the Durable Object: run `npm run dev:cloud` to exercise `/api/capital/*` and the live tape locally.

## Deployment

Live at **https://blakewoods.us**, also available at https://www.blakewoods.us. Hosting uses Cloudflare Workers Free with SQLite-backed Durable Objects; the custom domain renews separately. The old `workers.dev` address and preview URLs are disabled.

For updates from this repository:

```sh
npm run check
npm test
npx wrangler login # only when authentication is needed
npm run deploy
```

`npm run deploy` builds and publishes the site. Hosted orders survive deployments and remain separate from local test data. Keep the `EXCHANGE` binding, `Exchange` class, `bw-exchange-v1` object name, and existing migration intact to preserve the ledger; keep `CAPITAL`, `Capital`, `capital-v1` and `v3` intact to preserve the floor.

Cloudflare stores `ADMIN_KEY`, `SESSION_SECRET` and `CAPITAL_PUBLISH_TOKEN` as encrypted secrets. Normal deployments do not replace them. `npm run publish:first` is a one-time bootstrap helper that uploads local secrets; do not use it for routine updates. Changing the admin password invalidates existing admin sessions; changing `SESSION_SECRET` invalidates visitor cookies.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the live moderation link. Free-plan quotas still apply; review usage before enabling paid hosting.

Published source/assets are explicitly selected. Resume, archives, `.dev.vars`, `.data`, tests and server internals are not public assets. The admin HTML/JS shell is public but every queue and moderation endpoint requires a server-verified admin session.

Public HTML uses `Cache-Control: no-transform` to prevent Cloudflare from injecting analytics scripts outside the site's self-only script policy. Hashed assets retain their normal caching. See [Cloudflare's injection behavior](https://developers.cloudflare.com/web-analytics/faq/).

## Price chart and memos

The on-screen symbol is **$WOODS**, for **Blake Woods Stock**. The price is a playful stock-price simulation in fictional USD, not a security or brokerage. New buys add $1; new sells execute at the current price without lowering it. Historical trades are preserved.

- **6M / 1Y / All** select calendar periods on a time-scaled chart. Hover, touch, or arrow keys inspect prices and dates.
- A deterministic, nondecreasing series with quiet stretches, buying bursts and upward gaps starts June 1, 2021 and ends at the exchange's original 100-dollar launch reference. It is identified as generated in the expandable simulation rules, never inserted into the ledger, and never counted as visitor activity. Real trades take over from launch onward.
- Daily closing points are stored from real executions, plus recent individual trades for detail. A one-time migration backfills daily closes from existing trades without changing them. Long-range history remains available after trades leave the recent window.
- Approved memos run below the chart. The latest 20 are displayed, independent of their trade's age. All text uses `textContent`.
- **Delete** permanently erases the selected name and memo from the application database. The numeric trade, counters, daily prices and retry reference remain intact. Deleted text cannot be re-approved. Provider recovery backups may retain historical copies until their retention window expires.
- The admin password is supplied only through Cloudflare's `ADMIN_KEY` secret and ignored local `.dev.vars`. No password value belongs in source, tests, documentation or Git. Login attempts are rate limited. Changing the password invalidates previous admin sessions without resetting visitor cookies.

## Behavior and costs

- One order per minute, five per visitor/day, thirty per network/day. Signed, HttpOnly cookies; HMAC network identifiers rather than stored raw IPs. Limits deter casual spam, not determined multi-network attackers.
- A unique request reference makes order retries idempotent. Atomic transactions serialize changes to the shared market.
- EVERY visitor name and note is pending by default. Public SQL projects approved text only. Reject or hide text without changing the numeric trade. Text is rendered with `textContent`, including in the private queue.
- Manual approval costs no model/API fees. The exchange has no paid market-data feed, socket or keep-alive service; one daily Cron Trigger creates the fictional cameo buy.
- The floor's tape is the site's only socket: one hibernating Durable Object WebSocket per visitor, at most 200 at once, with an eight-second polling fallback. It bills for connected duration, which is a Workers Paid consideration.
- Public snapshots can be cached for three seconds, so prices and moderation changes may take that long to appear across visitors. Refresh is explicit. Private endpoints are never cached.
- One SQLite Durable Object is the consistent shared ledger. It handles a personal site's market, not exchange-scale trading. Quotas and a single ledger's throughput still apply. CDN-served pages scale independently.
- Static files can remain accessible if the exchange reaches a quota. Expect to review storage/retention if the project becomes popular.

Current free-plan documentation (checked September 7, 2026):
https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/durable-objects/platform/pricing/
https://developers.cloudflare.com/durable-objects/platform/limits/

## Verification

`npm run check`, `npm test`, `npm run build`, and `npx wrangler deploy --dry-run`.

`test/capital.test.mjs` covers the publication validators including the `risk.review` payload contract, the optional `infra` and live/shadow floor fields, `shadow: true` payloads, idempotent and conflicting batches, checkpoint monotonicity and the derived desk roster, pagination and ETags, WebSocket tag matching and fan-out, the retirement routes, the partner/sparkline/now-line/playbook/allocation projections, the shadow and live badges and card numbers, the infrastructure strip, the flywheel strip with each proven family's clock and capacity curve, the floor, desk and committee pages mounted against a stub DOM, the public-file allowlist, and the build with hashed assets.

Tests cover concurrent idempotent orders, index consistency, cooldown/daily limits, moderation gating and revocation, admin session expiry/logout, forged cookies, cross-origin writes and body limits. Cloudflare runtime/browser smoke checks additionally exercise the ticket, approval flow, literal HTML text rendering, public-file allowlist and mobile overflow.

### Daily fictional cameos

A Cloudflare Cron Trigger runs at 00:00 UTC each day through an internal Durable Object RPC method. Object startup also checks the current day, so the first cameo appears immediately and a missed run can recover on a later startup. There is at most one automated buy of 1–10 shares per UTC day (+$1 per share); missed days are not bulk-backfilled. The unique system/day order key and transactional writes make retries and concurrent invocations safe, including after memo deletion.

`lib/cameos.mjs` contains original, curated jokes selected by a date-seeded hash. Automated trades use the same visual formatting as visitor trades; the simulation rules explain that famous-name cameos are fictional, not endorsements. Names display without a suffix, including previously stored cameos. Cameos are automatically approved and can be hidden or deleted with the existing moderation controls. Visitor text still requires approval. Each scheduled purchase counts as one trade; its share quantity determines the price increase and is displayed using the same format as visitor orders. Existing orders retain quantity 1. No external AI, market-data service, or additional paid infrastructure is used. The daily method has no public HTTP endpoint.
