import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const output = new URL('./dist/', root);

// Both directories are generated. Clearing them also retires the old Portfolio Agent output.
for (const directory of ['assets/', 'capital/', 'portfolio/']) {
  await rm(new URL(directory, output), { recursive: true, force: true });
}
for (const directory of ['assets/', 'capital/', 'capital/desk/', 'capital/committee/', 'admin/']) {
  await mkdir(new URL(directory, output), { recursive: true });
}
const assets = new Map();
for (const filename of [
  'chart.js', 'styles.css', 'app.js', 'favicon.svg', 'admin/admin.js',
  'capital/capital.css', 'capital/schema.js', 'capital/capital.js',
]) {
  let content = await readFile(new URL(filename, root));
  if (filename === 'app.js') {
    content = Buffer.from(content.toString().replace(
      './chart.js', './' + assets.get('chart.js').split('/').at(-1),
    ));
  }
  if (filename === 'capital/capital.js') content = Buffer.from(content.toString().replace('./schema.js', './' + assets.get('capital/schema.js').split('/').at(-1)));
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const name = filename.split('/').at(-1);
  const dot = name.lastIndexOf('.');
  const asset = `assets/${name.slice(0, dot)}.${digest}${name.slice(dot)}`;
  assets.set(filename, asset);
  await writeFile(new URL(asset, output), content);
}
for (const filename of ['index.html', 'admin/index.html', 'capital/index.html', 'capital/desk/index.html', 'capital/committee/index.html']) {
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

// Prevent analytics injection outside the self-only script policy.
const publicHtmlHeaders = ['/', '/index.html', '/capital/', '/capital/index.html',
  '/capital/desk/', '/capital/desk/index.html', '/capital/committee/', '/capital/committee/index.html']
  .map(path => `${path}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`)
  .join('');
await writeFile(new URL('_headers', output), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' wss://blakewoods.us wss://www.blakewoods.us; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
/admin/*
  X-Robots-Tag: noindex, nofollow
${publicHtmlHeaders}`);
console.log('Built personal site, review shell, and Long Term Capital Management → dist/');
