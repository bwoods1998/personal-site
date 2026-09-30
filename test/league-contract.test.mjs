// The executable contract with the House's publisher (long-term-capital-management/league/publish.py).
// The runtime keeps two fixtures of exactly what its publisher posts, built by its own
// `build_checkpoint` and `to_events`; this proves the site accepts them, that they carry nothing a
// quote licence forbids, and that every section of /capital/ draws from them. The fixtures live in the
// other repository, so without it the tests skip rather than fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validCheckpoint, validEventBatch, validEvent, EVENT_KINDS, BANDS, SCHEMA_VERSION, quoteFree } from '../capital/schema.js';
import { PERFORMANCE_START_AT, CHECKPOINT_READ, mastheadNumbers, tradingProfit, totalProfit, swarmRows, structureRows, feedLines, positionsLedger, practiceTable, costsLine, startCapital } from '../capital/capital.js';
import { floor, post, get, words, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';

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

for (const [label, read, skipped] of [['', load, skip], [' (with the positions ledger)', loadLedger, ledgerSkip], [' (with the practice league)', loadPractice, practiceSkip]]) {
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
    assert.deepEqual(original, checkpoint);
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
