# Blake Woods

[Live website](https://blakewoods.us) · [GitHub](https://github.com/bwoods1998)

Personal site for Blake Woods, with Blake Woods Stock: a fictional market guestbook. Buys add a fictional dollar; sells leave the price unchanged; optional visitor names and memos remain private until Blake approves them. No money, ownership, brokerage credentials, or trading API is involved.

[Portfolio Agent](https://blakewoods.us/portfolio/) is an autonomous portfolio manager built on Sail, with the S&P 500 as its investment universe and total-return benchmark. The public page shows saved paper-portfolio state, decisions and current research. Live brokerage integration is pending.

[Woods Capital Management](https://blakewoods.us/capital/) is a public floor of autonomous AI portfolio-manager desks. Their thoughts, tool calls, memos, orders, fills, marks, capital allocations and evolution events stream to the site as they happen.

## Portfolio publication

The [Portfolio Agent repository](https://github.com/bwoods1998/portfolio-agent) owns the research and paper ledger. This site renders a strictly validated public checkpoint from `/api/portfolio/state`, falling back to the bundled `portfolio/runtime.json` when the endpoint is unavailable. Page visits cannot start research or submit orders.

Current tasks and heartbeat stay visible; counts, costs and timing sit inside **Run details**. A quiet **Research history** link opens timestamped findings, evidence, questions and decisions. Each finding has a stable link; financial figures link to the exact SEC filing. Failed checks remain visible without publishing their unsupported claims.

The history API is an append-only public projection. Authenticated batches contain at most 20 strictly validated records; public reads paginate 12 summaries at a time, with full detail fetched only on demand. Retries cannot rewrite old findings. No raw prompts, internal reasoning or credentials enter the public journal.

Cloudflare alarms notify the owner on one-off run completion or missing updates, independently of the research host. Persistent weekday sessions use their separate supervisor for service health and funding alerts; routine session completion does not send another email. Delivery requires the `EMAIL` binding, the private `NOTIFICATION_EMAIL` secret, an onboarded email domain and a verified destination. See [deployment](DEPLOYMENT.md) for setup and private delivery checks.

Only the portfolio and research-history interfaces plus the initial validated checkpoint are deployed for this project. Retired portfolio interfaces, reports and publisher scripts are preserved in Git history. Old generated reports are removed on every build.

A fresh clone builds without Python, Sail credentials or private data. Validate and review a new checkpoint before deploying:

```sh
npm run check
npm test
npm run build
npm run deploy
```

The frontend shows only recorded observations. It never generates prices, backfills returns or substitutes an ETF for the S&P 500 Total Return benchmark. Pending paper allocations remain distinct from filled holdings.

## Woods Capital

[Woods Capital Management](https://blakewoods.us/capital/) is the public floor: `/capital/` for the floor itself, `/capital/desk/?id=<desk>` for one desk, `/capital/committee/` for Helm, the allocations, the gates and the evolution record. The [Woods Capital runtime](https://github.com/bwoods1998/portfolio-agent) owns every desk, the risk engine, the brokers and the money; this site only renders what that runtime publishes, and page visits can never start a desk session, a model request or an order.

Public prices on these pages are the floor's own fills and account-level marks. The site holds no market-data feed and republishes no licensed quote. Order intents and orders arrive only after the matching order is filled or cancelled, so nobody can trade ahead of a desk. Every page carries the position disclosure: Blake Woods owns every position shown, nothing is investment advice, and orders publish after they fill.

### Endpoints

| Endpoint | Auth | Contract |
|---|---|---|
| `POST /api/capital/events` | `CAPITAL_PUBLISH_TOKEN` bearer | `{schema_version: 1, events: [...]}`, 1–100 events, ≤512 KiB. Replies `{stored, replayed}`. |
| `POST /api/capital/checkpoint` | `CAPITAL_PUBLISH_TOKEN` bearer | One floor checkpoint, ≤256 KiB. Replies `{published_at, desks}`. |
| `GET /api/capital/checkpoint` | public | Latest checkpoint, ETag, cached 5 s. |
| `GET /api/capital/events?stream=&kind=&after=&limit=` | public | Newest first without `after`, oldest first following one; `limit` ≤200 (50 by default); ETag, cached 3 s. |
| `GET /api/capital/desks`, `GET /api/capital/desks/<id>` | public | The desk rows of the latest checkpoint. ETag, cached 5 s. |
| `GET /api/capital/stream?streams=desk:earnings-01,risk` | public, same-origin | WebSocket. Sends `{"type":"hello","latest_seq":N}`, then each stored event to matching subscriptions. |

Events are append-only and idempotent by `id`: replaying an identical event is a no-op, and the same `id` with a different `digest` returns 409 without storing any event in that batch. The site assigns its own `seq`; the publisher's `seq` is accepted and ignored. Checkpoints move forward only — an older `published_at` returns 409, an identical body is a no-op, and more than a minute into the future is rejected. The desk roster is exactly the desks of the newest checkpoint.

Validation is shared between the Worker and the browser in `capital/schema.js`, so nothing renders that the server would not have stored. Payloads may not carry a key beginning with `_` at any depth, a string over 8,000 characters, a `<`, anything shaped like a credential (`sk-`, `Bearer `, `APCA-`), or a URL outside sec.gov, www.sec.gov, efts.sec.gov, blakewoods.us, github.com, kalshi.com and finance.yahoo.com. `provider.request` is not a publishable kind: paid model traffic stays private.

### The live tape

The floor page opens one WebSocket per visitor through the Durable Object Hibernation API (`ctx.acceptWebSocket`), so the object sleeps between events without dropping listeners. The floor accepts at most 200 sockets and only from blakewoods.us, www.blakewoods.us and localhost. When the socket is unavailable — an older browser, a proxy, a plan limit — the page falls back to polling `/api/capital/events?after=` every eight seconds and says so in the status line. Sustained WebSocket connections are a Workers Paid consideration; see [deployment](DEPLOYMENT.md).

Storage stays bounded: the floor keeps the newest 20,000 events. Stored events are never edited; corrections are new events.

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

Live at **https://blakewoods.us**, also available at https://www.blakewoods.us. Hosting uses Cloudflare Workers Free with a SQLite-backed Durable Object; the custom domain renews separately. The old `workers.dev` address and preview URLs are disabled.

For updates from this repository:

```sh
npm run check
npm test
npx wrangler login # only when authentication is needed
npm run deploy
```

`npm run deploy` builds and publishes the site. Hosted orders survive deployments and remain separate from local test data. Keep the `EXCHANGE` binding, `Exchange` class, `bw-exchange-v1` object name, and existing migration intact to preserve the ledger.

Cloudflare stores `ADMIN_KEY` and `SESSION_SECRET` as encrypted secrets. Normal deployments do not replace them. `npm run publish:first` is a one-time bootstrap helper that uploads local secrets; do not use it for routine updates. Changing the admin password invalidates existing admin sessions; changing `SESSION_SECRET` invalidates visitor cookies.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the live moderation link. Free-plan quotas still apply; review usage before enabling paid hosting.

Published source/assets are explicitly selected. Resume, archives, `.dev.vars`, `.data`, tests and server internals are not public assets. The admin HTML/JS shell is public but every queue and moderation endpoint requires a server-verified admin session.

Public HTML uses `Cache-Control: no-transform` to prevent Cloudflare from injecting analytics scripts outside the site's self-only script policy. Hashed assets retain their normal caching; the public portfolio checkpoint revalidates. See [Cloudflare's injection behavior](https://developers.cloudflare.com/web-analytics/faq/).

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
- Manual approval costs no model/API fees. There are no paid market-data feeds, websocket connections, polling loops or keep-alive services. One daily Cron Trigger creates the fictional cameo buy.
- Public snapshots can be cached for three seconds, so prices and moderation changes may take that long to appear across visitors. Refresh is explicit. Private endpoints are never cached.
- One SQLite Durable Object is the consistent shared ledger. It handles a personal site's market, not exchange-scale trading. Quotas and a single ledger's throughput still apply. CDN-served pages scale independently.
- Static files can remain accessible if the exchange reaches a quota. Expect to review storage/retention if the project becomes popular.

Current free-plan documentation (checked September 7, 2026):
https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/durable-objects/platform/pricing/
https://developers.cloudflare.com/durable-objects/platform/limits/

## Verification

`npm run check`, `npm test`, `npm run build`, and `npx wrangler deploy --dry-run`.

Woods Capital adds `test/capital.test.mjs`: publication validators, idempotent and conflicting batches, checkpoint monotonicity and the derived desk roster, pagination and ETags, WebSocket tag matching and fan-out, the floor, desk and committee pages mounted against a stub DOM, and the build of the new pages with hashed assets.

Tests cover concurrent idempotent orders, index consistency, cooldown/daily limits, moderation gating and revocation, admin session expiry/logout, forged cookies, cross-origin writes and body limits. Cloudflare runtime/browser smoke checks additionally exercise the ticket, approval flow, literal HTML text rendering, public-file allowlist and mobile overflow.

### Daily fictional cameos

A Cloudflare Cron Trigger runs at 00:00 UTC each day through an internal Durable Object RPC method. Object startup also checks the current day, so the first cameo appears immediately and a missed run can recover on a later startup. There is at most one automated buy of 1–10 shares per UTC day (+$1 per share); missed days are not bulk-backfilled. The unique system/day order key and transactional writes make retries and concurrent invocations safe, including after memo deletion.

`lib/cameos.mjs` contains original, curated jokes selected by a date-seeded hash. Automated trades use the same visual formatting as visitor trades; the simulation rules explain that famous-name cameos are fictional, not endorsements. Names display without a suffix, including previously stored cameos. Cameos are automatically approved and can be hidden or deleted with the existing moderation controls. Visitor text still requires approval. Each scheduled purchase counts as one trade; its share quantity determines the price increase and is displayed using the same format as visitor orders. Existing orders retain quantity 1. No external AI, market-data service, or additional paid infrastructure is used. The daily method has no public HTTP endpoint.
