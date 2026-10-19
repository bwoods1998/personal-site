// The event lane on /capital/ (Oct 19, 2026): the House's view under the versioned key `lane_v1` (its programs, the funnel,
// the goal's checkpoint, the verdict spend and the equity book's lots), the Worker's lane read (every older read byte for
// byte what it was), and the page evolved, not redesigned: the Agents board is the lane's four steps with the gold line
// under Learning, the Positions list the lots like any other position and still add up to Profit to the cent, and the
// checkpoint beside the Agents heading counts events. Without the view the page is exactly what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANE_KEY, LANE_BANDS, MAX_LOTS, MAX_PROGRAMS, OPTIONAL_CHECKPOINT_FIELDS, validCheckpoint, validLane } from '../capital/schema.js';
import {
  CHECKPOINT_READ, LANE_MONEY_LINE, LANE_STAGES, AGENT_STAGES, CHECKPOINT_TITLE, chartMarks, laneCheckpoint as checkpointCopy, laneOf, laneRows,
  laneStages, positionsLedger, profitNow, sharesText, startCapital, tradingProfit, accountSeries,
} from '../capital/capital.js';
import { CURRENT_READ, LANE_READ, POSITIONS_READ, WINDOW_READ } from '../lib/capital.mjs';
import { FLOOR_IDS, floor, get, post, stubPage, withBrowser, words } from './harness.mjs';
import { PUBLISHED_AT, laneBlock, laneCheckpoint, lot, lots, program, windowCheckpoint, PROGRAMS, LOTS } from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const withLane = lane => windowCheckpoint({ [LANE_KEY]: lane });
const cents = value => Math.round(Number(value) * 100);

// ---------------------------------------------------------------------------- the schema
test('the lane rides one versioned key: optional, exact, and every rule of its programs, funnel, checkpoint and lots', () => {
  assert.equal(LANE_KEY, 'lane_v1');
  assert.equal(OPTIONAL_CHECKPOINT_FIELDS.at(-1), LANE_KEY);
  assert.deepEqual(LANE_BANDS, ['shadow', 'learning', 'probe', 'sized', 'retired']);
  assert.equal(validCheckpoint(laneCheckpoint()), true, 'a House with the lane');
  assert.equal(validCheckpoint(windowCheckpoint()), true, 'an older House: no lane');
  assert.equal(validCheckpoint(withLane(null)), true, 'or null');
  assert.equal(validCheckpoint(withLane(laneBlock({ lots: null, funnel: null, checkpoint: null, verdict_usd: null }))), true, 'each part may be unknown');
  const programs = (index, patch) => PROGRAMS.map((row, n) => (n === index ? { ...row, ...patch } : row));
  const lotRows = (index, patch) => LOTS.map((row, n) => (n === index ? { ...row, ...patch } : row));
  for (const [label, lane] of [
    ['an unknown key', { ...laneBlock(), notes: [] }],
    ['dated after its checkpoint', laneBlock({ as_of: '2026-09-28T15:00:00.000Z' })],
    ['a band the lane has not', laneBlock({ programs: programs(1, { band: 'candidate' }) })],
    ['a shadow program with real money', laneBlock({ programs: programs(5, { real: 2 }) })],
    ['a shadow program with a look', laneBlock({ programs: programs(5, { look: { need: 60, to_go: 1 } }) })],
    ['a retired program with a look', laneBlock({ programs: programs(4, { look: { need: 60, to_go: 1 } }) })],
    ['more to go than the look needs', laneBlock({ programs: programs(1, { look: { need: 60, to_go: 61 } }) })],
    ['a name with a price in it', laneBlock({ programs: programs(1, { name: 'Buys at 1.25' }) })],
    ['a name that names the venue', laneBlock({ programs: programs(1, { name: 'Alpaca read' }) })],
    ['a program with more to say', laneBlock({ programs: programs(1, { rule: 'score >= 2' }) })],
    ['a program twice', laneBlock({ programs: [...PROGRAMS, PROGRAMS[0]] })],
    ['too many programs', laneBlock({ programs: Array.from({ length: MAX_PROGRAMS + 1 }, (_, n) => program(`p-${n}`)), lots: null })],
    ['a funnel that widens', laneBlock({ funnel: { ...laneBlock().funnel, probe: 10 } })],
    ['a funnel retiring more than ever traded', laneBlock({ funnel: { ...laneBlock().funnel, retired: 10 } })],
    ['a checkpoint that skips a reading', laneBlock({ checkpoint: { events: 3, next: 200 } })],
    ['a negative bill', laneBlock({ verdict_usd: '-1.00' })],
    ['lots that do not add up', laneBlock({ lots: lots({ pnl_usd: '4.46' }) })],
    ['a lot with a price', laneBlock({ lots: lots({ rows: lotRows(1, { price: '68.82' }) }) })],
    ['a lot of a program the view does not list', laneBlock({ lots: lots({ rows: lotRows(1, { owner: 'nobody' }) }) })],
    ['an agent\'s lot with no agent id', laneBlock({ lots: lots({ rows: lotRows(3, { owner: 'Not An Id' }) }) })],
    ['a lot with two owners', laneBlock({ lots: lots({ rows: lotRows(1, { agent: 'orb-4' }) }) })],
    ['an open lot that closed', laneBlock({ lots: lots({ rows: lotRows(0, { closed_at: '2026-09-28T14:40:00.000Z' }) }) })],
    ['a closed lot still holding shares', laneBlock({ lots: lots({ rows: lotRows(1, { open_shares: '1' }) }) })],
    ['a lot closed before it opened', laneBlock({ lots: lots({ rows: lotRows(1, { closed_at: '2026-09-28T13:00:00.000Z' }) }) })],
    ['shares past six decimals', laneBlock({ lots: lots({ rows: lotRows(3, { shares: '2.5134211' }) }) })],
    ['a time to the second', laneBlock({ lots: lots({ rows: lotRows(1, { opened_at: '2026-09-28T13:30:04.000Z' }) }) })],
    ['a fraction of a cent', laneBlock({ lots: lots({ rows: lotRows(1, { pnl_usd: '-0.845' }), pnl_usd: '4.445' }) })],
    ['a route the lane has not', laneBlock({ lots: lots({ rows: lotRows(1, { route: 'tuition' }) }) })],
    ['too many lots', laneBlock({ lots: lots({ rows: Array.from({ length: MAX_LOTS + 1 }, (_, n) => lot(`lot:${n + 100}`, { pnl_usd: '0.00' })), pnl_usd: '0.00' }) })],
  ]) assert.equal(validCheckpoint(withLane(lane)), false, label);
  // An unknown total leaves its lines free to be unknown; a known one is their exact sum.
  assert.equal(validLane(laneBlock({ lots: lots({ rows: LOTS.map((row, n) => (n ? row : { ...row, pnl_usd: null })), pnl_usd: null }) }), PUBLISHED_AT), true);
  assert.equal(validLane(laneBlock({ lots: lots({ rows: LOTS.map((row, n) => (n ? row : { ...row, pnl_usd: null })) }) }), PUBLISHED_AT), false);
  assert.equal(validLane(laneBlock({ lots: lots({ earlier: { positions: 12, pnl_usd: '-1.00' }, pnl_usd: '3.45' }) }), PUBLISHED_AT), true, 'older lots folded');
});

// ---------------------------------------------------------------------------- the Worker
test('the Worker serves the lane to the lane read only: every other read is byte for byte what it was', async () => {
  assert.equal(LANE_READ, `${WINDOW_READ}&lane=1`);
  assert.equal(CHECKPOINT_READ, LANE_READ, 'the page asks for it');
  const reads = ['', '?progress=1', POSITIONS_READ, CURRENT_READ, WINDOW_READ];
  const bodies = async checkpoint => {
    const { capital } = floor(at + 30000);
    assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
    return Promise.all([...reads, LANE_READ].map(async query => {
      const response = await get(capital, `/api/capital/checkpoint${query}`);
      assert.equal(response.status, 200, query);
      return response.text();
    }));
  };
  const withIt = await bodies(laneCheckpoint());
  const without = await bodies(windowCheckpoint());
  for (const [index, query] of reads.entries()) assert.equal(withIt[index], without[index], `${query || 'default'}: unchanged by the stored lane`);
  const lane = JSON.parse(withIt[reads.length]);
  assert.deepEqual(lane[LANE_KEY], laneBlock(), 'exactly as the House sent it: no name added to a lot');
  const { [LANE_KEY]: _lane, ...windowed } = lane;
  assert.deepEqual(windowed, JSON.parse(withIt[reads.length - 1]), 'the window read and the lane');
  assert.equal(validCheckpoint(lane, { publicRead: true }), true);
  assert.deepEqual(JSON.parse(without[reads.length]), JSON.parse(without[reads.length - 1]), 'an older House: the lane read is the window read');
  const { capital } = floor(at + 30000);
  await post(capital, '/api/capital/checkpoint', laneCheckpoint());
  for (const query of ['?lane=1', '?progress=1&positions=1&practice=1&lane=1', `${WINDOW_READ}&lane=2`, `${LANE_READ}&lane=1`]) {
    assert.equal((await get(capital, `/api/capital/checkpoint${query}`)).status, 404, query);
  }
});

// ---------------------------------------------------------------------------- the board
test('the board is the lane\'s four steps, the gold line under Learning, each step with how many ever reached it', () => {
  assert.deepEqual(LANE_STAGES.map(stage => [stage.label, Boolean(stage.real)]), [['Sized', true], ['Probe', true], ['Learning', true], ['Shadow', false]]);
  const checkpoint = laneCheckpoint();
  const now = at + 30000;
  const stages = laneStages(checkpoint, now);
  assert.deepEqual(stages.map(stage => stage.ever), [0, 1, 9, 18]);
  assert.deepEqual(stages.map(stage => stage.agents.map(row => row.id)), [[], ['ern-read-o1'], ['8k-read-o1', 'news-read-o1', 'ins-buy-o1'],
    ['ctrl-ern-all-o1', 'ern-read-o3']], 'a retired program leaves the board');
  assert.equal(stages.at(-1).share, 1);
  for (let index = 0; index < 3; index++) assert.ok(stages[index].width.wide < stages[index + 1].width.wide, 'it narrows going up');
  const rows = new Map(laneRows(checkpoint, now).map(row => [row.id, row]));
  assert.equal(rows.get('8k-read-o1').label, '8-K read · Learning · 38 events to the next look');
  assert.equal(rows.get('8k-read-o1').progress.fraction, 22 / 60);
  assert.equal(rows.get('ctrl-ern-all-o1').label, 'All earnings · Shadow');
  assert.equal(rows.get('ctrl-ern-all-o1').record.main, 'shadow 31 events', 'never real money: no real count');
  assert.equal(rows.get('ern-read-o1').record.main, 'real 4 events · shadow 63 events');
  assert.equal(laneRows(checkpoint, at + 3600000).every(row => row.progress === null), true, 'no ring once the House has stopped publishing');
  assert.equal(laneOf(windowCheckpoint()), null);
  assert.deepEqual(laneStages(withLane(laneBlock({ funnel: null })), now).map(stage => stage.ever), [null, null, null, null], 'no funnel: no counts');
});

test('the checkpoint counts events, not closes', () => {
  assert.deepEqual(checkpointCopy(laneCheckpoint()), { text: '3 / 100 events', title: CHECKPOINT_TITLE });
  assert.equal(checkpointCopy(withLane(laneBlock({ checkpoint: { events: 1234, next: 1300 } }))).text, '1,234 / 1,300 events');
  assert.equal(checkpointCopy(windowCheckpoint()), null, 'an older House: no copy');
  assert.equal(checkpointCopy(withLane(laneBlock({ checkpoint: null }))), null);
});

// ---------------------------------------------------------------------------- the positions
test('the lots are positions like any other: whose, what, how many, and every line adds up to Profit to the cent', () => {
  const checkpoint = laneCheckpoint();
  const now = at + 30000;
  const ledger = positionsLedger(checkpoint, now);
  const lotLines = [...ledger.open, ...ledger.closed].filter(line => line.id.startsWith('lot:'));
  assert.deepEqual(lotLines.map(line => [line.id, line.who, line.what, line.amount, line.routeText, line.pnl]), [
    ['lot:24', 'Insider buy', 'PFE shares', '6 shares', 'Learning', '$0.00'],
    ['lot:22', 'Morning news read', 'KO shares', '3 shares', 'Learning', '−$0.84'],
    ['lot:21', 'Earnings read', 'F shares', '9 shares', 'Learning', '+$1.17'],
    ['lot:3', 'Orb 4', 'SPY shares', '2.51 shares', 'Probe', '+$4.12'],
  ]);
  assert.deepEqual(ledger.open.map(line => line.id), ['lot:24', 'real:8', 'real:6', 'real:7'],
    'open first, newest first, the options rows and the lots together (the same minute: the higher number first)');
  assert.equal(lotLines.find(line => line.id === 'lot:3').thesis, 'The opening range breaks in the direction the day keeps. A vertical rides it with a known worst case.',
    'an older lane\'s agent keeps its thesis');
  assert.equal(lotLines.find(line => line.id === 'lot:21').thesis, null);
  // The headline is the account's Profit; the lines add up to it exactly, the open ones carrying what the marks differ by.
  const profit = profitNow(checkpoint, now);
  assert.equal(profit, '212.72');
  assert.equal(ledger.total.usd, profit);
  assert.equal(cents(ledger.openTotal.usd) + cents(ledger.closedTotal.usd) + cents(ledger.other.usd), cents(profit));
  assert.equal(ledger.marks.pnl, '−$5.13', 'several open: each at the House\'s value, and the valuation difference');
  assert.equal(ledger.closedTotal.usd, '216.35', 'the closed lots in the Closed group');
  // A lot alone open takes the rest, as an options row does.
  const closedOnly = windowCheckpoint().positions.rows.filter(row => row.status === 'closed');
  const kept = new Set(closedOnly.map(row => row.id));
  const alone = laneCheckpoint({ positions: { ...windowCheckpoint().positions, rows: closedOnly }, trading: { as_of: PUBLISHED_AT, pnl_usd: '211.90' },
    rationale: { ...windowCheckpoint().rationale, trades: windowCheckpoint().rationale.trades.filter(trade => kept.has(trade.id)) } });
  assert.equal(validCheckpoint(alone), true);
  const one = positionsLedger(alone, now);
  assert.deepEqual(one.open.map(line => [line.id, line.pnl]), [['lot:24', '−$3.63']]);
  assert.equal(one.marks, null);
  // The older lots folded by the House join the positions the table no longer lists, as one line.
  const folded = positionsLedger(withLane(laneBlock({ lots: lots({ earlier: { positions: 12, pnl_usd: '-1.00' }, pnl_usd: '3.45' }) })), now);
  assert.deepEqual([folded.earlier.count, folded.earlier.pnl], [12, '−$1.00']);
  assert.equal(sharesText('1'), '1 share');
});

test('the chart marks a program\'s lot where it opened, like an agent\'s position', () => {
  const checkpoint = laneCheckpoint();
  const series = accountSeries([{ at: '2026-09-26T07:00:00.000Z', equity: '481.65' }, { at: '2026-09-28T14:57:58.000Z', equity: '5694.37' }], checkpoint);
  const marks = chartMarks(checkpoint, series);
  assert.ok(marks.some(mark => mark.id === 'lot:24' && mark.open && mark.label === 'Insider buy opened PFE shares'));
  assert.ok(marks.some(mark => mark.id === 'lot:3' && !mark.open && mark.label === 'Orb 4 opened SPY shares'));
});

test('the House\'s own total holds the lots with the lane, and is unknown while they are', () => {
  const now = at + 30000;
  assert.equal(tradingProfit(laneCheckpoint(), now), '217.85', '213.40 of options and 4.45 of lots');
  assert.equal(tradingProfit(withLane(laneBlock({ lots: null })), now), null);
  assert.equal(tradingProfit(withLane(laneBlock({ lots: lots({ pnl_usd: null, rows: [] }) })), now), null);
  assert.equal(tradingProfit(windowCheckpoint(), now), '213.40', 'an older House: as before');
  const unread = laneCheckpoint({ account: null });
  assert.equal(profitNow(unread, now), '217.85', 'the account unread: the House\'s complete total stands in');
});

// ---------------------------------------------------------------------------- the page, mounted
async function mounted(checkpoint, work) {
  const { capital } = floor(at + 30000);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
  const root = stubPage('floor', [...FLOOR_IDS, 'floor-checkpoint']);
  root.querySelector('#floor-checkpoint').hidden = true;
  const asked = [];
  await withBrowser('', path => { asked.push(path); return capital.fetch(new Request('https://blakewoods.us' + path)); }, async () => {
    const saved = Date.now;
    Date.now = () => at + 30000;
    try {
      const feed = await startCapital(root);
      feed.stop();
      await work(root, asked);
    } finally { Date.now = saved; }
  });
}

test('mounted: the lane\'s board, its lots among the positions, and the checkpoint beside the heading', async () => {
  await mounted(laneCheckpoint(), async (root, asked) => {
    assert.ok(asked.includes(`/api/capital/checkpoint${LANE_READ}`));
    const board = root.querySelector('#floor-agents');
    assert.deepEqual(board.withClass('rung-name').map(words), ['Sized', 'Probe', 'Learning', 'Shadow']);
    assert.deepEqual(board.withClass('reached-count').map(words), ['0', '1', '9', '18']);
    assert.equal(board.withClass('agent-dot').length, 6, 'every program but the retired one');
    assert.deepEqual(board.withClass('level-learning').map(dot => dot.dataset.agent), ['8k-read-o1', 'news-read-o1', 'ins-buy-o1']);
    assert.deepEqual(board.withClass('level-shadow').map(dot => dot.dataset.rung), ['1', '1']);
    const mark = board.withClass('ladder-real-mark');
    assert.equal(mark.length, 1, 'one gold line');
    assert.equal(mark[0].getAttribute('title'), LANE_MONEY_LINE);
    assert.deepEqual(board.withClass('ladder-floor')[0].withClass('rung-name').map(words), ['Learning'], 'the line runs under Learning');
    const copy = root.querySelector('#floor-checkpoint');
    assert.deepEqual([copy.hidden, words(copy), copy.getAttribute('title')], [false, '3 / 100 events', CHECKPOINT_TITLE]);
    // A dot opens its program: its name, its step, what it has settled and its next look; the board says nothing else.
    board.withClass('agent-dot').find(dot => dot.dataset.agent === '8k-read-o1').click();
    const card = board.withClass('agent-detail-card')[0];
    assert.equal(words(card), '8-K read Learning × real 2 events · shadow 22 events Next look 22 / 60 events');
    const positions = root.querySelector('#floor-positions');
    const ids = positions.withClass('pos').map(row => row.dataset.position).filter(Boolean);
    for (const id of ['lot:24', 'lot:21', 'lot:22', 'lot:3']) assert.ok(ids.includes(id), id);
    const pfe = positions.withClass('pos').find(row => row.dataset.position === 'lot:24');
    assert.equal(words(pfe), 'PFE shares Insider buy Learning 6 shares · opened Sep 28 $0.00 open');
    assert.equal(words(positions.withClass('ledger-total')[0]), 'Profit +$212.72');
    assert.doesNotMatch(root.textContent, /kalshi|alpaca|coinbase/i);
    assert.doesNotMatch(words(board) + words(copy), /\$|price|limit|filing|verdict/i, 'the board and its count: steps, names and counts only');
  });
});

test('mounted without the lane: the page is what it was', async () => {
  await mounted(windowCheckpoint(), async root => {
    const board = root.querySelector('#floor-agents');
    assert.deepEqual(board.withClass('rung-name').map(words), AGENT_STAGES.map(stage => stage.label));
    assert.equal(root.querySelector('#floor-checkpoint').hidden, true, 'no checkpoint copy');
    assert.equal(root.querySelector('#floor-positions').withClass('pos').some(row => String(row.dataset.position).startsWith('lot:')), false);
  });
});
