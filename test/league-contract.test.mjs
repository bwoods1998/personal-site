// The executable contract with the rebuilt runtime (long-term-capital-management/league). The
// runtime keeps two fixtures of exactly what its publisher posts; this proves the site accepts
// them and that all five sections of /capital/ draw from them. The fixtures live in the other
// repository, so without it the tests skip rather than fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validCheckpoint, validEventBatch, validEvent, deskId, isLive } from '../capital/schema.js';
import {
  PERFORMANCE_START_AT, mastheadNumbers, portfolioPerformance, balanceSeries, openPositionRows, closedRows, closedRecord, boardSnapshot,
  feedLines, heroThought, selfImprovingParts, positionCounts, startCapital,
} from '../capital/capital.js';
import { floor, post, get, words, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';

const FIXTURES = process.env.LTCM_FIXTURES || fileURLToPath(new URL('../../long-term-capital-management/league/tests/fixtures/', import.meta.url));
const files = ['site_checkpoint.json', 'site_events.json'].map(name => `${FIXTURES.replace(/\/?$/, '/')}${name}`);
const skip = files.every(file => existsSync(file)) ? false
  : `the runtime repository's fixtures are not at ${FIXTURES} (set LTCM_FIXTURES to league/tests/fixtures to run the contract)`;
const load = () => files.map(file => JSON.parse(readFileSync(file, 'utf8')));
const RENDERED_KINDS = ['desk.thought', 'desk.tool_call', 'broker.fill', 'desk.outcome', 'lab.progress', 'floor.mark'];
const AGENT_ID = /^[a-z][a-z0-9-]{1,38}$/;

// Publish as the runtime will: the balance marks to the archive, the batch to the tape, then the
// checkpoint. The floor's clock stands just after the checkpoint, as it does when one arrives.
async function publishedFloor(checkpoint, batch) {
  const { capital } = floor(Date.parse(checkpoint.published_at) + 30000);
  const marks = batch.events.filter(event => event.kind === 'floor.mark');
  assert.deepEqual(await (await post(capital, '/api/capital/history', { schema_version: 1, events: marks })).json(), { stored: marks.length, replayed: 0 });
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch)).json(), { stored: batch.events.length, replayed: 0 });
  assert.deepEqual(await (await post(capital, '/api/capital/checkpoint', checkpoint)).json(), { published_at: checkpoint.published_at, desks: checkpoint.desks.length });
  return capital;
}

test('the runtime’s fixtures pass the site’s own validators, in the ids, streams and kinds the league uses', { skip }, () => {
  const [checkpoint, batch] = load();
  assert.equal(validCheckpoint(checkpoint), true, 'site_checkpoint.json');
  assert.equal(validEventBatch(batch), true, 'site_events.json');
  for (const event of batch.events) assert.equal(validEvent(event), true, event.id);
  assert.deepEqual([...new Set(batch.events.map(event => event.kind))].sort(), [...RENDERED_KINDS].sort(), 'one of each kind the page draws');
  assert.deepEqual(batch.events.filter(event => event.kind === 'floor.mark').map(event => event.stream), ['ops', 'ops']);
  // Agent ids as the league writes them are desk ids as the site reads them.
  assert.deepEqual(checkpoint.desks.map(desk => [desk.id, desk.mode, desk.generation, desk.parent_id]), [
    ['favorites-maker', 'live', 1, null], ['crypto-reversion', 'live', 1, null], ['crypto-reversion-2', 'shadow', 2, 'crypto-reversion'],
  ]);
  for (const desk of checkpoint.desks) assert.ok(AGENT_ID.test(desk.id) && deskId(desk.id) && deskId(desk.family), desk.id);
  // The profit basis is the page's own constant, to the millisecond, or no profit is shown.
  assert.equal(checkpoint.floor.performance.start_at, PERFORMANCE_START_AT);
  assert.equal(checkpoint.floor.performance.start_equity, '1021.9251');
  assert.ok(Date.parse(checkpoint.published_at) - Date.parse(checkpoint.floor.performance.verified_at) <= 600000, 'funding verified within ten minutes');
  assert.deepEqual(checkpoint.floor.venues.map(row => [row.venue, row.stale === true]), [['kalshi', false], ['alpaca', false]]);
});

test('published to a floor and read back, the fixtures fill all five sections', { skip }, async () => {
  const [checkpoint, batch] = load();
  const capital = await publishedFloor(checkpoint, batch);
  // A second delivery of the same things changes nothing: the publisher may retry freely.
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch)).json(), { stored: 0, replayed: batch.events.length });
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);

  const read = async path => (await get(capital, path)).json();
  const board = await read('/api/capital/checkpoint');
  assert.deepEqual(board, checkpoint);
  const history = await read('/api/capital/history');
  const marks = history.points.map(point => ({ kind: 'floor.mark', at: point.at, payload: { account_equity: point.account_equity } }));
  const events = (await read('/api/capital/events?limit=200')).events;
  assert.equal(events.length, batch.events.length);
  const live = new Set(board.desks.filter(isLive).map(desk => desk.id));
  const now = Date.parse(board.published_at);

  // 1. The masthead: total profit is a number, and Running counts from run.started_at.
  const [profit, clock] = mastheadNumbers(board, now, marks);
  assert.deepEqual([profit.label, profit.value, profit.tone, profit.note], ['Total profit', '+$0.32', 'positive', '+0.03%']);
  assert.notEqual(profit.value, '—');
  assert.equal(clock.startedAt, Date.parse(checkpoint.run.started_at));
  assert.deepEqual([clock.label, clock.value, clock.tick], ['Running', '1h 30m', '00s']);
  assert.equal(clock.value, selfImprovingParts((now - Date.parse(checkpoint.run.started_at)) / 1000).main);
  assert.equal(mastheadNumbers({ ...board, run: { ...board.run, started_at: '2026-09-19T06:00:00.000Z' } }, now, marks)[1].value, '30m', 'the clock follows the field, nothing else');

  // 2. The live stream: thinking, researching, two trades and the research loop, newest first.
  const lines = feedLines(events, live);
  assert.deepEqual(lines.map(line => [line.kind, line.name, line.practice]), [
    ['testing', 'League', false], ['trading', 'Crypto Reversion', false], ['thinking', 'Crypto Reversion', false],
    ['researching', 'Crypto Reversion', false], ['trading', 'Favorites Maker', false],
  ]);
  assert.equal(lines[1].text, 'bought 0.000437 BTC at $80,950.00');
  assert.equal(lines[3].text, 'searching the web for “bitcoin price drop September 19”');
  assert.deepEqual([lines[4].text, lines[4].pnl, lines[4].tone], ['closed BTC above $80,499.99 · Sep 19 2am ET, settled YES', '+$0.14', 'positive']);
  for (const line of lines) assert.ok(line.text.length > 0, line.kind);
  const hero = heroThought(events);
  assert.deepEqual([hero.desk, hero.research], ['crypto-reversion', 'searching the web for “bitcoin price drop September 19”']);

  // 3. The all-time balance chart: the baseline, the mark on the tape, and the checkpoint itself.
  const performance = portfolioPerformance(board, marks);
  assert.deepEqual(performance.series.points.map(point => point.equity), [1021.9251, 1022.19, 1022.25]);
  assert.equal(performance.series.first.at, Date.parse(PERFORMANCE_START_AT));
  assert.equal(performance.series.last.at, now);
  assert.ok(Math.abs(performance.profit - 0.3249) < 1e-9 && performance.netFlows === 0 && performance.verifiedAt === checkpoint.floor.performance.verified_at);
  assert.equal(balanceSeries(events).points.length, 2, 'the tape’s own marks draw a line even before the archive answers');

  // 4. Open and closed positions, each with who holds it and why.
  // Real money first and untagged; the shadow agent's practice position follows, tagged.
  const book = openPositionRows(board);
  assert.deepEqual(book.rows.map(row => [row.name, row.live, row.market, row.side, row.valueText, row.pnlText]), [
    ['Crypto Reversion', true, 'BTC', 'long', '$35.49', '+$0.11'],
    ['Favorites Maker', true, 'BTC above $80,999.99 · Sep 19 3am ET', 'YES', '$18.80', '+$0.20'],
    ['Crypto Reversion II', false, 'ETH', 'long', '$24.96', '−$0.04'],
  ]);
  for (const row of book.rows) assert.ok(row.short.length > 10 && row.full.length >= row.short.length, `${row.name} says why`);
  assert.deepEqual([book.real, book.practice, book.dust], [2, 1, 0]);
  assert.equal(positionCounts(book), '2 real · 1 practice');
  assert.deepEqual(board.desks.filter(desk => !isLive(desk)).map(desk => [desk.id, desk.positions.length]), [['crypto-reversion-2', 1]], 'the fixture keeps a practice position to draw');
  const closed = closedRows(events, board);
  assert.deepEqual(closed.map(row => [row.name, row.live, row.market, row.outcome, row.settled, row.pnlText, row.heldText]), [
    ['Favorites Maker', true, 'BTC above $80,499.99 · Sep 19 2am ET', 'won', 'settled YES', '+$0.14', '48m'],
  ]);
  assert.ok(closed[0].short.length > 10, 'the closed trade says why');
  assert.equal(closedRecord(closed), '1 real-money trade · 1 won · +$0.14');

  // 5. The ladder puts every agent on the level its band (or its rung) implies, empty levels included.
  const ladder = boardSnapshot(board, events, now);
  assert.deepEqual(ladder.levels.map(row => [row.level, row.agents.length]), [[3, 0], [2, 2], [1, 1]]);
  assert.equal(ladder.living, 3);
  assert.equal(ladder.real, 2);
  assert.equal(ladder.unknown.length, 0);
  // When the publisher sends the allocator's fields, the coins are its stakes and its evidence.
  if (board.desks.some(desk => Object.hasOwn(desk, 'band'))) {
    const live = ladder.levels.find(row => row.level === 2);
    assert.deepEqual(live.agents.map(agent => [agent.id, agent.stake]), board.desks.filter(desk => desk.band === 'bunt').map(desk => [desk.id, Number(desk.stake_usd)])
      .sort((a, b) => b[1] - a[1]));
    assert.ok(ladder.levels.flatMap(row => row.agents).every(agent => agent.evidence === null || Number(agent.evidence.E) > 0));
  }
  if (board.board) {
    assert.ok(ladder.moves.length > 0, 'the board\'s trail is drawn');
    assert.equal(ladder.levels.find(row => row.level === 2).capital,
      Object.values(board.board.bands).reduce((sum, bands) => sum + Number(bands.bunt?.capital_usd || 0), 0));
  }
});

test('the page itself, mounted on that floor, draws every section from the fixtures', { skip }, async () => {
  const [checkpoint, batch] = load();
  const capital = await publishedFloor(checkpoint, batch);
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    const feed = await startCapital(root);
    feed.stop();
    for (const id of FLOOR_IDS.filter(name => name !== 'floor-status')) assert.equal(root.querySelector(`#${id}`).getAttribute('aria-busy'), 'false', id);

    const numbers = words(root.querySelector('#floor-numbers'));
    assert.match(numbers, /^Total profit \+\$0\.32 \+0\.03% Running (?:\d+h \d\dm \d\ds|\d+d \d+h)$/);
    assert.doesNotMatch(numbers, /—/);

    const now = root.querySelector('#floor-now');
    assert.match(words(now), /^Crypto Reversion real money sat down for the 06:25 slot /);
    assert.match(now.withClass('now-thought')[0].textContent, /^BTC is 2\.1 standard deviations under its 24-bar mean/);
    assert.match(words(now.withClass('now-research')[0]), /^researching searching the web for “bitcoin price drop September 19”$/);
    const lines = root.querySelector('#floor-feed').withClass('feed-line').map(words);
    assert.equal(lines.length, 3, 'the thought on stage and its research are not repeated below it');
    assert.match(lines[0], /testing League Replayed 3 variants of crypto-reversion/);
    assert.match(lines[1], /trading Crypto Reversion bought 0\.000437 BTC at \$80,950\.00$/);
    assert.match(lines[2], /trading Favorites Maker closed BTC above \$80,499\.99 · Sep 19 2am ET, settled YES \+\$0\.14$/);
    assert.match(lines[0], /1 passed the history test and starts on practice\.$/, 'the League speaks in the page\'s words');
    assert.equal(root.querySelector('#floor-feed').withClass('tag-practice').length, 0, 'every agent here trades real money');

    const portfolio = root.querySelector('#floor-portfolio');
    assert.equal(portfolio.find('svg').length, 1);
    assert.match(portfolio.find('svg')[0].getAttribute('aria-label'), /\$1,021\.93 to \$1,022\.25/);
    assert.match(words(portfolio.withClass('balance-caption')[0]), /\+\$0\.32 balance change · now \$1,022\.25/);
    assert.match(words(portfolio), /\+\$0\.32 balance change − \$0\.00 net deposits = \+\$0\.32 tracked profit\./);
    assert.equal(words(portfolio.withClass('venues')[0]), 'Kalshi $512.21 Alpaca $510.04');

    // Real money only until the Positions switch is pressed; then the practice book follows, tagged.
    const real = root.querySelector('#floor-positions').find('tbody')[0].find('tr');
    assert.deepEqual(real.map(row => [row.className, ...row.find('td').slice(0, 5).map(words)]), [
      ['', 'Crypto Reversion', 'BTC', 'long', '$35.49', '+$0.11'],
      ['', 'Favorites Maker', 'BTC above $80,999.99 · Sep 19 3am ET', 'YES', '$18.80', '+$0.20'],
    ]);
    root.querySelector('#floor-practice').find('button')[0].click();
    const open = root.querySelector('#floor-positions').find('tbody')[0].find('tr');
    assert.deepEqual(open.map(row => [row.className, ...row.find('td').slice(0, 5).map(words)]), [
      ['', 'Crypto Reversion', 'BTC', 'long', '$35.49', '+$0.11'],
      ['', 'Favorites Maker', 'BTC above $80,999.99 · Sep 19 3am ET', 'YES', '$18.80', '+$0.20'],
      ['row-practice', 'Crypto Reversion II practice', 'ETH', 'long', '$24.96', '−$0.04'],
    ]);
    assert.equal(words(root.querySelector('#floor-positions').withClass('record-line')[0]), '2 real · 1 practice');
    for (const row of open) assert.ok(words(row.withClass('col-why')[0]).length > 10);
    const closed = root.querySelector('#floor-closed');
    assert.equal(words(closed.withClass('record-line')[0]), '1 real-money trade · 1 won · +$0.14');
    assert.match(words(closed.find('tbody')[0].find('tr')[0]), /^Favorites Maker BTC above \$80,499\.99 · Sep 19 2am ET won \+\$0\.14 48m BTC sat \$600 above/);

    const improvement = root.querySelector('#floor-improvement');
    assert.deepEqual(improvement.withClass('board-lane-head').map(words).map(text => text.replace(/\$[\d,]+/, '$N')),
      ['Level 3 Increased capital 0', 'Level 2 Live trading 2 · $N real', 'Level 1 Practice 1']);
    assert.equal(improvement.withClass('board-coin').length + improvement.withClass('board-dot').length, 3, 'one button per agent, whatever the switch says');
    assert.doesNotMatch(improvement.textContent, /\b(?:replay|bunt|swing|star|paper|rungs?)\b/i);
    assert.deepEqual(root.find('a'), []);
  });
});
