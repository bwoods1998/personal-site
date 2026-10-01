import test from 'node:test';
import assert from 'node:assert/strict';
import { Capital } from '../lib/capital.mjs';
import { validCheckpoint, validPublicEvent, displayNameFor } from '../capital/schema.js';
import { tradingProfit, mastheadNumbers, climbModel, agentName, startCapital, holdMs } from '../capital/capital.js';
import { floor, post, get, token, withBrowser, stubPage, FLOOR_IDS, words } from './harness.mjs';
import { swarmCheckpoint, emptyCheckpoint, agent, note, news, PUBLISHED_AT } from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const batch = (...events) => ({ schema_version: 2, events });
const checkpoint = (minute, agents) => swarmCheckpoint({ published_at: `2026-09-28T14:${minute}:00.000Z`, agents });

test('Profit accepts only a complete, fresh live-options total; account flows, costs and clipped agents cannot change it', () => {
  const source = swarmCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: '0' } });
  assert.equal(tradingProfit(source, at), '0');
  assert.deepEqual(mastheadNumbers(source, at).map(row => [row.label, row.value]), [['Profit', '$0.00'], ['Net', '—'], ['Running', '55h 55m']]);
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
  for (const stream of [1, null, {}, []]) assert.equal(validPublicEvent({ ...events[1], stream }), false, 'malformed stream refuses an alias without throwing');
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

test('every published agent gets a dot where it stands; training totals never move it', () => {
  const many = Array.from({ length: 100 }, (_, n) => agent(`family-${n}`, { record: { trials: n * 1000, revisions: n, forward: null, real: null } }));
  const crowd = climbModel(swarmCheckpoint({ agents: many }));
  assert.equal(crowd.steps.train.agents.length, 100);
  assert.ok(['validation', 'tuition', 'holdout', 'probe', 'sized'].every(key => crowd.steps[key].agents.length === 0));
  const swarm = climbModel(swarmCheckpoint());
  assert.deepEqual(['sized', 'probe', 'holdout', 'train'].map(key => swarm.steps[key].agents.map(dot => dot.band)),
    [['sized'], ['probe', 'probe'], ['candidate', 'candidate', 'candidate'], ['gym', 'gym', 'gym', 'gym', 'gym']]);
});

test('a note is held while it is read; newer notes queue behind a +N pill, which skips to the newest', async () => {
  const { capital } = floor();
  const original = note('one', 'I am testing the opening range and waiting for evidence before I change the program.', PUBLISHED_AT);
  await post(capital, '/api/capital/events', batch(original));
  await post(capital, '/api/capital/checkpoint', swarmCheckpoint({ agents: [agent('one'), agent('two')], structures: [] }));
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
    const card = () => root.querySelector('#floor-now');
    const shown = () => card().withClass('think-text')[0].textContent;
    const pill = () => card().withClass('think-queue')[0];
    assert.match(shown(), /testing the opening range/);
    assert.equal(holdMs(original.payload.text), 6000, 'sixteen words: the six-second floor');
    let seq = 1;
    const send = (agentId, text, name) => { seq += 1; socket.handlers.get('message')({ data: JSON.stringify({ ...note(agentId, text, new Date(clock).toISOString()), seq, display_name: name }) }); };
    clock += 1000;
    send('two', 'The next revision will test whether that pattern survives another session.', 'Hilibrand');
    assert.match(shown(), /testing the opening range/, 'held while it is read');
    assert.deepEqual([pill().hidden, pill().textContent], [false, '+1']);
    assert.match(words(root.querySelector('#floor-feed')), /next revision/, 'the tape has it at once');
    clock += 1000;
    send('two', 'A third thought arrives while the first is still on the card.', 'Hilibrand');
    assert.equal(pill().textContent, '+2');
    clock += 10000;
    send('one', 'A fourth thought, once the first has been read.', 'Meriwether');
    assert.match(shown(), /next revision/, 'the queue moves in order once the hold is over');
    assert.equal(card().withClass('think-name')[0].textContent, 'Hilibrand');
    assert.equal(pill().textContent, '+2');
    pill().click();
    assert.match(shown(), /A fourth thought/, '+N skips to the newest');
    assert.equal(pill().hidden, true);
    // A note the card cuts gets a ↓ (measured: how much fits depends on the card's width), and an expanded note stays until
    // its reader closes it. A note that fits has none, however long it is.
    const more = card().withClass('think-more')[0];
    assert.equal(more.hidden, true, 'a note that fits: no ↓');
    clock += 30000;
    Object.assign(card().withClass('think-text')[0], { scrollHeight: 216, clientHeight: 135 });
    const full = 'I am checking whether the same mechanism holds in another market session. '.repeat(9).trim();
    send('two', full, 'Hilibrand');
    assert.equal(more.hidden, false, 'a cut note: ↓');
    more.click();
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    clock += 60000;
    send('one', 'Waiting behind an open note.', 'Meriwether');
    assert.equal(shown(), full, 'an expanded thought waits for its reader');
    more.click();
    clock += 7000;
    send('one', 'And after it closes, the queue moves again.', 'Meriwether');
    assert.match(shown(), /Waiting behind an open note/);
    // A note written more than ten minutes ago dims the card; it keeps the thought and its true age, and never a placeholder.
    clock += 11 * 60000;
    feed.state.think.readUntil = 0;
    send('one', 'One more.', 'Meriwether');
    assert.match(shown(), /And after it closes/);
    assert.match(card().withClass('think-card')[0].className, /is-quiet/);
    assert.equal(card().withClass('think-age')[0].textContent, '11m');
    feed.stop();
  });
});
