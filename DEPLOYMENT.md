# Live deployment

Public URL: https://blakewoods.us (also available at https://www.blakewoods.us).

Published September 7, 2026 to Cloudflare Workers with a SQLite Durable Object. The custom domain is registered with Cloudflare; hosting remains on the Free plan. The original workers.dev address is disabled in Wrangler configuration. Both custom hostnames use the same existing Worker and exchange database, separate from local test databases.

Update: `npm run deploy` from this directory.

Moderation: https://blakewoods.us/admin/

Print your private sign-in link locally:

```sh
npm run admin:live
```

Do not share the generated link or `.dev.vars`. All visitor text requires approval; approved memos can be hidden or permanently deleted; numeric trades are immediate. Free-tier quotas apply.
