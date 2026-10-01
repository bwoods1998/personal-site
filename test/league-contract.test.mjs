// The executable contract with the House's publisher (long-term-capital-management/league/publish.py).
// The runtime keeps two fixtures of exactly what its publisher posts, built by its own
// `build_checkpoint` and `to_events`; this proves the site accepts them, that they carry nothing a
// quote licence forbids, and that every section of /capital/ draws from them. The fixtures live in the
// other repository, so without it the tests skip rather than fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validCheckpoint, validEventBatch, validEvent, validFunnel, EVENT_KINDS, BANDS, SCHEMA_VERSION, FUNNEL_CHAINS, quoteFree, numbered, plainGlyphs, thesisWords } from '../capital/schema.js';
import { PERFORMANCE_START_AT, CHECKPOINT_READ, mastheadNumbers, tradingProfit, totalProfit, swarmRows, structureRows, feedLines, positionsLedger, practiceTable, costsLine, startCapital } from '../capital/capital.js';
import { WINDOW_READ } from '../lib/capital.mjs';
import { floor, post, get, words, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';
import { LEAKS, PLAIN, randomSentences } from './number-words.mjs';

const FIXTURES = process.env.LTCM_FIXTURES || fileURLToPath(new URL('../../long-term-capital-management/league/tests/fixtures/', import.meta.url));
const files = ['site_checkpoint.json', 'site_events.json'].map(name => `${FIXTURES.replace(/\/?$/, '/')}${name}`);
const present = files.every(file => existsSync(file));
const version = present ? JSON.parse(readFileSync(files[0], 'utf8')).schema_version : null;
const skip = !present ? `the runtime repository's fixtures are not at ${FIXTURES} (set LTCM_FIXTURES to league/tests/fixtures to run the contract)`
  : version !== SCHEMA_VERSION ? `the fixtures at ${FIXTURES} are schema ${version}, not ${SCHEMA_VERSION} (point LTCM_FIXTURES at a checkout with the options publisher)` : false;
const load = () => files.map(file => JSON.parse(readFileSync(file, 'utf8')));
// The runtime's checkpoint with Profit and the positions ledger (Sept 28, 2026), once its publisher writes one: the
// review of #408 found each side testing only its own fixture of the ledger, and the two blocks disagreeing.
const ledgerFile = `${FIXTURES.replace(/\/?$/, '/')}site_checkpoint_positions.json`;
const ledgerSkip = skip || (!existsSync(ledgerFile) && `the runtime's fixtures at ${FIXTURES} predate the positions ledger`);
const loadLedger = () => [JSON.parse(readFileSync(ledgerFile, 'utf8')), load()[1]];
// The practice league (Sept 29, 2026): the publisher's checkpoint with the block, which the page reads since Sept 30.
const practiceFile = `${FIXTURES.replace(/\/?$/, '/')}site_checkpoint_practice.json`;
const practiceSkip = skip || (!existsSync(practiceFile) && `the runtime's fixtures at ${FIXTURES} predate the practice league`);
const loadPractice = () => [JSON.parse(readFileSync(practiceFile, 'utf8')), load()[1]];
// The swarm window (Oct 1, 2026): the publisher's checkpoint with `levels` and `rationale`, built from fixed inputs.
const windowFile = `${FIXTURES.replace(/\/?$/, '/')}site_checkpoint_window.json`;
const windowSkip = skip || (!existsSync(windowFile) && `the runtime's fixtures at ${FIXTURES} predate the swarm window`);
const loadWindow = () => [JSON.parse(readFileSync(windowFile, 'utf8')), load()[1]];
// The House's own funnel chains (league/publish.py `FUNNEL_CHAINS`): the two sides must narrow the same way, or the House's
// window is refused and dropped for half an hour at a time (Oct 1, 2026: Tuition became its own chain under Validation).
const publishFile = fileURLToPath(new URL('../../publish.py', `file://${FIXTURES.replace(/\/?$/, '/')}`));
const publishSkip = windowSkip || (!existsSync(publishFile) && `the runtime's publisher is not at ${publishFile}`);
function houseChains(source) {
  const match = /^FUNNEL_CHAINS\s*=\s*\(([\s\S]*?)\)\s*$/m.exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/\(([^()]*)\)/g)].map(group => [...group[1].matchAll(/"([a-z_]+)"/g)].map(name => name[1]));
}
test('the House narrows its funnel by the same chains as the site', { skip: publishSkip }, () => {
  assert.deepEqual(houseChains(readFileSync(publishFile, 'utf8')), FUNNEL_CHAINS);
  const [checkpoint] = loadWindow();
  if (checkpoint.levels) assert.equal(validFunnel(checkpoint.levels.funnel), true, 'the window fixture’s funnel');
});
// The House's own number rules (league/swarm/public.py `numbered` and `plain_glyphs`), run in its checkout on the same
// sentences as the site's copy in schema.js: the Worker's contract refuses a thesis or a tag the House's publisher refuses,
// so the two must agree sentence for sentence, or the House's window is refused (or a leak passes). Oct 1, 2026.
const houseRoot = fileURLToPath(new URL('../../../', `file://${FIXTURES.replace(/\/?$/, '/')}`));
const publicFile = `${houseRoot}league/swarm/public.py`;
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const paritySkip = windowSkip || (!existsSync(publicFile) && `the runtime's number rules are not at ${publicFile}`) || (!python && 'python3 is not installed');
// The House's own case list for the number rules (league/tests/fixtures/number_words.json), which both sides test against.
const casesFile = `${FIXTURES.replace(/\/?$/, '/')}number_words.json`;
const casesSkip = windowSkip || (!existsSync(casesFile) && `the runtime's fixtures at ${FIXTURES} predate its number-word case list`);
const loadCases = () => JSON.parse(readFileSync(casesFile, 'utf8'));
test('the House’s case list of numbers in words: each is refused by the site’s rules and its contract, each plain sentence passes', { skip: casesSkip }, () => {
  const cases = loadCases();
  assert.ok(cases.numbered.length >= 40 && cases.plain.length >= 10);
  for (const text of cases.numbered) {
    assert.ok(numbered(text) || !plainGlyphs(text), text);
    assert.equal(thesisWords(text, 280), false, `contract: ${text}`);
  }
  for (const text of cases.plain) {
    assert.deepEqual([numbered(text), plainGlyphs(text)], [false, true], text);
    assert.equal(thesisWords(text, 280), true, `contract: ${text}`);
  }
});
test('the House and the site read a number in words alike, sentence for sentence', { skip: paritySkip }, () => {
  const shared = casesSkip ? [] : [...loadCases().numbered, ...loadCases().plain];
  const corpus = [...LEAKS, ...PLAIN, ...shared, ...randomSentences(5000)];
  const script = 'import json, sys\nfrom league.swarm import public\nprint(json.dumps([[public.numbered(s), public.plain_glyphs(s)] for s in json.load(sys.stdin)]))';
  const done = spawnSync('python3', ['-c', script], { cwd: houseRoot, input: JSON.stringify(corpus), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(done.status, 0, done.stderr);
  const house = JSON.parse(done.stdout);
  assert.equal(house.length, corpus.length);
  const differ = corpus.map((text, index) => ({ text, house: house[index], site: [numbered(text), plainGlyphs(text)] }))
    .filter(row => row.house[0] !== row.site[0] || row.house[1] !== row.site[1]);
  assert.deepEqual(differ.slice(0, 12), [], `${differ.length} of ${corpus.length} sentences read differently`);
  for (const text of LEAKS) assert.ok(house[corpus.indexOf(text)].join() !== 'false,true', `the House refuses: ${text}`);
  for (const text of PLAIN) assert.deepEqual(house[corpus.indexOf(text)], [false, true], `the House passes: ${text}`);
});
// The page's own sections, and the two it draws only when there is something to show.
const PAGE_IDS = [...FLOOR_IDS, 'floor-costs', 'practice-league', 'floor-league'];
// Every name a quote, a greek, a surface or a fitted parameter goes by. None is a key anywhere.
const FORBIDDEN_KEYS = /^(?:bid|ask|mid|mark|last|spread|iv|implied_vol|vol|delta|gamma|theta|vega|rho|greeks?|surface|strike|strikes|price|prices|entry_price|exit_price|mark_price|underlying_price|params|parameters|quote|quotes|nbbo|program|code|legs_detail)$/i;
function keysOf(value, found = []) {
  if (Array.isArray(value)) { for (const item of value) keysOf(item, found); return found; }
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { found.push(key); keysOf(item, found); }
  return found;
}
function stringsOf(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, found);
  return found;
}

async function publishedRecord(checkpoint, batch) {
  const { capital } = floor(Date.parse(checkpoint.published_at) + 30000);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch)).json(), { stored: batch.events.length, replayed: 0 });
  assert.deepEqual(await (await post(capital, '/api/capital/checkpoint', checkpoint)).json(), { published_at: checkpoint.published_at, agents: checkpoint.agents.length });
  return capital;
}

for (const [label, read, skipped] of [['', load, skip], [' (with the positions ledger)', loadLedger, ledgerSkip], [' (with the practice league)', loadPractice, practiceSkip],
  [' (with the swarm window)', loadWindow, windowSkip]]) {
  test(`the publisher’s fixtures pass the site’s own validators and carry no quote, greek, surface or parameter${label}`, { skip: skipped }, () => {
    const [checkpoint, batch] = read();
    assert.equal(validCheckpoint(checkpoint), true, 'site_checkpoint.json');
    assert.equal(validEventBatch(batch), true, 'site_events.json');
    for (const event of batch.events) assert.equal(validEvent(event), true, event.id);
    assert.deepEqual([...new Set(batch.events.map(event => event.kind))].sort(), Object.keys(EVENT_KINDS).sort(), 'one of each kind the page draws');
    assert.ok(checkpoint.agents.length >= 12, 'a dozen agents');
    assert.deepEqual([...new Set(checkpoint.agents.map(agent => agent.band))].sort(), [...BANDS].sort(), 'every band');
    assert.ok(checkpoint.structures.length >= 2);
    for (const body of [checkpoint, batch]) {
      for (const key of keysOf(body)) assert.doesNotMatch(key, FORBIDDEN_KEYS, key);
    }
    // Every sentence, in both files, is quote-free: the ids and times aside, strings are words.
    for (const text of stringsOf(batch.events.map(event => event.payload))) assert.ok(quoteFree(text) || /^\d{4}-\d\d-\d\d(?:T[\d:.]+Z)?$|^-?\d+(?:\.\d+)?$/.test(text), text);
    // A basis dated before the page's reset is never read: the page then shows no profit, whatever the numbers say.
    if (Date.parse(checkpoint.performance.start_at) < Date.parse(PERFORMANCE_START_AT)) assert.equal(totalProfit(checkpoint), null);
  });

  test(`published to a record and read back, the fixtures fill every section${label}`, { skip: skipped }, async () => {
    const [checkpoint, batch] = read();
    const capital = await publishedRecord(checkpoint, batch);
    assert.deepEqual(await (await post(capital, '/api/capital/events', batch)).json(), { stored: 0, replayed: batch.events.length }, 'the publisher may retry freely');
    const board = await (await get(capital, `/api/capital/checkpoint${CHECKPOINT_READ}`)).json();
    const unnamed = ({ display_name: _name, ...row }) => row;
    const original = { ...board, agents: board.agents.map(unnamed) };
    if (board.positions) original.positions = { ...board.positions, rows: board.positions.rows.map(unnamed) };
    if (board.practice) original.practice = { ...board.practice, rows: board.practice.rows.map(unnamed) };
    // The page's read carries every block but the swarm window's: the Worker keeps `levels` and `rationale` for the window
    // read alone (C7), so the page gets exactly the shapes it validates, and the window comes back whole on its own read.
    const { levels, rationale, ...pageBlocks } = checkpoint;
    assert.deepEqual(original, pageBlocks);
    if (levels !== undefined || rationale !== undefined) {
      const window = await (await get(capital, `/api/capital/checkpoint${WINDOW_READ}`)).json();
      assert.deepEqual([window.levels, window.rationale], [levels, rationale]);
      assert.equal(validCheckpoint(window, { publicRead: true }), true);
    }
    assert.equal(validCheckpoint(board, { publicRead: true }), true);
    const events = (await (await get(capital, '/api/capital/events?limit=200')).json()).events;
    assert.equal(events.length, batch.events.length);
    const [profit, net, running] = mastheadNumbers(board, Date.parse(board.published_at));
    assert.equal(net.label, 'Net');
    assert.match(costsLine(board, Date.parse(board.published_at)), /^Costs /);
    if (checkpoint.practice) assert.equal(practiceTable(board).rows.length, checkpoint.practice.rows.length);
    assert.equal(profit.value === '—', tradingProfit(board, Date.parse(board.published_at)) === null);
    assert.ok(running.value);
    assert.equal(swarmRows(board).length, board.agents.length);
    assert.equal(structureRows(board).length, board.structures.length);
    // The positions ledger, once the publisher sends one: every row drawn, and its lines add up to the headline.
    if (checkpoint.positions) {
      const ledger = positionsLedger(board, Date.parse(board.published_at));
      assert.equal(ledger.open.length + ledger.closed.length, checkpoint.positions.rows.length);
      assert.equal(ledger.total.pnl, profit.value);
    }
    const names = new Map(board.agents.map(agent => [agent.id, agent.name]));
    assert.ok(feedLines(events, names).length >= 3);
    const root = stubPage('floor', PAGE_IDS);
    await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
      const feed = await startCapital(root);
      feed.stop();
      assert.equal(root.querySelector('#practice-league').hidden, !checkpoint.practice, 'the practice league shows only when published');
      if (checkpoint.practice) assert.equal(root.querySelector('#floor-league').find('tbody')[0].find('tr').length, checkpoint.practice.rows.length);
      for (const id of FLOOR_IDS.filter(name => name !== 'floor-status')) assert.equal(root.querySelector(`#${id}`).getAttribute('aria-busy'), 'false', id);
      assert.equal(root.querySelector('#floor-agents').withClass('agent-dot').length, board.agents.length);
      assert.doesNotMatch(root.textContent, /kalshi|alpaca|coinbase/i);
      assert.match(words(root.querySelector('#floor-numbers')), /^Profit /);
      if (checkpoint.positions) assert.equal(root.querySelector('#floor-positions').find('table').length, 1);
    });
  });
}
