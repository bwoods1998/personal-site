import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioState, MAX_STATE_BYTES } from '../lib/portfolio-state.mjs';
import { readFile } from 'node:fs/promises';
const initial = JSON.parse(await readFile(new URL('../portfolio/runtime.json', import.meta.url)));
const secret = 'test-only-portfolio-token-1234567890';
function setup() {
  const map = new Map();
  const api = createPortfolioState({ async get(key) { return map.get(key); }, async put(key,value) { map.set(key,value); } },secret,() => Date.parse('2026-09-14T00:00:00Z'));
  return api;
}
const req = (method='GET', value, auth=secret) => new Request('https://blakewoods.us/api/portfolio/state', {method,headers: {'Content-Type':'application/json',Authorization:`Bearer ${auth}`},...(value === undefined ? {} : {body:JSON.stringify(value)})});
test('public reads require a saved checkpoint and cannot mutate it', async () => {
 const api=setup();assert.equal((await api(req())).status,404);
 assert.equal((await api(req('POST',initial,'wrong'))).status,401);
 assert.equal((await api(req())).status,404);
 assert.equal((await api(req('DELETE'))).status,405);
});
test('publisher saves strict state, serves ETag and handles idempotent retries', async () => {
 const api=setup();assert.equal((await api(req('POST',initial))).status,200);
 const get=await api(req());assert.equal(get.status,200);assert.deepEqual(await get.json(),initial);
 const conditional=new Request('https://blakewoods.us/api/portfolio/state',{headers:{'If-None-Match':get.headers.get('ETag')}});
 assert.equal((await api(conditional)).status,304);
 assert.equal((await api(req('HEAD'))).status,200);
 assert.equal((await api(req('POST',initial))).status,200);
});
test('unknown private fields, future state and oversized bodies are rejected', async () => {
 const api=setup();assert.equal((await api(req('POST',{...initial,credentials:'private'}))).status,400);
 assert.equal((await api(req('POST',{...initial,published_at:'2027-01-01T00:00:00Z'}))).status,400);
 assert.equal((await api(req('POST',{padding:'x'.repeat(MAX_STATE_BYTES)}))).status,413);
});
test('out-of-order publishers cannot overwrite newer state', async () => {
 const api=setup();const newer={...initial,published_at:'2026-09-13T23:59:00Z'};
 assert.equal((await api(req('POST',newer))).status,200);
 assert.equal((await api(req('POST',initial))).status,409);
 assert.deepEqual(await (await api(req())).json(),newer);
});
