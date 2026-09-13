const symbols = ['NVDA', 'TSM', 'AVGO', 'CEG', 'VRT', 'MSFT', 'AMZN', 'GOOGL', 'META'];
const scope = 'Mechanical checks and fallible model comparisons. Company cases and dependency maps remain unapproved drafts.';
const keys = ['schema_version', 'saved_at', 'state', 'started_at', 'deadline', 'planned_steps', 'completed_steps', 'submitted_requests', 'unknown_requests', 'estimated_usd', 'max_reservation_usd', 'inflight_requests', 'source_documents', 'scope', 'companies'];
const exact = (value, names) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const decimal = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,5})(?:\.\d{1,20})?$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace('Z', '.000Z');

export function validOvernight(value) {
  if (!exact(value, keys) || value.schema_version !== 1 || value.scope !== scope) return false;
  if (!['running', 'complete', 'deadline', 'needs_attention'].includes(value.state)) return false;
  if (![value.saved_at, value.started_at, value.deadline].every(timestamp) || value.started_at > value.saved_at || value.deadline <= value.started_at) return false;
  if (Date.parse(value.deadline) - Date.parse(value.started_at) > 8 * 3600000) return false;
  if (value.planned_steps !== 86 || !integer(value.completed_steps, 86) || !integer(value.submitted_requests, 86)) return false;
  if (!integer(value.unknown_requests, value.submitted_requests) || !integer(value.inflight_requests, value.unknown_requests)) return false;
  if (!integer(value.source_documents, 90) || value.source_documents < 9 || !decimal(value.estimated_usd) || !decimal(value.max_reservation_usd)) return false;
  if (Number(value.max_reservation_usd) <= 0 || Number(value.max_reservation_usd) > 40) return false;
  if (value.state === 'complete' && (value.completed_steps !== value.planned_steps || value.inflight_requests !== 0)) return false;
  if (value.state === 'deadline' && value.saved_at < value.deadline) return false;
  if (!Array.isArray(value.companies) || value.companies.length !== symbols.length) return false;
  let completed = 0;
  for (const [index, company] of value.companies.entries()) {
    if (!exact(company, ['symbol', 'completed_steps', 'baseline_mechanical_pass', 'revised_mechanical_pass', 'judge_preferences', 'approved']) || company.symbol !== symbols[index] || company.approved !== false) return false;
    if (!integer(company.completed_steps, 9) || ![company.baseline_mechanical_pass, company.revised_mechanical_pass].every(item => item === null || typeof item === 'boolean')) return false;
    if (!Array.isArray(company.judge_preferences) || company.judge_preferences.length > 2 || !company.judge_preferences.every(item => ['baseline', 'revision', 'tie'].includes(item))) return false;
    const observed = Number(company.baseline_mechanical_pass !== null) + Number(company.revised_mechanical_pass !== null) + company.judge_preferences.length;
    if (observed > company.completed_steps) return false;
    completed += company.completed_steps;
  }
  return completed <= value.completed_steps && value.completed_steps <= completed + 5;
}

function element(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}

export function mountOvernight(value, target) {
  if (!validOvernight(value)) return false;
  const heading = element('div', undefined, 'night-heading');
  heading.append(element('h3', 'Night shift'), element('span', {
    running: value.submitted_requests ? 'Researching · recorded' : 'Queued · recorded',
    complete: 'Finished · review next', deadline: 'Window ended', needs_attention: 'Paused for review',
  }[value.state], 'night-state'));
  const progress = element('progress');
  progress.max = value.planned_steps;
  progress.value = value.completed_steps;
  progress.setAttribute('aria-label', `${value.completed_steps} of ${value.planned_steps} research stages complete`);
  const counts = element('p', `${value.completed_steps}/${value.planned_steps} stages · 9 companies · $${Number(value.estimated_usd).toFixed(2)} known${value.unknown_requests ? ` + ${value.unknown_requests} unsettled` : ''}`, 'night-counts');
  const detail = element('details', undefined, 'night-detail');
  detail.append(element('summary', 'Evidence checks'));
  const intro = element('p', 'First draft → revision. Quotes and arithmetic; findings still need review.');
  const rows = element('div', undefined, 'night-companies');
  const label = item => item === null ? '—' : item ? 'Pass' : 'Check';
  for (const company of value.companies) {
    const row = element('div');
    row.append(element('span', company.symbol), element('span', `${label(company.baseline_mechanical_pass)} → ${label(company.revised_mechanical_pass)}`));
    rows.append(row);
  }
  detail.append(intro, rows);
  const footer = element('div', undefined, 'night-footer');
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  const saved = element('time', `Saved ${date.format(new Date(value.saved_at))} UTC`);
  saved.dateTime = value.saved_at;
  saved.title = `Research window ends ${value.deadline}`;
  const link = element('a', 'Research notes ↗');
  link.href = 'https://github.com/bwoods1998/portfolio-agent/blob/main/docs/NIGHT-SHIFT.md';
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  footer.append(saved, link);
  target.replaceChildren(heading, element('p', 'Independent research and review on Sail.', 'night-purpose'), progress, counts, detail, footer);
  return true;
}

export async function loadOvernight(target, section, fetcher = fetch) {
  try {
    const response = await fetcher('./overnight-research.json', { cache: 'no-cache', credentials: 'omit' });
    if (!response.ok) return false;
    const value = await response.json();
    if (!mountOvernight(value, target)) return false;
    section.hidden = false;
    return true;
  } catch { return false; }
}

if (typeof document !== 'undefined') {
  const section = document.querySelector('#overnight');
  if (section) loadOvernight(document.querySelector('#overnight-content'), section);
}
