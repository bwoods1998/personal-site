const exact = (v, names) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const integer = n => Number.isSafeInteger(n) && n >= 0 && n <= 100000;
const money = n => typeof n === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,16})?$/.test(n) && Number.isFinite(Number(n)) && Number(n) <= 100000;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const hash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const modelNames = new Map([
  ['deepseek-ai/DeepSeek-V4-Pro-0813', 'DeepSeek Pro'],
  ['deepseek-ai/DeepSeek-V4-Flash-0731', 'DeepSeek Flash'],
  ['moonshotai/Kimi-K3', 'Kimi K3'],
  ['moonshotai/Kimi-K2.6', 'Kimi K2.6'],
]);
const baselineKeys = ['model', 'trials', 'finalized', 'passed', 'estimated_known_usd', 'unknown_cost_runs'];
const pairedKeys = ['model', 'critic_model', 'scheduled_pairs', 'finalized_pairs', 'before_passed', 'after_passed', 'extra_estimated_known_usd', 'unknown_cost_runs'];

export function validEvaluations(data) {
  if (!exact(data, ['schema_version', 'published_at', 'campaigns']) || data.schema_version !== 1 || !date(data.published_at) || !Array.isArray(data.campaigns) || data.campaigns.length > 20) return false;
  const ids = new Set();
  for (const campaign of data.campaigns) {
    if (!exact(campaign, ['id', 'created_at', 'finished', 'planned_calls', 'fixture_count', 'cases_sha256', 'prompts_sha256', 'baseline', 'paired']) || !uuid(campaign.id) || ids.has(campaign.id) || !date(campaign.created_at) || Date.parse(campaign.created_at) > Date.parse(data.published_at) || typeof campaign.finished !== 'boolean' || !integer(campaign.planned_calls) || campaign.planned_calls < 1 || !integer(campaign.fixture_count) || campaign.fixture_count < 1 || !hash(campaign.cases_sha256) || !hash(campaign.prompts_sha256) || !Array.isArray(campaign.baseline) || !campaign.baseline.length || campaign.baseline.length > 4 || !Array.isArray(campaign.paired) || campaign.paired.length > 4) return false;
    ids.add(campaign.id);
    const models = new Set();
    for (const row of campaign.baseline) {
      if (!exact(row, baselineKeys) || !modelNames.has(row.model) || models.has(row.model) || !['trials', 'finalized', 'passed', 'unknown_cost_runs'].every(k => integer(row[k])) || row.trials < campaign.fixture_count || row.finalized > row.trials || row.passed > row.finalized || row.unknown_cost_runs > row.trials || !money(row.estimated_known_usd) || (campaign.finished && row.finalized !== row.trials)) return false;
      models.add(row.model);
    }
    const pairedModels = new Set();
    for (const row of campaign.paired) {
      if (!exact(row, pairedKeys) || !models.has(row.model) || pairedModels.has(row.model) || !modelNames.has(row.critic_model) || !['scheduled_pairs', 'finalized_pairs', 'before_passed', 'after_passed', 'unknown_cost_runs'].every(k => integer(row[k])) || row.scheduled_pairs < 1 || row.finalized_pairs > row.scheduled_pairs || row.before_passed > row.finalized_pairs || row.after_passed > row.finalized_pairs || row.unknown_cost_runs > row.scheduled_pairs || !money(row.extra_estimated_known_usd) || (campaign.finished && row.finalized_pairs !== row.scheduled_pairs)) return false;
      const baseline = campaign.baseline.find(item => item.model === row.model);
      if (row.scheduled_pairs !== baseline.trials || row.finalized_pairs > baseline.finalized || row.before_passed > baseline.passed) return false;
      pairedModels.add(row.model);
    }
    if (campaign.paired.length && pairedModels.size !== models.size) return false;
    if (campaign.planned_calls !== campaign.baseline.reduce((sum, row) => sum + row.trials, 0) + campaign.paired.reduce((sum, row) => sum + row.scheduled_pairs, 0)) return false;
  }
  return true;
}

export function passRate(passed, trials) {
  return integer(passed) && integer(trials) && trials > 0 && passed <= trials ? `${(100 * passed / trials).toFixed(1).replace(/\.0$/, '')}%` : '—';
}

export function estimate(value, unknown = 0) {
  if (!money(value) || !integer(unknown)) return 'Pending';
  if (unknown && Number(value) === 0) return 'Pending';
  return `${unknown ? '≥' : ''}$${Number(value).toFixed(Number(value) > 0 && Number(value) < 0.01 ? 4 : 2)}`;
}

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = String(content);
  if (className) element.className = className;
  return element;
}

function table(title, headers) {
  const wrap = node('div', undefined, 'evaluation-table-wrap');
  wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', `${title} results`);
  const grid = node('table', undefined, 'evaluation-table');
  grid.append(node('caption', title, 'sr-only'));
  const head = node('thead'); const line = node('tr');
  for (const text of headers) { const cell = node('th', text); cell.scope = 'col'; line.append(cell); }
  head.append(line); grid.append(head);
  const body = node('tbody'); grid.append(body); wrap.append(grid);
  return { wrap, body };
}

function labelCell(text, detail) {
  const cell = node('th', undefined); cell.scope = 'row';
  cell.append(node('span', text));
  if (detail) cell.append(node('small', detail));
  return cell;
}

export function renderEvaluations(data, target) {
  if (!validEvaluations(data)) throw new TypeError('Invalid evaluation publication');
  target.replaceChildren();
  for (const campaign of data.campaigns) {
    const box = node('article', undefined, 'evaluation-campaign');
    const paired = campaign.paired.length > 0;
    const title = paired ? 'A second opinion' : 'Model comparison';
    const heading = node('div', undefined, 'evaluation-heading');
    heading.append(node('h3', title), node('span', `${campaign.fixture_count} cases · ${campaign.planned_calls} calls${campaign.finished ? '' : ' · In progress'}`));
    box.append(heading);
    if (paired) {
      const { wrap, body } = table(title, ['Research → Critic', 'Pairs', 'Before', 'After', 'Extra cost']);
      for (const row of campaign.paired) {
        const line = node('tr');
        line.append(labelCell(modelNames.get(row.model), `→ ${modelNames.get(row.critic_model)}`));
        const progress = row.finalized_pairs === row.scheduled_pairs ? String(row.scheduled_pairs) : `${row.finalized_pairs}/${row.scheduled_pairs}`;
        line.append(node('td', progress), node('td', passRate(row.before_passed, row.finalized_pairs)), node('td', passRate(row.after_passed, row.finalized_pairs)), node('td', estimate(row.extra_estimated_known_usd, row.unknown_cost_runs)));
        body.append(line);
      }
      box.append(wrap);
    } else {
      const { wrap, body } = table(title, ['Model', 'Trials', 'Pass', 'Est. cost']);
      for (const row of campaign.baseline) {
        const line = node('tr');
        const done = row.finalized === row.trials;
        line.append(labelCell(modelNames.get(row.model)), node('td', done ? String(row.trials) : `${row.finalized}/${row.trials}`), node('td', done ? passRate(row.passed, row.trials) : 'Pending'), node('td', estimate(row.estimated_known_usd, row.unknown_cost_runs)));
        body.append(line);
      }
      box.append(wrap);
    }
    const method = node('details', undefined, 'evaluation-method');
    method.append(node('summary', 'Method & limits'));
    method.append(node('p', `${campaign.fixture_count} authored Microsoft evidence cases; a development regression, not a held-out test of investment ability. A pass requires the expected verdict, valid citations, and required evidence coverage. The explanation itself is not scored.`));
    method.append(node('p', paired ? 'Every baseline answer gets the same critic. Before and after use only finalized pairs, including failed calls. This separate run does not prove a causal improvement. Extra cost estimates cover critic calls only.' : 'Each model receives the same frozen cases and prompts. Final pass rates count failed or invalid calls as errors; unfinished trials show progress. Costs are token-based estimates, not reconciled bills.'));
    method.append(node('p', 'Unknown charges remain pending; ≥ marks a partial cost.'));
    method.append(node('code', `Cases SHA256 ${campaign.cases_sha256}`, 'source-hash'), node('code', `Prompts SHA256 ${campaign.prompts_sha256}`, 'source-hash'));
    box.append(method); target.append(box);
  }
}

async function load() {
  try {
    const response = await fetch('./evaluations.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) });
    if (!response.ok) return;
    const body = await response.text();
    if (body.length > 200000) return;
    const data = JSON.parse(body);
    if (!validEvaluations(data) || !data.campaigns.length) return;
    renderEvaluations(data, document.querySelector('#evaluation-campaigns'));
    document.querySelector('#evaluations').hidden = false;
  } catch { /* The optional benchmark publication must not block the research ledger. */ }
}

if (typeof document !== 'undefined') load();
