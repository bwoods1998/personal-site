import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
const root = new URL('./', import.meta.url), output = new URL('./dist/', root);
await mkdir(new URL('assets/', output), { recursive: true });
// Remove only our generated hashed assets so old JavaScript is not published.
for (const file of await readdir(new URL('assets/', output))) {
  if (/^(styles|app|admin|favicon|chart|portfolio|investigations|evaluations)\.[a-f0-9]{12}\.(css|js|svg)$/.test(file)) await unlink(new URL(`assets/${file}`, output));
}
await mkdir(new URL('admin/', output), { recursive: true });
await mkdir(new URL('portfolio/', output), { recursive: true });
const assets = new Map();
for (const filename of ['chart.js', 'styles.css', 'app.js', 'favicon.svg', 'admin/admin.js', 'portfolio/portfolio.css', 'portfolio/portfolio.js', 'portfolio/investigations.js', 'portfolio/evaluations.js']) {
  let content = await readFile(new URL(filename, root));
  if (filename === 'app.js') content = Buffer.from(content.toString().replace('./chart.js', './' + assets.get('chart.js').split('/').at(-1)));
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const name = filename.split('/').at(-1), dot = name.lastIndexOf('.');
  const asset = `assets/${name.slice(0, dot)}.${digest}${name.slice(dot)}`;
  assets.set(filename, asset);
  await writeFile(new URL(asset, output), content);
}
for (const filename of ['index.html', 'admin/index.html', 'portfolio/index.html']) {
  let html = await readFile(new URL(filename, root), 'utf8');
  const directory = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/') + 1) : '';
  for (const [source, target] of assets) {
    const reference = directory ? (source.startsWith(directory) ? `./${source.slice(directory.length)}` : `../${source}`) : `./${source}`;
    html = html.replaceAll(reference, `${directory ? '../' : './'}${target}`);
  }
  await writeFile(new URL(filename, output), html);
}
// The research pipeline explicitly publishes this allowlisted public projection.
// Never copy the private project directory or call a model during a site build.
const snapshot = await readFile(new URL('portfolio/snapshot.json', root), 'utf8');
const { validSnapshot } = await import('./portfolio/portfolio.js');
if (!validSnapshot(JSON.parse(snapshot))) throw new Error('Invalid Portfolio Agent publication. Run the reviewed snapshot export first.');
await writeFile(new URL('portfolio/snapshot.json', output), snapshot);
const investigations = await readFile(new URL('portfolio/investigations.json', root), 'utf8');
const { validInvestigations } = await import('./portfolio/investigations.js');
if (!validInvestigations(JSON.parse(investigations))) throw new Error('Invalid reviewed investigation publication.');
await writeFile(new URL('portfolio/investigations.json', output), investigations);
const evaluations = await readFile(new URL('portfolio/evaluations.json', root), 'utf8');
const { validEvaluations } = await import('./portfolio/evaluations.js');
if (!validEvaluations(JSON.parse(evaluations))) throw new Error('Invalid evaluation publication.');
await writeFile(new URL('portfolio/evaluations.json', output), evaluations);
// Keep public HTML intact: Cloudflare's automatic analytics injection conflicts
// with our self-only script policy. Hashed assets retain their normal caching.
const publicHtmlHeaders = ['/', '/index.html', '/portfolio/', '/portfolio/index.html'].map(path =>
  `${path}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`).join('');
await writeFile(new URL('_headers', output), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\n/admin/*\n  X-Robots-Tag: noindex, nofollow\n/portfolio/snapshot.json\n  Cache-Control: no-cache\n/portfolio/investigations.json\n  Cache-Control: no-cache\n/portfolio/evaluations.json\n  Cache-Control: no-cache\n${publicHtmlHeaders}`);
console.log('Built public site, Portfolio Agent ledger, and private review shell → dist/');
