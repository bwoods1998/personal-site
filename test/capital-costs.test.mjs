// Every input cost by service and Net (Sept 30, 2026), the practice league (Sept 29) and the incubator route's label
// (before Oct 1): the schema, the Worker's reads for old and new pages, the numbers and the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPUTE_PARTS, LEGACY_COMPUTE_PARTS, MAX_PRACTICE_ROWS, PRACTICE_ROW_FIELDS, legacyCompute, scaledDecimal, scaledAmount,
  validCheckpoint, validCompute, validPractice, validPosition, validStructure,
} from '../capital/schema.js';
import {
  CHECKPOINT_READ, INCUBATOR_TITLE, NET_TITLE, PRACTICE_CAPTION, costsLine, inputCosts, mastheadNumbers, netNumber, positionsLedger,
  practiceTable, structureRows, startCapital,
} from '../capital/capital.js';
import { floor, post, get, words, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';
import { swarmCheckpoint, ledgerCheckpoint, ledger, position, structure, POSITIONS, STRUCTURES, PUBLISHED_AT } from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
// The itemized bill: Sail as billed, Claude its own part. 212.40 + 41.20 + 64.10 + 5.43 + 5.66 + 0 = 328.79.
const BILL = { as_of: '2026-09-28T14:57:00.000Z', sail_usd: '212.40', claude_usd: '41.20', openai_usd: '64.10', thetadata_usd: '5.43',
  market_data_usd: '5.66', other_usd: '0.00' };
const itemized = (overrides = {}) => ledgerCheckpoint({ compute: BILL, ...overrides });
export const practiceRow = (agent, overrides = {}) => ({
  agent, family: agent.replace(/-\d+$/, ''), structure: 'iron_condor', tier: 'validated', status: 'alive', sessions: 3, trades: 9, wins: 5,
  pnl_usd: '42.50', return_on_risk: '0.12', ...overrides,
});
const ROWS = [practiceRow('condor-vrp-3'), practiceRow('orb-4', { structure: 'debit_vertical', tier: 'train', trades: 4, wins: 1, pnl_usd: '-18.20',
  return_on_risk: '-0.09' }), practiceRow('gone-2', { structure: 'long_straddle', status: 'retired', trades: 2, wins: 0, pnl_usd: '-7.00', return_on_risk: null })];
const practice = (overrides = {}) => ({ as_of: PUBLISHED_AT, sessions: 2, capital_usd: '10000.00',
  totals: { families: 3, trades: 15, wins: 6, pnl_usd: '17.30' }, rows: ROWS, ...overrides });
const PAGE_IDS = FLOOR_IDS;

// ---------------------------------------------------------------------------- the schema
test('compute names Claude as its own part, and an older House\'s five parts still validate', () => {
  assert.deepEqual(COMPUTE_PARTS, ['sail_usd', 'claude_usd', 'openai_usd', 'thetadata_usd', 'market_data_usd', 'other_usd']);
  assert.deepEqual(LEGACY_COMPUTE_PARTS, ['sail_usd', 'openai_usd', 'thetadata_usd', 'market_data_usd', 'other_usd']);
  assert.equal(validCompute(BILL, PUBLISHED_AT), true);
  assert.equal(validCompute({ ...BILL, claude_usd: null }, PUBLISHED_AT), true, 'not yet metered');
  assert.equal(validCompute(swarmCheckpoint().compute, PUBLISHED_AT), true, 'the older five parts');
  const { other_usd: _other, ...short } = BILL;
  for (const [label, value] of [['a negative Claude', { ...BILL, claude_usd: '-1' }], ['Claude as a number', { ...BILL, claude_usd: 41.2 }],
    ['a sixth part missing', short], ['an unknown part', { ...BILL, jev_usd: '1' }], ['a booked estimate beside it', { ...BILL, sail_booked_usd: '1' }]]) {
    assert.equal(validCompute(value, PUBLISHED_AT), false, label);
  }
  assert.equal(validCheckpoint(itemized()), true);
  // An older page reads Claude back inside `other`, exactly.
  assert.deepEqual(legacyCompute(BILL), { as_of: BILL.as_of, sail_usd: '212.40', openai_usd: '64.10', thetadata_usd: '5.43', market_data_usd: '5.66', other_usd: '41.20' });
  assert.equal(legacyCompute({ ...BILL, other_usd: '0.125' }).other_usd, '41.325');
  assert.equal(legacyCompute({ ...BILL, claude_usd: null }).other_usd, null, 'unknown Claude: unknown other');
  assert.equal(validCompute(legacyCompute(BILL), PUBLISHED_AT), true);
  const older = swarmCheckpoint().compute;
  assert.equal(legacyCompute(older), older, 'the older shape is already the older shape');
  for (const [value, text] of [['0', '0.00'], ['0.5', '0.50'], ['12.34567891', '12.34567891'], ['-3.2', '-3.20'], ['100000000000000', '100000000000000.00']]) {
    assert.equal(scaledDecimal(scaledAmount(value)), text, value);
  }
});

test('the practice league is an exact allowlist whose totals cover every family', () => {
  assert.deepEqual(PRACTICE_ROW_FIELDS, ['agent', 'family', 'structure', 'tier', 'status', 'sessions', 'trades', 'wins', 'pnl_usd', 'return_on_risk']);
  assert.equal(validPractice(practice(), PUBLISHED_AT), true);
  assert.equal(validCheckpoint(swarmCheckpoint({ practice: practice() })), true, 'beside an older House\'s blocks');
  assert.equal(validCheckpoint(itemized({ practice: practice() })), true, 'beside Profit and the ledger');
  assert.equal(validCheckpoint(itemized({ practice: null })), true, 'or null');
  assert.equal(validPractice(practice({ totals: { families: 60, trades: 400, wins: 150, pnl_usd: '-812.00' } }), PUBLISHED_AT), true,
    'more families than rows: totals over every one, at least the rows');
  assert.equal(validPractice(practice({ rows: [] , totals: { families: 0, trades: 0, wins: 0, pnl_usd: '0.00' } }), PUBLISHED_AT), true);
  const smuggle = field => practice({ rows: [{ ...ROWS[0], [field]: '571.25' }, ...ROWS.slice(1)] });
  for (const field of ['strike', 'price', 'bid', 'expiry', 'version', 'code', 'params', 'last_day', 'live', 'minute', 'validation_t', 'mechanism']) {
    assert.equal(validPractice(smuggle(field), PUBLISHED_AT), false, field);
  }
  const row = patch => practice({ rows: [{ ...ROWS[0], ...patch }, ...ROWS.slice(1)] });
  for (const [label, value] of [
    ['totals that miss a row', practice({ totals: { families: 3, trades: 14, wins: 6, pnl_usd: '17.30' } })],
    ['a P&L total off by a cent', practice({ totals: { families: 3, trades: 15, wins: 6, pnl_usd: '17.31' } })],
    ['fewer families than rows', practice({ totals: { families: 2, trades: 15, wins: 6, pnl_usd: '17.30' } })],
    ['more wins than trades', row({ wins: 10 })],
    ['a fraction of a cent', row({ pnl_usd: '42.505' })],
    ['a return to three places', row({ return_on_risk: '0.125' })],
    ['an unknown tier', row({ tier: 'holdout' })],
    ['an unknown status', row({ status: 'sized' })],
    ['a publisher-supplied name', row({ display_name: 'Meriwether' })],
    ['an unknown structure', row({ structure: 'short_put' })],
    ['duplicate agents', practice({ rows: [ROWS[0], ROWS[0], ROWS[2]], totals: { families: 3, trades: 20, wins: 10, pnl_usd: '78.00' } })],
    ['too many rows', practice({ rows: Array.from({ length: MAX_PRACTICE_ROWS + 1 }, (_, n) => practiceRow(`fam-${n}`)),
      totals: { families: 49, trades: 441, wins: 245, pnl_usd: '2082.50' } })],
    ['no capital', practice({ capital_usd: '0.00' })],
    ['as of after the checkpoint', practice({ as_of: '2026-09-28T16:00:00.000Z' })],
  ]) assert.equal(validPractice(value, PUBLISHED_AT), false, label);
  assert.equal(validPractice(row({ display_name: 'Meriwether' }), PUBLISHED_AT, { publicRead: true }), true, 'the Worker names it on a public read');
  assert.equal(validCheckpoint({ ...swarmCheckpoint(), rumours: [] }), false, 'no other block');
  const noProfit = ledgerCheckpoint();
  delete noProfit.trading;
  assert.equal(validCheckpoint(noProfit), false, 'a ledger needs its Profit');
});

test('an incubator position names its agent and a routed structure is real money', () => {
  const incubator = position('real:8', { source: 'incubator' });
  assert.equal(validPosition(incubator, PUBLISHED_AT), true);
  assert.equal(validPosition({ ...incubator, agent: null }, PUBLISHED_AT), false, 'it names its agent');
  assert.equal(validPosition({ ...incubator, display_name: 'Meriwether' }, PUBLISHED_AT, { publicRead: true }), true);
  assert.equal(validPosition({ ...position('real:1', { source: 'calibration', agent: null }), display_name: 'Meriwether' }, PUBLISHED_AT, { publicRead: true }), false);
  const routed = structure('st-inc', { route: 'incubator' });
  assert.equal(validStructure(routed, PUBLISHED_AT), true);
  assert.equal(validStructure({ ...routed, real: false }, PUBLISHED_AT), false, 'the shadow book has no route');
  assert.equal(validStructure({ ...routed, route: 'tuition' }, PUBLISHED_AT), false);
  assert.equal(validStructure({ ...routed, route: null }, PUBLISHED_AT), false);
});

// ---------------------------------------------------------------------------- the Worker
test('the Worker gives the page every block, and every older read the shapes it validates', async () => {
  const incubator = position('real:8', { source: 'incubator', agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', right: 'put', legs: 2,
    status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:00:00.000Z', closed_at: '2026-09-28T13:30:00.000Z', pnl_usd: '-4.00' });
  const body = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '216.40' }, positions: ledger({ rows: [...POSITIONS, incubator] }), practice: practice(),
    structures: [...STRUCTURES, structure('st-orb-4-inc', { agent: 'orb-4', route: 'incubator' })] });
  assert.equal(validCheckpoint(body), true);
  const { capital } = floor(at + 30000);
  assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 200);
  const read = async query => { const response = await get(capital, `/api/capital/checkpoint${query}`); assert.equal(response.status, 200, query); return response.json(); };
  const page = await read(CHECKPOINT_READ);
  assert.equal(CHECKPOINT_READ, '?progress=1&positions=1&practice=1&window=1');
  assert.equal(validCheckpoint(page, { publicRead: true }), true);
  assert.deepEqual(page.compute, BILL);
  assert.equal(page.positions.rows.find(row => row.id === 'real:8').source, 'incubator');
  assert.equal(page.positions.rows.find(row => row.id === 'real:8').display_name, 'Scholes', 'named like its agent');
  assert.equal(page.structures.find(row => row.id === 'st-orb-4-inc').route, 'incubator');
  assert.deepEqual(page.practice.rows.map(row => row.display_name ?? null), ['Meriwether', 'Scholes', 'Meriwether 2'],
    'named after the roster; a family off the roster gets the next name');
  for (const query of ['', '?progress=1', '?progress=1&positions=1']) {
    const old = await read(query);
    assert.equal('practice' in old, false, query);
    assert.deepEqual(Object.keys(old.compute), ['as_of', 'sail_usd', 'openai_usd', 'thetadata_usd', 'market_data_usd', 'other_usd'], query);
    assert.equal(old.compute.other_usd, '41.20', `${query}: Claude inside other, as before`);
    assert.equal(old.structures.some(row => 'route' in row), false, query);
    if (old.positions) assert.equal(old.positions.rows.find(row => row.id === 'real:8').source, 'agent', query);
    // What a page already open validates: the schema before Sept 30 knew no claude_usd, practice, incubator or route.
    assert.equal(JSON.stringify(old).includes('incubator') || JSON.stringify(old).includes('claude_usd'), false, query);
  }
  for (const query of ['?progress=1&practice=1', '?practice=1', '?progress=1&positions=1&practice=0', '?progress=1&practice=1&positions=1']) {
    assert.equal((await get(capital, `/api/capital/checkpoint${query}`)).status, 404, query);
  }
});

// ---------------------------------------------------------------------------- the numbers
test('Net is realized P&L less every input cost: open gains out, open losses in, deposits never', () => {
  // Profit 220.40 holds real:7 open at +12.50 (out) and real:6 open at −8.00 (in): realized 207.90, less 328.79.
  assert.deepEqual(inputCosts(itemized(), at), { parts: COMPUTE_PARTS.map(part => ({ part, label: { sail_usd: 'Sail', claude_usd: 'Claude',
    openai_usd: 'OpenAI', thetadata_usd: 'ThetaData', market_data_usd: 'market data', other_usd: 'other' }[part], usd: BILL[part] })),
  total: '328.79', itemized: true, asOf: BILL.as_of });
  assert.equal(netNumber(itemized(), at), '-120.89');
  const [profit, net, clock] = mastheadNumbers(itemized(), at);
  assert.deepEqual([profit.value, net.label, net.value, net.tone, net.title, clock.label], ['+$220.40', 'Net', '−$120.89', 'negative', NET_TITLE, 'Running']);
  assert.equal(costsLine(itemized(), at), 'Costs since the reset $328.79: Sail $212.40 · Claude $41.20 · OpenAI $64.10 · ThetaData $5.43 · market data $5.66 · other $0.00.');
  // With no open position, Net is Profit less the bill.
  const flat = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '215.90' }, positions: ledger({ rows: POSITIONS.slice(2) }) });
  assert.equal(validCheckpoint(flat), true);
  assert.equal(netNumber(flat, at), '-112.89');
  // An unreconciled difference counts only when it is a loss.
  const gain = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '221.40' }, positions: ledger({ unreconciled_usd: '1.00' }) });
  const loss = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '219.40' }, positions: ledger({ unreconciled_usd: '-1.00' }) });
  assert.equal(validCheckpoint(gain) && validCheckpoint(loss), true);
  assert.deepEqual([netNumber(gain, at), netNumber(loss, at)], ['-120.89', '-121.89']);
  // Deposits and the balance never enter it.
  assert.equal(netNumber(itemized({ performance: { ...itemized().performance, net_flows: '0' }, account: { ...itemized().account, equity: '99999.00' } }), at), '-120.89');
  // A dash unless every part is known, itemized and fresh, and Profit with its ledger.
  for (const [label, body, when = at] of [
    ['an unmetered part', itemized({ compute: { ...BILL, claude_usd: null } })],
    ['an older House\'s five parts', ledgerCheckpoint()],
    ['no bill', itemized({ compute: null })],
    ['a stale bill', itemized({ compute: { ...BILL, as_of: '2026-09-28T14:40:00.000Z' } })],
    ['a stale Profit', itemized(), at + 11 * 60000],
    ['no ledger', swarmCheckpoint({ compute: BILL })],
    ['an unknown Profit', itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: null } })],
  ]) assert.equal(netNumber(body, when), null, label);
  assert.equal(costsLine(itemized({ compute: { ...BILL, claude_usd: null } }), at),
    'Costs since the reset: Sail $212.40 · Claude not yet metered · OpenAI $64.10 · ThetaData $5.43 · market data $5.66 · other $0.00.');
  assert.equal(costsLine(ledgerCheckpoint(), at), 'Costs are not itemized yet.');
  assert.equal(costsLine(itemized({ compute: null }), at), 'Costs are not published yet.');
});

test('the practice league reads as the House sends it, and the incubator\'s rows and structures carry their label', () => {
  const league = practiceTable(itemized({ practice: practice() }));
  assert.deepEqual(league.rows.map(row => [row.who, row.what, row.tier, row.trades, row.wins, row.pnl, row.ror, row.retired]), [
    ['Condor Vrp 3', 'iron condor', 'validated', '9', '5', '+$42.50', '+12%', false],
    ['Orb 4', 'debit vertical', 'Train', '4', '1', '−$18.20', '−9%', false],
    ['Gone 2', 'long straddle', 'validated', '2', '0', '−$7.00', '—', true],
  ]);
  assert.deepEqual([league.total.label, league.total.trades, league.total.pnl, league.hidden], ['3 families', '15', '+$17.30', 0]);
  assert.equal(practiceTable(itemized()), null, 'no block: no section');
  const incubator = position('real:8', { source: 'incubator', agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', right: 'put', legs: 2,
    status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:00:00.000Z', closed_at: '2026-09-28T13:30:00.000Z', pnl_usd: '-4.00' });
  const body = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '216.40' }, positions: ledger({ rows: [...POSITIONS, incubator] }),
    structures: [...STRUCTURES, structure('st-orb-4-inc', { agent: 'orb-4', route: 'incubator' })] });
  const line = positionsLedger(body, at).closed.find(row => row.id === 'real:8');
  assert.deepEqual([line.who, line.route, line.agent, line.pnl], ['Orb 4', 'Incubator', 'orb-4', '−$4.00']);
  assert.equal(positionsLedger(body, at).closed.find(row => row.id === 'real:5').route, '', 'an agent\'s own row has none');
  assert.deepEqual(structureRows(body).filter(row => row.incubator).map(row => row.id), ['st-orb-4-inc']);
  assert.equal(netNumber(body, at), '-124.89', 'the incubator is real money: in Profit and in Net');
});

// ---------------------------------------------------------------------------- the page
async function mount(checkpoint, work) {
  const { capital } = floor(at + 30000);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
  const root = stubPage('floor', PAGE_IDS);
  const asked = [];
  await withBrowser('', path => { asked.push(path); return capital.fetch(new Request('https://blakewoods.us' + path)); }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    await work(root, asked);
  });
}

test('mounted, the top bar shows Profit, Net and Running over one line of costs, and the Practice step opens the practice league', async () => {
  const incubator = position('real:8', { source: 'incubator', agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', right: 'put', legs: 2,
    status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:00:00.000Z', closed_at: '2026-09-28T13:30:00.000Z', pnl_usd: '-4.00' });
  const body = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '216.40' }, positions: ledger({ rows: [...POSITIONS, incubator] }), practice: practice() });
  await mount(body, async (root, asked) => {
    assert.ok(asked.includes(`/api/capital/checkpoint${CHECKPOINT_READ}`));
    assert.match(words(root.querySelector('#floor-numbers')), /^Profit \+\$216\.40 Net −\$124\.89 Running /);
    assert.equal(words(root.querySelector('#floor-costs')), 'Costs since the reset $328.79: Sail $212.40 · Claude $41.20 · OpenAI $64.10 · ThetaData $5.43 · market data $5.66 · other $0.00.');
    // The practice league is the Practice step's sheet, under its caption, with its totals in a dashed box: never Profit.
    const label = root.querySelector('#floor-agents').withClass('step-label').find(node => node.dataset.step === 'practice');
    assert.equal(label.getAttribute('title'), 'Shadow trades on live quotes, never real money');
    label.click();
    const box = root.querySelector('#floor-sheet');
    assert.equal(box.hidden, false);
    assert.match(words(box.withClass('practice-caption')[0]), new RegExp(`^${PRACTICE_CAPTION.replace(/[.]/g, '\\.')} · as of `));
    assert.equal(words(box.withClass('practice-total')[0]), 'practice 3 families · 15 trades · +$17.30');
    const [table] = box.find('table');
    assert.deepEqual(table.find('thead')[0].find('th').map(words), ['Agent', 'Structure', 'Version', 'Sessions', 'Trades', 'Won', 'P&L', 'On risk']);
    assert.deepEqual(table.find('tbody')[0].find('tr').map(words), ['Meriwether iron condor validated 3 9 5 +$42.50 +12%',
      'Scholes debit vertical Train 3 4 1 −$18.20 −9%', 'Meriwether 2 retired long straddle validated 3 2 0 −$7.00 —']);
    assert.equal(words(table.find('tfoot')[0]), '3 families 15 6 +$17.30');
    const positions = root.querySelector('#floor-positions');
    const row = positions.withClass('pos-item').find(node => node.dataset.position === 'real:8');
    assert.equal(words(row.withClass('pos-who')[0]), 'Scholes Incubator');
    assert.equal(row.withClass('tag-incubator')[0].getAttribute('title'), INCUBATOR_TITLE);
    // The ledger table (≡) carries the same label.
    positions.withClass('pos-table-toggle')[0].click();
    const line = positions.find('tr').find(node => node.dataset.position === 'real:8');
    assert.equal(words(line.find('th')[0]), 'Scholes Incubator');
  });
  // A House that publishes no practice block, and no itemized bill: the Practice sheet has only its caption, and Net is a dash.
  await mount(ledgerCheckpoint(), async root => {
    root.querySelector('#floor-agents').withClass('step-label').find(node => node.dataset.step === 'practice').click();
    assert.equal(root.querySelector('#floor-sheet').withClass('practice-table').length, 0);
    assert.match(words(root.querySelector('#floor-sheet')), /Shadow trades on live quotes, never real money$/);
    assert.match(words(root.querySelector('#floor-numbers')), /^Profit \+\$220\.40 Net — Running /);
    assert.equal(words(root.querySelector('#floor-costs')), 'Costs are not itemized yet.');
  });
});
