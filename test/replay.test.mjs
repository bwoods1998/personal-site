import test from 'node:test';
import assert from 'node:assert/strict';
import { projectReplay } from '../scripts/publish-replay.mjs';
import { validReplay, eventState, displayValue, mountReplay } from '../portfolio/replay.js';
const model = 'deepseek-ai/DeepSeek-V4-Pro-0813';
const fields = ['cash_proxy', 'cash_proxy_change', 'commitment_outlook', 'capex_driver', 'ai_return'];
const costs = { known_estimated_usd: '0.003', unknown_usage_runs: 0 };
const project = source => projectReplay(source, '2026-09-13T04:00:00Z');
function fixture() {
  const id = 'cedar-correction';
  const events = [
    ['2026-07-01', 'statement-2025', 'admitted', 'statement', 'FY2025', null],
    ['2026-07-20', 'statement-2026', 'admitted', 'statement', 'FY2026', null],
    ['2026-07-21', 'statement-2026', 'duplicate', 'statement', 'FY2026', null],
    ['2026-07-22', 'future', 'future', 'guidance', 'FY2027', null],
    ['2026-07-25', 'guidance', 'admitted', 'guidance', 'FY2027', null],
    ['2026-08-01', 'unapproved', 'unapproved', 'guidance', 'FY2027', null],
    ['2026-08-15', 'correction', 'admitted', 'statement', 'FY2026', 'statement-2026'],
  ].map(([at, document, decision, kind, period, supersedes], event_index) => ({ at, event_index, document_id: `${id}-${document}`, decision, kind, period, supersedes: supersedes ? `${id}-${supersedes}` : null }));
  const steps = [0, 1, 4, 6].map((event_index, step) => {
    const values = { cash_proxy: ['40', '60', '60', '20'][step], cash_proxy_change: ['insufficient', 'rising', 'rising', 'falling'][step], commitment_outlook: step < 2 ? 'insufficient' : 'unchanged', capex_driver: step < 2 ? 'insufficient' : 'accounting', ai_return: 'insufficient' };
    const expected = { event_index, values, unit: 'USD millions', period: step === 0 ? 'FY2025' : 'FY2026' };
    const observed = Object.fromEntries(fields.map(field => [field, { value: values[field], evidence_ids: [] }]));
    Object.assign(observed.cash_proxy, { unit: expected.unit, period: expected.period });
    if (step === 3) observed.cash_proxy_change.value = 'rising';
    const grade = { format_correct: true, passed: step !== 3, fields: Object.fromEntries(fields.map(field => [field, { passed: step !== 3 || field !== 'cash_proxy_change' }])) };
    return { trajectory: id, model, policy: 'full_history', step, state: 'completed', as_of: events[event_index].at, expected, observed, grade };
  });
  return { schema_version: 1, synthetic: true, protocol_sha256: 'a'.repeat(64), finished: true, recovery: { state: 'verified' }, cost: costs,
    gates: { admitted: 4, blocked_or_duplicate: 3, paid_requests_for_blocked_events: 0, executed_per_path_counts: { admitted: 4, duplicate: 1, future: 1, unapproved: 1 } },
    conditions: [{ model, policy: 'full_history', planned_steps: 4, finalized_steps: 4, passed_steps: 3, admitted_request_payload_bytes: 10000, cost: costs }],
    trajectories: [{ id, events }], steps };
}

test('projection preserves typed mistakes, corrections and gate chronology without source prose', () => {
  const source = fixture(); source.raw_response = 'PRIVATE_SENTINEL'; source.trajectories[0].company = 'PRIVATE_SENTINEL'; source.trajectories[0].description = 'PRIVATE_SENTINEL'; source.trajectories[0].events[5].content = { attack: 'PRIVATE_SENTINEL' }; source.steps[0].observed.cash_proxy.evidence_ids = ['PRIVATE_SENTINEL'];
  const data = project(source); assert.equal(validReplay(data), true);
  assert.equal(JSON.stringify(data).includes('PRIVATE_SENTINEL'), false);
  const report = data.report;
  const duplicate = eventState(report, 'cedar-correction', model, 'full_history', 2);
  assert.equal(duplicate.carried, true); assert.equal(duplicate.event.decision, 'duplicate'); assert.equal(duplicate.step.event_index, 1);
  const future = eventState(report, 'cedar-correction', model, 'full_history', 3);
  assert.equal(future.step.event_index, 1);
  const correction = eventState(report, 'cedar-correction', model, 'full_history', 6);
  assert.equal(correction.step.expected.cash_proxy_change, 'falling'); assert.equal(correction.step.observed.cash_proxy_change, 'rising'); assert.equal(correction.step.checks.cash_proxy_change, false);
  assert.equal(displayValue(correction.step.expected, 'cash_proxy'), '$20m · FY2026');
  assert.equal(displayValue(correction.step.expected, 'ai_return'), 'Unknown');
  const unknownUnit = structuredClone(correction.step.observed); unknownUnit.cash_proxy.unit = 'unrecognized';
  assert.equal(displayValue(unknownUnit, 'cash_proxy'), '20 (unit?) · FY2026');
});

test('all public object boundaries reject extra private fields and impossible aggregate states', () => {
  for (const mutate of [
    d => { d.private = true; }, d => { d.synthetic = false; }, d => { d.report.raw = 'hidden'; },
    d => { d.report.cost.private = 'hidden'; }, d => { d.report.gates.private = 'hidden'; },
    d => { d.report.conditions[0].prompt = 'hidden'; }, d => { d.report.conditions[0].cost.private = 'hidden'; },
    d => { d.report.scenarios[0].description = 'hidden'; }, d => { d.report.scenarios[0].events[0].content = 'hidden'; },
    d => { d.report.scenarios[0].runs[0] = null; }, d => { d.report.scenarios[0].runs[0].raw = 'hidden'; }, d => { d.report.scenarios[0].runs[0].steps[0].raw = 'hidden'; },
    d => { d.report.scenarios[0].runs[0].steps[0].expected.raw = 'hidden'; }, d => { d.report.scenarios[0].runs[0].steps[0].observed.cash_proxy.raw = 'hidden'; },
    d => { d.report.scenarios[0].runs[0].steps[0].checks.raw = true; },
    d => { d.report.conditions[0].passed = 4; }, d => { d.report.conditions[0].finalized = 3; },
    d => { d.report.conditions[0].model = '<script>bad</script>'; }, d => { d.report.scenarios[0].id = 'unknown'; },
    d => { d.report.scenarios[0].runs[0].steps[3].observed.ai_return = 'do something unsafe'; },
    d => { d.report.scenarios[0].runs[0].steps[3].checks.passed = true; },
    d => { d.report.scenarios[0].events[6].supersedes = 'never-admitted'; },
    d => { d.report.scenarios[0].events[1].at = '2026-01-01'; },
    d => { d.report.scenarios[0].runs[0].steps[0].expected.cash_proxy.value = 'Infinity'; },
  ]) { const data = project(fixture()); mutate(data); assert.equal(validReplay(data), false); }
});

test('pending, failed and unknown usage cannot masquerade as successful observations', () => {
  const source = fixture(); source.finished = false;
  Object.assign(source.steps[3], { state: 'reserved', observed: null, grade: null });
  source.conditions[0].finalized_steps = 3; source.conditions[0].passed_steps = 3;
  source.conditions[0].cost = { known_estimated_usd: '0.002', unknown_usage_runs: 1 };
  source.cost = { ...source.conditions[0].cost };
  const data = project(source); assert.equal(validReplay(data), true);
  const pending = eventState(data.report, 'cedar-correction', model, 'full_history', 6);
  assert.equal(pending.step.observed, null); assert.equal(displayValue(null, 'cash_proxy'), 'Pending');
  data.report.finished = true; assert.equal(validReplay(data), false);
  const empty = { schema_version: 1, synthetic: true, published_at: '2026-09-13T04:00:00Z', report: null };
  assert.equal(validReplay(empty), true);
});

test('publisher rejects unrecognized paths, reordered updates and untyped model output', () => {
  for (const mutate of [
    s => { s.steps.push({ ...s.steps[0], trajectory: 'unknown' }); },
    s => { s.steps[1].step = 0; }, s => { s.steps[1].as_of = '2026-07-01'; },
    s => { s.steps[0].observed.cash_proxy.period = 'raw provider prose'; },
    s => { s.steps[0].observed.cash_proxy.unit = 'raw provider prose'; },
    s => { s.steps[0].observed.cash_proxy.value = 'secret-string'; },
    s => { s.steps[0].grade.fields.ai_return.passed = 'true'; },
  ]) { const source = fixture(); mutate(source); assert.throws(() => project(source), TypeError); }
});

test('interactive controls retain state at gated events and show the correction mismatch', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = ''; this.listeners = {}; }
    append(...children) { this.children.push(...children); } replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; } addEventListener(name, fn) { this.listeners[name] = fn; }
    click() { if (!this.disabled) this.listeners.click?.(); }
    text() { return this.textContent + this.children.map(child => child.text()).join(' '); }
    all(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(child => child.all(tag))]; }
  }
  const prior = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  try {
    const source = fixture();
    source.conditions.push({ ...source.conditions[0], policy: 'current_notebook' });
    source.cost = { known_estimated_usd: '0.006', unknown_usage_runs: 0 };
    source.steps.push(...source.steps.map(step => ({ ...step, policy: 'current_notebook' })));
    const target = new Element('div'); mountReplay(project(source), target);
    const [back, next] = target.all('button'); assert.equal(back.disabled, true); assert.equal(next.disabled, false);
    next.click(); next.click(); assert.match(target.text(), /Duplicate · skipped/); assert.match(target.text(), /prior state retained/);
    next.click(); assert.match(target.text(), /Future · blocked/);
    next.click(); next.click(); assert.match(target.text(), /Unapproved · blocked/);
    next.click(); assert.match(target.text(), /Correction accepted/); assert.equal(next.disabled, true);
    assert.match(target.text(), /Falling/); assert.match(target.text(), /Rising×/);
    assert.equal(target.all('select').length, 3); assert.equal(target.all('details').length, 1);
    const memory = target.all('select')[2]; memory.value = 'current_notebook'; memory.listeners.change();
    assert.match(target.text(), /7 \/ 7/); assert.match(target.text(), /Notebook: 3\/4/);
    assert.match(target.text(), /Correction accepted/);
    back.click(); assert.match(target.text(), /Unapproved · blocked/);
    assert.throws(() => mountReplay({ schema_version: 9 }, target), TypeError);
  } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
});


test('semantic publication invariants reject contradictory money, gates, dates and passing states', () => {
  for (const mutate of [
    d => { d.report.cost.known_estimated_usd = '0.004'; },
    d => { d.report.cost.unknown_usage_runs = 1; },
    d => { d.report.gates.paid_for_blocked = 1; },
    d => { d.report.gates.executed_admitted = 5; },
    d => { d.report.gates.executed_blocked = 4; },
    d => { d.report.scenarios[0].events[0].at = '2026-02-30'; },
    d => { d.report.scenarios[0].runs[0].steps[0].observed.cash_proxy.value = '999'; },
    d => { d.report.scenarios[0].runs[0].steps[0].observed.cash_proxy.unit = 'USD billions'; },
    d => { d.report.scenarios[0].runs[0].steps[0].observed.cash_proxy.period = 'FY2026'; },
    d => { d.report.scenarios[0].runs[0].steps[0].observed.ai_return = 'supported'; },
    d => { d.report.scenarios[0].runs[0].steps[0].state = 'failed'; },
    d => { d.report.scenarios[0].runs[0].steps[0].state = 'invalid'; },
    d => {
      const s=d.report.scenarios[0].runs[0].steps[0]; s.observed=null;
      for(const k of Object.keys(s.checks)) s.checks[k]=false;
      d.report.conditions[0].passed--;
    },
  ]) { const data=project(fixture()); mutate(data); assert.equal(validReplay(data),false); }
  const equivalent=project(fixture());
  equivalent.report.scenarios[0].runs[0].steps[0].observed.cash_proxy.value='40.0000';
  assert.equal(validReplay(equivalent),true);
  const citationFailure=project(fixture());
  citationFailure.report.scenarios[0].runs[0].steps[0].checks.ai_return=false;
  citationFailure.report.scenarios[0].runs[0].steps[0].checks.passed=false;
  citationFailure.report.conditions[0].passed--;
  assert.equal(validReplay(citationFailure),true);
});
