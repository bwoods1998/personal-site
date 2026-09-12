const keys = (value, names) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key));
const text = (value, limit = 600) => typeof value === 'string' && value.length > 0 && value.length <= limit;
const date = value => text(value, 40) && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
const money = value => typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
const strings = value => Array.isArray(value) && value.length > 0 && value.length <= 6 && value.every(x => text(x));
const rowKeys = ['id', 'question', 'mode', 'created_at', 'completed_at', 'evidence_cutoff', 'model', 'critic_model', 'result', 'critique_summary', 'reviewer', 'reviewed_at', 'sources', 'steps', 'metrics', 'source_versions'];
const metricKeys = ['tool_calls', 'successful_tools', 'source_count', 'passage_count', 'elapsed_seconds', 'estimated_usd', 'known_estimated_usd', 'unknown_runs', 'reserved_usd', 'model_calls'];
const toolNames = { list_sources: 'List sources', read_source: 'Read source', get_evidence: 'Check facts', calculate: 'Calculate', save_hypothesis: 'Save hypothesis' };

export function sourceUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function validInvestigations(data) {
  if (!keys(data, ['schema_version', 'published_at', 'investigations']) || data.schema_version !== 1 || !date(data.published_at) || !Array.isArray(data.investigations) || data.investigations.length > 100) return false;
  const ids = new Set();
  for (const run of data.investigations) {
    if (!keys(run, rowKeys) || !text(run.id, 80) || ids.has(run.id) || !text(run.question, 400) || !['tools', 'single_pass'].includes(run.mode) || !text(run.model, 120) || !text(run.critic_model, 120) || !text(run.reviewer, 80) || !text(run.critique_summary)) return false;
    ids.add(run.id);
    if (!['created_at', 'completed_at', 'reviewed_at', 'evidence_cutoff'].every(key => date(run[key])) || Date.parse(run.completed_at) < Date.parse(run.created_at) || Date.parse(run.reviewed_at) < Date.parse(run.completed_at)) return false;
    if (!keys(run.metrics, metricKeys)) return false;
    const m = run.metrics;
    if (!['tool_calls', 'successful_tools', 'source_count', 'passage_count', 'unknown_runs', 'model_calls'].every(key => count(m[key])) || m.successful_tools > m.tool_calls || m.unknown_runs > m.model_calls || !Number.isFinite(m.elapsed_seconds) || m.elapsed_seconds < 0 || !money(m.known_estimated_usd) || !money(m.reserved_usd) || !(m.estimated_usd === null || money(m.estimated_usd)) || (m.unknown_runs > 0 && m.estimated_usd !== null)) return false;
    if (!Array.isArray(run.sources) || !run.sources.length || run.sources.length > 12) return false;
    const sourceIds = new Set();
    for (const source of run.sources) {
      if (!keys(source, ['id', 'title', 'url', 'published_at']) || !text(source.id, 80) || sourceIds.has(source.id) || !text(source.title, 240) || !date(source.published_at) || Date.parse(source.published_at) > Date.parse(run.evidence_cutoff) || !sourceUrl(source.url)) return false;
      sourceIds.add(source.id);
    }
    if (!Array.isArray(run.source_versions) || run.source_versions.length !== m.source_count) return false;
    const versions = new Set();
    for (const version of run.source_versions) {
      if (!keys(version, ['source_id', 'sha256', 'fetched_at']) || !sourceIds.has(version.source_id) || versions.has(version.source_id) || !/^[a-f0-9]{64}$/.test(version.sha256) || !date(version.fetched_at)) return false;
      versions.add(version.source_id);
    }
    const report = run.result;
    if (!keys(report, ['headline', 'summary', 'claims', 'changes', 'open_questions', 'invalidation', 'change_assessment']) || !text(report.headline, 120) || !text(report.summary) || !['unchanged', 'qualified', 'new_evidence'].includes(report.change_assessment) || !['changes', 'open_questions', 'invalidation'].every(key => strings(report[key])) || !Array.isArray(report.claims) || !report.claims.length || report.claims.length > 4) return false;
    for (const claim of report.claims) {
      if (!keys(claim, ['text', 'evidence_ids', 'source_ids']) || !text(claim.text, 400) || !strings(claim.evidence_ids) || !strings(claim.source_ids) || !claim.source_ids.every(id => sourceIds.has(id))) return false;
    }
    if (!Array.isArray(run.steps) || run.steps.length > 100) return false;
    let previous = -Infinity;
    for (const step of run.steps) {
      if (!keys(step, ['at', 'kind', 'model', 'tools', 'verdict']) || !date(step.at) || Date.parse(step.at) < previous || !['started', 'model_reserved', 'tools_completed', 'memory_compacted', 'editorial_amendment', 'report_saved', 'critique_saved'].includes(step.kind) || !(step.model === null || text(step.model, 120)) || !Array.isArray(step.tools) || !step.tools.every(name => Object.hasOwn(toolNames, name)) || !(step.verdict === null || ['pass', 'revise', 'insufficient'].includes(step.verdict))) return false;
      previous = Date.parse(step.at);
    }
  }
  return true;
}

export function modelName(value) {
  return new Map([['deepseek-ai/DeepSeek-V4-Pro-0813', 'DeepSeek Pro'], ['deepseek-ai/DeepSeek-V4-Flash-0731', 'DeepSeek Flash'], ['moonshotai/Kimi-K3', 'Kimi K3'], ['moonshotai/Kimi-K2.6', 'Kimi K2.6']]).get(value) || value;
}

export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${Math.round(seconds % 60)}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function cost(value) {
  return money(value) ? `$${Number(value).toFixed(Number(value) > 0 && Number(value) < 0.01 ? 4 : 2)}` : 'Pending';
}

function node(tag, content, className) {
  const result = document.createElement(tag);
  if (content !== undefined) result.textContent = content;
  if (className) result.className = className;
  return result;
}

function link(source) {
  const result = node('a', 'Source ↗');
  result.href = sourceUrl(source.url);
  result.target = '_blank'; result.rel = 'noopener noreferrer';
  result.setAttribute('aria-label', `${source.title} (opens in a new tab)`);
  return result;
}

function detail(title) {
  const box = node('details', undefined, 'run-detail');
  box.append(node('summary', title));
  return box;
}

function renderRun(data, index) {
  const run = data.investigations[index];
  const panel = document.querySelector('#investigation-panel');
  panel.replaceChildren();
  panel.setAttribute('aria-labelledby', `investigation-${index}`);
  document.querySelectorAll('.investigation-tab').forEach((button, i) => {
    button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1;
  });
  panel.append(node('p', run.mode === 'tools' ? 'Tool-assisted investigation' : 'Single-pass comparison', 'eyebrow'));
  panel.append(node('h3', run.result.headline), node('p', run.result.summary, 'thesis-summary'));
  const metrics = node('dl', undefined, 'run-metrics');
  for (const [label, value] of [['Model calls', run.metrics.model_calls], ['Tool calls', run.metrics.tool_calls], ['Elapsed', duration(run.metrics.elapsed_seconds)], ['Est. cost', cost(run.metrics.estimated_usd)]]) {
    const cell = node('div'); cell.append(node('dt', label), node('dd', String(value))); metrics.append(cell);
  }
  panel.append(metrics);
  const finding = detail('Findings & sources');
  finding.append(node('p', run.question, 'run-question'));
  for (const claim of run.result.claims) {
    const paragraph = node('p', claim.text);
    for (const id of claim.source_ids) paragraph.append(link(run.sources.find(source => source.id === id)));
    finding.append(paragraph);
  }
  finding.append(node('h4', 'Still open'));
  for (const question of run.result.open_questions) finding.append(node('p', question));
  finding.append(node('h4', 'What would change the view'));
  for (const condition of run.result.invalidation) finding.append(node('p', condition));
  panel.append(finding);
  const timeline = detail('Replay the research');
  const steps = node('ol', undefined, 'run-timeline');
  for (const step of run.steps) {
    const row = node('li');
    let label = { started: 'Investigation started', model_reserved: 'Model request', tools_completed: 'Evidence tools', memory_compacted: 'Research notebook compacted', editorial_amendment: 'Editorial correction recorded', report_saved: 'Report saved', critique_saved: 'Critique recorded' }[step.kind];
    if (step.model) label += ` · ${modelName(step.model)}`;
    if (step.tools.length) label = step.tools.map(name => toolNames[name]).join(' · ');
    if (step.verdict) label += ` · ${step.verdict}`;
    const at = node('time', new Date(step.at).toISOString().slice(11, 19)); at.dateTime = step.at;
    row.append(at, node('span', label)); steps.append(row);
  }
  timeline.append(node('p', 'Recorded steps · UTC'), steps);
  panel.append(timeline);
  const review = detail('Models & review');
  review.append(node('p', `Research: ${modelName(run.model)}. Critique: ${modelName(run.critic_model)}.`));
  review.append(node('p', run.critique_summary));
  review.append(node('p', `${run.reviewer} · ${new Date(run.reviewed_at).toISOString().slice(0, 10)}`));
  review.append(node('p', 'A model critique is a check, not independent verification. Cost estimates include every model call in this run; they are not reconciled bills.'));
  for (const version of run.source_versions) {
    const source = run.sources.find(item => item.id === version.source_id);
    review.append(node('p', `${source.title} · published ${source.published_at} · retrieved ${version.fetched_at.slice(0, 10)}`));
    review.append(node('code', `SHA256 ${version.sha256}`, 'source-hash'));
  }
  panel.append(review);
}

async function load() {
  try {
    const response = await fetch('./investigations.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) });
    if (!response.ok) return;
    const body = await response.text();
    if (body.length > 2_000_000) return;
    const data = JSON.parse(body);
    if (!validInvestigations(data) || !data.investigations.length) return;
    const tabs = document.querySelector('#investigation-tabs');
    data.investigations.forEach((run, index) => {
      const button = node('button', run.mode === 'tools' ? 'Investigator' : 'Single pass', 'investigation-tab');
      button.type = 'button'; button.role = 'tab'; button.id = `investigation-${index}`;
      button.setAttribute('aria-controls', 'investigation-panel');
      button.addEventListener('click', () => renderRun(data, index));
      button.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % data.investigations.length;
        else if (event.key === 'ArrowLeft') next = (index + data.investigations.length - 1) % data.investigations.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = data.investigations.length - 1;
        else return;
        event.preventDefault(); renderRun(data, next); document.querySelector(`#investigation-${next}`).focus();
      });
      tabs.append(button);
    });
    document.querySelector('#investigation-count').textContent = `${data.investigations.length} reviewed`;
    const latestTools = data.investigations.findLastIndex(run => run.mode === 'tools');
    renderRun(data, latestTools < 0 ? data.investigations.length - 1 : latestTools);
    document.querySelector('#investigations').hidden = false;
  } catch { /* Optional publication cannot prevent the existing ledger from loading. */ }
}

if (typeof document !== 'undefined') load();
