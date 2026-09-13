# Live deployment

Public URL: https://blakewoods.us (also available at https://www.blakewoods.us).

Published September 7, 2026 to Cloudflare Workers with a SQLite Durable Object. The custom domain is registered with Cloudflare; hosting remains on the Free plan. The original workers.dev address is disabled in Wrangler configuration. Both custom hostnames use the same existing Worker and exchange database, separate from local test databases.

Update: `npm run deploy` from this directory.

Portfolio Agent: https://blakewoods.us/portfolio/. The sibling project publishes validated checkpoints to `/api/portfolio/state` using a private publication secret. The page reads saved state without starting research; the bundled `portfolio/runtime.json` provides an initial fallback. Website assets use the normal site deployment.

## Research publication

`POST /api/portfolio/research` accepts `{schema_version: 1, entries: [...]}` with the same private publication bearer token. Records are immutable: replaying the same entry succeeds; changing an existing ID returns 409 without saving the rest of the batch. The project exporter independently matches financial claims before publication.

Public `GET /api/portfolio/research` returns 12 summaries with an opaque `next_cursor`; pass it as `?cursor=` for the next page. `GET /api/portfolio/research/<id>` returns the selected finding. Both support ETags and HEAD. No API read starts research. Records are stored in the existing PortfolioState Durable Object; no new migration or paid provider credential is required for the website.

## Portfolio email alerts

Onboard `blakewoods.us` in Cloudflare Email Service and verify the owner's destination address through Email Routing. [Sending to verified destinations is free](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/). The Worker uses a restricted `EMAIL` binding and a private `NOTIFICATION_EMAIL` secret; it cannot accept visitor-supplied recipients or messages.

Persistent service checkpoints include a typed `service` field; their independent supervisor handles health and funding alerts, so routine research sessions do not generate repeated completion emails. For one-off runs, the PortfolioState Durable Object sends a completion alert on the actual terminal checkpoint, including an early finish. A missing heartbeat for ten minutes generates a separate alert. Delivery does not depend on the Sailbox remaining alive.

Owner-only endpoints use the existing publication bearer token: `GET /api/portfolio/notifications` reads the delivery journal; an empty `POST /api/portfolio/notifications/test` requests one fixed connection test per UTC day. Never put the bearer token in a URL or browser code. Provider acceptance is recorded separately from inbox delivery; uncertain sends are retained without automatic duplication. Verified configuration failures can retry for up to 24 hours.

Moderation: https://blakewoods.us/admin/

Print your private sign-in link locally:

```sh
npm run admin:live
```

Do not share the generated link or `.dev.vars`. All visitor text requires approval; approved memos can be hidden or permanently deleted; numeric trades are immediate. Free-tier quotas apply.
