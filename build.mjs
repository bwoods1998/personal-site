import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
const root = new URL('./', import.meta.url), output = new URL('./dist/', root);
await mkdir(new URL('assets/', output), { recursive: true });
// Remove only our generated hashed assets so old JavaScript is not published.
for (const file of await readdir(new URL('assets/', output))) {
  if (/^(styles|app|admin|favicon|chart)\.[a-f0-9]{12}\.(css|js|svg)$/.test(file)) await unlink(new URL(`assets/${file}`, output));
}
await mkdir(new URL('admin/', output), { recursive: true });
const assets = new Map();
for (const filename of ['chart.js', 'styles.css', 'app.js', 'favicon.svg', 'admin/admin.js']) {
  let content = await readFile(new URL(filename, root));
  if (filename === 'app.js') content = Buffer.from(content.toString().replace('./chart.js', './' + assets.get('chart.js').split('/').at(-1)));
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const name = filename.split('/').at(-1), dot = name.lastIndexOf('.');
  const asset = `assets/${name.slice(0, dot)}.${digest}${name.slice(dot)}`;
  assets.set(filename, asset);
  await writeFile(new URL(asset, output), content);
}
for (const filename of ['index.html', 'admin/index.html']) {
  let html = await readFile(new URL(filename, root), 'utf8');
  for (const [source, target] of assets) {
    const reference = filename.startsWith('admin/') ? (source.startsWith('admin/') ? './admin.js' : `../${source}`) : `./${source}`;
    html = html.replaceAll(reference, `${filename.startsWith('admin/') ? '../' : './'}${target}`);
  }
  await writeFile(new URL(filename, output), html);
}
await writeFile(new URL('_headers', output), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\n/admin/*\n  X-Robots-Tag: noindex, nofollow\n`);
console.log('Built public site and private review shell → dist/');
