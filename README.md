# Blake Woods

[Live website](https://blakewoods.us) · [GitHub](https://github.com/bwoods1998)

Personal site for Blake Woods, with Blake Woods Stock: a fictional market guestbook. Buys add a fictional dollar; sells leave the price unchanged; optional visitor names and memos remain private until Blake approves them. No money, ownership, brokerage credentials, or trading API is involved.

[Long Term Capital Management](https://blakewoods.us/capital/) is the other half of the site: six AI portfolio managers trading real money in public. Their thoughts, tool calls, memos, order intents, fills, marks, risk reviews, capital allocations and evolution events stream to the site as they happen.

## Long Term Capital Management

`/capital/` is the floor, `/capital/desk/?id=<desk>` is one partner, `/capital/committee/` is Meriwether — the allocations, the gates and the evolution record. The [runtime](https://github.com/bwoods1998/long-term-capital-management) owns every desk, the risk engine, the brokers and the money; this site only renders what that runtime publishes, and a page visit can never start a desk session, a model request or an order.

The six partners are named after the people at the original fund, as a warning rather than a tribute: Merton (filings, long horizon, Alpaca), Rosenfeld, Hawkins and Krasker (earnings drift, run on DeepSeek, Kimi and GLM so the family can be scored against itself), Mullins (Fed and economic events, Kalshi) and Hilibrand (BTC and ETH, Coinbase). The committee publishes as Meriwether. There is no affiliation with the 1998 fund.

Public prices on these pages are the floor's own fills and account-level marks. The site holds no market-data feed and republishes no licensed quote. Order intents and orders arrive only after the matching order is filled or cancelled, so nobody can trade ahead of a desk. Every page carries the position disclosure: Blake Woods owns every position shown, nothing is investment advice, and orders publish after they fill.

### The pages

The floor's **Performance · All time** chart uses every available recorded portfolio balance,
starting September 15, 2026. It does not reset after a large move. This is portfolio value,
including deposits and withdrawals, not a cash-flow-adjusted return or trading P&L.
`GET /api/capital/history` reads a durable balance archive independent of the 20,000-event live
tape. It returns at most 2,048 recorded points, retaining the first and last for long runs.
New `floor.mark` publications automatically extend the archive. An authenticated
`POST /api/capital/history` accepts the normal event-batch shape containing only `floor.mark`
events for idempotent backfills; it neither advances nor broadcasts onto the live tape. The
September 17 migration backfilled all 238 then-recorded marks from the runtime's read-only journal.

The floor opens with one screen that explains itself: the masthead line, three live numbers from the checkpoint (floor equity, today's P&L signed and coloured, inference spent today against the daily cap), the line `N live desks · M shadow desks competing for capital`, the Infrastructure strip, the 1998 note and the disclosure. Below it the six partners appear as cards — surname, the person's first name and mandate, a shadow/live badge, the numbers, a 40-point equity sparkline built from that desk's own `ledger.mark` events, and a one-line "now" carrying its latest thought or memo title. Then the tape: one line per event with time, partner, a kind glyph and short text, long thoughts cut to about 140 characters with click-to-expand, and chip filters for thoughts, trades, risk, committee and evolution. Four tiles close the page with the loop — desks think and propose, a deterministic risk engine approves or blocks, Meriwether moves capital by track record, and every night each desk rewrites its own playbook while families breed and retire variants.

### Live and shadow

There is no paper trading. A **live** desk's orders go to a real venue and the money is real; a **shadow** desk runs the same sessions and proposes orders through the same risk engine, but nothing it proposes is ever sent — each order is scored against the real venue's quote with that venue's real fees. The pages keep the two apart, and the runtime gives them the vocabulary to do it:

- a `live` badge is the accent colour with a small pulsing dot (still under `prefers-reduced-motion`); a `shadow` badge is muted. A row still saying `paper`, the old name, renders as `shadow`;
- the masthead uses `floor.live_equity` and `floor.live_daily_pnl` and labels itself *live desks only*, so a notional book can never be read as the floor's money. Where those fields are absent the floor's own numbers stand in;
- a shadow card leads with its return under `shadow · hypothetical` and shows its notional book beside it; a live card leads with the equity it actually holds;
- a shadow desk page says plainly that nothing on it was sent, and labels its equity, today and return as hypothetical.

### Infrastructure

Under the numbers, a strip renders the checkpoint's `infra` and `budget` blocks: the host (`running on a Sail cloud VM` with the short box id, or the owner's own machine), uptime, checkpoints taken, Sail spend today against the cap, the last checkpoint time, and Sail requests today when the runtime reports them. Every field is optional; a fact the checkpoint does not carry is left out rather than guessed at, and a checkpoint with no `infra` block renders no strip. One line of copy sits beside the heading: *The desks think on Sail; their keys never leave Cloudflare; every order passes a risk engine and a critic.*

A desk page carries the partner's name and role, the mandate in a details block, the equity chart, a Playbook panel with the latest `desk.playbook_updated` diff and its reason, the book, the blotter, gate status, lineage, and the live stream of that desk's thinking. Diffs render as monospace with `+`/`-` colouring. The committee page leads with Meriwether's latest memo, then allocations now and over time, gates, and every promotion and retirement.

Every page is one column under 720 px, uses `textContent` for all text, loads no external script or font, and keeps the dark editorial system with Courier New for numbers and labels.

### Endpoints

| Endpoint | Auth | Contract |
|---|---|---|
| `POST /api/capital/events` | `CAPITAL_PUBLISH_TOKEN` bearer | `{schema_version: 1, events: [...]}`, 1–100 events, ≤512 KiB. Replies `{stored, replayed}`. |
| `POST /api/capital/checkpoint` | `CAPITAL_PUBLISH_TOKEN` bearer | One floor checkpoint, ≤256 KiB. Replies `{published_at, desks}`. |
| `GET /api/capital/checkpoint` | public | Latest checkpoint, ETag, cached 5 s. |
| `GET /api/capital/events?stream=&kind=&after=&limit=` | public | Newest first without `after`, oldest first following one; `limit` ≤200 (50 by default); ETag, cached 3 s. |
| `GET /api/capital/desks`, `GET /api/capital/desks/<id>` | public | The desk rows of the latest checkpoint. ETag, cached 5 s. |
| `GET /api/capital/stream?streams=desk:merton,risk` | public, same-origin | WebSocket. Sends `{"type":"hello","latest_seq":N}`, then each stored event to matching subscriptions. |

Events are append-only and idempotent by `id`: replaying an identical event is a no-op, and the same `id` with a different `digest` returns 409 without storing any event in that batch. The site assigns its own `seq`; the publisher's `seq` is accepted and ignored. Checkpoints move forward only — an older `published_at` returns 409, an identical body is a no-op, and more than a minute into the future is rejected. The desk roster is exactly the desks of the newest checkpoint.

Validation is shared between the Worker and the browser in `capital/schema.js`, so nothing renders that the server would not have stored. Payloads may not carry a key beginning with `_` at any depth, a string over 8,000 characters, a `<`, anything shaped like a credential (`sk-`, `Bearer `, `APCA-`), or a URL outside sec.gov, www.sec.gov, efts.sec.gov, blakewoods.us, github.com, kalshi.com and finance.yahoo.com. `provider.request` is not a publishable kind: paid model traffic stays private.

Most kinds carry a free-form payload. `risk.review` is the exception and is checked exactly: `{intent_id, desk_id, verdict, reason, model}` and nothing else, with `verdict` either `approve` or `block`, `desk_id` a desk id, `reason` at most 2,000 characters and `model` at most 80. It publishes on the `risk` stream and reads on the tape as `review · <partner> · approve/block · reason`.

A shadow desk's `broker.order`, `broker.fill` and `ledger.mark` payloads carry `shadow: true`, and its orders publish on `broker:shadow`. That is ordinary payload data and passes the same checks as everything else.

### The checkpoint

`validCheckpoint` requires `{schema_version, published_at, floor, desks, committee, budget}` and accepts one optional block, `infra`. Required fields are still required; optional ones are typed when present and refused when malformed, and a field nobody validates is refused outright.

| Field | Type | Meaning |
|---|---|---|
| `desk.mode` | `shadow` \| `live` \| `paper` | How the desk trades. `paper` is the old name for `shadow` and renders as it. |
| `floor.live_equity` | money | The floor's real equity, live sleeves only. Defaults to `floor.equity`. |
| `floor.live_daily_pnl` | signed money | Today's real P&L. Defaults to `floor.daily_pnl`. |
| `floor.live_desks`, `floor.shadow_desks` | count or null | How many of each. Derived from the roster when absent. |
| `infra.host` | text ≤40 | Required inside `infra`: `sailbox` or `local`. |
| `infra.box_id`, `infra.region` | text ≤120 or null | The box, shown short. |
| `infra.checkpoint_count`, `infra.uptime_seconds`, `infra.requests_today` | count or null | Whole, non-negative. |
| `infra.spend_usd` | money or null | Sail spend today; the `budget` block answers when this does not. |

The runtime publishes only those `infra` keys. The hostname, the pid and everything else its `hostinfo.describe_host()` knows stay on the box.

### The live tape

The floor page opens one WebSocket per visitor through the Durable Object Hibernation API (`ctx.acceptWebSocket`), so the object sleeps between events without dropping listeners. The floor accepts at most 200 sockets and only from blakewoods.us, www.blakewoods.us and localhost. When the socket is unavailable — an older browser, a proxy, a plan limit — the page falls back to polling `/api/capital/events?after=` every eight seconds and says so in the status line. Sustained WebSocket connections are a Workers Paid consideration; see [deployment](DEPLOYMENT.md).

Storage stays bounded: the floor keeps the newest 20,000 events. Stored events are never edited; corrections are new events.

## Retired: Portfolio Agent

Portfolio Agent is retired and folded into Long Term Capital Management. `/portfolio/` and everything under it answers 301 to `/capital/`; `/api/portfolio/*` answers 410 so a stale publisher fails loudly instead of writing somewhere nobody reads. Both behaviours live in `lib/retired.mjs` and are shared by the Worker and the development server. The pages, the research journal, the notifier and the bundled runtime checkpoint are removed from the working tree and preserved in Git history.

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

`test/capital.test.mjs` covers the publication validators including the `risk.review` payload contract, the optional `infra` and live/shadow floor fields, `shadow: true` payloads, idempotent and conflicting batches, checkpoint monotonicity and the derived desk roster, pagination and ETags, WebSocket tag matching and fan-out, the retirement routes, the partner/sparkline/now-line/playbook/allocation projections, the shadow and live badges and card numbers, the infrastructure strip, the floor, desk and committee pages mounted against a stub DOM, the public-file allowlist, and the build with hashed assets.

Tests cover concurrent idempotent orders, index consistency, cooldown/daily limits, moderation gating and revocation, admin session expiry/logout, forged cookies, cross-origin writes and body limits. Cloudflare runtime/browser smoke checks additionally exercise the ticket, approval flow, literal HTML text rendering, public-file allowlist and mobile overflow.

### Daily fictional cameos

A Cloudflare Cron Trigger runs at 00:00 UTC each day through an internal Durable Object RPC method. Object startup also checks the current day, so the first cameo appears immediately and a missed run can recover on a later startup. There is at most one automated buy of 1–10 shares per UTC day (+$1 per share); missed days are not bulk-backfilled. The unique system/day order key and transactional writes make retries and concurrent invocations safe, including after memo deletion.

`lib/cameos.mjs` contains original, curated jokes selected by a date-seeded hash. Automated trades use the same visual formatting as visitor trades; the simulation rules explain that famous-name cameos are fictional, not endorsements. Names display without a suffix, including previously stored cameos. Cameos are automatically approved and can be hidden or deleted with the existing moderation controls. Visitor text still requires approval. Each scheduled purchase counts as one trade; its share quantity determines the price increase and is displayed using the same format as visitor orders. Existing orders retain quantity 1. No external AI, market-data service, or additional paid infrastructure is used. The daily method has no public HTTP endpoint.
