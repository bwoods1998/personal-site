# Blake Woods

[Live website](https://blake-woods.blake-woods-personal-site.workers.dev) · [GitHub](https://github.com/bwoods1998)

Personal site for Blake Woods, with The Woods Company Stock Exchange: a fictional market guestbook. Buy/sell moves an index by one point; optional visitor names and memos remain private until Blake approves them. No money, ownership, brokerage credentials, or trading API is involved.

## Local

Node 24 or newer:

```sh
npm ci
npm run dev
```

Open http://localhost:4173. `npm run admin` prints the private review sign-in link. Generated keys live in ignored `.dev.vars` (owner-readable only). Local orders live in ignored `.data/exchange.sqlite`.

For the published site, `npm run admin:live` prints your private sign-in link. Choose **Pending → Approve** to publish a name and memo. **Reject** keeps text private; **Approved → Hide** removes previously approved text without undoing its trade. Do not share the key or private link.

To test the actual cloud runtime: `npm run dev:cloud` (http://localhost:4175). Its local database is separate from Node development and the public database. Use `SITE_URL=http://localhost:4175 npm run admin` for its review link.

## Publish for $0/month

Use **Cloudflare Workers Free**, including its SQLite-backed Durable Objects database and a free `workers.dev` address. No domain purchase, separate database account, always-on VM, or paid AI moderation is needed. Stay on Free: quotas can interrupt the exchange when exhausted; this is not unlimited hosting. Static assets are served separately and do not need the database. Do not upgrade to Workers Paid without reviewing usage-based billing.

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up and verify your email. Skip buying a domain or selecting a paid plan.
2. Run `npx wrangler login` and authorize in your browser.
3. Run `node scripts/setup.mjs` to generate local secrets if needed.
4. Run `npm run publish:first`. This builds the site, provisions its database with the Worker, installs the two private secrets, and publishes. If interrupted, rerun the command. It does not reset the database. Until both secrets are installed, API requests return an unavailable response rather than accepting unprotected orders.
5. Use the URL printed by Wrangler. Your private moderation page is `/admin/`. To print your private sign-in link: `SITE_URL=https://YOUR-URL.workers.dev npm run admin`. Store your admin key in a password manager. Never share `.dev.vars` or the private sign-in link.

Subsequent updates: `npm run deploy`. Never rename the `Exchange` class, `bw-exchange-v1` object name, or migration unless intentionally migrating the data. Deploys preserve hosted orders independently of the MacBook. Local test data is never uploaded. If you rotate `SESSION_SECRET`, visitor cookies become invalid; rotate the admin key together with clearing outstanding admin sessions if revoking compromised access.

Published source/assets are explicitly selected. Resume, archives, `.dev.vars`, `.data`, tests and server internals are not public assets. The admin HTML/JS shell is public but every queue and moderation endpoint requires a server-verified admin session.

## Market terminal

The on-screen symbol is **WOODS**, for **The Woods Company**. It is a points-based visitor simulation, not an actual security, brokerage or matching exchange. The existing one-point buy/sell rule and floor of 1 preserve all historical trades.

- **Last** is the last executed simulated price. Before the first trade, the display says **Reference**.
- **24h change** compares the latest price with the last price at or before the rolling 24-hour boundary (or the initial 100). High/low use actual executions in that window; no trades means no high/low. Trade counts are not labeled share volume.
- **Chart** shows the most recent 120 trades, equally spaced by execution order, explicitly labeled. Hover exposes the point and UTC timestamp.
- **Tape** shows the latest 20 executions with UTC time, side, price and approved name. **Memos** separately shows the latest 20 approved memos, including older trades no longer on the tape.
- Tickets show an estimated fill; concurrent trades may change the actual result. No artificial bid/ask, liquidity, market cap or unbacked real-market claim is displayed.
- The terminal borrows compact panels, numbered function tabs and amber quotes from classic financial terminals. It is not affiliated with Bloomberg. A true price-time-priority order book is a separate future upgrade.

## Behavior and costs

- One order per minute, five per visitor/day, thirty per network/day. Signed, HttpOnly cookies; HMAC network identifiers rather than stored raw IPs. Limits deter casual spam, not determined multi-network attackers.
- A unique request reference makes order retries idempotent. Atomic transactions serialize changes to the shared market.
- EVERY visitor name and note is pending by default. Public SQL projects approved text only. Reject or hide text without changing the numeric trade. Text is rendered with `textContent`, including in the private queue.
- Manual approval costs no model/API fees. There are no paid market-data feeds, websocket connections, polling loops, cron jobs or keep-alive services.
- Public snapshots can be cached for three seconds, so prices and moderation changes may take that long to appear across visitors. Refresh is explicit. Private endpoints are never cached.
- One SQLite Durable Object is the consistent shared ledger. It handles a personal site's market, not exchange-scale trading. Quotas and a single ledger's throughput still apply. CDN-served pages scale independently.
- Static files can remain accessible if the exchange reaches a quota. Expect to review storage/retention if the project becomes popular.

Current free-plan documentation (checked September 7, 2026):
https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/durable-objects/platform/pricing/
https://developers.cloudflare.com/durable-objects/platform/limits/

## Verification

`npm run check`, `npm test`, `npm run build`, and `npx wrangler deploy --dry-run`.

Tests cover concurrent idempotent orders, index consistency, cooldown/daily limits, moderation gating and revocation, admin session expiry/logout, forged cookies, cross-origin writes and body limits. Cloudflare runtime/browser smoke checks additionally exercise the ticket, approval flow, literal HTML text rendering, public-file allowlist and mobile overflow.
