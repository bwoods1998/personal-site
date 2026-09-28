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
import {
  PROFIT_TITLES, POSITION_COLUMNS, mastheadNumbers, positionsLedger, positionsLine, positionWhat, shareOf, startCapital,
} from '../capital/capital.js';
import { floor, post, get, words, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';
import { swarmCheckpoint, ledgerCheckpoint, ledger, position, POSITIONS, agent, PUBLISHED_AT } from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const READ = '/api/capital/checkpoint?progress=1&positions=1';
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
test('each line reads as who, what, how many, when and the dollar result; open first, newest first, and they add up to Profit', () => {
  const book = positionsLedger(ledgerCheckpoint(), at);
  assert.deepEqual(book.open.map(line => [line.id, line.who, line.what, line.quantity, line.expiry, line.closedAt, line.pnl, line.share]), [
    ['real:6', 'Orb 4', 'SPY call debit vertical', '×2', 'Sep 28', null, '−$8.00', '−3.6%'],
    ['real:7', 'Condor Vrp 3', 'XSP iron condor', '×1', 'Sep 28', null, '+$12.50', '5.7%'],
  ]);
  assert.deepEqual(book.closed.map(line => [line.id, line.who, line.what, line.quantity, line.expiry, line.pnl, line.share]), [
    ['real:5', 'Orb 4', 'SPY call debit vertical', '×2', 'Sep 28', '+$31.00', '14.1%'],
    ['real:4', 'Putspread Dip 2', 'QQQ put debit vertical', '×1', 'Oct 9', '−$18.30', '−8.3%'],
    ['real:1', 'House calibration', 'SPY call debit vertical', '×1', 'Sep 29', '−$2.20', '−1.0%'],
    ['real:3', 'Condor Vrp 3', 'XSP iron condor', '×1', 'Sep 28', '+$205.40', '93.2%'],
  ]);
  assert.deepEqual([book.other.label, book.other.detail, book.other.pnl, book.other.share], ['Other account activity', 'fees +$0.08 · crypto fees −$0.08', '$0.00', '0.0%']);
  assert.equal(book.unreconciled, null, 'a zero difference is not a line');
  assert.equal(book.earlier, null);
  assert.deepEqual([book.total.label, book.total.pnl, book.total.share], ['Profit', '+$220.40', '100.0%']);
  assert.equal(book.total.pnl, mastheadNumbers(ledgerCheckpoint(), at)[0].value, 'the total is the headline');
  const lines = [...book.open, ...book.closed, book.other];
  assert.equal(lines.reduce((sum, line) => sum + cents(line.usd), 0n), cents(book.total.usd), 'to the cent');
  assert.equal(positionsLine(book), '2 open · 4 closed');
  // A partial close, the oldest positions folded, and a difference the House could not explain: each its own line.
  const partialCheckpoint = ledgerCheckpoint({ positions: ledger({
    rows: [POSITIONS[0], { ...POSITIONS[1], open_quantity: 1 }, ...POSITIONS.slice(2, 4)],
    earlier: { positions: 2, pnl_usd: '203.20' }, other: { ...ledger().other, fees_usd: '-0.92' }, unreconciled_usd: '1.00' }) });
  assert.equal(validCheckpoint(partialCheckpoint), true);
  const partial = positionsLedger(partialCheckpoint, at);
  assert.equal(partial.open[0].quantity, '×1 of 2');
  assert.deepEqual([partial.earlier.label, partial.earlier.detail, partial.earlier.pnl, partial.earlier.count],
    ['2 positions not listed', 'the oldest closed, and any the table can’t describe', '+$203.20', 2]);
  assert.deepEqual([partial.unreconciled.label, partial.unreconciled.pnl], ['Unreconciled difference', '+$1.00']);
  assert.deepEqual([partial.other.detail, partial.other.pnl], ['fees −$0.92 · crypto fees −$0.08', '−$1.00']);
  assert.equal(positionsLine(partial), '2 open · 2 closed · 2 not listed');
  const partialLines = [...partial.open, ...partial.closed, partial.earlier, partial.other, partial.unreconciled];
  assert.equal(partialLines.reduce((sum, line) => sum + cents(line.usd), 0n), cents(partial.total.usd));
  // A stale or unknown Profit is a dash in the total and every share, exactly as in the headline.
  const stale = positionsLedger(ledgerCheckpoint(), at + 11 * 60000);
  assert.equal(mastheadNumbers(ledgerCheckpoint(), at + 11 * 60000)[0].value, '—');
  assert.deepEqual([stale.total.pnl, stale.total.share, stale.open[0].share, stale.other.share], ['—', '—', '—', '—']);
  assert.equal(stale.open[0].pnl, '−$8.00', 'a position keeps its last published result');
  const unknown = positionsLedger(swarmCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: null },
    positions: ledger({ rows: POSITIONS.map(row => ({ ...row, pnl_usd: null })), other: null, unreconciled_usd: null }) }), at);
  assert.deepEqual([unknown.open[0].pnl, unknown.other.pnl, unknown.other.detail, unknown.total.pnl], ['—', '—', '', '—']);
  assert.equal(positionsLedger(swarmCheckpoint(), at), null, 'no ledger published');
  assert.equal(positionsLedger(null), null);
});

test('the House’s first real day: one calibration round trip with the broker’s own fees, and a crypto fee, adding up to Profit', () => {
  // As the House publishes it since the review of #408 (5): the broker's posted fees are in the position's own row (the
  // trade's real -2.12), and Other holds only what no position carries (the coins' sale fees).
  const calibration = position('real:1', { source: 'calibration', agent: null, underlying: 'SPY', structure: 'debit_vertical', right: 'call', legs: 2,
    expiry: '2026-09-29', status: 'closed', open_quantity: 0, opened_at: '2026-09-28T14:10:00.000Z', closed_at: '2026-09-28T14:10:00.000Z', pnl_usd: '-2.12' });
  const day = swarmCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: '-2.20' },
    positions: ledger({ rows: [calibration], other: { ...ledger().other, fees_usd: '0.00' } }) });
  assert.equal(validCheckpoint(day), true);
  const book = positionsLedger(day, at);
  assert.deepEqual(book.closed.map(line => [line.who, line.what, line.pnl, line.share]), [['House calibration', 'SPY call debit vertical', '−$2.12', '96.4%']]);
  assert.deepEqual([book.other.detail, book.other.pnl, book.other.share], ['crypto fees −$0.08', '−$0.08', '3.6%']);
  assert.deepEqual([book.total.pnl, book.total.share], ['−$2.20', '100.0%']);
});

test('structures read in words, and shares are exact tenths of a percent', () => {
  const what = (structure, right) => positionWhat({ underlying: 'SPY', structure, right });
  assert.deepEqual([what('long_call', 'call'), what('long_put', 'put'), what('debit_vertical', 'put'), what('credit_vertical', 'call'),
    what('iron_condor', 'both'), what('iron_butterfly', 'both'), what('long_butterfly', 'put'), what('long_straddle', 'both'),
    what('long_strangle', 'both'), what('calendar', 'call'), what('diagonal', 'put')], ['SPY long call', 'SPY long put', 'SPY put debit vertical',
    'SPY call credit vertical', 'SPY iron condor', 'SPY iron butterfly', 'SPY long put butterfly', 'SPY long straddle', 'SPY long strangle',
    'SPY call calendar', 'SPY put diagonal']);
  assert.equal(shareOf('-2.20', '-2.20'), '100.0%');
  assert.equal(shareOf('0.08', '-2.20'), '−3.6%', 'a line that moved against a loss');
  assert.equal(shareOf('10.00', '-2.20'), '−454.5%');
  assert.equal(shareOf('1000.00', '0.10'), '1,000,000.0%');
  assert.equal(shareOf('0.0004', '220.40'), '0.0%');
  assert.equal(shareOf('1.00', '0.00'), '—', 'no share of nothing');
  assert.equal(shareOf('1.00', null), '—');
  assert.equal(shareOf(null, '1.00'), '—');
  assert.deepEqual(POSITION_COLUMNS.map(([, label]) => label), ['Who', 'Position', 'Qty', 'Expiry', 'Opened', 'Closed', 'P&L', 'Share']);
  assert.equal(mastheadNumbers(ledgerCheckpoint(), at)[0].title, PROFIT_TITLES.ledger);
  // The review of #408 (N1): Profit counts crypto fees only, and says the leftover dust is not counted.
  assert.match(PROFIT_TITLES.ledger, /crypto fees/);
  assert.match(PROFIT_TITLES.ledger, /not the leftover crypto dust/);
  assert.equal(mastheadNumbers(swarmCheckpoint(), at)[0].title, PROFIT_TITLES.options, 'a House that predates the ledger publishes options alone');
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
const rowText = row => words(row);

test('mounted, the ledger sits under the chart as one table whose total is the headline', async () => {
  await mounted(ledgerCheckpoint(), async (box, root, asked) => {
    assert.ok(asked.includes(READ), 'the page asks for the ledger');
    assert.equal(box.getAttribute('aria-busy'), 'false');
    assert.match(words(box.withClass('positions-caption')[0]), /^2 open · 4 closed · as of Sep 28, 10:58 AM EDT$/);
    const [table] = box.find('table');
    assert.ok(table, 'one table');
    assert.equal(box.withClass('positions-scroll').length, 1, 'it scrolls within its own box, never the page');
    assert.deepEqual(table.find('thead')[0].find('th').map(words), ['Who', 'Position', 'Qty', 'Expiry', 'Opened', 'Closed', 'P&L', 'Share']);
    assert.deepEqual(table.find('thead')[0].find('th').map(node => node.getAttribute('scope')), Array(8).fill('col'));
    assert.deepEqual(table.withClass('pos-group').map(words), ['Open', 'Closed']);
    const rows = table.withClass('pos-row');
    assert.deepEqual(rows.map(row => row.dataset.position), ['real:6', 'real:7', 'real:5', 'real:4', 'real:1', 'real:3']);
    assert.equal(rowText(rows[0]), 'Scholes SPY call debit vertical ×2 Sep 28 Sep 28, 10:10 open −$8.00 −3.6%');
    assert.equal(rowText(rows[2]), 'Scholes SPY call debit vertical ×2 Sep 28 Sep 28, 09:41 Sep 28, 10:30 +$31.00 14.1%');
    assert.equal(rowText(rows[4]), 'House calibration SPY call debit vertical ×1 Sep 29 Sep 28, 10:10 Sep 28, 10:10 −$2.20 −1.0%');
    assert.equal(rows[0].find('th')[0].getAttribute('scope'), 'row');
    assert.equal(rows[0].withClass('pos-pnl')[0].className, 'pos-pnl negative');
    assert.equal(rows[2].withClass('pos-pnl')[0].className, 'pos-pnl positive');
    const time = rows[2].find('time');
    assert.deepEqual(time.map(node => node.dateTime), ['2026-09-28T13:41:00.000Z', '2026-09-28T14:30:00.000Z']);
    assert.match(time[0].getAttribute('title'), /^Sep 28, 9:41 AM EDT$/);
    const foot = table.find('tfoot')[0];
    assert.deepEqual(foot.find('tr').map(rowText), ['Other account activity fees +$0.08 · crypto fees −$0.08 $0.00 0.0%', 'Profit +$220.40 100.0%']);
    const headline = root.querySelector('#floor-numbers').withClass('number-value')[0].textContent;
    assert.equal(headline, '+$220.40');
    assert.equal(foot.withClass('pos-total')[0].withClass('pos-pnl')[0].textContent, headline, 'the total is the headline, to the cent');
    assert.equal(root.querySelector('#floor-numbers').withClass('number-profit')[0].getAttribute('title'), PROFIT_TITLES.ledger);
    assert.doesNotMatch(root.textContent, /kalshi|alpaca|coinbase/i);
    assert.deepEqual(root.find('a'), []);
  });
});

test('a difference, a fold and an empty book each read plainly, and a page before the ledger says so', async () => {
  const shown = ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.map((row, n) => (n ? row : { ...row, pnl_usd: '13.50' })), unreconciled_usd: '-1.00' }) });
  await mounted(shown, async box => {
    assert.deepEqual(box.find('tfoot')[0].find('tr').map(rowText), ['Other account activity fees +$0.08 · crypto fees −$0.08 $0.00 0.0%',
      'Unreconciled difference not yet matched to a position or account activity −$1.00 −0.5%', 'Profit +$220.40 100.0%']);
  });
  const folded = ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.slice(0, 4), earlier: { positions: 2, pnl_usd: '203.20' } }) });
  await mounted(folded, async box => {
    // The review of #408 (S2): the not-listed line sits in the footer, never under Closed (an open position the table
    // cannot describe is counted in it too), and says what it holds.
    const closed = box.withClass('pos-body-closed')[0];
    assert.deepEqual(closed.withClass('pos-row').map(row => row.dataset.position), ['real:5', 'real:4']);
    assert.equal(closed.withClass('pos-sum').length, 0);
    assert.deepEqual(box.find('tfoot')[0].find('tr').map(rowText).slice(0, 2), [
      '2 positions not listed the oldest closed, and any the table can’t describe +$203.20 92.2%',
      'Other account activity fees +$0.08 · crypto fees −$0.08 $0.00 0.0%']);
    assert.match(words(box.withClass('positions-caption')[0]), /^2 open · 2 closed · 2 not listed ·/);
  });
  // While Profit is unknown, a not-listed line with an unknown amount (an unpriced row folded) is shown, never hidden.
  const unknownFold = swarmCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: null },
    positions: ledger({ rows: POSITIONS.slice(0, 4), earlier: { positions: 1, pnl_usd: null }, other: null, unreconciled_usd: null }) });
  assert.equal(validCheckpoint(unknownFold), true);
  await mounted(unknownFold, async box => {
    assert.equal(rowText(box.find('tfoot')[0].find('tr')[0]), '1 position not listed the oldest closed, and any the table can’t describe — —');
  });
  const empty = swarmCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: '0.00' },
    positions: ledger({ rows: [], other: { ...ledger().other, fees_usd: '0.00', crypto_usd: '0.00' } }) });
  await mounted(empty, async box => {
    assert.equal(rowText(box.withClass('pos-empty')[0]), 'No real positions yet.');
    assert.deepEqual(box.find('tfoot')[0].find('tr').map(rowText), ['Other account activity none $0.00 —', 'Profit $0.00 —']);
    assert.equal(words(box.withClass('positions-caption')[0]).startsWith('0 open · 0 closed'), true);
  });
  await mounted(swarmCheckpoint(), async box => {
    assert.equal(words(box), 'No positions have been published yet.');
  });
  await mounted(null, async box => {
    assert.equal(words(box), 'No positions have been published yet.');
    assert.equal(box.getAttribute('aria-busy'), 'false');
  });
});

test('forbidden fields never reach the page: a smuggled ledger is refused whole, and the model reads named fields only', async () => {
  const smuggled = patchRow(0, { strike: '571', fill_price: '1.23', mark: '4.56', bid: '7.89' });
  // Straight to the browser, past the record: the page's own validation refuses the whole checkpoint.
  await mounted(null, async (box, root) => {
    assert.equal(words(box), 'No positions have been published yet.');
    assert.doesNotMatch(root.textContent, /571|1\.23|4\.56|7\.89/);
  }, path => (path.startsWith('/api/capital/checkpoint') ? smuggled : null));
  // And the model copies named fields only, whatever else an object carries.
  const book = positionsLedger({ ...smuggled, positions: { ...smuggled.positions, bid: '9.99' } }, at);
  assert.doesNotMatch(JSON.stringify(book), /571|1\.23|4\.56|7\.89|9\.99|strike|fill_price|"mark"|"bid"/);
});

test('the section is quiet: text nodes only, no motion, and it stacks on a phone without widening the page', async () => {
  const source = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|outerHTML/);
  const css = await readFile(new URL('../capital/capital.css', import.meta.url), 'utf8');
  const ledgerRules = css.split('\n').filter(line => /positions|pos-/.test(line));
  assert.ok(ledgerRules.length > 10);
  assert.doesNotMatch(ledgerRules.join('\n'), /animation|transition/, 'nothing in the ledger moves');
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
  assert.match(phone, /\.positions-table tr \{ display: flex; flex-wrap: wrap;/);
  assert.match(phone, /\.positions-table thead \{ position: absolute;/);
  assert.match(css, /\.positions-scroll \{[^}]*overflow-x: auto;/);
  const html = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(html, /<section id="positions" class="block positions" aria-labelledby="positions-title">\s*<h2 id="positions-title">Positions<\/h2>\s*<div id="floor-positions" aria-busy="true">/);
});
