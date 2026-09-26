import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Capital, MAX_EVENTS_KEPT, MAX_HISTORY_POINTS, allowedOrigin } from '../lib/capital.mjs';
import { retiredRoute, RETIRED_TARGET } from '../lib/retired.mjs';
import { createServer } from '../server.mjs';
import {
  SCHEMA_VERSION, EVENT_KINDS, BANDS, STRUCTURE_TYPES, MAX_AGENTS, MAX_STRUCTURES, MAX_BATCH_BYTES, CHECKPOINT_FIELDS, AGENT_FIELDS, STRUCTURE_FIELDS,
  validEvent, validEventBatch, validCheckpoint, validAgent, validStructure, validPerformance, validCompute, validGym, validAccount, validKindPayload,
  validStream, socketMatches, parseStreamTags, sourceUrl, quoteFree, words,
} from '../capital/schema.js';
import {
  PERFORMANCE_START_AT, START_EQUITY, BAND_WORDS, tapeOf, apiBase, streamUrl, money, signedMoney, expiryText, structureText, runningParts,
  profitBasis, totalProfit, computeSpend, profitAfterCompute, startedAt, mastheadNumbers, accountLines, accountSeries, balanceSeries,
  swarmRows, recordWords, bandCounts, gymLine, structureRows, structureLine, tradeWords, feedLine, feedLines, heroNote, floorRunning, startCapital,
} from '../capital/capital.js';
import { NOW, floor, request, post, get, words as textOf, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';
import { swarmCheckpoint, emptyCheckpoint, agent, structure, note, trade, news, mark, TAPE, PUBLISHED_AT, RESET_AT } from './swarm-fixture.mjs';

const batch = (...events) => ({ schema_version: SCHEMA_VERSION, events });

// ---------------------------------------------------------------------------- the licence
// Quotes in prose: the same list `league/tests/test_publish.py` scrubs, so both sides agree.
export const QUOTED = ['bid 1.25 ask 1.30', 'IV 18%', 'implied vol at 22', '30 delta short strike', 'the 10-delta put', 'SPY at 571.23',
  'paid $120 for it', 'a credit of 45¢', 'the spread was 5 wide', 'mid 2 on the call', 'priced at 3', 'theta of 4 a day', 'vega 12', 'NBBO 2 by 3',
  'marks 7 higher', 'premium 3 per contract', 'gamma: 2', 'skew 4 points', 'quoted 6 across'];
export const PLAIN = ['Opened 3 contracts of the XSP iron condor, 45 DTE.', 'the 570 strike', 'Sold the 0DTE put spread at the open.',
  'won 12 of 20 trades', 'It closes at 15:30 ET on 2026-10-02.', 'A gap of 2 days, then a 3-day slide.', 'The ask is not the point here.'];

test('prose is quote-free: no decimal, no dollar or cent price, no number beside a quote word', () => {
  for (const text of QUOTED) assert.equal(quoteFree(text), false, text);
  for (const text of PLAIN) assert.equal(quoteFree(text), true, text);
  assert.equal(quoteFree('the data:\n next'), true);
  assert.equal(words('a'.repeat(61), 60), false);
  assert.equal(words('   ', 60), false);
  assert.equal(words('the <b>bid</b>', 60), false);
});

// ---------------------------------------------------------------------------- the checkpoint
test('schema 2 is one exact checkpoint: every block present, null or empty until the House has it', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.deepEqual(CHECKPOINT_FIELDS, ['schema_version', 'published_at', 'run', 'account', 'performance', 'compute', 'gym', 'agents', 'structures']);
  assert.equal(validCheckpoint(emptyCheckpoint()), true, 'the first minutes of a new House');
  assert.equal(validCheckpoint(emptyCheckpoint({ run: { started_at: null } })), true);
  assert.equal(validCheckpoint(swarmCheckpoint()), true, 'a dozen agents, four structures, every block');
  for (const field of CHECKPOINT_FIELDS) {
    const missing = swarmCheckpoint();
    delete missing[field];
    assert.equal(validCheckpoint(missing), false, `without ${field}`);
  }
  for (const [label, value] of [
    ['schema 1', swarmCheckpoint({ schema_version: 1 })],
    ['an old floor block', { ...swarmCheckpoint(), floor: { equity: '1' } }],
    ['desks', { ...swarmCheckpoint(), desks: [] }],
    ['published without milliseconds', swarmCheckpoint({ published_at: '2026-09-28T14:58:00Z' })],
    ['a run started after its checkpoint', swarmCheckpoint({ run: { started_at: '2026-09-28T15:00:00.000Z' } })],
    ['a run with more to say', swarmCheckpoint({ run: { started_at: null, uptime_seconds: 1 } })],
    ['an account read after its checkpoint', swarmCheckpoint({ account: { ...swarmCheckpoint().account, as_of: '2026-09-28T15:00:00.000Z' } })],
    ['an account without stale', swarmCheckpoint({ account: { equity: '1', cash: '1', as_of: PUBLISHED_AT } })],
    ['a negative balance', swarmCheckpoint({ account: { ...swarmCheckpoint().account, equity: '-1' } })],
    ['agents not a list', swarmCheckpoint({ agents: null })],
    ['duplicate agents', swarmCheckpoint({ agents: [agent('a-1'), agent('a-1')] })],
    ['duplicate structures', swarmCheckpoint({ structures: [structure('s1'), structure('s1')] })],
  ]) assert.equal(validCheckpoint(value), false, label);
});

test('the profit basis, the compute bill and the Gym are typed, and refuse anything else', () => {
  const at = PUBLISHED_AT;
  const basis = swarmCheckpoint().performance;
  assert.equal(validPerformance(basis, at), true);
  assert.equal(validPerformance({ ...basis, net_flows: null, verified_at: null }, at), true, 'not yet verified');
  for (const bad of [{ ...basis, net_flows: null }, { ...basis, verified_at: null }, { ...basis, start_equity: '0' },
    { ...basis, verified_at: '2026-09-25T00:00:00.000Z' }, { ...basis, start_at: '2026-09-29T00:00:00.000Z' }, { ...basis, source: 'x' }]) {
    assert.equal(validPerformance(bad, at), false, JSON.stringify(bad));
  }
  const compute = swarmCheckpoint().compute;
  assert.equal(validCompute(compute, at), true);
  assert.equal(validCompute({ ...compute, openai_usd: null }, at), true, 'a part not yet metered');
  assert.equal(validCompute({ ...compute, sail_usd: '-1' }, at), false);
  assert.equal(validCompute({ ...compute, jev_usd: '1' }, at), false);
  const { other_usd: _other, ...short } = compute;
  assert.equal(validCompute(short, at), false);
  const gym = swarmCheckpoint().gym;
  assert.equal(validGym(gym, at), true);
  assert.equal(validGym({ ...gym, trials: null, market_years: null, families_alive: null, families_retired: null }, at), true);
  assert.equal(validGym({ ...gym, market_years: '12.25' }, at), false, 'one decimal at most');
  assert.equal(validGym({ ...gym, trials: 1.5 }, at), false);
  assert.equal(validGym({ ...gym, best_sharpe: '2.1' }, at), false, 'a Gym result is derived from licensed quotes: never published');
  assert.equal(validAccount({ equity: '5694.37', cash: '5210.12', as_of: at, stale: true }, at), true);
});

test('agents: at most 160, five bands, one family each, the mechanism in quote-free words, and a record', () => {
  assert.deepEqual(BANDS, ['gym', 'candidate', 'probe', 'sized', 'retired']);
  assert.deepEqual(AGENT_FIELDS, ['id', 'family', 'name', 'mechanism', 'structure', 'band', 'born_at', 'retired_at', 'record']);
  const many = count => Array.from({ length: count }, (_, n) => agent(`agent-${n}`));
  assert.equal(MAX_AGENTS, 160);
  assert.equal(validCheckpoint(swarmCheckpoint({ agents: many(160) })), true);
  assert.equal(validCheckpoint(swarmCheckpoint({ agents: many(161) })), false);
  for (const band of BANDS) assert.equal(validAgent(agent('a-1', { band }), PUBLISHED_AT), true, band);
  for (const type of STRUCTURE_TYPES) assert.equal(validAgent(agent('a-1', { structure: type }), PUBLISHED_AT), true, type);
  const record = agent('a-1').record;
  for (const [label, patch] of [
    ['a House band word', { band: 'paper' }], ['the old ladder', { band: 'swing' }], ['an unknown structure', { structure: 'naked_put' }],
    ['a capital id', { id: 'Condor-1' }], ['a family with a slash', { family: 'condor/vrp' }], ['a blank name', { name: ' ' }],
    ['a quoted mechanism', { mechanism: 'Sells the 10-delta wings when IV is above 20.' }], ['a long mechanism', { mechanism: 'a'.repeat(241) }],
    ['a venue in the mechanism', { mechanism: 'Trades what Alpaca lists.' }],
    ['more wins than trades', { record: { ...record, forward: { trades: 1, wins: 2, pnl_usd: '0' } } }],
    ['a record with a Sharpe', { record: { ...record, sharpe: '1.2' } }], ['a born date after the checkpoint', { born_at: '2026-09-28T16:00:00.000Z' }],
    ['a program', { program: 'def decide(ctx): ...' }], ['parameters', { params: { width: 5 } }],
  ]) assert.equal(validAgent(agent('a-1', patch), PUBLISHED_AT), false, label);
});

test('structures: what, whose, how many legs and contracts, real or shadow, the maximum loss and the P&L; never a price', () => {
  assert.deepEqual(STRUCTURE_FIELDS, ['id', 'agent', 'underlying', 'structure', 'legs', 'expiry', 'quantity', 'real', 'opened_at', 'max_loss_usd', 'pnl_usd']);
  assert.equal(validStructure(structure('s1'), PUBLISHED_AT), true);
  assert.equal(validStructure(structure('s1', { pnl_usd: null, underlying: 'BRK.B' }), PUBLISHED_AT), true);
  assert.equal(MAX_STRUCTURES, 100);
  assert.equal(validCheckpoint(swarmCheckpoint({ structures: Array.from({ length: 101 }, (_, n) => structure(`s${n}`)) })), false);
  for (const [label, patch] of [
    ['five legs', { legs: 5 }], ['no contracts', { quantity: 0 }], ['a lower-case symbol', { underlying: 'spy' }], ['an impossible expiry', { expiry: '2026-02-30' }],
    ['a negative maximum loss', { max_loss_usd: '-5' }], ['real as a word', { real: 'yes' }], ['opened after the checkpoint', { opened_at: '2026-09-28T16:00:00.000Z' }],
  ]) assert.equal(validStructure(structure('s1', patch), PUBLISHED_AT), false, label);
});

// The licence test: a checkpoint that tries to carry a quote in every block, under every name a quote
// goes by, and in words. Every one is refused whole, by the Worker too.
export const QUOTE_FIELDS = ['bid', 'ask', 'mid', 'mark', 'last', 'spread', 'iv', 'implied_vol', 'delta', 'gamma', 'theta', 'vega', 'greeks',
  'surface', 'strike', 'strikes', 'price', 'entry_price', 'underlying_price', 'params', 'quote', 'nbbo', 'legs_detail'];
test('a checkpoint that smuggles quotes, greeks, surfaces or parameters is refused, in any block and in words', async () => {
  const good = swarmCheckpoint();
  const { capital } = floor(Date.parse(PUBLISHED_AT) + 30000);
  const smuggled = [];
  for (const field of QUOTE_FIELDS) {
    smuggled.push([`top level ${field}`, { ...good, [field]: '1.25' }]);
    smuggled.push([`agent ${field}`, { ...good, agents: [{ ...good.agents[0], [field]: '1.25' }, ...good.agents.slice(1)] }]);
    smuggled.push([`record ${field}`, { ...good, agents: [{ ...good.agents[0], record: { ...good.agents[0].record, [field]: '1.25' } }] }]);
    smuggled.push([`structure ${field}`, { ...good, structures: [{ ...good.structures[0], [field]: '1.25' }] }]);
    smuggled.push([`gym ${field}`, { ...good, gym: { ...good.gym, [field]: '1.25' } }]);
    smuggled.push([`account ${field}`, { ...good, account: { ...good.account, [field]: '1.25' } }]);
    smuggled.push([`compute ${field}`, { ...good, compute: { ...good.compute, [field]: '1.25' } }]);
    smuggled.push([`run ${field}`, { ...good, run: { ...good.run, [field]: '1.25' } }]);
  }
  for (const text of QUOTED) {
    smuggled.push([`mechanism "${text}"`, { ...good, agents: [{ ...good.agents[0], mechanism: text }] }]);
    smuggled.push([`name "${text}"`, { ...good, agents: [{ ...good.agents[0], name: text }] }]);
  }
  for (const [label, body] of smuggled) {
    assert.equal(validCheckpoint(body), false, label);
    assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 400, label);
  }
  assert.equal((await post(capital, '/api/capital/checkpoint', good)).status, 200, 'the clean checkpoint still publishes');
});

// ---------------------------------------------------------------------------- the tape
test('the tape carries four kinds, each one exact payload on its own stream, in quote-free words', async () => {
  assert.deepEqual(Object.keys(EVENT_KINDS), ['agent.note', 'agent.trade', 'swarm.news', 'account.mark']);
  const events = TAPE();
  for (const event of events) assert.equal(validEvent(event), true, event.id);
  assert.equal(validEventBatch(batch(...events)), true);
  const close = trade('orb-4', { action: 'close', max_loss_usd: null, pnl_usd: '-12.00' });
  assert.equal(validEvent(close), true, 'a close may no longer know its maximum loss');
  assert.equal(validEventBatch({ schema_version: 1, events }), false, 'schema 1 batches are refused');
  const open = trade('orb-4');
  const rejected = [
    ['a note on the swarm stream', { ...note('orb-4', 'x'), stream: 'swarm' }],
    ['news on an agent stream', { ...news('x'), stream: 'agent:orb-4' }],
    ['a mark on the old ops stream', { ...mark('1', PUBLISHED_AT), stream: 'ops' }],
    ['an old desk stream', { ...note('orb-4', 'x'), stream: 'desk:orb-4' }],
    ['an old kind', { ...note('orb-4', 'x'), kind: 'desk.thought' }],
    ['a note with a session', { ...note('orb-4', 'x'), payload: { text: 'x', session_id: 's' } }],
    ['a blank note', note('orb-4', '  ')],
    ['a trade with a price', { ...open, payload: { ...open.payload, price: '1.25' } }],
    ['a trade with strikes', { ...open, payload: { ...open.payload, strikes: [570, 575] } }],
    ['an open with a P&L', { ...open, payload: { ...open.payload, pnl_usd: '3' } }],
    ['an open without its maximum loss', { ...open, payload: { ...open.payload, max_loss_usd: null } }],
    ['a note naming the venue', note('orb-4', 'The Alpaca order was refused.')],
    ['news naming a venue', news('Kalshi settled the market.')],
    ['a trade of a naked short', { ...open, payload: { ...open.payload, structure: 'short_put' } }],
    ['a mark with venues', { ...mark('1', PUBLISHED_AT), payload: { equity: '1', cash: '1', as_of: PUBLISHED_AT, venues: [] } }],
  ];
  for (const text of QUOTED) {
    rejected.push([`a note "${text}"`, note('orb-4', text)]);
    rejected.push([`news "${text}"`, news(text)]);
    rejected.push([`a trade's why "${text}"`, { ...open, payload: { ...open.payload, why: text } }]);
  }
  const { capital } = floor();
  for (const [label, event] of rejected) {
    assert.equal(validEvent(event), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch(event))).status, 400, label);
  }
  assert.equal(validKindPayload('provider.request', {}), false);
  assert.equal(validStream('broker:alpaca'), false);
});

test('the publisher projection is the only event shape the record stores', async () => {
  const { capital } = floor();
  const base = note('condor-vrp-3', 'Holding the condor.');
  assert.equal(validEvent({ ...base, seq: 41 }), true, 'a stored seq is accepted and ignored');
  for (const [label, mutate] of [
    ['private key', e => { e.payload._prompt = 'system prompt'; }],
    ['api credential', e => { e.payload.text = 'exported sk-live-9aa1 for the run'; }],
    ['bearer credential', e => { e.payload.text = 'sent Bearer abc for the run'; }],
    ['broker credential', e => { e.payload.text = 'header APCA-API-KEY-ID rotated'; }],
    ['markup', e => { e.payload.text = 'the filing said <b>growth</b>'; }],
    ['offsite url', e => { e.payload.text = 'source https://example.com/report'; }],
    ['a venue host', e => { e.payload.text = 'source https://kalshi.com/markets'; }],
    ['script uri', e => { e.payload.text = 'then javascript:alert(1) runs'; }],
    ['uppercase stream', e => { e.stream = 'agent:Condor'; }],
    ['timestamp without milliseconds', e => { e.at = '2026-09-28T14:01:00Z'; }],
    ['short digest', e => { e.digest = 'abc123'; }],
    ['spaced id', e => { e.id = 'note condor'; }],
    ['unknown field', e => { e.received_at = 1; }],
  ]) {
    const candidate = structuredClone(base);
    mutate(candidate);
    assert.equal(validEvent(candidate), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch(candidate))).status, 400, label);
  }
  assert.equal(sourceUrl('https://www.sec.gov/Archives/x'), 'https://www.sec.gov/Archives/x');
  assert.equal(sourceUrl('https://kalshi.com/fees'), null, 'no venue is a source');
  assert.equal(validEvent(note('condor-vrp-3', 'The filing https://www.sec.gov/Archives/x confirms it.')), true);
});

// ---------------------------------------------------------------------------- the Durable Object
test('batches are idempotent by id and a conflicting digest rejects the whole batch', async () => {
  const { capital } = floor();
  const [one, two, three] = [note('orb-4', 'One.'), note('orb-4', 'Two.'), note('orb-4', 'Three.')];
  assert.equal((await post(capital, '/api/capital/events', batch(one), { auth: 'wrong-token-but-long-enough-to-compare' })).status, 401);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(one, two))).json(), { stored: 2, replayed: 0 });
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(one, two))).json(), { stored: 0, replayed: 2 });
  const rewritten = { ...one, payload: { text: 'Rewritten history.' }, digest: 'f'.repeat(64) };
  assert.equal((await post(capital, '/api/capital/events', batch(three, rewritten))).status, 409);
  const stored = await (await get(capital, '/api/capital/events')).json();
  assert.deepEqual(stored.events.map(e => e.seq), [2, 1], 'the conflicting batch stored nothing');
  assert.equal(stored.schema_version, 2);
  assert.deepEqual(stored.events[1], { ...one, seq: 1 });
  assert.equal((await post(capital, '/api/capital/events', batch(three, three))).status, 400);
  assert.equal((await post(capital, '/api/capital/events', batch(...Array.from({ length: 101 }, (_, i) => note('orb-4', `N ${i}`))))).status, 400);
  assert.equal((await post(capital, '/api/capital/events', `{"schema_version":2,"padding":"${'x'.repeat(MAX_BATCH_BYTES)}"}`)).status, 413);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/events', { method: 'DELETE' }))).status, 405);
  assert.ok(MAX_EVENTS_KEPT > 1000);
});

test('checkpoints publish forward only and the agent roster follows them', async () => {
  const { capital } = floor(Date.parse(PUBLISHED_AT) + 30000);
  assert.equal((await get(capital, '/api/capital/checkpoint')).status, 404, 'nothing published yet: the watchdog reads a 404');
  assert.equal((await post(capital, '/api/capital/checkpoint', swarmCheckpoint(), { auth: 'short' })).status, 401);
  const reply = await post(capital, '/api/capital/checkpoint', swarmCheckpoint());
  assert.deepEqual(await reply.json(), { published_at: PUBLISHED_AT, agents: 12 });
  const read = await get(capital, '/api/capital/checkpoint');
  assert.deepEqual(await read.json(), swarmCheckpoint());
  assert.equal((await get(capital, '/api/capital/checkpoint', { 'If-None-Match': read.headers.get('ETag') })).status, 304);
  assert.equal((await post(capital, '/api/capital/checkpoint', swarmCheckpoint())).status, 200, 'an identical replay is a no-op');
  assert.equal((await post(capital, '/api/capital/checkpoint', emptyCheckpoint())).status, 409, 'older');
  assert.equal((await post(capital, '/api/capital/checkpoint', swarmCheckpoint({ published_at: '2026-09-28T15:02:00.000Z' }))).status, 400, 'more than a minute ahead');
  const roster = await (await get(capital, '/api/capital/agents')).json();
  assert.equal(roster.schema_version, 2);
  assert.deepEqual(roster.agents.map(row => row.id), swarmCheckpoint().agents.map(row => row.id).sort());
  assert.deepEqual(await (await get(capital, '/api/capital/agents/orb-4')).json(), swarmCheckpoint().agents.find(row => row.id === 'orb-4'));
  assert.equal((await get(capital, '/api/capital/agents/unknown')).status, 404);
  assert.equal((await get(capital, '/api/capital/agents/..%2Fadmin')).status, 404);
  assert.equal((await get(capital, '/api/capital/desks')).status, 404, 'the old roster address is gone');
  const next = swarmCheckpoint({ published_at: '2026-09-28T14:59:00.000Z', agents: [agent('orb-4')] });
  assert.equal((await post(capital, '/api/capital/checkpoint', next)).status, 200);
  assert.deepEqual((await (await get(capital, '/api/capital/agents')).json()).agents.map(row => row.id), ['orb-4']);
});

test('public reads page newest first and follow a cursor forward; the live tape fans out to matching subscribers', async () => {
  const { capital, listen } = floor();
  const orb = listen(['agent:orb-4']);
  const swarm = listen(['swarm']);
  const everything = listen(['all']);
  const events = [note('orb-4', 'One.'), note('orb-4', 'Two.'), news('Born: Gap Drift.'), note('condor-vrp-3', 'Three.')];
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(...events))).json(), { stored: 4, replayed: 0 });
  assert.deepEqual((await (await get(capital, '/api/capital/events')).json()).events.map(e => e.seq), [4, 3, 2, 1]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?after=2&limit=1')).json()).events.map(e => e.seq), [3]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?stream=agent%3Aorb-4')).json()).events.map(e => e.seq), [2, 1]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?kind=swarm.news')).json()).events.map(e => e.seq), [3]);
  for (const query of ['?limit=201', '?after=abc', '?stream=desk:orb-4', '?kind=desk.thought', '?cursor=1']) {
    assert.equal((await get(capital, '/api/capital/events' + query)).status, 400, query);
  }
  assert.deepEqual(orb.received.map(e => e.seq), [1, 2]);
  assert.deepEqual(swarm.received.map(e => e.kind), ['swarm.news']);
  assert.equal(everything.received.length, 4);
  assert.equal(socketMatches(['all'], 'agent:orb-4'), true);
  assert.deepEqual(parseStreamTags('agent:orb-4,swarm'), ['agent:orb-4', 'swarm']);
  assert.equal(parseStreamTags('desk:orb-4'), null);
  assert.equal(allowedOrigin('https://blakewoods.us'), true);
  assert.equal(allowedOrigin('https://blakewoods.us.evil.example'), false);
});

test('the Brokerage Account marks are archived as the balance history, beyond the tape, and backfill without replaying', async () => {
  const { capital, listen } = floor();
  const socket = listen(['all']);
  const marks = [mark('481.65', '2026-09-26T06:30:00.000Z'), mark('5481.65', '2026-09-28T13:00:00.000Z')];
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(...marks))).json(), { stored: 2, replayed: 0 });
  const history = await (await get(capital, '/api/capital/history')).json();
  assert.deepEqual(history, { schema_version: 2, total: 2, sampled: false, points: [{ at: marks[0].at, equity: '481.65' }, { at: marks[1].at, equity: '5481.65' }] });
  const backfill = mark('490.00', '2026-09-27T00:00:00.000Z');
  assert.deepEqual(await (await post(capital, '/api/capital/history', batch(backfill))).json(), { stored: 1, replayed: 0 });
  assert.equal(socket.received.length, 2, 'a backfill is not rebroadcast');
  assert.equal((await post(capital, '/api/capital/history', batch(note('orb-4', 'x')))).status, 400, 'only marks');
  assert.equal((await (await get(capital, '/api/capital/history')).json()).total, 3);
  assert.ok(MAX_HISTORY_POINTS >= 2048);
});

test('the reset erases the tape, the balance history, the checkpoint and the roster, and nothing else answers it', async () => {
  const { capital } = floor(Date.parse(PUBLISHED_AT) + 30000);
  await post(capital, '/api/capital/events', batch(...TAPE()));
  await post(capital, '/api/capital/checkpoint', swarmCheckpoint());
  assert.equal((await post(capital, '/api/capital/reset', {})).status, 400, 'the confirmation is required');
  assert.equal((await post(capital, '/api/capital/reset?confirm=erase-everything', {}, { auth: 'wrong-token-but-long-enough-to-compare' })).status, 401);
  assert.equal((await get(capital, '/api/capital/reset?confirm=erase-everything')).status, 405);
  const reply = await post(capital, '/api/capital/reset?confirm=erase-everything', {});
  assert.deepEqual(await reply.json(), { reset: true, cleared: { events: 9, floor_history: 3, checkpoint: 1, desks: 12 } });
  assert.equal((await get(capital, '/api/capital/checkpoint')).status, 404);
  assert.deepEqual((await (await get(capital, '/api/capital/events')).json()).events, []);
  assert.equal((await (await get(capital, '/api/capital/events')).json()).latest_seq, 0);
  assert.deepEqual((await (await get(capital, '/api/capital/history')).json()).points, []);
  assert.deepEqual((await (await get(capital, '/api/capital/agents')).json()).agents, []);
  // The House's first checkpoint after the reset lands on the clean record, whatever came before.
  assert.equal((await post(capital, '/api/capital/checkpoint', emptyCheckpoint())).status, 200);
});

test('the retired Portfolio Agent redirects its pages and refuses its API', async () => {
  for (const path of ['/portfolio', '/portfolio/', '/portfolio/research/', '/capital/desk', '/capital/desk/']) {
    assert.deepEqual(retiredRoute(path), { status: 301, headers: { Location: RETIRED_TARGET, 'Cache-Control': 'public, max-age=3600' }, body: '' }, path);
  }
  for (const path of ['/api/portfolio', '/api/portfolio/state']) assert.equal(retiredRoute(path).status, 410, path);
  for (const path of ['/capital/', '/api/capital/events', '/', '/api/exchange']) assert.equal(retiredRoute(path), null, path);
  const server = createServer(() => { throw new Error('No exchange calls expected'); }, { origin: 'http://localhost' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/', '/capital/', '/capital/capital.js', '/capital/capital.css', '/capital/schema.js']) assert.equal((await fetch(origin + path)).status, 200, path);
    assert.equal((await fetch(origin + '/capital/committee/', { redirect: 'manual' })).status, 301);
    for (const path of ['/capital/runtime.json', '/.env', '/.data/credentials.json']) assert.equal((await fetch(origin + path)).status, 404, path);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

// ---------------------------------------------------------------------------- the page's words
const VENUES = /kalshi|alpaca|coinbase/i;
test('no venue is named anywhere a visitor can read, and the page says what it is', async () => {
  for (const file of ['capital/index.html', 'capital/capital.js', 'capital/capital.css', 'index.html', 'app.js']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, VENUES, file);
  }
  // The schema names them once, in the rule that refuses them in anything published.
  const schema = await readFile(new URL('../capital/schema.js', import.meta.url), 'utf8');
  assert.deepEqual(schema.split('\n').filter(line => VENUES.test(line)), ['export const VENUE_NAMES = /alpaca|kalshi|coinbase/i;']);
  const html = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(html, /<p class="lede">AI agents trading options\.<\/p>/);
  assert.match(html, /<meta name="description" content="Long-Term Capital Management: AI agents trading options\./);
  assert.match(html, /Brokerage Account/);
  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /Long-Term Capital Management[\s\S]{0,400}AI agents trading options, in public\./);
});

const SECTION_IDS = ['masthead', 'live', 'account', 'swarm', 'structures'];
test('the page carries five sections in order, four numbers, the two header links and nothing external', async () => {
  const source = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|localStorage|sessionStorage|sendBeacon|document\.write/);
  assert.doesNotMatch(source, /createElement\('a'\)|element\('a'|github\.com/, 'the script builds no link');
  const html = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>Long-Term Capital Management<\/title>/);
  assert.doesNotMatch(html, /http:\/\/|<script(?![^>]*type="module" *>)[^>]*>(?!\s*<\/script>)/);
  const anchors = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(anchors, [['/', 'Blake Woods'], ['https://github.com/bwoods1998/long-term-capital-management', 'GitHub ↗']]);
  assert.equal((html.match(/<a[\s>]/gi) || []).length, 2);
  assert.deepEqual([...html.matchAll(/<section id="([a-z-]+)"/g)].map(match => match[1]), SECTION_IDS);
  assert.deepEqual([...html.matchAll(/<h2 [^>]*>([^<]+)<\/h2>/g)].map(match => match[1]), ['Brokerage Account', 'The swarm', 'Open structures']);
  assert.match(html, /<h2 id="live-title" class="live-heading"><span id="floor-status" class="live-status live-stopped" role="status"><span class="pulse"><\/span><span>stopped<\/span><\/span><\/h2>/);
  assert.deepEqual([...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1]), ['Brokerage Account', 'Total profit', 'After compute', 'Running']);
  const order = FLOOR_IDS.map(id => html.indexOf(`id="${id}"`));
  assert.ok(order.every((index, n) => index > 0 && (n === 0 || index > order[n - 1])), 'numbers, status, stage, feed, account, swarm, structures');
  for (const gone of ['floor-improvement', 'floor-positions', 'floor-closed', 'floor-practice', 'floor-portfolio']) assert.doesNotMatch(html, new RegExp(`id="${gone}"`), gone);
  assert.doesNotMatch(html, /<footer|investment advice|ladder|Level \d/i);
  // The word budget: at most 40 static words above the live feed, 90 on the whole page.
  const staticWords = text => text.replace(/<[^>]+>/g, ' ').replace(/[—…$]/g, ' ').split(/\s+/).filter(word => /[A-Za-z]/.test(word));
  assert.ok(staticWords(html.slice(html.indexOf('<body'), html.indexOf('id="floor-feed"'))).length <= 40);
  assert.ok(staticWords(html.slice(html.indexOf('<body'))).length <= 90);
});

test('the build publishes the page with hashed, self-hosted assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ltcm-build-'));
  try {
    for (const name of ['build.mjs', 'package.json', 'index.html', 'styles.css', 'app.js', 'chart.js', 'favicon.svg', 'admin', 'capital']) {
      await cp(new URL('../' + name, import.meta.url), join(root, name), { recursive: true });
    }
    const build = () => spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(build().status, 0);
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['_headers', 'admin', 'assets', 'capital', 'index.html']);
    assert.deepEqual((await readdir(join(root, 'dist/capital'))).sort(), ['index.html']);
    const html = await readFile(join(root, 'dist/capital/index.html'), 'utf8');
    assert.match(html, /\.\.\/assets\/capital\.[a-f0-9]{12}\.css/);
    assert.match(html, /\.\.\/assets\/capital\.[a-f0-9]{12}\.js/);
    const bundle = await readFile(join(root, 'dist/assets/' + (await readdir(join(root, 'dist/assets'))).find(name => /^capital\.[a-f0-9]{12}\.js$/.test(name))), 'utf8');
    assert.match(bundle, /from '\.\/schema\.[a-f0-9]{12}\.js'/);
    const headers = await readFile(join(root, 'dist/_headers'), 'utf8');
    assert.match(headers, /connect-src 'self' wss:\/\/blakewoods\.us wss:\/\/www\.blakewoods\.us/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------- the numbers
test('total profit is the balance less the reset less net deposits, only on a fresh balance and a verified funding check', () => {
  const good = swarmCheckpoint();
  assert.equal(PERFORMANCE_START_AT, RESET_AT);
  assert.equal(START_EQUITY, '481.65');
  assert.equal(totalProfit(good), '212.72', '5,694.37 − 481.65 − 5,000');
  assert.equal(totalProfit(swarmCheckpoint({ account: { ...good.account, stale: true } })), null, 'a stale balance');
  assert.equal(totalProfit(swarmCheckpoint({ account: { ...good.account, as_of: '2026-09-28T14:40:00.000Z' } })), null, 'a balance 18 minutes old');
  assert.equal(totalProfit(swarmCheckpoint({ performance: { ...good.performance, net_flows: null, verified_at: null } })), null, 'funding not verified');
  assert.equal(totalProfit(swarmCheckpoint({ performance: { ...good.performance, verified_at: '2026-09-28T14:40:00.000Z' } })), null, 'funding checked too long ago');
  assert.equal(totalProfit(swarmCheckpoint({ account: null })), null);
  assert.equal(totalProfit(swarmCheckpoint({ performance: null })), null, 'no basis published: the constants stand in, and profit waits');
  // A basis from before the reset is the old record's: never read.
  const old = { ...good.performance, start_at: '2026-09-19T04:56:53.000Z', start_equity: '1021.9251' };
  assert.equal(profitBasis(swarmCheckpoint({ performance: old })).start_equity, START_EQUITY);
  assert.equal(totalProfit(swarmCheckpoint({ performance: old })), null);
  // A later basis from the House is read as published.
  const later = { ...good.performance, start_at: '2026-09-26T07:02:18.000Z', start_equity: '481.70', net_flows: '0' };
  assert.equal(totalProfit(swarmCheckpoint({ performance: later })), '5212.67');
  assert.equal(totalProfit(swarmCheckpoint({ account: { ...good.account, equity: '5400.00' } })), '-81.65', 'losses are first-class');
});

test('the one number is total profit after every input cost, and a dash while any part is unmetered', () => {
  const good = swarmCheckpoint();
  assert.deepEqual(computeSpend(good).total, '287.59');
  assert.equal(profitAfterCompute(good), '-74.87', '212.72 − 287.59');
  assert.equal(profitAfterCompute(swarmCheckpoint({ compute: { ...good.compute, openai_usd: null } })), null);
  assert.equal(computeSpend(swarmCheckpoint({ compute: null })).total, null);
  assert.equal(profitAfterCompute(swarmCheckpoint({ account: { ...good.account, stale: true } })), null);
  const [balance, profit, net, clock] = mastheadNumbers(good, Date.parse(PUBLISHED_AT));
  assert.deepEqual([balance.label, balance.value], ['Brokerage Account', '$5,694.37']);
  assert.deepEqual([profit.label, profit.value, profit.tone], ['Total profit', '+$212.72', 'positive']);
  assert.deepEqual([net.label, net.value, net.tone], ['After compute', '−$74.87', 'negative']);
  assert.deepEqual([clock.label, clock.value, clock.tick], ['Running', '55h 55m', '42s'], 'from run.started_at');
  assert.deepEqual(mastheadNumbers(emptyCheckpoint(), Date.parse('2026-09-26T07:03:00.000Z')).map(item => item.value), ['—', '—', '—', '0m']);
  assert.deepEqual(mastheadNumbers(null).map(item => item.value), ['—', '—', '—', '—'], 'no checkpoint: no clock either');
  assert.equal(startedAt(emptyCheckpoint({ run: { started_at: null } })), Date.parse(PERFORMANCE_START_AT), 'the reset, while the House has not said');
  assert.deepEqual(runningParts(3 * 86400 + 7 * 3600 + 5), { main: '79h 00m', tick: '05s' });
  assert.deepEqual(runningParts(200 * 3600), { main: '8d 8h', tick: '' });
  const lines = accountLines(good);
  assert.match(lines[0], /^\$5,694\.37 now · \$481\.65 at the reset, Sep 26, 2:25 AM EDT\.$/);
  assert.equal(lines[1], '+$212.72 total profit, after +$5,000.00 of deposits less withdrawals.');
  assert.equal(lines[2], '$287.59 compute: Sail $212.40, OpenAI $64.10, ThetaData $5.43, market data $5.66, other $0.00.');
  assert.equal(lines[3], '−$74.87 after compute: the one number.');
  assert.match(accountLines(emptyCheckpoint()).join(' '), /No balance has been published since\. Total profit waits .* Compute is not yet metered\./);
  assert.match(accountLines(swarmCheckpoint({ compute: { ...good.compute, openai_usd: null } }))[2], /^Compute so far: .*OpenAI not yet metered/);
});

test('the balance chart draws the reset, every mark since and the fresh reading, and never an older record', () => {
  const marks = [{ at: '2026-09-20T00:00:00.000Z', equity: '1021.92' }, { at: '2026-09-28T13:00:00.000Z', equity: '5481.65' }];
  const series = accountSeries(marks, swarmCheckpoint());
  assert.deepEqual(series.points.map(point => point.equity), [481.65, 5481.65, 5694.37]);
  assert.equal(series.tone, 'positive');
  assert.equal(accountSeries([], emptyCheckpoint()), null, 'one point is no line');
  assert.equal(balanceSeries([{ at: 'x', equity: '1' }, { at: PUBLISHED_AT, equity: '2' }]), null);
});

// ---------------------------------------------------------------------------- the swarm and the book
test('the swarm lists every band highest first, with the mechanism in words and the record that sizes money', () => {
  const rows = swarmRows(swarmCheckpoint());
  assert.deepEqual(rows.map(row => row.band), ['sized', 'probe', 'probe', 'candidate', 'candidate', 'candidate', 'gym', 'gym', 'gym', 'gym', 'gym', 'retired']);
  assert.deepEqual(rows.slice(0, 3).map(row => [row.name, row.bandText, row.real, row.record.main]), [
    ['Condor Vrp 3', 'Sized', true, 'real 22 trades · 16 won · +$212.40'],
    ['Orb 4', 'Probe', true, 'real 3 trades · 2 won · +$21.80'],
    ['Putspread Dip 2', 'Probe', true, 'real 4 trades · 2 won · −$18.30'],
  ]);
  assert.equal(rows[3].record.main, 'forward 18 trades · 11 won · +$96.40');
  assert.equal(rows[3].record.rest, '2,410 trials · 19 revisions');
  assert.deepEqual(recordWords(agent('x', { record: { trials: 1, revisions: 1, forward: null, real: null } })), { main: '1 trial · 1 revision', tone: '', rest: '' });
  assert.equal(rows[0].structure, 'iron condor');
  assert.deepEqual(bandCounts(swarmCheckpoint()).map(row => `${row.count} ${row.word}`), ['1 Sized', '2 Probe', '3 Candidate', '5 Gym', '1 Retired']);
  assert.deepEqual(bandCounts(emptyCheckpoint()).map(row => row.count), [0, 0, 0, 0, 0], 'empty bands keep their place');
  assert.deepEqual(Object.values(BAND_WORDS), ['Gym', 'Candidate', 'Probe', 'Sized', 'Retired']);
  assert.equal(gymLine(swarmCheckpoint()), '48,213 programs tested · 51,240.5 market-years simulated · 11 families alive · 37 retired');
  assert.equal(gymLine(emptyCheckpoint()), 'The Gym has not reported yet.');
  assert.equal(gymLine(swarmCheckpoint({ gym: { ...swarmCheckpoint().gym, market_years: null, families_retired: null } })), '48,213 programs tested · 11 families alive');
});

test('open structures list real money first by maximum loss, then the shadow book, with their P&L', () => {
  const rows = structureRows(swarmCheckpoint());
  assert.deepEqual(rows.map(row => [row.name, row.real, row.what, row.detail, row.maxLoss, row.pnl]), [
    ['Condor Vrp 3', true, 'XSP iron condor', '4 legs · Sep 28 · ×1', '$184.00', '+$12.50'],
    ['Orb 4', true, 'SPY debit vertical', '2 legs · Sep 28 · ×2', '$96.00', '−$8.00'],
    ['Putspread Dip 2', true, 'QQQ debit vertical', '2 legs · Sep 30 · ×1', '$61.00', '—'],
    ['Ironfly Quiet', false, 'SPY iron butterfly', '4 legs · Sep 28 · ×1', '$312.00', '+$41.00'],
  ]);
  assert.equal(structureLine(rows), '3 real · 1 shadow · $341 at risk on real money');
  assert.equal(expiryText('2026-10-02'), 'Oct 2');
  assert.equal(structureText('XSP', 'long_call'), 'XSP long call');
});

test('the feed reads decisions, trades and news in plain words, folds repeats, and keeps the stage steady', () => {
  const names = new Map(swarmCheckpoint().agents.map(row => [row.id, row.name]));
  const lines = feedLines(TAPE(), names);
  assert.deepEqual(lines.map(line => [line.kind, line.name, line.text, line.pnl, line.real]), [
    ['thinking', 'Condor Vrp 3', 'Realized volatility since the open is running under half of what the index options expect. Holding the condor; closing at the first touch of either short strike.', '', null],
    ['thinking', 'Putspread Dip 2', 'The gap down held through the first hour, so I bought the put vertical two weeks out and will close it before the final hour.', '', null],
    ['trading', 'Orb 4', 'closed 2 SPY debit verticals', '+$31.00', true],
    ['trading', 'Orb 4', 'opened 2 SPY debit verticals · Sep 28 · max loss $96', '', true],
    ['trading', 'Condor Vrp 3', 'opened 1 XSP iron condor · Sep 28 · max loss $184', '', true],
    ['swarm', 'Swarm', 'Condor Vrp 3 reached Sized: its forward record held over 64 trades.', '', null],
  ]);
  assert.equal(lines[2].why, 'Target reached before the lunch lull.');
  const repeats = [note('orb-4', 'Waiting for the range.', '2026-09-28T14:00:00.000Z'), note('orb-4', 'Waiting for the range.', '2026-09-28T14:05:00.000Z')];
  assert.deepEqual(feedLines(repeats, names).map(line => [line.text, line.count]), [['Waiting for the range.', 2]]);
  assert.equal(feedLine(mark('1', PUBLISHED_AT)), null, 'a balance mark is the chart\'s, not the feed\'s');
  assert.equal(tradeWords({ action: 'open', underlying: 'SPY', structure: 'long_put', quantity: 1, expiry: '2026-10-02', max_loss_usd: '45.00' }), 'opened 1 SPY long put · Oct 2 · max loss $45');
  const hero = heroNote(TAPE());
  assert.equal(hero.agent, 'condor-vrp-3');
  const later = [...TAPE(), note('orb-4', 'Standing aside until the range breaks.', '2026-09-28T14:52:30.000Z')];
  assert.equal(heroNote(later, 'condor-vrp-3').agent, 'condor-vrp-3', 'the agent on stage keeps it while it is still talking');
  assert.equal(heroNote(later).agent, 'orb-4');
});

test('the helpers read as words and money', () => {
  assert.equal(money('1234567.891'), '$1,234,567.89');
  assert.equal(money('-0.005'), '−$0.01');
  assert.equal(money(null), '—');
  assert.equal(signedMoney('250.25', 0), '+$250');
  assert.equal(signedMoney('-250.25'), '−$250.25');
  assert.equal(floorRunning(swarmCheckpoint(), Date.parse(PUBLISHED_AT) + 60000), true);
  assert.equal(floorRunning(swarmCheckpoint(), Date.parse(PUBLISHED_AT) + 16 * 60000), false);
  assert.equal(floorRunning(null), false);
  assert.equal(tapeOf('?tape=test'), 'test');
  assert.equal(tapeOf('?tape=demo'), null);
  assert.equal(apiBase('?tape=canary'), '/api/capital/t/canary');
  assert.equal(apiBase(''), '/api/capital');
  assert.equal(streamUrl(['all'], { protocol: 'https:', host: 'blakewoods.us', search: '' }), 'wss://blakewoods.us/api/capital/stream');
  assert.equal(streamUrl(['agent:orb-4'], { protocol: 'http:', host: 'localhost:4173', search: '?tape=test' }), 'ws://localhost:4173/api/capital/t/test/stream?streams=agent%3Aorb-4');
});

// ---------------------------------------------------------------------------- the page, mounted
async function publishedRecord(checkpoint, events) {
  const { capital } = floor(Date.parse(checkpoint.published_at) + 30000);
  if (events.length) assert.equal((await post(capital, '/api/capital/events', batch(...events))).status, 200);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
  return capital;
}
test('mounted on a published record, the page draws every section from it', async () => {
  const capital = await publishedRecord(swarmCheckpoint(), TAPE());
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    const feed = await startCapital(root);
    feed.stop();
    for (const id of FLOOR_IDS.filter(name => name !== 'floor-status')) assert.equal(root.querySelector(`#${id}`).getAttribute('aria-busy'), 'false', id);
    assert.match(textOf(root.querySelector('#floor-numbers')), /^Brokerage Account \$5,694\.37 Total profit \+\$212\.72 After compute −\$74\.87 Running (?:\d+h \d\dm \d\ds|\d+m \d\ds|\d+d \d+h)$/);
    const now = root.querySelector('#floor-now');
    assert.match(textOf(now), /^Condor Vrp 3 Sized /);
    assert.match(now.withClass('now-thought')[0].textContent, /^Realized volatility since the open/);
    const lines = root.querySelector('#floor-feed').withClass('feed-line').map(textOf);
    assert.equal(lines.length, 5, 'the note on stage is not repeated below it');
    assert.match(lines[0], /thinking Putspread Dip 2 The gap down held/);
    assert.match(lines[1], /trading Orb 4 real money closed 2 SPY debit verticals \+\$31\.00$/);
    assert.match(lines[4], /swarm Swarm Condor Vrp 3 reached Sized/);
    const account = root.querySelector('#floor-account');
    assert.equal(account.find('svg').length, 1);
    assert.match(account.find('svg')[0].getAttribute('aria-label'), /\$481\.65 to \$5,694\.37/);
    assert.match(textOf(account), /−\$74\.87 after compute: the one number\./);
    const swarm = root.querySelector('#floor-swarm');
    assert.equal(textOf(swarm.withClass('gym-line')[0]), '48,213 programs tested · 51,240.5 market-years simulated · 11 families alive · 37 retired');
    assert.equal(textOf(swarm.withClass('band-counts')[0]), '1 Sized 2 Probe 3 Candidate 5 Gym 1 Retired');
    const rows = swarm.find('tbody')[0].find('tr');
    assert.equal(rows.length, 11, 'the living agents; the retired one waits behind the button');
    assert.match(textOf(rows[0]), /^Condor Vrp 3 Sized iron condor Sells short-dated index premium .* real 22 trades · 16 won · \+\$212\.40 5,812 trials · 41 revisions$/);
    const more = swarm.withClass('more')[0];
    assert.equal(textOf(more), '1 more, 1 retired among them');
    more.click();
    assert.equal(root.querySelector('#floor-swarm').find('tbody')[0].find('tr').length, 12);
    const book = root.querySelector('#floor-structures');
    assert.equal(textOf(book.withClass('record-line')[0]), '3 real · 1 shadow · $341 at risk on real money');
    assert.deepEqual(book.find('tbody')[0].find('tr').map(row => textOf(row)), [
      'Condor Vrp 3 real money XSP iron condor 4 legs · Sep 28 · ×1 $184.00 +$12.50',
      'Orb 4 real money SPY debit vertical 2 legs · Sep 28 · ×2 $96.00 −$8.00',
      'Putspread Dip 2 real money QQQ debit vertical 2 legs · Sep 30 · ×1 $61.00 —',
      'Ironfly Quiet shadow SPY iron butterfly 4 legs · Sep 28 · ×1 $312.00 +$41.00',
    ]);
    assert.doesNotMatch(root.textContent, VENUES);
    assert.deepEqual(root.find('a'), []);
  });
});

test('after the reset, before the House publishes, every section says so and the numbers keep their dashes', async () => {
  const { capital } = floor();
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    const feed = await startCapital(root);
    feed.stop();
    assert.equal(textOf(root.querySelector('#floor-status')), 'stopped');
    assert.equal(textOf(root.querySelector('#floor-account')), 'No balance has been published yet.');
    assert.equal(textOf(root.querySelector('#floor-swarm')), 'Waiting for the swarm.');
    assert.equal(textOf(root.querySelector('#floor-structures')), 'No structure is open.');
    assert.equal(textOf(root.querySelector('#floor-now')), 'Nothing is running right now.');
    assert.match(textOf(root.querySelector('#floor-feed')), /^Quiet for now\./);
  });
  // The House's first checkpoint: a clock and nothing else yet.
  const fresh = await publishedRecord(emptyCheckpoint(), []);
  const first = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => fresh.fetch(new Request('https://blakewoods.us' + path)), async () => {
    const feed = await startCapital(first);
    feed.stop();
    assert.match(textOf(first.querySelector('#floor-numbers')), /^Brokerage Account — Total profit — After compute — Running /);
    assert.equal(textOf(first.querySelector('#floor-swarm')), 'The Gym has not reported yet. 0 Sized 0 Probe 0 Candidate 0 Gym 0 Retired No agent yet. The first families are born in the Gym.');
    assert.equal(textOf(first.querySelector('#floor-structures')), 'No structure is open.');
    assert.equal(textOf(first.querySelector('#floor-now')), 'No agent has written a note yet.');
  });
});

test('a test tape is read from its own address, and an unknown tape is the real record', async () => {
  const capital = await publishedRecord(swarmCheckpoint(), []);
  const asked = [];
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('?tape=test', path => { asked.push(path); return capital.fetch(new Request('https://blakewoods.us' + path.replace('/t/test', ''))); }, async () => {
    const feed = await startCapital(root);
    feed.stop();
  });
  assert.ok(asked.length > 0 && asked.every(path => path.startsWith('/api/capital/t/test/')), asked.join(' '));
});
