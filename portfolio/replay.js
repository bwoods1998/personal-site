const exact = (v, names) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 1000000;
const decimal = v => typeof v === 'string' && /^-?\d{1,15}(?:\.\d{1,8})?$/.test(v);
const money = v => typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,16})?$/.test(v) && Number.isFinite(Number(v));
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const moment = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const identifier = v => typeof v === 'string' && /^[a-z][a-z0-9-]{1,79}$/.test(v);
export const models = { 'deepseek-ai/DeepSeek-V4-Pro-0813': 'DeepSeek Pro', 'deepseek-ai/DeepSeek-V4-Flash-0731': 'DeepSeek Flash' };
export const policies = { full_history: 'Full history', current_notebook: 'Notebook' };
export const scenarios = { 'cedar-correction': 'Cedar · Cash correction', 'harbor-cut': 'Harbor · Outlook cut', 'mesa-withdrawal': 'Mesa · Guidance withdrawn' };
const fields = ['cash_proxy', 'cash_proxy_change', 'commitment_outlook', 'capex_driver', 'ai_return'];
const enums = { cash_proxy_change: ['rising', 'falling', 'flat', 'insufficient'], commitment_outlook: ['raised', 'cut', 'unchanged', 'insufficient'], capex_driver: ['accounting', 'investment', 'mixed', 'insufficient'], ai_return: ['supported', 'refuted', 'insufficient'] };
const fieldLabels = ['Cash after PP&E', 'Cash trend', 'Planned investment', 'Capex driver', 'AI-only return'];
const finalStates = ['completed', 'invalid', 'failed'];
const conditionKey = v => `${v?.model}:${v?.policy}`;
const validCost = v => exact(v, ['known_estimated_usd', 'unknown_usage_runs']) && money(v.known_estimated_usd) && count(v.unknown_usage_runs);
const scaledDecimal = (value, scale) => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return (negative ? -1n : 1n) * BigInt(whole + fraction.padEnd(scale, '0'));
};
const validView = v => exact(v, fields) && exact(v.cash_proxy, ['value', 'unit', 'period']) && decimal(v.cash_proxy.value) && ['USD millions', 'USD billions', 'USD', 'unrecognized'].includes(v.cash_proxy.unit) && (v.cash_proxy.period === 'unrecognized' || /^FY\d{4}$/.test(v.cash_proxy.period)) && fields.slice(1).every(k => enums[k].includes(v[k]));

export function validReplay(data) {
  if (!exact(data, ['schema_version', 'synthetic', 'published_at', 'report']) || data.schema_version !== 1 || data.synthetic !== true || !moment(data.published_at)) return false;
  const r = data.report; if (r === null) return true;
  if (!exact(r, ['protocol_sha256', 'finished', 'recovery', 'gates', 'cost', 'conditions', 'scenarios']) || !/^[a-f0-9]{64}$/.test(r.protocol_sha256) || typeof r.finished !== 'boolean' || !['not_observed', 'awaiting_fresh_process', 'verified'].includes(r.recovery) || !validCost(r.cost) || !exact(r.gates, ['admitted', 'blocked', 'paid_for_blocked', 'executed_admitted', 'executed_blocked']) || !Object.values(r.gates).every(count) || r.gates.paid_for_blocked !== 0 || !Array.isArray(r.conditions) || !r.conditions.length || r.conditions.length > 4 || !Array.isArray(r.scenarios) || !r.scenarios.length || r.scenarios.length > 3) return false;
  const conditions = new Set();
  for (const c of r.conditions) {
    if (!exact(c, ['model', 'policy', 'planned', 'finalized', 'passed', 'input_bytes', 'cost']) || !Object.hasOwn(models, c.model) || !Object.hasOwn(policies, c.policy) || conditions.has(conditionKey(c)) || !['planned', 'finalized', 'passed', 'input_bytes'].every(k => count(c[k])) || c.planned < 1 || c.finalized > c.planned || c.passed > c.finalized || !validCost(c.cost) || c.cost.unknown_usage_runs > c.planned || (r.finished && c.finalized !== c.planned)) return false;
    conditions.add(conditionKey(c));
  }
  const ids = new Set(); let admitted = 0, blocked = 0;
  const totals = new Map([...conditions].map(k => [k, { planned: 0, finalized: 0, passed: 0 }]));
  for (const scenario of r.scenarios) {
    if (!exact(scenario, ['id', 'events', 'runs']) || !Object.hasOwn(scenarios, scenario.id) || ids.has(scenario.id) || !Array.isArray(scenario.events) || !scenario.events.length || scenario.events.length > 12 || !Array.isArray(scenario.runs) || scenario.runs.length !== conditions.size) return false;
    ids.add(scenario.id); const accepted = []; let previousDate = ''; const active = new Set();
    for (const [index, e] of scenario.events.entries()) {
      if (!exact(e, ['at', 'document_id', 'decision', 'kind', 'period', 'supersedes']) || !day(e.at) || e.at < previousDate || !identifier(e.document_id) || !e.document_id.startsWith(scenario.id + '-') || !['admitted', 'duplicate', 'future', 'unapproved'].includes(e.decision) || !['statement', 'guidance', 'withdrawal'].includes(e.kind) || !/^FY\d{4}$/.test(e.period) || !(e.supersedes === null || identifier(e.supersedes))) return false;
      previousDate = e.at;
      if (e.decision === 'admitted') {
        if (active.has(e.document_id) || (e.supersedes !== null && !active.has(e.supersedes))) return false;
        if (e.supersedes !== null) active.delete(e.supersedes);
        active.add(e.document_id); accepted.push(index); admitted++;
      } else { if (e.decision === 'duplicate' && !active.has(e.document_id)) return false; blocked++; }
    }
    const runs = new Set();
    for (const run of scenario.runs) {
      const key = conditionKey(run);
      if (!exact(run, ['model', 'policy', 'steps']) || !conditions.has(key) || runs.has(key) || !Array.isArray(run.steps) || run.steps.length !== accepted.length) return false;
      runs.add(key);
      for (const [i, step] of run.steps.entries()) {
        if (!exact(step, ['event_index', 'state', 'expected', 'observed', 'checks']) || step.event_index !== accepted[i] || !['pending', 'reserved', 'running', 'waiting', 'unknown', ...finalStates].includes(step.state) || !validView(step.expected) || step.expected.cash_proxy.unit !== 'USD millions' || !/^FY\d{4}$/.test(step.expected.cash_proxy.period) || !(step.observed === null || validView(step.observed)) || !(step.checks === null || (exact(step.checks, ['format', 'passed', ...fields]) && Object.values(step.checks).every(v => typeof v === 'boolean')))) return false;
        const isFinal = finalStates.includes(step.state);
        if ((step.checks && step.checks.passed !== (step.checks.format && fields.every(k => step.checks[k]))) || isFinal !== (step.checks !== null) || (step.checks?.passed && (step.observed === null || !step.checks.format || !fields.every(k => step.checks[k]))) || (step.observed !== null && !isFinal) || (r.finished && !isFinal)) return false;
        if (step.state === 'completed' && (step.observed === null || !step.checks.format)) return false;
        if (['invalid', 'failed'].includes(step.state) && (step.observed !== null || step.checks.format)) return false;
        if (step.checks) {
          for (const field of fields) {
            if (!step.checks[field]) continue;
            if (!step.observed || !step.checks.format) return false;
            if (field === 'cash_proxy') {
              const expected = step.expected.cash_proxy, observed = step.observed.cash_proxy;
              if (scaledDecimal(expected.value, 8) !== scaledDecimal(observed.value, 8) || expected.unit !== observed.unit || expected.period !== observed.period) return false;
            } else if (step.expected[field] !== step.observed[field]) return false;
          }
        }
        const total = totals.get(key); total.planned++; total.finalized += Number(isFinal); total.passed += Number(step.checks?.passed === true);
      }
    }
  }
  if (admitted !== r.gates.admitted || blocked !== r.gates.blocked || r.gates.executed_admitted > admitted * conditions.size || r.gates.executed_blocked > blocked * conditions.size) return false;
  if (r.conditions.reduce((sum, c) => sum + scaledDecimal(c.cost.known_estimated_usd, 16), 0n) !== scaledDecimal(r.cost.known_estimated_usd, 16) || r.conditions.reduce((sum, c) => sum + c.cost.unknown_usage_runs, 0) !== r.cost.unknown_usage_runs) return false;
  return r.conditions.every(c => ['planned', 'finalized', 'passed'].every(k => c[k] === totals.get(conditionKey(c))[k]));
}

export function eventState(report, scenarioId, model, policy, eventIndex) {
  const scenario = report.scenarios.find(s => s.id === scenarioId);
  const run = scenario?.runs.find(r => r.model === model && r.policy === policy);
  if (!scenario || !run || !count(eventIndex) || eventIndex >= scenario.events.length) return null;
  const step = run.steps.filter(s => s.event_index <= eventIndex).at(-1) || null;
  return { event: scenario.events[eventIndex], step, carried: step !== null && step.event_index !== eventIndex };
}

export function displayValue(view, field) {
  if (!view) return 'Pending';
  if (field !== 'cash_proxy') return view[field] === 'insufficient' ? 'Unknown' : view[field][0].toUpperCase() + view[field].slice(1);
  const cash = view.cash_proxy; const negative = cash.value.startsWith('-');
  const amount = `${negative ? '−' : ''}${cash.unit === 'unrecognized' ? '' : '$'}${negative ? cash.value.slice(1) : cash.value}${{ 'USD millions': 'm', 'USD billions': 'b', USD: '', unrecognized: ' (unit?)' }[cash.unit]}`;
  return `${amount} · ${cash.period}`;
}

function node(tag, content, className) { const e = document.createElement(tag); if (content !== undefined) e.textContent = String(content); if (className) e.className = className; return e; }
function estimated(cost) { return cost.unknown_usage_runs && Number(cost.known_estimated_usd) === 0 ? 'Pending cost' : `${cost.unknown_usage_runs ? '≥' : ''}$${Number(cost.known_estimated_usd).toFixed(Number(cost.known_estimated_usd) < 0.01 ? 4 : 2)} est.`; }

export function mountReplay(data, target) {
  if (!validReplay(data)) throw new TypeError('Invalid synthetic replay publication');
  target.replaceChildren(); if (!data.report) return;
  const report = data.report; let scenarioId = report.scenarios[0].id; let model = report.conditions[0].model; let policy = report.conditions[0].policy; let eventIndex = 0;
  const selectors = node('div', undefined, 'replay-selectors');
  const select = (name, options, selected, change) => {
    const label = node('label', name); const control = node('select'); control.setAttribute('aria-label', name);
    for (const [value, text] of options) { const option = node('option', text); option.value = value; control.append(option); }
    control.value = selected; control.addEventListener('change', () => change(control.value)); label.append(control); selectors.append(label); return control;
  };
  select('Scenario', report.scenarios.map(s => [s.id, scenarios[s.id]]), scenarioId, v => { scenarioId = v; eventIndex = 0; draw(); });
  const modelSelect = select('Model', [...new Set(report.conditions.map(c => c.model))].map(id => [id, models[id]]), model, v => {
    model = v;
    if (!report.conditions.some(c => c.model === model && c.policy === policy)) policy = report.conditions.find(c => c.model === model).policy;
    policySelect.value = policy; draw();
  });
  const policySelect = select('Memory', [...new Set(report.conditions.map(c => c.policy))].map(id => [id, policies[id]]), policy, v => {
    policy = v;
    if (!report.conditions.some(c => c.model === model && c.policy === policy)) model = report.conditions.find(c => c.policy === policy).model;
    modelSelect.value = model; draw();
  });
  const panel = node('div', undefined, 'replay-panel');
  const controls = node('div', undefined, 'replay-controls');
  const previous = node('button', '← Previous'); previous.type = 'button';
  const progress = node('span'); progress.setAttribute('aria-live', 'polite'); progress.setAttribute('aria-atomic', 'true');
  const next = node('button', 'Next →'); next.type = 'button';
  previous.addEventListener('click', () => { if (eventIndex > 0) { eventIndex--; draw(); } });
  next.addEventListener('click', () => { if (eventIndex + 1 < report.scenarios.find(s => s.id === scenarioId).events.length) { eventIndex++; draw(); } });
  controls.append(previous, progress, next);
  const notes = node('details', undefined, 'replay-method'); notes.append(node('summary', 'Rules & measurements'));
  const measurement = node('p'); notes.append(measurement);
  notes.append(node('p', 'Fictional disclosures, real model responses. Expected states are authored test answers. A passing field checks its value, units, period, and current evidence. Unknown means insufficient evidence; Pending means no validated answer yet.'));
  notes.append(node('p', 'Duplicate, future, and unapproved records are gated before inference. Corrections replace earlier evidence. The notebook combines retained evidence with the latest typed agent view. This tests a condensed replay, not months of autonomous research or resistance to malicious approved sources.'));
  notes.append(node('p', `${report.gates.blocked} blocked or duplicate events in the fixture; ${report.gates.executed_blocked} gate decisions observed across model paths. ${report.gates.paid_for_blocked} paid calls for blocked events. Process recovery: ${report.recovery === 'verified' ? 'verified' : report.recovery === 'awaiting_fresh_process' ? 'awaiting verification' : 'not observed'}.`));
  notes.append(node('code', `Protocol SHA256 ${report.protocol_sha256}`, 'source-hash'));
  target.append(selectors, panel, controls, notes);
  function draw() {
    const scenario = report.scenarios.find(s => s.id === scenarioId);
    const { event, step, carried } = eventState(report, scenarioId, model, policy, eventIndex);
    panel.replaceChildren();
    const heading = node('div', undefined, 'replay-event-heading');
    heading.append(node('time', event.at));
    const gateLabel = { admitted: event.supersedes ? 'Correction accepted' : 'Accepted', duplicate: 'Duplicate · skipped', future: 'Future · blocked', unapproved: 'Unapproved · blocked' }[event.decision];
    heading.append(node('span', gateLabel, event.decision === 'admitted' ? 'replay-gate admitted' : 'replay-gate')); panel.append(heading);
    const kind = event.kind === 'statement' ? 'Cash-flow statement' : event.kind === 'withdrawal' ? 'Guidance withdrawn' : 'Investment outlook';
    panel.append(node('h3', `${kind} · ${event.period}`));
    if (carried) panel.append(node('p', 'Gate rule: no model call; prior state retained.', 'replay-carried'));
    const grid = node('table', undefined, 'replay-values'); const caption = node('caption', 'Expected test state and observed model state', 'sr-only'); grid.append(caption);
    const header = node('tr'); for (const text of ['State', 'Expected', 'Observed']) { const th = node('th', text); th.scope = 'col'; header.append(th); } const thead = node('thead'); thead.append(header); grid.append(thead);
    const tbody = node('tbody');
    fields.forEach((field, i) => {
      const row = node('tr'); const name = node('th', fieldLabels[i]); name.scope = 'row';
      const observed = node('td', step?.checks && !step.observed ? 'Invalid' : displayValue(step?.observed, field));
      if (step?.checks) {
        const passed = step.checks[field]; const mark = node('span', passed ? '✓' : '×', passed ? 'replay-pass' : 'replay-miss');
        mark.setAttribute('aria-label', passed ? 'Field check passed' : 'Field check failed'); observed.append(mark);
      }
      row.append(name, node('td', displayValue(step?.expected, field)), observed); tbody.append(row);
    }); grid.append(tbody); panel.append(grid);
    progress.textContent = `${eventIndex + 1} / ${scenario.events.length}`; previous.disabled = eventIndex === 0; next.disabled = eventIndex === scenario.events.length - 1;
    const condition = report.conditions.find(c => c.model === model && c.policy === policy);
    measurement.textContent = `${models[model]} · ${policies[policy]}: ${condition.passed}/${condition.finalized} finalized updates passed across ${report.scenarios.length} scenarios; ${condition.planned} planned. ${estimated(condition.cost)} · ${(condition.input_bytes / 1024).toFixed(1)} KiB of user evidence payload across admitted requests. Costs are token estimates; payload size is not a token or latency measurement.`;
  }
  draw();
}

async function load() {
  try {
    const response = await fetch('./replay.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) }); if (!response.ok) return;
    const body = await response.text(); if (body.length > 500000) return; const data = JSON.parse(body);
    if (!validReplay(data) || !data.report) return;
    mountReplay(data, document.querySelector('#replay-content')); document.querySelector('#replay').hidden = false;
  } catch { /* Optional static replay cannot interrupt the research ledger. */ }
}
if (typeof document !== 'undefined') load();
