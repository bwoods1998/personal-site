import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { validRuntime } from './portfolio/runtime.js';

const root = new URL('./', import.meta.url);
const output = new URL('./dist/', root);
// Only this explicit projection can enter the public portfolio page.
// A build never reads private research data or starts model/brokerage requests.
const runtime = await readFile(new URL('portfolio/runtime.json', root), 'utf8');
if (!validRuntime(JSON.parse(runtime))) {
  throw new Error('Invalid public portfolio state. Export a validated runtime checkpoint.');
}

// Both directories are generated. Clearing them also retires old public reports.
for (const directory of ['assets/', 'portfolio/', 'capital/']) {
  await rm(new URL(directory, output), { recursive: true, force: true });
  await mkdir(new URL(directory, output), { recursive: true });
}
await mkdir(new URL('admin/', output), { recursive: true });
await mkdir(new URL('portfolio/research/', output), { recursive: true });
for (const directory of ['capital/desk/', 'capital/committee/']) await mkdir(new URL(directory, output), { recursive: true });
const assets = new Map();
for (const filename of [
  'chart.js', 'styles.css', 'app.js', 'favicon.svg', 'admin/admin.js',
  'portfolio/runtime.css', 'portfolio/runtime.js', 'portfolio/research/research.css', 'portfolio/research/schema.js', 'portfolio/research/research.js',
  'capital/capital.css', 'capital/schema.js', 'capital/capital.js',
]) {
  let content = await readFile(new URL(filename, root));
  if (filename === 'app.js') {
    content = Buffer.from(content.toString().replace(
      './chart.js', './' + assets.get('chart.js').split('/').at(-1),
    ));
  }
  if (filename === 'portfolio/research/research.js') content = Buffer.from(content.toString().replace('./schema.js', './' + assets.get('portfolio/research/schema.js').split('/').at(-1)));
  if (filename === 'capital/capital.js') content = Buffer.from(content.toString().replace('./schema.js', './' + assets.get('capital/schema.js').split('/').at(-1)));
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const name = filename.split('/').at(-1);
  const dot = name.lastIndexOf('.');
  const asset = `assets/${name.slice(0, dot)}.${digest}${name.slice(dot)}`;
  assets.set(filename, asset);
  await writeFile(new URL(asset, output), content);
}
for (const filename of ['index.html', 'admin/index.html', 'portfolio/index.html', 'portfolio/research/index.html', 'capital/index.html', 'capital/desk/index.html', 'capital/committee/index.html']) {
  let html = await readFile(new URL(filename, root), 'utf8');
  const directory = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/') + 1) : '';
  for (const [source, target] of assets) {
    const depth = directory.split('/').filter(Boolean).length;
    const prefix = '../'.repeat(depth);
    const common = directory.split('/').filter(Boolean);
    const parts = source.split('/');
    while (common.length && parts.length && common[0] === parts[0]) { common.shift(); parts.shift(); }
    const relative = '../'.repeat(common.length) + parts.join('/');
    const reference = relative.startsWith('../') ? relative : './' + relative;
    html = html.replaceAll(reference, `${depth ? prefix : './'}${target}`);
  }
  await writeFile(new URL(filename, output), html);
}
await writeFile(new URL('portfolio/runtime.json', output), runtime);

// Prevent analytics injection outside the self-only script policy.
const publicHtmlHeaders = ['/', '/index.html', '/portfolio/', '/portfolio/index.html', '/portfolio/research/', '/portfolio/research/index.html',
  '/capital/', '/capital/index.html', '/capital/desk/', '/capital/desk/index.html', '/capital/committee/', '/capital/committee/index.html']
  .map(path => `${path}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`)
  .join('');
await writeFile(new URL('_headers', output), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' wss://blakewoods.us wss://www.blakewoods.us; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
/admin/*
  X-Robots-Tag: noindex, nofollow
/portfolio/runtime.json
  Cache-Control: no-cache
${publicHtmlHeaders}`);
console.log('Built personal site, public portfolio checkpoint, review shell, and the Woods Capital floor → dist/');
