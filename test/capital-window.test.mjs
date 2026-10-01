// The swarm window's data layer (Oct 1, 2026): the schema's two optional blocks (`levels` and `rationale`), the Worker's
// reads for every page (the window read alone carries the blocks), one agent's tape, the score archive, and the number-word
// rule the Worker's contract shares with the House. The page that drew the window was rolled back to the prior design;
// it reads CURRENT_READ, which these tests hold byte for byte to what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, ROUTES, EXITS, FUNNEL_KEYS, FUNNEL_CHAINS, OPTIONAL_CHECKPOINT_FIELDS, MAX_AGENTS, thesisWords, validCheckpoint, validLevels, validRationale, validFunnel,
  scorePoint, validScorePoint, numberTokens, numbered, MAX_STRUCTURES, MAX_CHECKPOINT_BYTES, MAX_PUBLIC_CHECKPOINT_BYTES, MAX_NAMED_ROWS, MAX_POSITIONS,
  MAX_PRACTICE_ROWS, byteLength,
} from '../capital/schema.js';
import { CURRENT_READ, POSITIONS_READ, WINDOW_READ, MAX_SCORE_POINTS, SCORE_BUCKET_MS } from '../lib/capital.mjs';
import { CHECKPOINT_READ, netNumber } from '../capital/capital.js';
import { floor, post, get } from './harness.mjs';
import { LEAKS, PLAIN } from './number-words.mjs';
import {
  swarmCheckpoint, ledgerCheckpoint, ledger, position, agent, structure, note, trade, news, POSITIONS, PUBLISHED_AT, RESET_AT,
  funnel, levelsBlock, rationaleBlock, rationaleTrade, windowCheckpoint,
} from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const BILL = { as_of: '2026-09-28T14:57:00.000Z', sail_usd: '212.40', claude_usd: '41.20', openai_usd: '64.10', thetadata_usd: '5.43',
  market_data_usd: '5.66', other_usd: '0.00' };
const batch = (...events) => ({ schema_version: 2, events });
const withLevels = (agents, extra = {}) => windowCheckpoint({ levels: levelsBlock({ agents, ...extra }) });
const withTrades = trades => windowCheckpoint({ rationale: rationaleBlock({ trades }) });

// ---------------------------------------------------------------------------- the schema
test('the window adds two optional blocks: the words for levels, routes and exits, and fourteen funnel keys', () => {
  assert.deepEqual(LEVELS, ['train', 'practice', 'validation', 'incubator', 'tuition', 'candidate', 'probe', 'sized', 'retired']);
  assert.deepEqual(ROUTES, ['tuition', 'incubator', 'probe', 'sized', 'calibration', 'house']);
  assert.deepEqual(EXITS, ['agent', 'house', 'expiry']);
  assert.equal(FUNNEL_KEYS.length, 14);
  assert.deepEqual(OPTIONAL_CHECKPOINT_FIELDS, ['trading', 'positions', 'practice', 'levels', 'rationale']);
  assert.equal(validCheckpoint(windowCheckpoint()), true, 'a new House: both blocks');
  assert.equal(validCheckpoint(ledgerCheckpoint()), true, 'an old House: neither');
  const { rationale: _r, ...levelsOnly } = windowCheckpoint();
  assert.equal(validCheckpoint(levelsOnly), true, 'each block is optional on its own');
  assert.equal(validCheckpoint(windowCheckpoint({ levels: null, rationale: null })), true, 'or null');
  assert.equal(validCheckpoint({ ...windowCheckpoint(), climb: {} }), false, 'no other block');
});

test('levels: one level per roster agent, consistent with its band, and a funnel that only narrows', () => {
  const body = windowCheckpoint();
  assert.equal(validLevels(body.levels, body, PUBLISHED_AT), true);
  const agents = body.levels.agents;
  const swap = (id, level) => agents.map(row => (row.id === id ? { ...row, level } : row));
  for (const [label, value] of [
    ['an id off the roster', withLevels([...agents, { id: 'stranger', level: 'train' }])],
    ['an id twice', withLevels([...agents, agents[0]])],
    ['an unknown level', withLevels(swap('calendar-term', 'gym'))],
    ['a Gym agent on Probe', withLevels(swap('calendar-term', 'probe'))],
    ['a Gym agent past the holdout', withLevels(swap('calendar-term', 'candidate'))],
    ['a Sized agent anywhere else', withLevels(swap('condor-vrp-3', 'probe'))],
    ['a Candidate on Train', withLevels(swap('ironfly-quiet', 'train'))],
    ['a retired agent on Train', withLevels(swap('reversal-1', 'train'))],
    ['a retired agent in Validation', withLevels(swap('googl-lags', 'validation'))],
    ['an entry with more to say', withLevels(agents.map((row, n) => (n ? row : { ...row, why: 'x' })))],
    ['dated after its checkpoint', withLevels(agents, { as_of: '2026-09-28T15:00:00.000Z' })],
    ['too many', withLevels(Array.from({ length: MAX_AGENTS + 1 }, () => agents[0]))],
  ]) assert.equal(validCheckpoint(value), false, label);
  // Band consistency: a Gym agent may stand anywhere below the holdout; a retired one only where its money is.
  for (const level of ['train', 'practice', 'validation', 'incubator', 'tuition']) assert.equal(validCheckpoint(withLevels(swap('calendar-term', level))), true, level);
  for (const level of ['retired', 'tuition', 'incubator', 'probe', 'sized']) assert.equal(validCheckpoint(withLevels(swap('reversal-1', level))), true, level);
  assert.equal(validCheckpoint(withLevels([])), true, 'the House may send no agent entries');
});

test('the funnel: fourteen keys, counters or null, and each track narrows among the counts it knows', () => {
  assert.equal(validFunnel(funnel()), true);
  assert.equal(validFunnel(funnel({ validation: null, practice: null })), true, 'a source the House could not read is null');
  assert.equal(validFunnel(Object.fromEntries(FUNNEL_KEYS.map(key => [key, key === 'since' ? RESET_AT : null]))), true, 'all unknown');
  // Tuition is its own chain under Validation: a look needs no tuition first, and a failed look never gets one, so more
  // families may reach the Holdout than Tuition (the House's funnel since Oct 1, 2026).
  assert.deepEqual(FUNNEL_CHAINS, [['sized', 'probe', 'candidate', 'validation', 'born'], ['tuition', 'validation'], ['incubator', 'practice', 'born'],
    ['retired', 'born'], ['looks_passed', 'looks']]);
  assert.equal(validFunnel(funnel({ tuition: 1 })), true, 'candidate 6 above tuition 1');
  assert.equal(validFunnel(funnel({ tuition: 0, candidate: 9 })), true, 'every validated family looked, none paid tuition');
  assert.equal(validCheckpoint(windowCheckpoint({ levels: levelsBlock({ funnel: funnel({ tuition: 1 }) }) })), true, 'the whole window stands');
  for (const [label, value] of [
    ['probe above candidate', funnel({ probe: 7 })], ['sized above probe', funnel({ sized: 4 })], ['tuition above validation', funnel({ tuition: 10 })],
    ['validation above born', funnel({ validation: 50 })], ['the incubator above practice', funnel({ incubator: 4 })], ['practice above born', funnel({ practice: 60 })],
    ['more retired than born', funnel({ retired: 50 })], ['more passes than looks', funnel({ looks_passed: 5 })],
    ['a gap skipped by a null still narrows', funnel({ candidate: null, validation: 2 })], ['tuition above validation, alone', funnel({ tuition: 10, candidate: 0, probe: 0, sized: 0 })],
    ['a fraction', funnel({ born: 49.5 })], ['a negative', funnel({ looks: -1 })], ['a string', funnel({ born: '49' })], ['since not an instant', funnel({ since: '2026-09-26' })],
    ['a key missing', (({ live_test: _l, ...rest }) => rest)(funnel())], ['a key more', funnel({ odds: 1 })],
  ]) assert.equal(validFunnel(value), false, label);
});

test('rationale: theses in safe words, and each trade’s route, tags, exit and risk fit its ledger row', () => {
  const body = windowCheckpoint();
  assert.equal(validRationale(body.rationale, body, PUBLISHED_AT), true);
  const trades = body.rationale.trades;
  const patch = (id, change) => trades.map(row => (row.id === id ? { ...row, ...change } : row));
  for (const [label, value] of [
    ['a thesis for an agent off the roster', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'stranger', thesis: 'A fine idea.' }] }) })],
    ['a thesis with a digit', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'Breaks a fresh 60-day low.' }] }) })],
    ['a thesis with a colon', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'The rule: buy the break.' }] }) })],
    ['a thesis with code', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'When PARAMS[width] is wide.' }] }) })],
    ['a thesis naming the venue', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'Alpaca fills it at the open.' }] }) })],
    ['a thesis over 280', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: `${'word '.repeat(57)}end.` }] }) })],
    ['a blank thesis', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: '  ' }] }) })],
    ['a trade off the ledger', withTrades([...trades, rationaleTrade('real:99')])],
    ['a trade twice', withTrades([...trades, trades[0]])],
    ['an agent row on the calibration route', withTrades(patch('real:7', { route: 'calibration' }))],
    ['a calibration row on an agent route', withTrades(patch('real:1', { route: 'tuition' }))],
    ['an incubator row on Probe', withTrades(patch('real:9', { route: 'probe' }))],
    ['an unknown route', withTrades(patch('real:7', { route: 'gym' }))],
    ['a House row with a reason', withTrades(patch('real:1', { open_why: 'measures fills' }))],
    ['an open row with a close reason', withTrades(patch('real:8', { close_why: 'done here' }))],
    ['an open row with an exit', withTrades(patch('real:8', { exit: 'agent' }))],
    ['an exit in words', withTrades(patch('real:5', { exit: 'the agent closed it' }))],
    ['a tag with a digit', withTrades(patch('real:8', { open_why: 'msft up 3 days' }))],
    ['a tag over 80', withTrades(patch('real:8', { open_why: 'a'.repeat(81) }))],
    ['a tag with a quote', withTrades(patch('real:8', { open_why: 'bid 1.25 ask 1.30' }))],
    ['a risk below zero', withTrades(patch('real:8', { max_loss_usd: '-1.00' }))],
    ['a risk in fractions of a cent', withTrades(patch('real:8', { max_loss_usd: '157.005' }))],
    ['a maximum gain', withTrades(patch('real:8', { max_gain_usd: '43.00' }))],
    ['a strike', withTrades(patch('real:8', { strike: '170' }))],
    ['trades with no ledger', windowCheckpoint({ positions: undefined })],
  ]) {
    const value_ = { ...value };
    if (label === 'trades with no ledger') delete value_.positions;
    assert.equal(validCheckpoint(value_), false, label);
  }
  const noLedger = { ...windowCheckpoint({ rationale: rationaleBlock({ trades: [] }) }) };
  delete noLedger.positions;
  assert.equal(validCheckpoint(noLedger), true, 'no ledger: no trades');
  assert.equal(validCheckpoint(withTrades(patch('real:5', { exit: null, close_why: null }))), true, 'an exit nobody recorded is null');
  assert.equal(thesisWords("investors reprice one on the other's capex", 80), true);
  for (const bad of ['IWM breaks to a fresh 60-day low', 'the (wide) leg', 'a = b', 'snake_case', 'a #tag', 'pipe | here', 'back\\slash', 'x < y', '{ }', '[ ]', '',
    'the gap exceeds ½ of the move', 'the Ⅻ month lookback', 'IV is ٣ points over realized', 'a ３ day hold', 'sev\u00aden days', 'one\u200bsigma']) {
    assert.equal(thesisWords(bad, 280), false, bad);
  }
});

// ---------------------------------------------------------------------------- the Worker
test('every read but the window read is byte for byte what it was, with the blocks stored or not (C7)', async () => {
  const reads = ['', '?progress=1', POSITIONS_READ, CURRENT_READ, WINDOW_READ];
  assert.equal(CHECKPOINT_READ, CURRENT_READ, 'the page reads CURRENT_READ, which the stored window never changes');
  assert.equal(WINDOW_READ, '?progress=1&positions=1&practice=1&window=1');
  const bodies = async checkpoint => {
    const { capital } = floor(at + 30000);
    assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
    return Promise.all(reads.map(async query => { const response = await get(capital, `/api/capital/checkpoint${query}`); assert.equal(response.status, 200, query); return response.text(); }));
  };
  const withBlocks = await bodies(windowCheckpoint());
  const { levels: _l, rationale: _r, ...plain } = windowCheckpoint();
  const without = await bodies(plain);
  for (let index = 0; index < 4; index++) assert.equal(withBlocks[index], without[index], `${reads[index] || 'default'}: unchanged by the stored blocks`);
  for (let index = 0; index < 4; index++) {
    const body = JSON.parse(withBlocks[index]);
    assert.equal('levels' in body || 'rationale' in body, false, reads[index] || 'default');
  }
  const window = JSON.parse(withBlocks[4]);
  assert.deepEqual(window.levels, levelsBlock());
  assert.deepEqual(window.rationale, rationaleBlock());
  assert.equal(validCheckpoint(window, { publicRead: true }), true);
  // The window read is CURRENT_READ plus the two blocks, and nothing else.
  const current = JSON.parse(withBlocks[3]);
  assert.deepEqual({ ...current, levels: window.levels, rationale: window.rationale }, window);
  assert.deepEqual(JSON.parse(without[4]), JSON.parse(without[3]), 'an old House: the window read is CURRENT_READ');
  const { capital } = floor(at + 30000);
  await post(capital, '/api/capital/checkpoint', windowCheckpoint());
  for (const query of ['?window=1', '?progress=1&positions=1&window=1', '?progress=1&positions=1&practice=1&window=0', '?window=1&progress=1&positions=1&practice=1']) {
    assert.equal((await get(capital, `/api/capital/checkpoint${query}`)).status, 404, query);
  }
});

test('a checkpoint fitted to the limit and read back with every row named still validates on the page', async () => {
  // The House fits its body under the stored limit; the public read names every roster agent, ledger row and practice row,
  // up to 508 of them. Built from the longest values the schema takes (three-byte mechanisms, two-byte theses), then trimmed
  // to just under the limit, with the longest names an ordinal can make.
  assert.equal(MAX_NAMED_ROWS, MAX_AGENTS + MAX_POSITIONS + MAX_PRACTICE_ROWS);
  const id = n => `${'a'.repeat(34)}-${String(n).padStart(5, '0')}`;
  const agents = Array.from({ length: MAX_AGENTS }, (_, n) => agent(id(n), { family: id(n), mechanism: '€'.repeat(240) }));
  const rows = Array.from({ length: MAX_POSITIONS }, (_, n) => position(`real:${n + 100}`, { agent: id(n % MAX_AGENTS), pnl_usd: '0.00', status: 'closed',
    open_quantity: 0, opened_at: '2026-09-28T13:00:00.000Z', closed_at: '2026-09-28T14:00:00.000Z' }));
  const structures = Array.from({ length: MAX_STRUCTURES }, (_, n) => structure(`st-${'x'.repeat(190)}-${n}`, { agent: id(n) }));
  const practiceRows = Array.from({ length: MAX_PRACTICE_ROWS }, (_, n) => ({ agent: id(n), family: id(n), structure: 'iron_condor', tier: 'validated',
    status: 'alive', sessions: 10, trades: 9, wins: 5, pnl_usd: '0.00', return_on_risk: '0.12' }));
  const theses = Array.from({ length: MAX_AGENTS }, () => `${'é'.repeat(278)}.`);
  const body = () => swarmCheckpoint({ agents, structures, trading: { as_of: PUBLISHED_AT, pnl_usd: '0.00' },
    positions: ledger({ rows, other: { ...ledger().other, fees_usd: '0.00', crypto_usd: '0.00' } }),
    practice: { as_of: PUBLISHED_AT, sessions: 10, capital_usd: '10000.00', totals: { families: MAX_PRACTICE_ROWS, trades: 9 * MAX_PRACTICE_ROWS, wins: 5 * MAX_PRACTICE_ROWS, pnl_usd: '0.00' }, rows: practiceRows },
    levels: { as_of: PUBLISHED_AT, agents: agents.map(row => ({ id: row.id, level: 'validation' })), funnel: funnel() },
    rationale: { as_of: PUBLISHED_AT, agents: agents.map((row, n) => ({ id: row.id, thesis: theses[n] })),
      trades: rows.map(row => ({ id: row.id, route: 'tuition', open_why: 'é'.repeat(79), close_why: 'é'.repeat(79), exit: 'agent', max_loss_usd: '157.00' })) } });
  for (let n = 0; byteLength(body()) > MAX_CHECKPOINT_BYTES - 64 && n < MAX_AGENTS; n++) theses[n] = null;
  const stored = body();
  assert.ok(byteLength(stored) <= MAX_CHECKPOINT_BYTES && byteLength(stored) > MAX_CHECKPOINT_BYTES - 1024, `stored ${byteLength(stored)}`);
  assert.equal(validCheckpoint(stored), true);
  const { capital } = floor(at + 30000);
  for (const [n, row] of agents.entries()) capital.sql.exec('INSERT INTO agent_names (id, ordinal) VALUES (?, ?)', row.id, 999999999999000 + n);
  assert.equal((await post(capital, '/api/capital/checkpoint', stored)).status, 200);
  const text = await (await get(capital, `/api/capital/checkpoint${WINDOW_READ}`)).text();
  const read = JSON.parse(text);
  assert.match(read.agents[0].display_name, /^[A-Z][a-z]+ \d{14}$/);
  const size = new TextEncoder().encode(text).length;
  assert.ok(size > MAX_CHECKPOINT_BYTES, `the named read is over the stored limit (${size})`);
  assert.ok(size <= MAX_PUBLIC_CHECKPOINT_BYTES, `and within the public one (${size})`);
  assert.equal(validCheckpoint(read, { publicRead: true }), true, 'the page takes it');
});

test('one agent’s tape: its notes and trades, and the swarm’s news about it, with kind, cursor and limit', async () => {
  const { capital } = floor();
  const events = [note('orb-4', 'One.'), news('is born, a new family: Breaks of the opening range.', PUBLISHED_AT, 'orb-4'), note('condor-vrp-3', 'Other.'),
    trade('orb-4'), news('retired: never beat the fill cost.', PUBLISHED_AT, 'condor-vrp-3'), news('New code on main.', PUBLISHED_AT, null)];
  assert.equal((await post(capital, '/api/capital/events', batch(...events))).status, 200);
  const read = async query => (await (await get(capital, `/api/capital/events${query}`)).json()).events.map(event => event.id);
  assert.deepEqual(await read('?agent=orb-4'), [events[3].id, events[1].id, events[0].id]);
  assert.deepEqual(await read('?agent=orb-4&kind=swarm.news'), [events[1].id]);
  assert.deepEqual(await read('?agent=orb-4&kind=agent.note&limit=5'), [events[0].id]);
  assert.deepEqual(await read('?agent=orb-4&after=1'), [events[1].id, events[3].id], 'a cursor reads forward');
  assert.deepEqual(await read('?agent=orb-4&limit=1'), [events[3].id]);
  assert.deepEqual(await read('?agent=nobody'), []);
  for (const query of ['?agent=orb-4&stream=agent%3Aorb-4', '?agent=Orb', '?agent=', '?agent=orb-4&agent=condor-vrp-3']) {
    assert.equal((await get(capital, `/api/capital/events${query}`)).status, 400, query);
  }
  const index = capital.sql.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'events_news_agent'").toArray();
  assert.equal(index.length, 1, 'the news-by-agent index exists');
});

test('the score archive: one point per five minutes, the latest wins, nulls kept, key-range retention, keyed sampling, one basis, and the reset', async () => {
  assert.equal(SCORE_BUCKET_MS, 300000);
  assert.equal(MAX_SCORE_POINTS, 30000);
  let now = at + 30000;
  const { capital } = floor();
  capital.now = () => now;
  const itemized = (minute, pnl, basis = swarmCheckpoint().performance) => {
    const stamp = `2026-09-28T14:${String(minute).padStart(2, '0')}:00.000Z`;
    return ledgerCheckpoint({ published_at: stamp, trading: { as_of: stamp, pnl_usd: pnl }, compute: { ...BILL, as_of: stamp },
      positions: pnl === null ? ledger({ as_of: stamp, rows: POSITIONS.map(row => ({ ...row, pnl_usd: null })), other: null, unreconciled_usd: null })
        : ledger({ as_of: stamp, other: { ...ledger().other, as_of: stamp } }),
      account: { ...swarmCheckpoint().account, as_of: stamp }, gym: { ...swarmCheckpoint().gym, as_of: stamp }, performance: { ...basis, verified_at: stamp } });
  };
  const read = async () => (await get(capital, '/api/capital/score')).json();
  assert.deepEqual(await read(), { schema_version: 2, sampled: false, step_ms: 300000, points: [], last_profit: null, last_net: null });
  for (const [minute, pnl] of [[50, '220.40'], [51, '220.40'], [56, null]]) {
    assert.equal((await post(capital, '/api/capital/checkpoint', itemized(minute, pnl))).status, 200);
  }
  const score = await read();
  assert.deepEqual(score.points, [
    { at: '2026-09-28T14:51:00.000Z', profit_usd: '220.40', costs_usd: '328.79', net_usd: '-120.89' },
    { at: '2026-09-28T14:56:00.000Z', profit_usd: null, costs_usd: '328.79', net_usd: null },
  ], '14:50 and 14:51 share a bucket');
  assert.deepEqual(score.last_profit, { at: '2026-09-28T14:51:00.000Z', profit_usd: '220.40' }, 'the newest known Profit, past the unknown one');
  assert.deepEqual(score.last_net, { at: '2026-09-28T14:51:00.000Z', net_usd: '-120.89' });
  assert.ok(score.points.every(validScorePoint));
  assert.equal((await get(capital, '/api/capital/score?limit=5')).status, 400, 'no query string');
  assert.equal((await post(capital, '/api/capital/score', {})).status, 405);
  assert.match((await get(capital, '/api/capital/score')).headers.get('Cache-Control'), /max-age=300\b/, 'a point changes once per bucket at most');
  assert.equal((await post(capital, '/api/capital/checkpoint', itemized(56, null))).status, 200, 'an identical replay changes nothing');
  assert.equal((await read()).points.length, 2);
  // Spanning more than 2,048 buckets, a read samples by key: the first bucket at or after each step, and the newest.
  for (let bucket = 1; bucket <= 2100; bucket++) {
    capital.sql.exec('INSERT INTO score_history (bucket, at, profit_usd, costs_usd, net_usd, basis) VALUES (?, ?, NULL, ?, NULL, ?)', bucket, new Date(bucket * 300000).toISOString(), '1.00', RESET_AT);
  }
  const newest = Math.floor(Date.parse('2026-09-28T14:56:00.000Z') / SCORE_BUCKET_MS);
  const sampled = await read();
  assert.equal(sampled.sampled, true);
  assert.equal(sampled.step_ms, Math.ceil((newest - 1) / 2047) * SCORE_BUCKET_MS);
  assert.ok(sampled.points.length <= 2048);
  assert.deepEqual(sampled.points.map(point => point.at), [new Date(300000).toISOString(), '2026-09-28T14:51:00.000Z', '2026-09-28T14:56:00.000Z']);
  // Retention deletes by key range: every bucket MAX_SCORE_POINTS or more older than the newest.
  const next = Math.floor(Date.parse('2026-09-28T14:58:00.000Z') / SCORE_BUCKET_MS);
  for (let bucket = next - MAX_SCORE_POINTS - 5; bucket <= next - MAX_SCORE_POINTS + 10; bucket++) {
    capital.sql.exec('INSERT INTO score_history (bucket, at, costs_usd, basis) VALUES (?, ?, ?, ?)', bucket, new Date(bucket * 300000).toISOString(), '1.00', RESET_AT);
  }
  now += 600000;
  assert.equal((await post(capital, '/api/capital/checkpoint', itemized(58, '220.40'))).status, 200);
  const oldest = Number(capital.sql.exec('SELECT MIN(bucket) AS b FROM score_history').toArray()[0].b);
  assert.equal(oldest, next - MAX_SCORE_POINTS + 1, 'the oldest went, the rest stay');
  assert.equal(Number(capital.sql.exec('SELECT COUNT(*) AS n FROM score_history').toArray()[0].n), 10 + 2, 'ten kept, then 14:51 and 14:58 (in 14:56’s bucket)');
  // A new Profit basis starts the archive over: no line mixes two bases.
  now += 120000;
  const rebased = { ...swarmCheckpoint().performance, start_at: '2026-09-28T14:00:00.000Z' };
  assert.equal((await post(capital, '/api/capital/checkpoint', itemized(59, '220.40', rebased))).status, 200);
  assert.deepEqual((await read()).points.map(point => point.at), ['2026-09-28T14:59:00.000Z']);
  const reset = await (await post(capital, '/api/capital/reset?confirm=erase-everything', {})).json();
  assert.equal(reset.cleared.score_history, 1);
  assert.deepEqual((await read()).points, []);
});

test('a score point is Profit, the bill and Net by the page’s own rule, measured against its checkpoint only', () => {
  const body = ledgerCheckpoint({ compute: BILL });
  assert.deepEqual(scorePoint(body), { at: PUBLISHED_AT, profit_usd: '220.40', costs_usd: '328.79', net_usd: '-120.89' });
  assert.equal(scorePoint(body).net_usd, netNumber(body, at), 'parity with the headline’s Net');
  for (const [label, value] of [
    ['an unreconciled gain', ledgerCheckpoint({ compute: BILL, trading: { as_of: PUBLISHED_AT, pnl_usd: '221.40' }, positions: ledger({ unreconciled_usd: '1.00' }) })],
    ['an unreconciled loss', ledgerCheckpoint({ compute: BILL, trading: { as_of: PUBLISHED_AT, pnl_usd: '219.40' }, positions: ledger({ unreconciled_usd: '-1.00' }) })],
    ['a bill in fractions of a cent', ledgerCheckpoint({ compute: { ...BILL, sail_usd: '212.405', claude_usd: '41.2049' } })],
  ]) assert.equal(scorePoint(value).net_usd, netNumber(value, at), label);
  assert.equal(scorePoint(ledgerCheckpoint()).costs_usd, null, 'an older bill is not itemized');
  assert.equal(scorePoint(ledgerCheckpoint()).net_usd, null);
  assert.equal(scorePoint(ledgerCheckpoint({ compute: { ...BILL, openai_usd: null } })).costs_usd, null);
  assert.equal(scorePoint(ledgerCheckpoint({ compute: { ...BILL, as_of: '2026-09-28T14:40:00.000Z' } })).costs_usd, null, 'a stale bill');
  assert.equal(scorePoint(ledgerCheckpoint({ compute: BILL, trading: { as_of: '2026-09-28T14:40:00.000Z', pnl_usd: '220.40' }, positions: ledger({ as_of: '2026-09-28T14:40:00.000Z' }) })).profit_usd, null, 'a stale Profit');
  assert.equal(scorePoint(swarmCheckpoint({ compute: BILL })).net_usd, null, 'no ledger: no Net');
  assert.equal(scorePoint(windowCheckpoint({ compute: BILL })).net_usd, netNumber(windowCheckpoint({ compute: BILL }), at), 'an open loss counts');
});

// ---------------------------------------------------------------------------- the number-word rule
test('every number hidden in words or other scripts is refused by the contract; only the pronoun "one" passes', () => {
  // A fixed adversarial list (the safety review of Oct 1, 2026): the Worker refuses each as a thesis and as a tag.
  const leaks = [
    'Buy the call when GOOGL lags MSFT by more than one stdev.', 'Enter when the gap exceeds one ATR over the prior close.', 'Enter at one sd.',
    'Use a lookback of one hr.', 'Exit after one trading session closes.', 'Hold through one full standard deviation.', 'Hold for one more week.',
    'Exit at the eleventh session.', 'Sell a twelfth of the range.', 'Close by the ninetieth minute.', 'The move runs threefold.',
    'Sell the twentyfive delta wing.', 'Size it at tenpercent.', 'Wait a single sigma.', 'Collect a nickel.', 'Collect a dime of premium.',
    'Hold for a fortnight.', 'When one name leads, follow it.', 'Enter when the gap exceeds ½ of the prior move.', 'Use the Ⅻ month lookback.',
    'Wait ｏｎｅ sigma.', 'Wait οne sigma.', 'Wait sev\u00aden days.', 'Wait fo\u200bur days.', 'Enter when IV is ٣ points over realized.',
  ];
  for (const text of leaks) {
    assert.equal(thesisWords(text, 280), false, text);
    assert.equal(thesisWords(text.replace(/\.$/, ''), 80), false, `tag: ${text}`);
  }
  for (const text of ["MSFT and GOOGL sell competing products, and investors reprice one on the other's capex with a delay.", 'Investors move one another.',
    'No one prices it in.', 'One of the legs decays faster.', 'The two names reprice one against the other.', 'Within seconds the spread widens.',
    'Once MSFT moves, GOOGL follows.']) {
    assert.equal(thesisWords(text, 280), !/two/.test(text), text);
  }
  assert.equal(numbered('the one day a week'), true, 'a pronoun before a unit is a number');
  assert.equal(numbered("reprice one on the other's"), false);
  assert.equal(numbered('one day'), true);
});

test('every sentence the safety reviews named is refused by the Worker’s contract; plain words and the pronoun pass', () => {
  for (const text of LEAKS) {
    assert.equal(thesisWords(text, 280), false, `contract: ${text}`);
    assert.equal(thesisWords(text.replace(/\.$/, ''), 80), false, `contract, as a tag: ${text}`);
  }
  for (const text of PLAIN) {
    assert.equal(thesisWords(text, 280), true, `contract: ${text}`);
  }
  // The words as the rules read them: accents folded off, split at apostrophes but "one's".
  assert.deepEqual(numberTokens("Wait \u2018Tw\u00e9nty\u2019 days; one\u2019s fifty's o'clock"), ['wait', 'twenty', 'days', "one's", 'fifty', 's', 'o', 'clock']);
  // A whole window: a thesis or a tag with a number in words is refused by the Worker, as the House's own check refuses it
  // (its publisher then sends the checkpoint without the window).
  assert.equal(validCheckpoint(windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'Hold for a fortnight.' }] }) })), false);
  const trades = rationaleBlock().trades.map(row => (row.id === 'real:8' ? { ...row, open_why: 'hold a couple of sessions' } : row));
  assert.equal(validCheckpoint(windowCheckpoint({ rationale: rationaleBlock({ trades }) })), false);
  assert.equal(validCheckpoint(windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'Funds dress their books at quarter-end.' }] }) })), true);
});
