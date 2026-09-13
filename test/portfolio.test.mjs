import test from 'node:test';
import assert from 'node:assert/strict';
import { validSnapshot, safeSourceUrl, formatFact, formatCost, formatCostSummary, formatResearch } from '../portfolio/portfolio.js';

// Test-only examples: never copied into the public site by the build.
function fixture() {
  return {
    schema_version: 1,
    published_at: '2026-09-12T18:00:00Z',
    project: { name: 'Portfolio Agent', repository: 'https://github.com/bwoods1998/portfolio-agent', mode: 'research' },
    portfolio: { status: 'not_connected' },
    costs: { estimated_usd: '0.00011808', billed_usd: null, completed_runs: 1, unknown_runs: 0, reserved_usd: '0.05' },
    thesis: {
      id: 'test-thesis', question: 'Can investment become cash flow?', company: 'Example', symbol: 'EXAMPLE',
      revisions: [{
        id: 'first', parent_id: null, created_at: '2026-09-12T17:00:00Z',
        evidence_as_of: '2026-07-29', headline: 'An initial question', summary: 'A test research thesis.',
        stance: 'watch', assumptions: ['Demand persists.'], invalidation: ['Margins deteriorate.'],
        open_questions: ['What changes next quarter?'], next_review: 'Next filing', changes: ['First thesis.'],
        sources: [{ id: 'source', title: 'Example source', url: 'https://example.com/report', published_at: '2026-07-29' }],
        facts: [{ id: 'cash', label: 'Cash flow', value: 2500, unit: 'USD millions', period: 'FY2026', source_id: 'source' }],
        context: [{ id: 'note', text: 'Definition of cash flow.', source_id: 'source' }],
        claims: [{ text: 'Cash flow was positive.', evidence_ids: ['cash', 'note'] }],
        reviewed_at: '2026-09-12T17:30:00Z', reviewer: 'Test reviewer',
        research: { model: 'deepseek-ai/DeepSeek-V4-Pro-0813', completion_window: 'flex', reasoning_effort: 'medium' },
      }],
    },
  };
}

test('publication validates source lineage, review metadata, and chronological versions', () => {
  assert.equal(validSnapshot(fixture()), true);
  for (const mutate of [
    data => { data.thesis.revisions[0].claims[0].evidence_ids.push('missing'); },
    data => { data.thesis.revisions[0].facts[0].source_id = 'missing'; },
    data => { data.thesis.revisions[0].reviewed_at = null; },
    data => { data.thesis.revisions[0].parent_id = 'missing'; },
    data => { data.thesis.revisions[0].facts[0].value = Infinity; },
    data => { data.thesis.revisions[0].sources[0].url = 'javascript:alert(1)'; },
    data => { data.thesis.revisions.push(structuredClone(data.thesis.revisions[0])); },
    data => { data.portfolio.status = 'connected'; },
  ]) {
    const data = fixture();
    mutate(data);
    assert.equal(validSnapshot(data), false);
  }
  const data = fixture();
  const second = structuredClone(data.thesis.revisions[0]);
  second.id = 'second'; second.parent_id = 'first'; second.created_at = '2026-09-13T17:00:00Z';
  data.thesis.revisions.push(second);
  assert.equal(validSnapshot(data), true);
  second.created_at = '2026-09-11T17:00:00Z';
  assert.equal(validSnapshot(data), false);
});

test('no approved revisions and unknown cost are honest supported states', () => {
  const data = fixture();
  data.thesis.revisions = [];
  data.costs = { estimated_usd: null, billed_usd: null, completed_runs: 0, unknown_runs: 1, reserved_usd: '0.05' };
  assert.equal(validSnapshot(data), true);
  assert.equal(formatCost(null), 'Estimate unavailable');
  assert.equal(formatCost(undefined), 'Estimate unavailable');
  assert.equal(formatCost('0.00011808'), '$0.000118 est.');
  assert.equal(formatCost('0.0000001'), '<$0.000001 est.');
  assert.equal(formatCost('1e3'), 'Estimate unavailable');
  assert.equal(formatCost('-1'), 'Estimate unavailable');
  assert.equal(formatCost('0'), '$0.00 est.');
});

test('known estimates remain visible without turning unknown usage into a total', () => {
  const data = fixture();
  data.costs.known_estimated_usd = '0.000118080';
  assert.equal(validSnapshot(data), true);
  assert.equal(formatCostSummary(data.costs), 'Inference · $0.000118 est.');
  data.costs.unknown_runs = 1;
  data.costs.estimated_usd = null;
  assert.equal(validSnapshot(data), true);
  assert.equal(formatCostSummary(data.costs), 'Inference · $0.000118 known · 1 unconfirmed');
  data.costs.known_estimated_usd = '0';
  data.costs.unknown_runs = 2;
  assert.equal(validSnapshot(data), true);
  assert.equal(formatCostSummary(data.costs), 'Inference · $0.00 known · 2 unconfirmed');
  delete data.costs.known_estimated_usd;
  assert.equal(validSnapshot(data), true);
  assert.equal(formatCostSummary(data.costs), 'Inference · Estimate unavailable · 2 unconfirmed');
});

test('the additive known-cost schema checks exact decimals, completeness and reservation bounds', () => {
  for (const costs of [
    { known_estimated_usd: '0.0001180800000000001' },
    { known_estimated_usd: '0.00011808', estimated_usd: null },
    { known_estimated_usd: '0.0500000000000000001', estimated_usd: null, unknown_runs: 1 },
    { known_estimated_usd: '-0.01' },
    { known_estimated_usd: '1e-3' },
    { known_estimated_usd: 0.001 },
    { known_estimated_usd: null },
    { known_estimated_usd: '0.00011808', private_cost_note: 'private' },
    { estimated_usd: '0.0500000000000000001' },
  ]) {
    const data = fixture();
    Object.assign(data.costs, costs);
    assert.equal(validSnapshot(data), false, JSON.stringify(costs));
  }
  const data = fixture();
  Object.assign(data.costs, { known_estimated_usd: '0.05', estimated_usd: null, unknown_runs: 1 });
  assert.equal(validSnapshot(data), true);
  data.costs.estimated_usd = '0.05';
  assert.equal(validSnapshot(data), false);
});

test('private or unexpected fields fail publication at every object boundary', () => {
  const targets = [
    data => data,
    data => data.project,
    data => data.portfolio,
    data => data.costs,
    data => data.thesis,
    data => data.thesis.revisions[0],
    data => data.thesis.revisions[0].sources[0],
    data => data.thesis.revisions[0].facts[0],
    data => data.thesis.revisions[0].context[0],
    data => data.thesis.revisions[0].claims[0],
    data => data.thesis.revisions[0].research,
  ];
  for (const target of targets) {
    const data = fixture();
    target(data).private_note = 'Must never be published';
    assert.equal(validSnapshot(data), false);
  }
  const missing = fixture();
  delete missing.costs.billed_usd;
  assert.equal(validSnapshot(missing), false);
});

test('research provenance uses the selected revision and preserves unknown model names', () => {
  const research = fixture().thesis.revisions[0].research;
  assert.equal(formatResearch(research), 'DeepSeek V4 Pro · Flex · Medium reasoning');
  assert.equal(formatResearch({ model: 'zai-org/GLM-5.3', completion_window: 'balanced', reasoning_effort: 'low' }), 'GLM 5.3 · Balanced · Low reasoning');
  assert.equal(formatResearch({ model: 'future/model-v2', completion_window: 'asap', reasoning_effort: 'high' }), 'future/model-v2 · ASAP · High reasoning');
  for (const key of ['model', 'completion_window', 'reasoning_effort']) {
    const data = fixture();
    data.thesis.revisions[0].research[key] = '';
    assert.equal(validSnapshot(data), false);
    delete data.thesis.revisions[0].research[key];
    assert.equal(validSnapshot(data), false);
  }
});

test('unconfirmed usage cannot become a total estimate or a reconciled bill', () => {
  for (const costs of [
    { unknown_runs: 1, estimated_usd: '0.01' },
    { billed_usd: '0.01' },
    { reserved_usd: '-0.05' },
    { reserved_usd: '1e2' },
    { reserved_usd: 0.05 },
    { unknown_runs: -1 },
    { completed_runs: 1.5 },
  ]) {
    const data = fixture();
    Object.assign(data.costs, costs);
    assert.equal(validSnapshot(data), false);
  }
});

test('source navigation cannot introduce active URL schemes or credentials', () => {
  assert.equal(safeSourceUrl('https://example.com/report#cash'), 'https://example.com/report#cash');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', '//example.com', '/api/trade', 'https://name:secret@example.com', 'http://example.com', null]) assert.equal(safeSourceUrl(value), null);
});

test('financial figures retain their unit, scale, and sign', () => {
  assert.equal(formatFact(2500, 'USD millions'), '$2.5B');
  assert.equal(formatFact(-1234, 'USD millions'), '−$1.2B');
  assert.equal(formatFact(999, 'USD millions'), '$999M');
  assert.equal(formatFact(0, 'USD millions'), '$0M');
  assert.equal(formatFact(2500, 'USD'), '—');
});
