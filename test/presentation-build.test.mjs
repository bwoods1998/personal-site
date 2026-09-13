import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from '../server.mjs';

test('public build validates the runtime and removes retired reports from a previous build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-public-build-'));
  try {
    for (const name of ['build.mjs', 'package.json', 'index.html', 'styles.css', 'app.js', 'chart.js', 'favicon.svg', 'admin', 'portfolio']) {
      await cp(new URL('../' + name, import.meta.url), join(root, name), { recursive: true });
    }
    const build = () => spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(build().status, 0);
    await writeFile(join(root, 'dist/portfolio/cash-map.json'), '{"stale":"retired report"}');
    await writeFile(join(root, 'dist/assets/explorer.abcdef012345.js'), '/* retired module */');
    assert.equal(build().status, 0);
    assert.deepEqual((await readdir(join(root, 'dist/portfolio'))).sort(), ['index.html', 'runtime.json']);
    assert.equal((await readdir(join(root, 'dist/assets'))).some(name => /explorer|agent|project|cashflow/.test(name)), false);
    const statePath = join(root, 'portfolio/runtime.json');
    const original = await readFile(statePath, 'utf8');
    const state = JSON.parse(original);
    state.private_draft = 'DO_NOT_PUBLISH';
    await writeFile(statePath, JSON.stringify(state));
    assert.notEqual(build().status, 0, 'Private fields cannot enter a checkpoint');
    await writeFile(statePath, original);
    state.research.status = 'trading_live';
    delete state.private_draft;
    await writeFile(statePath, JSON.stringify(state));
    assert.notEqual(build().status, 0, 'Unimplemented runtime states cannot publish');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('static server serves only active public files and denies historical and private files', async () => {
  const server = createServer(() => { throw new Error('No API calls expected'); }, { origin: 'http://localhost' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/portfolio/', '/portfolio/runtime.js', '/portfolio/runtime.css', '/portfolio/runtime.json']) {
      assert.equal((await fetch(origin + path)).status, 200, path);
    }
    for (const path of ['/portfolio/explorer.js', '/portfolio/agent.js', '/portfolio/project.css', '/portfolio/cash-map.json', '/portfolio/agent-state.json', '/portfolio/social.png', '/portfolio/snapshot.json', '/portfolio/cash-map-review.json', '/.env', '/.data/credentials.json', '/portfolio/private.json']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
