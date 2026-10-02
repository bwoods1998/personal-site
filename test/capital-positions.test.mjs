// The positions ledger under the balance chart (the owner, Sept 28, 2026): every real position on the Brokerage
// Account since the reset, open and closed, whose it was and its dollar P&L, adding up with the account's other
// activity to the Profit headline exactly, to the cent. Never a price, a strike or anything else a quote said.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_POSITIONS, POSITION_FIELDS, POSITIONS_FIELDS, OTHER_PARTS, STRUCTURE_TYPES, STRUCTURE_RIGHTS, CHECKPOINT_FIELDS,
  validCheckpoint, validPosition, validPositions,
} from '../capital/schema.js';
import { PROFIT_TITLE, CALIBRATION_TITLE, headline, positionsLedger, positionWhat, startCapital } from '../capital/capital.js';
import { floor, post, get, words, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';
import { swarmCheckpoint, ledgerCheckpoint, ledger, position, POSITIONS, agent, PUBLISHED_AT } from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const READ = '/api/capital/checkpoint?progress=1&positions=1';
// The page's own read since Oct 1, 2026: the ledger and the practice league, Claude's cost, the incubator route, and the
// House's `levels` and `rationale`.
const PAGE_READ = '/api/capital/checkpoint?progress=1&positions=1&practice=1&window=1';
const withRows = (rows, extra = {}) => ledgerCheckpoint({ positions: ledger({ rows, ...extra }) });
const patchRow = (index, patch) => withRows(POSITIONS.map((row, n) => (n === index ? { ...row, ...patch } : row)));
const cents = value => { const [whole, fraction = ''] = value.replace('-', '').split('.'); const size = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2)); return value.startsWith('-') ? -size : size; };
// Every name a quote, a greek, a fill or a fitted parameter goes by (test/league-contract.test.mjs FORBIDDEN_KEYS, and more).
const FORBIDDEN = ['bid', 'ask', 'mid', 'mark', 'last', 'spread', 'iv', 'implied_vol', 'delta', 'gamma', 'theta', 'vega', 'greeks', 'surface',
  'strike', 'strikes', 'price', 'entry_price', 'exit_price', 'fill_price', 'mark_price', 'underlying_price', 'cash', 'fees', 'params', 'quote',
  'nbbo', 'program', 'legs_detail', 'symbol', 'symbols', 'market_id', 'order_id', 'family', 'instance', 'max_loss_usd', 'why', 'text'];

// ---------------------------------------------------------------------------- the schema
test('the ledger is an exact allowlist: whose, what, how many, when and the dollar result, nothing more', () => {
  assert.deepEqual(POSITIONS_FIELDS, ['as_of', 'rows', 'earlier', 'other', 'unreconciled_usd']);
  assert.deepEqual(POSITION_FIELDS, ['id', 'source', 'agent', 'underlying', 'structure', 'right', 'legs', 'quantity', 'open_quantity', 'status',
    'expiry', 'opened_at', 'closed_at', 'pnl_usd']);
  assert.deepEqual(OTHER_PARTS, ['fees_usd', 'crypto_usd', 'interest_usd', 'misc_usd']);
  assert.equal(validCheckpoint(ledgerCheckpoint()), true);
  assert.equal(validCheckpoint(swarmCheckpoint()), true, 'a House that predates the ledger sends none');
  assert.equal(validCheckpoint(swarmCheckpoint({ positions: null })), true, 'or null while it cannot build one');
  assert.deepEqual(Object.keys(STRUCTURE_RIGHTS).sort(), [...STRUCTURE_TYPES].sort(), 'every structure says which side it can be on');
  const smuggled = [];
  for (const field of FORBIDDEN) {
    smuggled.push([`row ${field}`, patchRow(0, { [field]: '571.25' })]);
    smuggled.push([`ledger ${field}`, ledgerCheckpoint({ positions: { ...ledger(), [field]: '571.25' } })]);
    smuggled.push([`other ${field}`, ledgerCheckpoint({ positions: ledger({ other: { ...ledger().other, [field]: '571.25' } }) })]);
    smuggled.push([`earlier ${field}`, ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.slice(0, 2), earlier: { positions: 4, pnl_usd: '215.90', [field]: '1' } }) })]);
  }
  for (const [label, body] of smuggled) assert.equal(validCheckpoint(body), false, label);
  for (const [label, body] of [
    ['a publisher-supplied name', patchRow(0, { display_name: 'Meriwether' })],
    ['an agent row without its agent', patchRow(0, { agent: null })],
    ['a calibration row with an agent', patchRow(5, { agent: 'condor-vrp-3' })],
    ['an unknown source', patchRow(0, { source: 'desk' })],
    ['a condor on one side', patchRow(0, { right: 'call' })],
    ['a vertical on both sides', patchRow(1, { right: 'both' })],
    ['a long call that is a put', patchRow(0, { structure: 'long_call', legs: 1, right: 'put' })],
    ['a naked short', patchRow(0, { structure: 'short_put', right: 'put' })],
    ['a position awaiting expiry', patchRow(0, { status: 'awaiting_expiry' })],
    ['an open position with a close', patchRow(0, { closed_at: PUBLISHED_AT })],
    ['an open position holding nothing', patchRow(0, { open_quantity: 0 })],
    ['more open than it opened', patchRow(1, { open_quantity: 3 })],
    ['a closed position still holding', patchRow(2, { open_quantity: 1 })],
    ['a closed position without its close', patchRow(2, { closed_at: null })],
    ['closed before it opened', patchRow(2, { closed_at: '2026-09-28T13:00:00.000Z' })],
    ['opened after the checkpoint', patchRow(0, { opened_at: '2026-09-28T16:00:00.000Z' })],
    ['a close without milliseconds', patchRow(2, { closed_at: '2026-09-28T14:30:00Z' })],
    // The review of #408 (N2): to the minute, never a broker's fill time to the second or the millisecond.
    ['an open to the second', patchRow(0, { opened_at: '2026-09-28T14:02:40.000Z' })],
    ['a close to the millisecond', patchRow(2, { closed_at: '2026-09-28T14:30:00.312Z' })],
    ['a fraction of a cent', patchRow(0, { pnl_usd: '12.505' })],
    ['a P&L as a number', patchRow(0, { pnl_usd: 12.5 })],
    ['a shadow id', patchRow(0, { id: 'shadow:condor-vrp-3@4:c:7' })],
    ['a structure code for an id', patchRow(0, { id: 'real:SPY261002C00571000' })],
    ['an impossible expiry', patchRow(0, { expiry: '2026-02-30' })],
    ['five legs', patchRow(0, { legs: 5 })],
    ['duplicate ids', withRows([...POSITIONS, POSITIONS[0]])],
    ['a ledger of another moment', ledgerCheckpoint({ positions: ledger({ as_of: '2026-09-28T14:57:00.000Z' }) })],
    ['a ledger without Profit', (() => { const body = ledgerCheckpoint(); delete body.trading; return body; })()],
    ['a ledger with a null Profit block', ledgerCheckpoint({ trading: null })],
    ['nothing folded into earlier', ledgerCheckpoint({ positions: ledger({ rows: [], earlier: { positions: 0, pnl_usd: '220.40' } }) })],
    ['an unknown not-listed line beside a known Profit', ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.slice(0, 4), earlier: { positions: 2, pnl_usd: null } }) })],
    ['an other block missing a part', ledgerCheckpoint({ positions: ledger({ other: { as_of: PUBLISHED_AT, fees_usd: '0', crypto_usd: '0', interest_usd: '0' } }) })],
    ['other activity read after the checkpoint', ledgerCheckpoint({ positions: ledger({ other: { ...ledger().other, as_of: '2026-09-28T16:00:00.000Z' } }) })],
    ['rows not a list', ledgerCheckpoint({ positions: ledger({ rows: {} }) })],
  ]) assert.equal(validCheckpoint(body), false, label);
  const many = Array.from({ length: MAX_POSITIONS + 1 }, (_, n) => position(`real:${n + 100}`, { pnl_usd: '0.00' }));
  const zero = { trading: { as_of: PUBLISHED_AT, pnl_usd: '0.00' } };
  const zeroOther = { ...ledger().other, fees_usd: '0.00', crypto_usd: '0.00' };
  assert.equal(validCheckpoint(swarmCheckpoint({ ...zero, positions: ledger({ rows: many.slice(0, MAX_POSITIONS), other: zeroOther }) })), true, `${MAX_POSITIONS} rows`);
  assert.equal(validCheckpoint(swarmCheckpoint({ ...zero, positions: ledger({ rows: many, other: zeroOther }) })), false, 'one more is folded into earlier');
});

test('a known Profit is the exact sum of the ledger, to the cent, or the checkpoint is refused', () => {
  assert.equal(validCheckpoint(patchRow(0, { pnl_usd: '12.51' })), false, 'a cent too many');
  assert.equal(validCheckpoint(ledgerCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: '220.41' } })), false, 'a headline a cent off');
  assert.equal(validCheckpoint(ledgerCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: '220.400' } })), true, 'the same amount, written longer');
  assert.equal(validCheckpoint(ledgerCheckpoint({ positions: ledger({ other: null }) })), false, 'other activity unknown, Profit known');
  assert.equal(validCheckpoint(ledgerCheckpoint({ positions: ledger({ unreconciled_usd: null }) })), false, 'the difference unknown, Profit known');
  assert.equal(validCheckpoint(patchRow(0, { pnl_usd: null })), false, 'a position unknown, Profit known');
  // A difference the House cannot explain is its own line: shown, never hidden, and still adding up.
  assert.equal(validCheckpoint(ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.map((row, n) => (n ? row : { ...row, pnl_usd: '13.50' })), unreconciled_usd: '-1.00' }) })), true);
  // The oldest closed positions fold into one line and the sum still holds.
  const [open1, open2, ...closed] = POSITIONS;
  const folded = closed.slice(2);
  const foldedUsd = folded.reduce((sum, row) => sum + cents(row.pnl_usd), 0n);
  const earlier = { positions: folded.length, pnl_usd: `${foldedUsd / 100n}.${String(foldedUsd % 100n).padStart(2, '0')}` };
  assert.equal(validCheckpoint(ledgerCheckpoint({ positions: ledger({ rows: [open1, open2, ...closed.slice(0, 2)], earlier }) })), true);
  assert.equal(validCheckpoint(ledgerCheckpoint({ positions: ledger({ rows: [open1, open2, ...closed.slice(0, 2)], earlier: { ...earlier, pnl_usd: '0.00' } }) })), false);
  // An unknown Profit leaves the lines it could not know unknown.
  const unknown = { trading: { as_of: PUBLISHED_AT, pnl_usd: null } };
  assert.equal(validCheckpoint(swarmCheckpoint({ ...unknown, positions: ledger({ rows: POSITIONS.map(row => ({ ...row, pnl_usd: null })), other: null, unreconciled_usd: null }) })), true);
  assert.equal(validPositions(ledger(), { as_of: PUBLISHED_AT, pnl_usd: '220.40' }, PUBLISHED_AT), true);
  assert.equal(validPosition(POSITIONS[5], PUBLISHED_AT), true, 'the House calibration round trip');
});

// ---------------------------------------------------------------------------- the record
test('the record keeps the ledger for pages that ask for it, names each agent’s row, and old pages never see it', async () => {
  const { capital } = floor(at + 30000);
  const roster = [agent('condor-vrp-3', { band: 'sized' }), agent('putspread-dip-2', { band: 'probe' }), agent('orb-4', { band: 'probe' })];
  // An agent retired off the roster still owns its closed position, and keeps a name for it.
  const gone = position('real:2', { agent: 'gap-drift-1', underlying: 'IWM', structure: 'long_call', right: 'call', legs: 1,
    status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:31:00.000Z', closed_at: '2026-09-28T13:33:00.000Z', pnl_usd: '0.00' });
  const body = swarmCheckpoint({ agents: roster, positions: ledger({ rows: [...POSITIONS, gone] }) });
  assert.equal(validCheckpoint(body), true);
  assert.deepEqual(await (await post(capital, '/api/capital/checkpoint', body)).json(), { published_at: PUBLISHED_AT, agents: 3 });
  const legacy = await get(capital, '/api/capital/checkpoint');
  const progress = await get(capital, '/api/capital/checkpoint?progress=1');
  const current = await get(capital, READ);
  for (const response of [legacy, progress, current]) assert.equal(response.status, 200);
  for (const old of [await legacy.json(), await progress.json()]) {
    assert.deepEqual(Object.keys(old).sort(), [...CHECKPOINT_FIELDS, 'trading'].sort(), 'the keys an already open page validates');
  }
  const read = await current.json();
  assert.equal(validCheckpoint(read, { publicRead: true }), true);
  assert.equal(validCheckpoint(read), false, 'a publisher cannot send the names back');
  assert.equal((await post(capital, '/api/capital/checkpoint', { ...read, published_at: '2026-09-28T14:59:00.000Z' })).status, 400);
  const names = Object.fromEntries(read.positions.rows.map(row => [row.id, row.display_name ?? null]));
  assert.deepEqual(names, { 'real:7': 'Meriwether', 'real:6': 'Scholes', 'real:5': 'Scholes', 'real:4': 'Hilibrand', 'real:3': 'Meriwether',
    'real:1': null, 'real:2': 'Rosenfeld' }, 'the roster is named first, in its own order; the calibration row has no alias');
  const unnamed = ({ display_name: _name, ...row }) => row;
  assert.deepEqual({ ...read.positions, rows: read.positions.rows.map(unnamed) }, body.positions, 'the stored ledger is untouched');
  assert.notEqual(progress.headers.get('ETag'), current.headers.get('ETag'));
  assert.equal((await get(capital, READ, { 'If-None-Match': current.headers.get('ETag') })).status, 304);
  for (const query of ['?positions=1', '?positions=1&progress=1', '?progress=1&positions=0', '?progress=1&positions=1&positions=1', '?progress=1&positions=1&extra=1']) {
    assert.equal((await get(capital, `/api/capital/checkpoint${query}`)).status, 404, query);
  }
  assert.equal((await get(capital, '/api/capital/agents?progress=1&positions=1')).status, 404, 'the roster has no ledger');
  assert.equal((await post(capital, '/api/capital/checkpoint?progress=1&positions=1', body)).status, 400, 'only reads take the opt-in');
  // Smuggled into the ledger, a quote is refused whole by the record as well.
  for (const field of ['strike', 'fill_price', 'mark', 'bid']) {
    assert.equal((await post(capital, '/api/capital/checkpoint', { ...patchRow(0, { [field]: '571.25' }), published_at: '2026-09-28T14:59:00.000Z' })).status, 400, field);
  }
  // A ledger that does not add up is refused as well.
  assert.equal((await post(capital, '/api/capital/checkpoint', { ...patchRow(0, { pnl_usd: '12.51' }), published_at: '2026-09-28T14:59:00.000Z' })).status, 400);
});

// ---------------------------------------------------------------------------- the words
const sum = lines => lines.reduce((total, line) => total + cents(line.usd), 0n);
test('open, closed and the account\'s other activity add up to the Profit headline, to the cent, at any hour', () => {
  // The headline is the account: 5,694.37 − 481.65 − 5,000 = 212.72. Closed rows are realized (215.90 with the House's
  // calibration); the two open rows are worth the rest together (−3.18), each row its House value and the difference a line.
  const book = positionsLedger(ledgerCheckpoint(), at);
  assert.equal(book.total.pnl, headline(ledgerCheckpoint(), at).profit.value, 'the total is the headline');
  assert.deepEqual([book.total.pnl, book.openTotal.pnl, book.closedTotal.pnl, book.other.pnl], ['+$212.72', '−$3.18', '+$215.90', '$0.00']);
  assert.deepEqual(book.open.map(line => [line.id, line.who, line.what, line.quantity, line.expiry, line.closedAt, line.pnl]), [
    ['real:6', 'Orb 4', 'SPY call debit vertical', 2, 'Sep 28', null, '−$8.00'],
    ['real:7', 'Condor Vrp 3', 'XSP iron condor', 1, 'Sep 28', null, '+$12.50'],
  ]);
  assert.equal(book.marks.pnl, '−$7.68', 'the House values the two at +4.50; the account at −3.18');
  assert.equal(sum([...book.open, book.marks]), cents(book.openTotal.usd));
  // The calibration folds into one line; every agent's closed position is its own row, newest close first.
  assert.deepEqual(book.closed.map(line => [line.id, line.who, line.pnl]), [['real:5', 'Orb 4', '+$31.00'], ['real:4', 'Putspread Dip 2', '−$18.30'],
    ['real:3', 'Condor Vrp 3', '+$205.40']]);
  assert.deepEqual([book.calibration.count, book.calibration.pnl, book.calibration.rows.map(line => line.id)], [1, '−$2.20', ['real:1']]);
  assert.equal(sum([...book.closed, book.calibration]), cents(book.closedTotal.usd));
  assert.equal(sum([book.openTotal, book.closedTotal, book.other]), cents(book.total.usd), 'to the cent');
  // One open position is exactly what the account says it is worth.
  const one = positionsLedger(withRows(POSITIONS.filter(row => row.id !== 'real:6')), at);
  assert.deepEqual([one.open[0].pnl, one.openTotal.pnl, one.marks], ['−$3.18', '−$3.18', null]);
  // While the account is unknown, the House's ledger is the headline, and its own values add up with no difference.
  const house = positionsLedger(ledgerCheckpoint({ account: { ...ledgerCheckpoint().account, stale: true } }), at);
  assert.deepEqual([house.total.pnl, house.openTotal.pnl, house.marks], ['+$220.40', '+$4.50', null]);
  // With nothing open, what the ledger cannot place is the account's other activity.
  const flat = positionsLedger(withRows(POSITIONS.slice(2)), at);
  assert.deepEqual([flat.open.length, flat.other.pnl, flat.total.pnl], [0, '−$3.18', '+$212.72']);
  // A partial close, and the oldest positions folded.
  const partialCheckpoint = ledgerCheckpoint({ positions: ledger({
    rows: [POSITIONS[0], { ...POSITIONS[1], open_quantity: 1 }, ...POSITIONS.slice(2, 4)],
    earlier: { positions: 2, pnl_usd: '203.20' }, other: { ...ledger().other, fees_usd: '-0.92' }, unreconciled_usd: '1.00' }) });
  assert.equal(validCheckpoint(partialCheckpoint), true);
  const partial = positionsLedger(partialCheckpoint, at);
  assert.equal(partial.open[0].quantity, 1);
  assert.deepEqual([partial.earlier.count, partial.earlier.pnl], [2, '+$203.20']);
  assert.equal(partial.other.pnl, '−$1.00');
  assert.equal(sum([...partial.closed, partial.earlier]), cents(partial.closedTotal.usd), 'the older positions are in the Closed subtotal');
  assert.equal(sum([partial.openTotal, partial.closedTotal, partial.other]), cents(partial.total.usd));
  // Several open, one not valued yet (a night): the difference line carries the rest, so the rows still add up.
  const night = positionsLedger(withRows(POSITIONS.map(row => (row.id === 'real:6' ? { ...row, pnl_usd: null } : row))), at);
  assert.deepEqual(night.open.map(line => line.pnl), ['—', '+$12.50']);
  assert.equal(night.marks.pnl, '−$15.68');
  assert.equal(sum([night.open[1], night.marks]), cents(night.openTotal.usd));
  // An unknown Profit leaves the totals a dash; each row keeps its last published result.
  const unknown = positionsLedger(swarmCheckpoint({ account: null, trading: { as_of: PUBLISHED_AT, pnl_usd: null },
    positions: ledger({ rows: POSITIONS.map((row, n) => ({ ...row, pnl_usd: n ? null : row.pnl_usd })), other: null, unreconciled_usd: null }) }), at);
  assert.deepEqual([unknown.open[1].pnl, unknown.open[0].pnl, unknown.other.pnl, unknown.total.pnl, unknown.openTotal.pnl], ['+$12.50', '—', '—', '—', '—']);
  assert.equal(positionsLedger(swarmCheckpoint(), at), null, 'no ledger published');
  assert.equal(positionsLedger(null), null);
});

test('the House’s first real day: one calibration round trip with the broker’s own fees, and a crypto fee, adding up to Profit', () => {
  const calibration = position('real:1', { source: 'calibration', agent: null, underlying: 'SPY', structure: 'debit_vertical', right: 'call', legs: 2,
    expiry: '2026-09-29', status: 'closed', open_quantity: 0, opened_at: '2026-09-28T14:10:00.000Z', closed_at: '2026-09-28T14:10:00.000Z', pnl_usd: '-2.12' });
  const day = swarmCheckpoint({ account: null, trading: { as_of: PUBLISHED_AT, pnl_usd: '-2.20' },
    positions: ledger({ rows: [calibration], other: { ...ledger().other, fees_usd: '0.00' } }) });
  assert.equal(validCheckpoint(day), true);
  const book = positionsLedger(day, at);
  assert.deepEqual([book.closed.length, book.calibration.count, book.calibration.pnl], [0, 1, '−$2.12']);
  assert.deepEqual([book.other.pnl, book.total.pnl], ['−$0.08', '−$2.20']);
});

test('the House live test’s positions read as its own, beside the calibration’s, and add up to Profit', () => {
  const test_ = position('real:2', { source: 'house', agent: null, underlying: 'QQQ', structure: 'debit_vertical', right: 'put', legs: 2,
    expiry: '2026-10-02', status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:40:00.000Z', closed_at: '2026-09-28T14:30:00.000Z', pnl_usd: '7.40' });
  const calibration = position('real:1', { source: 'calibration', agent: null, underlying: 'SPY', structure: 'debit_vertical', right: 'call', legs: 2,
    expiry: '2026-09-29', status: 'closed', open_quantity: 0, opened_at: '2026-09-28T14:10:00.000Z', closed_at: '2026-09-28T14:10:00.000Z', pnl_usd: '-2.12' });
  const day = swarmCheckpoint({ account: null, trading: { as_of: PUBLISHED_AT, pnl_usd: '5.20' },
    positions: ledger({ rows: [test_, calibration], other: { ...ledger().other, fees_usd: '0.00' } }) });
  assert.equal(validCheckpoint(day), true);
  const book = positionsLedger(day, at);
  assert.deepEqual(book.closed.map(line => [line.who, line.what, line.pnl]), [['House live test', 'QQQ put debit vertical', '+$7.40']]);
  assert.equal(book.calibration.pnl, '−$2.12');
  assert.equal(sum([book.closedTotal, book.other]), cents(book.total.usd));
});

test('structures read in words', () => {
  const what = (structure, right) => positionWhat({ underlying: 'SPY', structure, right });
  assert.deepEqual([what('long_call', 'call'), what('long_put', 'put'), what('debit_vertical', 'put'), what('credit_vertical', 'call'),
    what('iron_condor', 'both'), what('iron_butterfly', 'both'), what('long_butterfly', 'put'), what('long_straddle', 'both'),
    what('long_strangle', 'both'), what('calendar', 'call'), what('diagonal', 'put')], ['SPY long call', 'SPY long put', 'SPY put debit vertical',
    'SPY call credit vertical', 'SPY iron condor', 'SPY iron butterfly', 'SPY long put butterfly', 'SPY long straddle', 'SPY long strangle',
    'SPY call calendar', 'SPY put diagonal']);
  assert.match(PROFIT_TITLE, /deposit/);
});

// ---------------------------------------------------------------------------- the page
async function mounted(checkpoint, work, routes) {
  const { capital } = floor(at + 30000);
  if (checkpoint) assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
  const root = stubPage('floor', FLOOR_IDS);
  const asked = [];
  await withBrowser('', path => { asked.push(path); return routes ? routes(path, capital) : capital.fetch(new Request('https://blakewoods.us' + path)); }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    await work(root.querySelector('#floor-positions'), root, asked);
  });
}

test('mounted, the positions read open then closed, the House\'s fill tests folded, and a total that is the headline', async () => {
  await mounted(ledgerCheckpoint(), async (box, root, asked) => {
    assert.ok(asked.includes(PAGE_READ), 'the page asks for the ledger');
    assert.equal(box.getAttribute('aria-busy'), 'false');
    assert.deepEqual(box.withClass('ledger-group').map(words), ['Open −$3.18', 'Closed +$215.90']);
    const rows = box.withClass('pos');
    assert.deepEqual(rows.map(row => row.dataset.position ?? row.className), ['real:6', 'real:7', 'pos pos-marks', 'real:5', 'real:4', 'real:3', 'pos pos-house']);
    const ORB = 'Trades the break of the opening range in the direction of the break, with a vertical sized by its maximum loss.';
    assert.equal(words(rows[0]), `SPY call debit vertical ${ORB} Scholes 2 contracts · opened Sep 28 · expires Sep 28 −$8.00 open`);
    assert.equal(words(rows[3]), `SPY call debit vertical ${ORB} Scholes 2 contracts · opened Sep 28 · closed Sep 28 +$31.00 closed`);
    assert.equal(words(rows[2]), 'Valuation difference −$7.68');
    assert.equal(rows[0].withClass('pos-pnl')[0].className, 'pos-pnl negative');
    const fold = rows[6];
    assert.match(words(fold), /^House fill tests 1 round trip · Sep 28 – Sep 28 −\$2\.20 /);
    assert.equal(fold.find('summary')[0].getAttribute('title'), CALIBRATION_TITLE);
    assert.equal(fold.withClass('fold-row').length, 1);
    assert.equal(words(box.withClass('ledger-line')[0]), 'Fees & other $0.00');
    const total = box.withClass('ledger-total')[0];
    const top = root.querySelector('#floor-numbers').withClass('number-value')[0].textContent;
    assert.equal(top, '+$212.72');
    assert.equal(total.withClass('ledger-sum')[0].textContent, top, 'the total is the headline, to the cent');
    assert.equal(root.querySelector('#floor-numbers').withClass('number-profit')[0].getAttribute('title'), PROFIT_TITLE);
    assert.doesNotMatch(root.textContent, /kalshi|alpaca|coinbase/i);
    assert.deepEqual(root.find('a'), []);
  });
});

test('a fold, an empty book and a page before the ledger each read plainly', async () => {
  const folded = ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.slice(0, 4), earlier: { positions: 2, pnl_usd: '203.20' } }) });
  await mounted(folded, async box => {
    assert.equal(words(box.withClass('pos-earlier')[0]), '2 older positions +$203.20');
  });
  const empty = swarmCheckpoint({ account: null, trading: { as_of: PUBLISHED_AT, pnl_usd: '0.00' },
    positions: ledger({ rows: [], other: { ...ledger().other, fees_usd: '0.00', crypto_usd: '0.00' } }) });
  await mounted(empty, async box => {
    assert.equal(words(box), 'No real positions yet. Fees & other $0.00 Profit $0.00');
  });
  await mounted(swarmCheckpoint(), async box => {
    assert.equal(words(box), 'No positions yet.');
  });
  await mounted(null, async box => {
    assert.equal(words(box), 'No positions yet.');
    assert.equal(box.getAttribute('aria-busy'), 'false');
  });
});

test('forbidden fields never reach the page: a smuggled ledger is refused whole, and the model reads named fields only', async () => {
  const smuggled = patchRow(0, { strike: '571', fill_price: '1.23', mark: '4.56', bid: '7.89' });
  // Straight to the browser, past the record: the page's own validation refuses the whole checkpoint.
  await mounted(null, async (box, root) => {
    assert.equal(words(box), 'No positions yet.');
    assert.doesNotMatch(root.textContent, /571|1\.23|4\.56|7\.89/);
  }, path => (path.startsWith('/api/capital/checkpoint') ? smuggled : null));
  // And the model copies named fields only, whatever else an object carries.
  const book = positionsLedger({ ...smuggled, positions: { ...smuggled.positions, bid: '9.99' } }, at);
  assert.doesNotMatch(JSON.stringify(book), /571|1\.23|4\.56|7\.89|9\.99|strike|fill_price|"mark"|"bid"/);
});

test('the section is quiet: text nodes only, its own rules never move, and it fits a phone', async () => {
  const source = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|outerHTML/);
  const css = await readFile(new URL('../capital/capital.css', import.meta.url), 'utf8');
  const ledgerRules = css.split('\n').filter(line => /ledger|\.pos|fold-/.test(line));
  assert.ok(ledgerRules.length > 10);
  assert.doesNotMatch(ledgerRules.join('\n'), /animation|transition/, 'nothing in the ledger moves');
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
  assert.match(phone, /\.pos \{ display: flex; flex-direction: column; gap: 6px; \}/);
  assert.match(phone, /\.pos-result \{ order: -1;/, 'the result rides above the position, never over it');
  const html = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(html, /<section id="positions" class="block positions" aria-labelledby="positions-title">\s*<h2 id="positions-title" class="section-title">Positions<\/h2>\s*<div id="floor-positions" aria-busy="true">/);
});
