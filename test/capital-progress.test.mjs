import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRESS_CHECKS, validAgent, validCheckpoint } from '../capital/schema.js';
import { agentProgress, agentStages, freshAgentActivity, startCapital } from '../capital/capital.js';
import { floor, post, withBrowser, stubPage, FLOOR_IDS, words } from './harness.mjs';
import { agent, swarmCheckpoint, PUBLISHED_AT, note, news } from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const needs = { validation_trades: 100, validation_days: 60, validation_quarters: 3,
  forward_trades: 20, real_trades: 5, probe_sessions: 1 };
export function progress(target = 'candidate', done = {}, blocked = 'validation_failed') {
  return { target, checks: PROGRESS_CHECKS[target].map(key => ({ key, done: done[key] ?? 0, need: needs[key] || 1 })), blocked };
}

test('promotion payloads are exact, complete, bounded and backward compatible, with no private evidence fields', () => {
  const row = agent('one', { progress: progress() });
  assert.equal(validAgent(row, PUBLISHED_AT), true);
  assert.equal(validAgent(agent('old'), PUBLISHED_AT), true);
  assert.equal(validAgent({ ...row, progress: null }, PUBLISHED_AT), true);
  assert.equal(validAgent({ ...row, display_name: 'Meriwether' }, PUBLISHED_AT), false);
  assert.equal(validAgent({ ...row, display_name: 'Meriwether' }, PUBLISHED_AT, { publicRead: true }), true);
  const mutations = [
    p => { p.bid = '1.25'; }, p => { p.checks[0].score = .99; }, p => { p.checks[0].key = 'secret'; },
    p => { p.checks[1].done = 101; }, p => { p.checks[1].need = 99; }, p => { p.checks[0].need = 2; },
    p => { p.checks[0].done = true; }, p => { p.checks[0].done = NaN; }, p => { p.checks[0].done = -.1; },
    p => { p.checks.pop(); }, p => { p.checks[1] = p.checks[0]; }, p => { p.blocked = 'private model details'; },
    p => { p.target = 'probe'; },
  ];
  for (const mutate of mutations) {
    const p = structuredClone(row.progress); mutate(p);
    assert.equal(validCheckpoint(swarmCheckpoint({ agents: [{ ...row, progress: p }], structures: [] })), false);
  }
  for (const [band, target] of [['gym', 'candidate'], ['candidate', 'probe'], ['probe', 'sized'], ['sized', 'maintain']]) {
    assert.equal(validAgent(agent('one', { band, progress: progress(target, {}, null) }), PUBLISHED_AT), true);
  }
  assert.equal(validAgent(agent('one', { band: 'retired', progress: progress() }), PUBLISHED_AT), false);
});

test('a ring reflects current prerequisites, never time, training attempts or another version’s money', () => {
  const p = progress('candidate', { validation_run: 1, validation_trades: 50, validation_days: 30 });
  const row = agent('one', { progress: p });
  const board = swarmCheckpoint({ agents: [row] });
  const shown = agentProgress(row, board, at);
  assert.equal(shown.completed, 1);
  assert.equal(shown.count, '1 / 11 checks');
  assert.equal(shown.fraction, 2 / 11);
  assert.equal(shown.ready, false);
  const older = { ...row, born_at: '2020-01-01T00:00:00.000Z', record: { trials: 999999, revisions: 99999,
    forward: { trades: 999, wins: 999, pnl_usd: '999999' }, real: { trades: 999, wins: 999, pnl_usd: '999999' } } };
  assert.deepEqual(agentProgress(older, board, at), shown);
  assert.equal(agentProgress({ ...row, progress: undefined }, board, at), null);
  assert.equal(agentProgress(row, board, at + 16 * 60000), null);
  assert.equal(agentProgress({ ...row, band: 'retired' }, board, at), null);
  const all = Object.fromEntries(PROGRESS_CHECKS.probe.map(key => [key, 1]));
  const held = agent('candidate', { band: 'candidate', progress: progress('probe', { ...all, execution_ready: 0 }, 'real_money_off') });
  const heldView = agentProgress(held, board, at);
  assert.equal(heldView.fraction, 5 / 6);
  assert.equal(heldView.blocker, 'Live trading is off');
  assert.equal(heldView.ready, false);
  assert.equal(agentProgress({ ...held, progress: progress('probe', all, null) }, board, at).ready, true);
});

test('dot positions remain stable within a band as attempts, returns and prerequisite counts change', () => {
  const a = agent('alpha', { progress: progress() }), b = agent('beta', { progress: progress() });
  const ids = agents => agentStages(swarmCheckpoint({ agents })).at(-1).agents.map(row => row.id);
  assert.deepEqual(ids([b, a]), ['alpha', 'beta']);
  b.record.trials = 99999; a.record.trials = 1;
  b.progress.checks[0].done = 1;
  assert.deepEqual(ids([b, a]), ['alpha', 'beta']);
});

test('published progress reaches the dot and click details without changing the thought-first page', async () => {
  const { capital } = floor();
  const row = agent('one', { progress: progress('candidate', { validation_run: 1, validation_trades: 36, validation_days: 22 }) });
  assert.equal((await post(capital, '/api/capital/checkpoint', swarmCheckpoint({ agents: [row], structures: [] }))).status, 200);
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    const feed = await startCapital(root);
    const board = root.querySelector('#floor-agents');
    const dot = board.withClass('agent-dot')[0];
    assert.match(dot.getAttribute('aria-label'), /Meriwether.*1 \/ 11 checks.*Live shadow/);
    assert.equal(dot.find('circle').length, 2);
    assert.doesNotMatch(words(board), /Validation trades/);
    dot.click();
    const detail = board.querySelector('#agent-detail');
    assert.match(words(detail), /Next · Live shadow 1 \/ 11 checks/);
    assert.match(words(detail), /Validation trades 36 \/ 100/);
    assert.match(words(detail), /Trading days 22 \/ 60/);
    assert.match(words(detail), /Validation needs improvement/);
    assert.equal(detail.withClass('progress-check').length, 11);
    feed.stop();
  });
});

test('activity cues require a fresh agent publication and never use balances or stale history', () => {
  assert.equal(freshAgentActivity(note('one', 'Working.', PUBLISHED_AT), at), 'one');
  assert.equal(freshAgentActivity(news('moves to Candidate.', PUBLISHED_AT, 'one'), at), 'one');
  assert.equal(freshAgentActivity(news('A tournament finished.', PUBLISHED_AT), at), null);
  assert.equal(freshAgentActivity(note('one', 'Working.', PUBLISHED_AT), at + 121000), null);
  assert.equal(freshAgentActivity(note('one', 'Working.', PUBLISHED_AT), at - 61000), null);
  assert.equal(freshAgentActivity({ kind: 'account.mark', at: PUBLISHED_AT }, at), null);
});
