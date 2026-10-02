// Every input cost by service and Net (Sept 30, 2026), the practice league (Sept 29) and the incubator route's label
// (before Oct 1): the schema, the Worker's reads for old and new pages, the numbers and the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPUTE_PARTS, LEGACY_COMPUTE_PARTS, MAX_PRACTICE_ROWS, PRACTICE_ROW_FIELDS, legacyCompute, scaledDecimal, scaledAmount,
  validCheckpoint, validCompute, validPractice, validPosition, validStructure,
} from '../capital/schema.js';
import { CHECKPOINT_READ, INCUBATOR_TITLE, positionsLedger, openMoney, startCapital } from '../capital/capital.js';
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
test('the incubator\'s rows and structures carry their label', () => {
  const incubator = position('real:8', { source: 'incubator', agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', right: 'put', legs: 2,
    status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:00:00.000Z', closed_at: '2026-09-28T13:30:00.000Z', pnl_usd: '-4.00' });
  const body = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '216.40' }, positions: ledger({ rows: [...POSITIONS, incubator] }),
    structures: [...STRUCTURES, structure('st-orb-4-inc', { agent: 'orb-4', route: 'incubator' })] });
  const line = positionsLedger(body, at).closed.find(row => row.id === 'real:8');
  assert.deepEqual([line.who, line.routeText, line.agent, line.pnl], ['Orb 4', 'Incubator', 'orb-4', '−$4.00']);
  assert.equal(positionsLedger(body, at).closed.find(row => row.id === 'real:5').route, null, 'an agent\'s own row has none');
  assert.equal(openMoney(body).get('orb-4').incubator, true, 'a routed structure is the incubator\'s money');
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

test('mounted, the page reads the full checkpoint, and an incubator position wears its label', async () => {
  const incubator = position('real:8', { source: 'incubator', agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', right: 'put', legs: 2,
    status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:00:00.000Z', closed_at: '2026-09-28T13:30:00.000Z', pnl_usd: '-4.00' });
  const body = itemized({ trading: { as_of: PUBLISHED_AT, pnl_usd: '216.40' }, positions: ledger({ rows: [...POSITIONS, incubator] }), practice: practice() });
  await mount(body, async (root, asked) => {
    assert.ok(asked.includes(`/api/capital/checkpoint${CHECKPOINT_READ}`));
    assert.match(words(root.querySelector('#floor-numbers')), /^Profit \+\$212\.72 Running /, 'no Net, no costs: Profit and Running only');
    assert.doesNotMatch(words(root), /Practice|Costs since/, 'the practice league is not on the page');
    const row = root.querySelector('#floor-positions').withClass('pos').find(node => node.dataset.position === 'real:8');
    assert.match(words(row), /Scholes INCUBATOR|Scholes Incubator/);
    assert.equal(row.withClass('tag-incubator')[0].getAttribute('title'), INCUBATOR_TITLE);
  });
});
