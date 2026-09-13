const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const list = value => Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const texts = value => list(value) && value.every(text);
const date = value => text(value) && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
const money = value => typeof value === 'string' && decimal.test(value) && Number.isFinite(Number(value));
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const publicationKeys = ['schema_version', 'published_at', 'project', 'thesis', 'costs', 'portfolio'];
const revisionKeys = ['id', 'parent_id', 'created_at', 'evidence_as_of', 'headline', 'summary', 'stance', 'claims', 'assumptions', 'invalidation', 'open_questions', 'next_review', 'changes', 'sources', 'facts', 'context', 'reviewed_at', 'reviewer', 'research'];
const costKeys = ['estimated_usd', 'billed_usd', 'completed_runs', 'unknown_runs', 'reserved_usd'];

// Compare validated decimal strings exactly, including amounts below float precision.
function compareMoney(left, right) {
  const [wholeLeft, fractionLeft = ''] = left.split('.');
  const [wholeRight, fractionRight = ''] = right.split('.');
  if (wholeLeft.length !== wholeRight.length) return wholeLeft.length - wholeRight.length;
  if (wholeLeft !== wholeRight) return wholeLeft < wholeRight ? -1 : 1;
  const places = Math.max(fractionLeft.length, fractionRight.length);
  const a = fractionLeft.padEnd(places, '0');
  const b = fractionRight.padEnd(places, '0');
  return a === b ? 0 : a < b ? -1 : 1;
}

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Reject a damaged publication instead of rendering partial research as complete.
export function validSnapshot(data) {
  if (!exactKeys(data, publicationKeys) || data.schema_version !== 1 || !date(data.published_at)) return false;
  if (!exactKeys(data.project, ['name', 'repository', 'mode']) || data.project.name !== 'Portfolio Agent' || data.project.repository !== 'https://github.com/bwoods1998/portfolio-agent' || data.project.mode !== 'research') return false;
  if (!exactKeys(data.portfolio, ['status']) || data.portfolio.status !== 'not_connected') return false;
  if (!exactKeys(data.thesis, ['id', 'symbol', 'company', 'question', 'revisions']) || !text(data.thesis.id) || !text(data.thesis.question) || !text(data.thesis.company) || !text(data.thesis.symbol) || !list(data.thesis.revisions)) return false;
  if (!exactKeys(data.costs, costKeys) && !exactKeys(data.costs, [...costKeys, 'known_estimated_usd'])) return false;
  if (!(data.costs.estimated_usd === null || money(data.costs.estimated_usd)) || data.costs.billed_usd !== null || !money(data.costs.reserved_usd)) return false;
  if (!Number.isSafeInteger(data.costs.completed_runs) || data.costs.completed_runs < 0 || !Number.isSafeInteger(data.costs.unknown_runs) || data.costs.unknown_runs < 0) return false;
  if (data.costs.unknown_runs > 0 && data.costs.estimated_usd !== null) return false;
  if (data.costs.estimated_usd !== null && compareMoney(data.costs.estimated_usd, data.costs.reserved_usd) > 0) return false;
  if (Object.hasOwn(data.costs, 'known_estimated_usd')) {
    if (!money(data.costs.known_estimated_usd) || compareMoney(data.costs.known_estimated_usd, data.costs.reserved_usd) > 0) return false;
    if (data.costs.unknown_runs === 0 && (data.costs.estimated_usd === null || compareMoney(data.costs.known_estimated_usd, data.costs.estimated_usd) !== 0)) return false;
  }
  const ids = new Set();
  let previousTime = -Infinity;
  for (const revision of data.thesis.revisions) {
    if (!exactKeys(revision, revisionKeys) || !text(revision.id) || ids.has(revision.id) || !date(revision.created_at) || !date(revision.evidence_as_of) || !date(revision.reviewed_at) || !text(revision.reviewer)) return false;
    if (!exactKeys(revision.research, ['model', 'completion_window', 'reasoning_effort']) || !Object.values(revision.research).every(text)) return false;
    if (Date.parse(revision.created_at) < previousTime) return false;
    previousTime = Date.parse(revision.created_at);
    if (revision.parent_id !== null && !ids.has(revision.parent_id)) return false;
    ids.add(revision.id);
    if (!text(revision.summary) || !text(revision.headline) || !['watch', 'hold', 'review'].includes(revision.stance) || !text(revision.next_review)) return false;
    if (!['assumptions', 'invalidation', 'open_questions', 'changes'].every(key => texts(revision[key]))) return false;
    if (!list(revision.sources) || !list(revision.facts) || !list(revision.context) || !list(revision.claims)) return false;
    const sourceIds = new Set();
    for (const source of revision.sources) {
      if (!exactKeys(source, ['id', 'title', 'url', 'published_at']) || !text(source.id) || sourceIds.has(source.id) || !text(source.title) || !date(source.published_at) || !safeSourceUrl(source.url)) return false;
      sourceIds.add(source.id);
    }
    const evidenceIds = new Set();
    for (const fact of revision.facts) {
      if (!exactKeys(fact, ['id', 'label', 'value', 'unit', 'period', 'source_id']) || !text(fact.id) || evidenceIds.has(fact.id) || !text(fact.label) || !Number.isFinite(fact.value) || fact.unit !== 'USD millions' || !text(fact.period) || !sourceIds.has(fact.source_id)) return false;
      evidenceIds.add(fact.id);
    }
    for (const context of revision.context) {
      if (!exactKeys(context, ['id', 'text', 'source_id']) || !text(context.id) || evidenceIds.has(context.id) || !text(context.text) || !sourceIds.has(context.source_id)) return false;
      evidenceIds.add(context.id);
    }
    for (const claim of revision.claims) {
      if (!exactKeys(claim, ['text', 'evidence_ids']) || !text(claim.text) || !texts(claim.evidence_ids) || claim.evidence_ids.length === 0 || !claim.evidence_ids.every(id => evidenceIds.has(id))) return false;
    }
  }
  return true;
}

export function formatFact(value, unit) {
  if (!Number.isFinite(value) || unit !== 'USD millions') return '—';
  const absolute = Math.abs(value);
  const scale = absolute >= 1000 ? 1000 : 1;
  const number = (absolute / scale).toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${value < 0 ? '−' : ''}$${number}${scale === 1000 ? 'B' : 'M'}`;
}

export function formatCost(value) {
  if (!money(value)) return 'Estimate unavailable';
  const amount = Number(value);
  if (amount > 0 && amount < 0.000001) return '<$0.000001 est.';
  return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: amount < 0.01 && amount > 0 ? 4 : 2, maximumFractionDigits: 6 }).format(amount)} est.`;
}

export function formatCostSummary(costs) {
  if (costs.unknown_runs > 0) {
    const known = money(costs.known_estimated_usd)
      ? formatCost(costs.known_estimated_usd).replace(' est.', ' known') : 'Estimate unavailable';
    return `Inference · ${known} · ${costs.unknown_runs} unconfirmed`;
  }
  return `Inference · ${formatCost(costs.estimated_usd)}`;
}

export function formatResearch(research) {
  const names = new Map([
    ['deepseek-ai/DeepSeek-V4-Pro-0813', 'DeepSeek V4 Pro'],
    ['deepseek-ai/DeepSeek-V4-Flash-0731', 'DeepSeek V4 Flash'],
    ['zai-org/GLM-5.3', 'GLM 5.3'],
  ]);
  const title = value => value[0].toUpperCase() + value.slice(1);
  const window = research.completion_window === 'asap' ? 'ASAP' : title(research.completion_window);
  return `${names.get(research.model) || research.model} · ${window} · ${title(research.reasoning_effort)} reasoning`;
}

const dateLabel = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const shortDate = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function sourceLink(source, label) {
  const link = element('a', label || `${source.title} ↗`);
  link.href = safeSourceUrl(source.url);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.append(element('span', ' (opens in a new tab)', 'sr-only'));
  return link;
}

function evidenceItem(fact, revision) {
  const source = revision.sources.find(item => item.id === fact.source_id);
  const item = element('details', undefined, 'evidence-item');
  const summary = element('summary');
  const label = element('span', fact.label, 'evidence-label');
  label.append(element('span', ` · ${fact.period}`, 'evidence-period'));
  summary.append(label, element('span', formatFact(fact.value, fact.unit), 'evidence-value'));
  const detail = element('div', undefined, 'evidence-detail');
  detail.append(element('p', `${fact.value.toLocaleString('en-US')} ${fact.unit} · ${fact.period}`));
  for (const claim of revision.claims.filter(item => item.evidence_ids.includes(fact.id))) detail.append(element('p', claim.text));
  for (const context of revision.context.filter(item => item.source_id === fact.source_id)) detail.append(element('p', context.text));
  detail.append(sourceLink(source), element('p', `Published ${dateLabel(source.published_at)}`, 'evidence-period'));
  item.append(summary, detail);
  return item;
}

function renderReasoning(revision) {
  const root = document.querySelector('#reasoning');
  root.replaceChildren();
  root.append(element('h5', 'Claims'));
  const claims = element('ul');
  for (const claim of revision.claims) {
    const row = element('li', claim.text);
    const sourceIds = new Set(claim.evidence_ids.map(id => [...revision.facts, ...revision.context].find(item => item.id === id)?.source_id));
    for (const sourceId of sourceIds) row.append(sourceLink(revision.sources.find(item => item.id === sourceId), 'Source ↗'));
    claims.append(row);
  }
  root.append(claims);
  for (const [title, values] of [['Assumptions', revision.assumptions], ['What would change the thesis', revision.invalidation], ['Open questions', revision.open_questions]]) {
    if (!values.length) continue;
    root.append(element('h5', title));
    const rows = element('ul');
    for (const value of values) rows.append(element('li', value));
    root.append(rows);
  }
  if (revision.context.length) {
    root.append(element('h5', 'Source context'));
    const rows = element('ul');
    for (const context of revision.context) {
      const row = element('li', context.text);
      row.append(sourceLink(revision.sources.find(item => item.id === context.source_id), 'Source ↗'));
      rows.append(row);
    }
    root.append(rows);
  }
  root.append(element('h5', 'Next review'), element('p', revision.next_review));
  root.append(element('h5', 'Review record'), element('p', `${revision.reviewer} · ${dateLabel(revision.reviewed_at)}`));
  const provenance = element('p', formatResearch(revision.research));
  provenance.title = revision.research.model;
  root.append(provenance);
}

function renderRevision(data, index) {
  const revision = data.thesis.revisions[index];
  const panel = document.querySelector('#version-panel');
  panel.setAttribute('aria-labelledby', `version-${index}`);
  document.querySelectorAll('.version-tab').forEach((button, position) => {
    button.setAttribute('aria-selected', String(position === index));
    button.tabIndex = position === index ? 0 : -1;
  });
  document.querySelector('#version-label').textContent = `THESIS / ${String(index + 1).padStart(3, '0')}`;
  document.querySelector('#as-of').textContent = `Evidence · ${dateLabel(revision.evidence_as_of)}`;
  document.querySelector('#question').textContent = data.thesis.question;
  document.querySelector('#stance').textContent = { watch: 'Watching', hold: 'Hold thesis', review: 'Under review' }[revision.stance];
  document.querySelector('#model').textContent = `${data.thesis.company} · ${data.thesis.symbol}`;
  document.querySelector('#summary').textContent = revision.summary;
  document.querySelector('#evidence-count').textContent = `${revision.facts.length} facts`;
  const evidence = document.querySelector('#evidence');
  const remaining = document.querySelector('#remaining-evidence');
  evidence.replaceChildren();
  remaining.replaceChildren();
  // Latest fiscal year first; comparison periods remain one click away.
  const facts = [...revision.facts].sort((left, right) => right.period.localeCompare(left.period, 'en', { numeric: true }));
  facts.forEach((fact, position) => (position < 3 ? evidence : remaining).append(evidenceItem(fact, revision)));
  const more = document.querySelector('#more-evidence');
  more.hidden = revision.facts.length <= 3;
  more.open = false;
  document.querySelector('#more-evidence-label').textContent = `${Math.max(0, revision.facts.length - 3)} more facts`;
  const changes = document.querySelector('#changes');
  document.querySelector('[aria-labelledby="changes-title"]').hidden = revision.parent_id === null;
  changes.replaceChildren();
  const changeItems = revision.changes.length ? revision.changes : ['First reviewed entry.'];
  for (const change of changeItems) changes.append(element('li', change));
  document.querySelector('#next-question').textContent = revision.open_questions[0] || revision.next_review;
  const watch = document.querySelector('#watch-list');
  watch.replaceChildren();
  const watchItems = revision.invalidation.length ? revision.invalidation : revision.assumptions;
  for (const item of watchItems.slice(0, 2)) watch.append(element('li', item));
  document.querySelector('.watch-section').hidden = watchItems.length === 0;
  document.querySelector('#review-status').textContent = `Reviewed ${dateLabel(revision.reviewed_at)}`;
  document.querySelector('#research-cost').textContent = formatCostSummary(data.costs);
  document.querySelector('.reasoning').open = false;
  renderReasoning(revision);
}

function render(data) {
  const versions = data.thesis.revisions;
  document.querySelector('#version-count').textContent = `${versions.length} ${versions.length === 1 ? 'entry' : 'entries'}`;
  const list = document.querySelector('#version-list');
  list.replaceChildren();
  versions.forEach((revision, index) => {
    const button = element('button', undefined, 'version-tab');
    button.type = 'button';
    button.id = `version-${index}`;
    button.title = revision.headline;
    button.role = 'tab';
    button.setAttribute('aria-controls', 'version-panel');
    const time = element('time', shortDate(revision.created_at));
    time.dateTime = revision.created_at;
    button.append(time, element('small', `v${String(index + 1).padStart(2, '0')} · ${index === 0 ? 'First thesis' : 'Revision'}`));
    button.setAttribute('aria-label', `Version ${index + 1}, ${dateLabel(revision.created_at)}, ${revision.headline}`);
    button.addEventListener('click', () => renderRevision(data, index));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % versions.length;
      else if (event.key === 'ArrowLeft') next = (index + versions.length - 1) % versions.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = versions.length - 1;
      else return;
      event.preventDefault();
      renderRevision(data, next);
      document.querySelector(`#version-${next}`).focus();
    });
    list.append(button);
  });
  renderRevision(data, versions.length - 1);
  const runLabel = `${data.costs.completed_runs} completed ${data.costs.completed_runs === 1 ? 'run' : 'runs'}`;
  const unknown = data.costs.unknown_runs ? ` ${data.costs.unknown_runs} ${data.costs.unknown_runs === 1 ? 'run has' : 'runs have'} unconfirmed usage.` : '';
  document.querySelector('#method-note').textContent = `Published ${dateLabel(data.published_at)}. ${runLabel}. Cost estimates include all research attempts, including incomplete or failed runs; they are not reconciled bills.${unknown} Public visits read this saved snapshot and do not trigger model calls.`;
}

async function load() {
  const status = document.querySelector('#load-state');
  const research = document.querySelector('#research');
  const retry = document.querySelector('#retry');
  research.hidden = true;
  retry.hidden = true;
  status.hidden = false;
  status.textContent = 'Opening the research ledger…';
  try {
    const response = await fetch('./snapshot.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Snapshot unavailable');
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('Snapshot too large');
    const data = JSON.parse(body);
    if (!validSnapshot(data)) throw new Error('Invalid snapshot');
    if (!data.thesis.revisions.length) {
      status.textContent = 'First review in progress. The ledger opens with the first published thesis.';
      return;
    }
    render(data);
    status.hidden = true;
    research.hidden = false;
  } catch {
    status.textContent = 'The research ledger is unavailable right now.';
    retry.hidden = false;
  }
}

if (typeof document !== 'undefined') {
  document.querySelector('#retry').addEventListener('click', load);
  load();
}
