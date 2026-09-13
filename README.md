# Blake Woods

[Live website](https://blakewoods.us) · [GitHub](https://github.com/bwoods1998)

Personal site for Blake Woods, with Blake Woods Stock: a fictional market guestbook. Buys add a fictional dollar; sells leave the price unchanged; optional visitor names and memos remain private until Blake approves them. No money, ownership, brokerage credentials, or trading API is involved.

[Portfolio Agent](https://blakewoods.us/portfolio/) follows the AI spending cycle across nine companies. Explore the company map, a checked cash-flow scenario, and dated research checkpoints. Technical detail lives on GitHub. Visitors cannot start paid work or access an account. Schwab is disconnected.

## Publish research

The [Portfolio Agent repository](https://github.com/bwoods1998/portfolio-agent)
owns research, private state, and review. From that repository, export one
consistent saved publication:

```sh
python3 scripts/export_project.py --site ../personal-site --state checkpoint
```

This offline command derives reviewed counts and known costs from one read-only
ledger snapshot, includes unknown usage, and validates this site's JSON contracts
before replacing files. Use `--state running` only for a dated observation of
work actually running. It does not publish raw drafts or deploy the site.

Review the public JSON diff, then run the site's checks, tests, build and deployment.
A fresh clone builds without Python, Sail access or private data. Only HTML,
hashed assets and allowlisted JSON enter the public bundle. Historical evaluation
and replay assets remain available; the default page keeps technical detail on
GitHub. Public visits never trigger inference.

The optional `portfolio/overnight-research.json` checkpoint contains typed stage
counts, costs and mechanical checks only. The build rejects extra fields and
contradictory totals; absent data hides the card. Model drafts and private run
identifiers never enter this publication.

## Local

Node 24 or newer:

```sh
npm ci
npm run dev
```

Open http://localhost:4173. `npm run admin` prints the private review sign-in link. Generated keys live in ignored `.dev.vars` (owner-readable only). Local orders live in ignored `.data/exchange.sqlite`.

For the published site, `npm run admin:live` prints your private sign-in link. Choose **Pending → Approve** to publish a name and memo. **Reject** keeps text private; **Approved → Hide** unpublishes text; **Delete** erases the name and memo without undoing the trade. Do not share the key or private link.

To test the actual cloud runtime: `npm run dev:cloud` (http://localhost:4175). Its local database is separate from Node development and the public database. Use `SITE_URL=http://localhost:4175 npm run admin` for its review link.

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

Public HTML uses `Cache-Control: no-transform` to prevent Cloudflare from injecting analytics scripts outside the site's self-only script policy. Hashed assets retain their normal caching; the research snapshot revalidates. See [Cloudflare's injection behavior](https://developers.cloudflare.com/web-analytics/faq/).

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

Tests cover concurrent idempotent orders, index consistency, cooldown/daily limits, moderation gating and revocation, admin session expiry/logout, forged cookies, cross-origin writes and body limits. Cloudflare runtime/browser smoke checks additionally exercise the ticket, approval flow, literal HTML text rendering, public-file allowlist and mobile overflow.

### Daily fictional cameos

A Cloudflare Cron Trigger runs at 00:00 UTC each day through an internal Durable Object RPC method. Object startup also checks the current day, so the first cameo appears immediately and a missed run can recover on a later startup. There is at most one automated buy of 1–10 shares per UTC day (+$1 per share); missed days are not bulk-backfilled. The unique system/day order key and transactional writes make retries and concurrent invocations safe, including after memo deletion.

`lib/cameos.mjs` contains original, curated jokes selected by a date-seeded hash. Automated trades use the same visual formatting as visitor trades; the simulation rules explain that famous-name cameos are fictional, not endorsements. Names display without a suffix, including previously stored cameos. Cameos are automatically approved and can be hidden or deleted with the existing moderation controls. Visitor text still requires approval. Each scheduled purchase counts as one trade; its share quantity determines the price increase and is displayed using the same format as visitor orders. Existing orders retain quantity 1. No external AI, market-data service, or additional paid infrastructure is used. The daily method has no public HTTP endpoint.
