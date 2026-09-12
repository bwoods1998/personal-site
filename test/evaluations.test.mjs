import test from 'node:test';
import assert from 'node:assert/strict';
import { validEvaluations, passRate, estimate, renderEvaluations } from '../portfolio/evaluations.js';
import { projectEvaluations } from '../scripts/publish-evaluations.mjs';

const model = 'deepseek-ai/DeepSeek-V4-Pro-0813';
const critic = 'moonshotai/Kimi-K3';
const cost = (known = '0.008', unknown = 0) => ({ estimated_known_usd: known, unknown_cost_runs: unknown, cost_complete: unknown === 0 });
function report(paired = false) {
  const baseline = { model, executor_model: model, condition: 'baseline', finalized_cases: 4, metrics: { cases: 4, passed: 3 }, cost: cost() };
  const campaign = { schema_version: 1, campaign: '12345678-1234-1234-1234-123456789abc', created_at: '2026-09-12T20:00:00Z', finished: true, planned_calls: paired ? 8 : 4,
    benchmark: { cases_sha256: 'a'.repeat(64), prompts_sha256: 'b'.repeat(64) },
    conditions: [baseline], comparisons: [], cases: [{ case: 'case-a' }, { case: 'case-b' }] };
  if (paired) {
    campaign.conditions.push({ model, executor_model: critic, condition: 'critic', finalized_cases: 4, metrics: { cases: 4, passed: 4 }, cost: cost('0.12') });
    campaign.comparisons.push({ model, critic_model: critic, scheduled_pairs: 4, finalized_pairs: 4, before: { cases: 4, passed: 3 }, after: { cases: 4, passed: 4 }, extra_cost: cost('0.12') });
  }
  return { schema_version: 1, campaigns: [campaign] };
}
const project = value => projectEvaluations(value, '2026-09-12T23:00:00Z');

test('projection keeps unpaired models and paired critics separate', () => {
  const source = report();
  const comparison = report(true).campaigns[0]; comparison.campaign = '22345678-1234-1234-1234-123456789abc';
  source.campaigns.push(comparison);
  const data = project(source);
  assert.equal(validEvaluations(data), true);
  assert.equal(data.campaigns.length, 2);
  assert.deepEqual(data.campaigns[0].paired, []);
  assert.equal(data.campaigns[1].paired[0].before_passed, 3);
  assert.equal(data.campaigns[1].paired[0].after_passed, 4);
  assert.equal(data.campaigns[1].paired[0].extra_estimated_known_usd, '0.12');
});

test('source prose, responses and private fields cannot reach the public projection', () => {
  const source = report(true);
  source.secret = 'PRIVATE_SENTINEL'; source.benchmark = 'PRIVATE_SENTINEL';
  source.campaigns[0].raw_response = { text: 'PRIVATE_SENTINEL' };
  source.campaigns[0].conditions[0].cost.private = 'PRIVATE_SENTINEL';
  source.campaigns[0].cases[0].reason = 'PRIVATE_SENTINEL';
  assert.equal(JSON.stringify(project(source)).includes('PRIVATE_SENTINEL'), false);
});

test('strict public boundaries reject added fields, unknown model identities, inconsistent counts and costs', () => {
  for (const mutate of [
    d => { d.private = 'hidden'; },
    d => { d.campaigns[0].private = 'hidden'; },
    d => { d.campaigns[0].baseline[0].raw_response = 'hidden'; },
    d => { d.campaigns[0].paired[0].reason = 'hidden'; },
    d => { d.campaigns[0].baseline[0].model = '<script>alert(1)</script>'; },
    d => { d.campaigns[0].baseline[0].finalized = 3; },
    d => { d.campaigns[0].paired[0].before_passed = 5; },
    d => { d.campaigns[0].paired[0].finalized_pairs = 5; },
    d => { d.campaigns[0].paired[0].scheduled_pairs = 3; },
    d => { d.campaigns[0].baseline[0].estimated_known_usd = 'NaN'; },
    d => { d.campaigns[0].baseline[0].unknown_cost_runs = 5; },
    d => { d.campaigns[0].planned_calls = 96; },
    d => { d.campaigns[0].cases_sha256 = 'secret'; },
    d => { d.campaigns[0].created_at = '2026-09-13T00:00:00Z'; },
  ]) {
    const data = project(report(true)); mutate(data);
    assert.equal(validEvaluations(data), false);
  }
});

test('pending trials and unresolved costs remain explicit', () => {
  const source = report(true); const campaign = source.campaigns[0]; campaign.finished = false;
  campaign.conditions[0].finalized_cases = 2; campaign.conditions[0].metrics.passed = 2;
  campaign.comparisons[0].finalized_pairs = 1;
  campaign.comparisons[0].before = { cases: 1, passed: 1 }; campaign.comparisons[0].after = { cases: 1, passed: 0 };
  campaign.comparisons[0].extra_cost = cost('0.01', 2);
  const result = project(source);
  assert.equal(validEvaluations(result), true);
  assert.equal(result.campaigns[0].paired[0].finalized_pairs, 1);
  assert.equal(estimate('0.01', 2), '≥$0.01');
  assert.equal(estimate('0', 2), 'Pending');
  assert.equal(estimate('0.008', 0), '$0.0080');
  assert.equal(passRate(0, 0), '—');
  assert.equal(passRate(3, 4), '75%');
  assert.equal(passRate(5, 4), '—');
});

test('inconsistent upstream pairings fail before publication', () => {
  for (const mutate of [
    c => { c.comparisons[0].after.cases = 2; },
    c => { c.conditions[1].executor_model = model; },
    c => { c.comparisons = []; },
    c => { c.conditions[0].cost.cost_complete = false; },
    c => { c.conditions[0].condition = 'unknown'; },
    c => { c.conditions[0].executor_model = critic; },
    c => { c.conditions[0].metrics.passed = 5; },
  ]) {
    const source = report(true); mutate(source.campaigns[0]);
    assert.throws(() => project(source), TypeError);
  }
});

test('optional empty publication is valid and renderer rejects malformed input before accessing DOM', () => {
  assert.equal(validEvaluations({ schema_version: 1, published_at: '2026-09-12T23:00:00Z', campaigns: [] }), true);
  assert.throws(() => renderEvaluations({ schema_version: 2 }, null), TypeError);
});

test('rendered scores use the stated denominator and distinguish pending work', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    text() { return this.textContent + this.children.map(child => child.text()).join(' '); }
    all(tag) { return [ ...(this.tagName === tag ? [this] : []), ...this.children.flatMap(child => child.all(tag)) ]; }
  }
  const source = report(); const campaign = source.campaigns[0];
  campaign.finished = false; campaign.conditions[0].finalized_cases = 1; campaign.conditions[0].metrics.passed = 1;
  campaign.conditions[0].cost = cost('0', 3);
  const second = report(true).campaigns[0]; second.campaign = '22345678-1234-1234-1234-123456789abc'; second.finished = false;
  second.comparisons[0].finalized_pairs = 2;
  second.comparisons[0].before = { cases: 2, passed: 1 }; second.comparisons[0].after = { cases: 2, passed: 2 };
  source.campaigns.push(second);
  const original = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  try {
    const target = new Element('div'); renderEvaluations(project(source), target);
    const grids = target.all('table');
    assert.equal(grids.length, 2);
    assert.deepEqual(grids[0].all('td').map(cell => cell.text()), ['1/4', 'Pending', 'Pending']);
    assert.deepEqual(grids[1].all('td').map(cell => cell.text()), ['2/4', '50%', '100%', '$0.12']);
    assert.match(target.text(), /In progress/);
    assert.equal(target.all('details').length, 2);
    assert.equal(target.all('caption').length, 2);
    assert.equal(target.all('div').filter(element => element.attributes.role === 'region').length, 2);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
