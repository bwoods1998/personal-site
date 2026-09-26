import test from 'node:test';
import assert from 'node:assert/strict';
import { Capital } from '../lib/capital.mjs';
import { validCheckpoint, validPublicEvent, displayNameFor } from '../capital/schema.js';
import { tradingProfit, mastheadNumbers, agentStages, agentName, startCapital } from '../capital/capital.js';
import { floor, post, get, token, withBrowser, stubPage, FLOOR_IDS, words } from './harness.mjs';
import { swarmCheckpoint, emptyCheckpoint, agent, note, news, PUBLISHED_AT } from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const batch = (...events) => ({ schema_version: 2, events });
const checkpoint = (minute, agents) => swarmCheckpoint({ published_at: `2026-09-28T14:${minute}:00.000Z`, agents });

test('Profit accepts only a complete, fresh live-options total; account flows, costs and clipped agents cannot change it', () => {
  const source = swarmCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: '0' } });
  assert.equal(tradingProfit(source, at), '0');
  assert.deepEqual(mastheadNumbers(source, at).map(row => [row.label, row.value]), [['Profit', '$0.00'], ['Running', '55h 55m']]);
  assert.equal(tradingProfit({ ...source, agents: [], account: { ...source.account, equity: '999999' },
    performance: { ...source.performance, net_flows: '7777' }, compute: null }, at), '0');
  assert.equal(tradingProfit({ ...source, trading: { as_of: PUBLISHED_AT, pnl_usd: '-3.12' } }, at), '-3.12');
  for (const trading of [undefined, null, { as_of: PUBLISHED_AT, pnl_usd: null },
    { as_of: '2026-09-28T14:40:00.000Z', pnl_usd: '1' }]) assert.equal(tradingProfit({ ...source, trading }, at), null);
  assert.equal(tradingProfit(source, at + 11 * 60000), null, 'an offline publisher cannot leave a fresh-looking profit behind');
  const old = { ...source }; delete old.trading;
  assert.equal(validCheckpoint(old), true, 'old schema 2 remains readable');
  assert.equal(tradingProfit(old, at), null, 'never guess zero from a partial roster');
  assert.equal(validCheckpoint({ ...source, trading: null }), true);
  for (const trading of [{ as_of: PUBLISHED_AT }, { as_of: PUBLISHED_AT, pnl_usd: 0 },
    { as_of: '2026-09-29T00:00:00.000Z', pnl_usd: '0' }, { as_of: PUBLISHED_AT, pnl_usd: '0', bid: '1.25' }]) {
    assert.equal(validCheckpoint({ ...source, trading }), false);
  }
});

test('the original partners have stable, unique site aliases across roster clipping, retirement, replay and restart', async () => {
  const { capital } = floor();
  const agents = Array.from({ length: 25 }, (_, n) => agent(`family-${n}`));
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint('57', agents))).status, 200);
  const first = await (await get(capital, '/api/capital/checkpoint')).json();
  const names = new Map(first.agents.map(row => [row.id, row.display_name]));
  assert.equal(new Set(names.values()).size, 25);
  assert.deepEqual(first.agents.slice(0, 3).map(agentName), ['Meriwether', 'Hilibrand', 'Scholes']);
  assert.equal(names.get('family-12'), 'Meriwether 2');
  assert.equal(names.get('family-24'), 'Meriwether 3');
  assert.equal(displayNameFor(0), null);
  assert.equal(validCheckpoint(first, { publicRead: true }), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', first)).status, 400, 'publisher cannot supply or overwrite aliases');
  const clipped = checkpoint('58', [agent('family-24', { band: 'retired' })]);
  assert.equal((await post(capital, '/api/capital/checkpoint', clipped)).status, 200);
  assert.equal((await post(capital, '/api/capital/checkpoint', clipped)).status, 200);
  const restarted = new Capital(capital.ctx, { CAPITAL_PUBLISH_TOKEN: token }, () => Date.parse('2026-09-28T15:00:00.000Z')); 
  assert.equal((await post(restarted, '/api/capital/checkpoint', checkpoint('59', [agents[0], agents[24], agent('new-family')]))).status, 200);
  const returned = await (await get(restarted, '/api/capital/checkpoint')).json();
  assert.deepEqual(returned.agents.map(agentName), ['Meriwether', 'Meriwether 3', 'Hilibrand 3']);
  assert.equal(returned.agents[0].id, 'family-0', 'execution identity is untouched');
});

test('thoughts and news keep their alias when their agent is absent from the roster, including WebSocket delivery', async () => {
  const { capital, listen } = floor();
  const socket = listen(['all']);
  const thought = note('outside-roster', 'Waiting for a clearer signal.');
  assert.equal((await post(capital, '/api/capital/events', batch(thought))).status, 200);
  assert.equal((await post(capital, '/api/capital/checkpoint', emptyCheckpoint())).status, 200);
  const update = news('is retired.', PUBLISHED_AT, 'outside-roster');
  assert.equal((await post(capital, '/api/capital/events', batch(update))).status, 200);
  const events = (await (await get(capital, '/api/capital/events')).json()).events;
  assert.deepEqual(events.map(event => event.display_name), ['Meriwether', 'Meriwether']);
  assert.deepEqual(socket.received.map(event => event.display_name), ['Meriwether', 'Meriwether']);
  for (const event of events) assert.equal(validPublicEvent(event), true);
  assert.equal(validPublicEvent({ ...events[0], display_name: 'bid 1.25' }), false);
  assert.equal((await post(capital, '/api/capital/events', batch({ ...thought, display_name: 'Scholes' }))).status, 400);
});

test('a rejected event batch rolls back its tentative name allocation', async () => {
  const { capital } = floor();
  const first = note('first', 'Waiting.');
  await post(capital, '/api/capital/events', batch(first));
  const rejected = await post(capital, '/api/capital/events', batch(note('should-not-exist', 'Waiting.'), { ...first, digest: 'f'.repeat(64) }));
  assert.equal(rejected.status, 409);
  assert.equal(capital.nameOf('should-not-exist'), null);
  await post(capital, '/api/capital/events', batch(note('second', 'Waiting.')));
  assert.equal(capital.nameOf('second'), 'Hilibrand');
});

test('every published agent gets a dot at the actual stage; training totals never imply a promotion', () => {
  const many = Array.from({ length: 100 }, (_, n) => agent(`family-${n}`));
  const stages = agentStages(swarmCheckpoint({ agents: many }));
  assert.deepEqual(stages.map(stage => stage.agents.length), [0, 0, 100]);
  assert.deepEqual(agentStages(swarmCheckpoint()).map(stage => stage.agents.map(row => row.band)),
    [['sized'], ['probe', 'probe'], ['candidate', 'candidate', 'candidate', 'gym', 'gym', 'gym', 'gym', 'gym']]);
});

test('a new thought waits for the current thought to be read while its feed entry arrives immediately', async () => {
  const { capital } = floor();
  const original = note('one', 'I am testing the opening range and waiting for evidence before I change the program.', PUBLISHED_AT);
  await post(capital, '/api/capital/events', batch(original));
  await post(capital, '/api/capital/checkpoint', swarmCheckpoint({ agents: [agent('one')], structures: [] }));
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    let socket;
    globalThis.WebSocket = class {
      constructor() { socket = this; this.handlers = new Map(); }
      addEventListener(kind, fn) { this.handlers.set(kind, fn); }
      close() {}
    };
    let clock = at;
    Date.now = () => clock;
    const feed = await startCapital(root);
    const next = { ...note('one', 'The next revision will test whether that pattern survives another session.', PUBLISHED_AT), seq: 2, display_name: 'Meriwether' };
    clock += 1000;
    socket.handlers.get('message')({ data: JSON.stringify(next) });
    assert.match(words(root.querySelector('#floor-now')), /testing the opening range/);
    assert.match(words(root.querySelector('#floor-feed')), /next revision/);
    clock += 60000;
    socket.handlers.get('message')({ data: JSON.stringify({ ...next, id: 'note:one:later', seq: 3 }) });
    assert.match(words(root.querySelector('#floor-now')), /next revision/);
    clock += 60000;
    const full = 'I am checking whether the same mechanism holds in another market session. '.repeat(9).trim();
    const long = { ...note('one', full, PUBLISHED_AT), seq: 4, display_name: 'Meriwether' };
    socket.handlers.get('message')({ data: JSON.stringify(long) });
    const more = root.querySelector('#floor-now').withClass('thought-more')[0];
    assert.equal(more.hidden, false);
    more.click();
    assert.equal(root.querySelector('#floor-now').withClass('now-thought')[0].textContent, full);
    clock += 60000;
    socket.handlers.get('message')({ data: JSON.stringify({ ...next, id: 'note:one:queued', seq: 5 }) });
    assert.equal(root.querySelector('#floor-now').withClass('now-thought')[0].textContent, full, 'an expanded thought waits for its reader');
    more.click();
    clock += 13000;
    socket.handlers.get('message')({ data: JSON.stringify({ ...next, id: 'note:one:ready', seq: 6 }) });
    assert.match(words(root.querySelector('#floor-now')), /next revision/);
    feed.stop();
  });
});
