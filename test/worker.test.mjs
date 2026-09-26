import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { capitalRoute, CAPITAL_OBJECT, tapeObject } from '../lib/capital.mjs';
import { tapeName, TAPES } from '../capital/schema.js';
import { floor, token, NOW } from './harness.mjs';

// worker.mjs imports the Workers runtime's base class. Outside workerd a bare class stands in, so
// the dispatch under test is the deployed file itself and not a copy of it.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== 'cloudflare:workers') return next(specifier, context);
    return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
  },
});
const { default: worker } = await import('../worker.mjs');

const checkpoint = (overrides = {}) => ({
  schema_version: 2, published_at: '2026-09-15T14:05:00.000Z', run: { started_at: null },
  account: null, performance: null, compute: null, gym: null, agents: [], structures: [], ...overrides,
});
const thought = (n = 1) => ({
  id: `note.condor-vrp.${n}`, stream: 'agent:condor-vrp', kind: 'agent.note', at: `2026-09-15T14:0${n}:00.000Z`,
  payload: { text: 'Realized volatility is running under what the options expect.' }, digest: n.toString(16).padStart(64, '0'),
});

// The CAPITAL binding as the worker sees it: one in-memory floor per object name, and a record
// of which name was asked for what. The edge cache is a map keyed by the address it was given.
function bench() {
  const objects = new Map();
  const calls = [];
  const cache = new Map();
  const pending = [];
  const env = { CAPITAL: {
    idFromName: name => ({ name }),
    get: id => ({ fetch: async request => {
      calls.push({ object: id.name, request, method: request.method, url: request.url, upgrade: request.headers.get('Upgrade'), origin: request.headers.get('Origin') });
      // A real upgrade needs the Workers socket pair; the routing is what is under test here.
      if (request.headers.get('Upgrade')) return new Response('upgraded');
      if (!objects.has(id.name)) objects.set(id.name, floor(NOW).capital);
      return objects.get(id.name).fetch(request);
    } }),
  } };
  const saved = globalThis.caches;
  globalThis.caches = { default: {
    match: async key => cache.get(key.url)?.clone(),
    put: async (key, response) => { cache.set(key.url, response); },
  } };
  const send = async (method, path, { body, auth = token, headers = {} } = {}) => {
    const request = new Request('https://blakewoods.us' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await worker.fetch(request, env, { waitUntil: promise => pending.push(promise) });
    await Promise.all(pending.splice(0));
    return { request, response };
  };
  return { send, calls, cache, objects, restore: () => { globalThis.caches = saved; } };
}

test('a tape address names its own object and the ordinary path; everything else is the real record', () => {
  assert.equal(CAPITAL_OBJECT, 'capital-v1');
  assert.equal(tapeObject('test'), 'capital-tape-test');
  assert.deepEqual(capitalRoute('/api/capital/t/test/events'), { tape: 'test', object: 'capital-tape-test', path: '/api/capital/events' });
  assert.deepEqual(capitalRoute('/api/capital/t/canary/agents/condor-vrp-2'), { tape: 'canary', object: 'capital-tape-canary', path: '/api/capital/agents/condor-vrp-2' });
  assert.deepEqual(capitalRoute('/api/capital/t/test/stream'), { tape: 'test', object: 'capital-tape-test', path: '/api/capital/stream' });
  for (const path of ['/api/capital', '/api/capital/', '/api/capital/events', '/api/capital/checkpoint', '/api/capital/stream', '/api/capital/agents/t', '/api/capital/tape/demo/events', '/api/capital/unknown']) {
    assert.deepEqual(capitalRoute(path), { tape: null, object: 'capital-v1', path }, path);
  }
  // Two tapes exist and no others: a well-formed name that is not on the list names nothing.
  assert.deepEqual(TAPES, ['test', 'canary']);
  for (const path of ['/api/capital/t', '/api/capital/t/', '/api/capital/t/test', '/api/capital/t//events', '/api/capital/t/Test/events', '/api/capital/t/demo/events',
    '/api/capital/t/test-2/events', '/api/capital/t/tests/events', '/api/capital/t/canary.x/events', `/api/capital/t/${'a'.repeat(25)}/events`, '/api/capital/t/ test/events',
    '/api/capital/t/constructor/events', '/api/capital/t/0/events']) {
    assert.equal(capitalRoute(path), null, path);
  }
  assert.deepEqual(['test', 'canary', 'demo', 'TEST', '', null, undefined, 0, ['test']].map(tapeName), [true, true, false, false, false, false, false, false, false]);
});

test('the worker sends a test tape to its own object with the path rewritten, and the same token publishes to it', async () => {
  const { send, calls, restore } = bench();
  try {
    assert.equal((await send('POST', '/api/capital/t/test/checkpoint', { body: checkpoint(), auth: 'wrong-token-but-long-enough-to-compare' })).response.status, 401);
    assert.equal((await send('POST', '/api/capital/t/test/checkpoint', { body: checkpoint(), auth: null })).response.status, 401);
    const published = await send('POST', '/api/capital/t/test/checkpoint', { body: checkpoint() });
    assert.equal(published.response.status, 200);
    assert.deepEqual(await published.response.json(), { published_at: '2026-09-15T14:05:00.000Z', agents: 0 });
    const call = calls.at(-1);
    assert.deepEqual([call.object, call.method, call.url], ['capital-tape-test', 'POST', 'https://blakewoods.us/api/capital/checkpoint']);
    assert.equal(call.request.headers.get('Authorization'), `Bearer ${token}`, 'the headers travel with it');

    assert.deepEqual(await (await send('POST', '/api/capital/t/test/events', { body: { schema_version: 2, events: [thought(1), thought(2)] } })).response.json(), { stored: 2, replayed: 0 });
    // The query string is kept, the body of a read is the tape's own.
    const read = await send('GET', '/api/capital/t/test/events?kind=agent.note&limit=1', { auth: null });
    assert.equal(calls.at(-1).url, 'https://blakewoods.us/api/capital/events?kind=agent.note&limit=1');
    assert.deepEqual((await read.response.json()).events.map(event => event.id), ['note.condor-vrp.2']);
    assert.deepEqual(await (await send('GET', '/api/capital/t/test/checkpoint', { auth: null })).response.json(), checkpoint());
    assert.deepEqual((await (await send('GET', '/api/capital/t/test/agents', { auth: null })).response.json()).agents, []);

    // The real floor and every other tape know nothing of it.
    const real = await send('GET', '/api/capital/checkpoint', { auth: null });
    assert.equal(real.response.status, 404);
    assert.equal(calls.at(-1).object, 'capital-v1');
    assert.deepEqual((await (await send('GET', '/api/capital/events', { auth: null })).response.json()).events, []);
    assert.equal((await send('GET', '/api/capital/t/canary/checkpoint', { auth: null })).response.status, 404);
    assert.equal(calls.at(-1).object, 'capital-tape-canary');

    // The tape can be wiped without going near the real record: the confirmation rides the query.
    const wiped = await send('POST', '/api/capital/t/test/reset?confirm=erase-everything');
    assert.equal(wiped.response.status, 200);
    assert.deepEqual([calls.at(-1).object, calls.at(-1).url], ['capital-tape-test', 'https://blakewoods.us/api/capital/reset?confirm=erase-everything']);
    assert.deepEqual([...new Set(calls.map(entry => entry.object))].sort(), ['capital-tape-canary', 'capital-tape-test', 'capital-v1']);
  } finally { restore(); }
});

test('a tape address that names no listed tape is a 404 that wakes no object', async () => {
  const { send, calls, cache, restore } = bench();
  try {
    for (const path of ['/api/capital/t', '/api/capital/t/', '/api/capital/t/test', '/api/capital/t/Test/events', '/api/capital/t/demo/checkpoint', '/api/capital/t/demo/events',
      '/api/capital/t/staging/stream', `/api/capital/t/${'a'.repeat(25)}/events`, '/api/capital/t//events', '/api/capital/t/test%20x/events']) {
      for (const method of ['GET', 'POST']) {
        const { response } = await send(method, path, method === 'POST' ? { body: checkpoint() } : { auth: null });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.deepEqual(await response.json(), { error: 'Not found.' });
      }
    }
    assert.equal(calls.length, 0, 'no object is woken for a name that is not on the list, however well formed');
    assert.equal(cache.size, 0);
    // A good name with an unknown route reaches the tape, which answers as the real floor would.
    assert.equal((await send('GET', '/api/capital/t/test/nothing', { auth: null })).response.status, 404);
    assert.deepEqual([calls.length, calls[0].object, calls[0].url], [1, 'capital-tape-test', 'https://blakewoods.us/api/capital/nothing']);
  } finally { restore(); }
});

test('reads are cached under the address as asked, so a tape and the real floor never share an entry', async () => {
  const { send, calls, cache, restore } = bench();
  try {
    await send('POST', '/api/capital/t/test/checkpoint', { body: checkpoint() });
    await send('POST', '/api/capital/checkpoint', { body: checkpoint({ published_at: '2026-09-15T14:06:00.000Z' }) });
    assert.equal(cache.size, 0, 'a publish is never cached');
    const first = await send('GET', '/api/capital/t/test/checkpoint', { auth: null });
    const asked = calls.length;
    assert.deepEqual([...cache.keys()], ['https://blakewoods.us/api/capital/t/test/checkpoint']);
    const again = await send('GET', '/api/capital/t/test/checkpoint', { auth: null });
    assert.equal(calls.length, asked, 'the second read is the edge’s');
    assert.deepEqual(await again.response.json(), await first.response.json());
    assert.equal((await send('GET', '/api/capital/t/test/checkpoint', { auth: null, headers: { 'If-None-Match': first.response.headers.get('ETag') } })).response.status, 304);
    assert.equal((await send('HEAD', '/api/capital/t/test/checkpoint', { auth: null })).response.status, 200);
    // The real floor's checkpoint is its own, whatever the tape cached a moment ago.
    const real = await send('GET', '/api/capital/checkpoint', { auth: null });
    assert.equal((await real.response.json()).published_at, '2026-09-15T14:06:00.000Z');
    assert.deepEqual([...cache.keys()].sort(), ['https://blakewoods.us/api/capital/checkpoint', 'https://blakewoods.us/api/capital/t/test/checkpoint']);
    // A different query is a different entry, on a tape as on the floor.
    await send('GET', '/api/capital/t/test/events?limit=1', { auth: null });
    await send('GET', '/api/capital/t/test/events?limit=2', { auth: null });
    assert.equal(cache.size, 4);
    // A miss is not kept.
    assert.equal((await send('GET', '/api/capital/t/canary/checkpoint', { auth: null })).response.status, 404);
    assert.equal(cache.size, 4);
  } finally { restore(); }
});

test('the live socket route works under a tape and is never cached; the real floor is passed the request untouched', async () => {
  const { send, calls, cache, restore } = bench();
  try {
    const upgrade = { Upgrade: 'websocket', Origin: 'https://blakewoods.us' };
    const tape = await send('GET', '/api/capital/t/test/stream?streams=swarm', { auth: null, headers: upgrade });
    assert.equal(await tape.response.text(), 'upgraded');
    assert.deepEqual([calls.at(-1).object, calls.at(-1).url, calls.at(-1).upgrade, calls.at(-1).origin],
      ['capital-tape-test', 'https://blakewoods.us/api/capital/stream?streams=swarm', 'websocket', 'https://blakewoods.us']);
    // Without the upgrade the tape's own object answers exactly as the floor's does.
    assert.equal((await send('GET', '/api/capital/t/test/stream', { auth: null })).response.status, 426);
    assert.equal((await send('GET', '/api/capital/stream', { auth: null })).response.status, 426);
    assert.equal(cache.size, 0, 'the stream is not a cacheable read, under a tape or not');

    // Production: the same object name as ever, and the very request the visitor sent.
    for (const [method, path, options] of [['GET', '/api/capital/events?limit=3', { auth: null }], ['GET', '/api/capital/stream', { auth: null, headers: upgrade }],
      ['POST', '/api/capital/events', { body: { schema_version: 2, events: [thought(3)] } }], ['GET', '/api/capital/agents/t', { auth: null }]]) {
      const { request } = await send(method, path, options);
      assert.equal(calls.at(-1).object, 'capital-v1', path);
      assert.equal(calls.at(-1).request, request, `${path} is forwarded as it arrived`);
    }
  } finally { restore(); }
});

// The reset the main session runs before the new House starts (plan, "How it resets"): the real record and
// both tapes, each erased on its own object, with the publish token and the confirmation, and nothing else.
test('the reset reaches the real record and each tape on its own object, and erases all four tables there', async () => {
  const { send, calls, objects, restore } = bench();
  try {
    for (const base of ['/api/capital', '/api/capital/t/test', '/api/capital/t/canary']) {
      assert.equal((await send('POST', `${base}/events`, { body: { schema_version: 2, events: [thought(1)] } })).response.status, 200, base);
      assert.equal((await send('POST', `${base}/checkpoint`, { body: checkpoint() })).response.status, 200, base);
    }
    assert.equal((await send('POST', '/api/capital/reset?confirm=erase-everything', { auth: null })).response.status, 401);
    assert.equal((await send('POST', '/api/capital/reset', {})).response.status, 400);
    for (const [base, object] of [['/api/capital', 'capital-v1'], ['/api/capital/t/test', 'capital-tape-test'], ['/api/capital/t/canary', 'capital-tape-canary']]) {
      const { response } = await send('POST', `${base}/reset?confirm=erase-everything`);
      assert.deepEqual(await response.json(), { reset: true, cleared: { events: 1, floor_history: 0, checkpoint: 1, desks: 0 } }, base);
      assert.equal(calls.at(-1).object, object);
      // What the gateway watchdog reads next: a 404, which it records and never answers with a restart.
      assert.equal((await send('GET', `${base}/checkpoint`, { auth: null })).response.status, 404, base);
    }
    assert.equal(objects.size, 3);
  } finally { restore(); }
});
