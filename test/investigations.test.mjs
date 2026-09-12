import test from 'node:test';
import assert from 'node:assert/strict';
import { validInvestigations, sourceUrl, cost, duration } from '../portfolio/investigations.js';

function fixture() {
  return { schema_version: 1, published_at: '2026-09-12T23:00:00Z', investigations: [{
    id: 'test-run', question: 'What does the reported measure establish?', mode: 'tools',
    created_at: '2026-09-12T20:00:00Z', completed_at: '2026-09-12T20:05:00Z',
    evidence_cutoff: '2026-09-12', model: 'test/analyst', critic_model: 'test/critic',
    result: { headline: 'Definitions matter', summary: 'A synthetic supported finding.',
      claims: [{ text: 'The measures have different scopes.', evidence_ids: ['test-passage'], source_ids: ['test-source'] }],
      changes: ['A definition was clarified.'], open_questions: ['Will future evidence reconcile the measures?'],
      invalidation: ['A full reconciliation could change the interpretation.'], change_assessment: 'qualified' },
    critique_summary: 'The evidence supports the limited conclusion.', reviewer: 'Test reviewer', reviewed_at: '2026-09-12T20:06:00Z',
    sources: [{ id: 'test-source', title: 'Synthetic source', url: 'https://example.com/evidence', published_at: '2026-07-29' }],
    steps: [{ at: '2026-09-12T20:00:00Z', kind: 'started', model: 'test/analyst', tools: [], verdict: null },
      { at: '2026-09-12T20:02:00Z', kind: 'memory_compacted', model: null, tools: [], verdict: null }],
    metrics: { tool_calls: 3, successful_tools: 3, source_count: 1, passage_count: 1, elapsed_seconds: 300,
      estimated_usd: '0.004', known_estimated_usd: '0.004', unknown_runs: 0, reserved_usd: '1.40', model_calls: 3 },
    source_versions: [{ source_id: 'test-source', sha256: 'a'.repeat(64), fetched_at: '2026-09-12T20:01:00Z' }],
  }] };
}

test('reviewed research validates citations, chronology and bounded metrics', () => {
  assert.equal(validInvestigations(fixture()), true);
  for (const mutate of [
    run => { run.result.claims[0].source_ids = ['missing']; },
    run => { run.sources[0].published_at = '2026-09-13'; },
    run => { run.sources[0].url = 'javascript:alert(1)'; },
    run => { run.source_versions[0].sha256 = 'changed'; },
    run => { run.reviewed_at = '2026-09-11'; },
    run => { run.metrics.successful_tools = 4; },
    run => { run.metrics.unknown_runs = 1; },
    run => { run.metrics.elapsed_seconds = Infinity; },
    run => { run.steps[1].at = '2026-09-11'; },
    run => { run.steps[1].tools = ['execute_shell']; },
  ]) {
    const data = fixture(); mutate(data.investigations[0]);
    assert.equal(validInvestigations(data), false);
  }
});

test('unexpected private fields fail every public object boundary', () => {
  for (const select of [data => data, data => data.investigations[0], data => data.investigations[0].result,
    data => data.investigations[0].result.claims[0], data => data.investigations[0].sources[0],
    data => data.investigations[0].steps[0], data => data.investigations[0].metrics,
    data => data.investigations[0].source_versions[0]]) {
    const data = fixture(); select(data).private_note = 'Do not publish';
    assert.equal(validInvestigations(data), false);
  }
});

test('an empty optional publication and unknown costs are honest states', () => {
  const data = fixture(); data.investigations = [];
  assert.equal(validInvestigations(data), true);
  const unknown = fixture(); unknown.investigations[0].metrics.unknown_runs = 1;
  unknown.investigations[0].metrics.estimated_usd = null;
  assert.equal(validInvestigations(unknown), true);
  assert.equal(cost(null), 'Pending'); assert.equal(cost('0.004'), '$0.0040');
  assert.equal(duration(125), '2m 5s');
  for (const url of ['http://example.com', 'https://user:secret@example.com', '//example.com', '/api/trade', 'data:text/html,test']) assert.equal(sourceUrl(url), null);
});
