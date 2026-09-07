import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const run = (args, input) => {
  const result = spawnSync('npx', ['wrangler', ...args], { stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit', input });
  if (result.status !== 0) process.exit(result.status || 1);
};
await import('./setup.mjs');
const vars = Object.fromEntries((await readFile(new URL('../.dev.vars', import.meta.url), 'utf8')).trim().split('\n').map(line => line.split('=')));
// The initial Worker fails closed until secrets are configured.
run(['deploy']);
run(['secret', 'bulk'], JSON.stringify({ SESSION_SECRET: vars.SESSION_SECRET, ADMIN_KEY: vars.ADMIN_KEY }));
console.log('Published with private exchange secrets. Review notes at your site’s /admin/ page.');
