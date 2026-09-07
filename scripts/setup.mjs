import { randomBytes } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
await mkdir(new URL('../.data/', import.meta.url), { recursive: true, mode: 0o700 });
const file = new URL('../.dev.vars', import.meta.url);
try { await writeFile(file, `SESSION_SECRET=${randomBytes(32).toString('base64url')}\nADMIN_KEY=${randomBytes(32).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
if (process.argv.includes('--admin')) {
  const vars = await readFile(file, 'utf8');
  const key = vars.match(/^ADMIN_KEY=(.+)$/m)[1];
  console.log(`${process.env.SITE_URL || 'http://localhost:4173'}/admin/#key=${key}`);
} else console.log('Local secrets ready. Keep .dev.vars private.');
