import { KINDS, PROFILES, validEntry, validSummary, recordId, summary } from './schema.js';

const API = '/api/portfolio/research';
const cache = new Map();
const entryCache = new Map();
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const date = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(value));
function link(label, href) { const n = el('a', label); n.href = href; return n; }
function section(parent, title, content) { parent.append(el('h2', title)); if (content) parent.append(el('p', content)); }
function amount(c) {
  const v = Number(c.value);
  return (c.unit === 'USD' ? '$' : '') + new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(v) + (c.unit === 'USD' ? '' : ` ${c.unit}`);
}
export function detailView(entry) {
  if (!validEntry(entry)) throw new Error('Invalid public research entry.');
  const body = el('div', undefined, 'journal-content');
  if (entry.case) {
    section(body, entry.kind === 'portfolio_critic' ? 'Review' : 'Investment case', entry.case);
    section(body, 'Evidence');
    const facts = el('ul', undefined, 'journal-claims');
    for (const claim of entry.claims) {
      const row = el('li');
      row.append(el('span', `${claim.symbol} · ${claim.metric.replaceAll('_', ' ')}`), el('strong', amount(claim)));
      const meta = el('small', `${claim.start ? claim.start + ' → ' : ''}${claim.end}`);
      meta.append(link(claim.source.title + ' ↗', claim.source.url)); row.append(meta); facts.append(row);
    }
    body.append(facts, el('p', 'Figures matched to the cited filings. The investment interpretation remains an agent assessment.', 'journal-check'));
    if (entry.questions.length) {
      section(body, 'Open questions'); const list = el('ul');
      for (const q of entry.questions) list.append(el('li', `${q.symbol} · ${q.question}`)); body.append(list);
    }
    const action = entry.decision.action;
    const statements = { research: 'Research only. No portfolio order.', proposal: 'Proposed allocation. This entry is not an executed trade.', approve: 'The reviewer approved this proposal. Execution is recorded separately in the portfolio.', revise: 'The reviewer requested changes to the proposal.', abstain: 'The reviewer declined to approve the proposal.' };
    section(body, 'Decision', statements[action]);
    if (entry.decision.targets.length) {
      const list = el('ul', undefined, 'target-list');
      for (const t of entry.decision.targets) { const row = el('li', t.symbol); row.append(el('span', `${(Number(t.weight) * 100).toFixed(1).replace(/\.0$/, '')}%`)); list.append(row); } body.append(list);
    }
    if (entry.decision.abstain_reason) body.append(el('p', entry.decision.abstain_reason));
  } else body.append(el('p', entry.outcome === 'unverified' ? 'The final answer did not pass publication checks. Its investment claims are withheld.' : 'The research request ended without a completed finding.'));
  const metadata = el('details', undefined, 'journal-metadata'); metadata.append(el('summary', 'Research details'));
  const dl = el('dl');
  const rows = [
    ['Model', PROFILES[entry.profile]], ['Request admitted', date(entry.started_at) + ' ET'], ['Completion observed', date(entry.completed_at) + ' ET'],
    ['Observed elapsed time', `${Math.round(entry.metrics.latency_seconds).toLocaleString('en-US')} seconds`],
    ['Known inference cost', entry.metrics.cost_usd === null ? 'Unsettled' : '$' + Number(entry.metrics.cost_usd).toFixed(4)],
    ['Source checks', entry.metrics.source_checks_passed ? `${entry.metrics.claims_checked} claims matched` : 'Not passed'],
  ];
  for (const [key, value] of rows) dl.append(el('dt', key), el('dd', value));
  metadata.append(dl, el('p', 'This record preserves the final investment explanation, not the model’s internal reasoning. Times record admission and observed completion.'));
  body.append(metadata, link('Link to this entry ↗', `/portfolio/research/#${entry.id}`));
  body.lastChild.className = 'journal-permalink';
  return body;
}
async function fetchData(path) {
  const previous = cache.get(path), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, { credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: previous?.etag ? { 'If-None-Match': previous.etag } : {} });
    if (response.status === 304 && previous) return previous.data;
    if (!response.ok) throw new Error('Research is temporarily unavailable.');
    if (Number(response.headers.get('Content-Length')) > 262144) throw new Error('Invalid research response.');
    const raw = await response.text(); if (new TextEncoder().encode(raw).length > 262144) throw new Error('Invalid research response.');
    const data = JSON.parse(raw); cache.set(path, { data, etag: response.headers.get('ETag') }); return data;
  } finally { clearTimeout(timeout); }
}
async function getEntry(id) {
  if (entryCache.has(id)) return entryCache.get(id);
  const data = await fetchData(`${API}/${id}`);
  if (!validEntry(data) || data.id !== id) throw new Error('Invalid research entry.');
  entryCache.set(id, data); return data;
}
function rowView(entry) {
  const row = el('details', undefined, 'journal-entry'); row.id = entry.id;
  const summary = el('summary'), at = el('time', date(entry.completed_at), 'journal-time'); at.dateTime = entry.completed_at;
  const label = el('span'); label.append(el('span', `${entry.symbol ? entry.symbol + ' · ' : ''}${KINDS[entry.kind]}`, 'journal-company'), el('span', entry.title, `journal-title${entry.outcome === 'passed' ? '' : ' journal-failure'}`));
  summary.append(at, label); row.append(summary);
  let loading = false, loaded = false;
  row.addEventListener('toggle', async () => {
    if (!row.open || loaded || loading) return;
    loading = true; const notice = el('p', 'Loading the finding…', 'journal-content'); row.append(notice);
    try { const entry = await getEntry(row.id); notice.replaceWith(detailView(entry)); loaded = true; }
    catch { notice.textContent = 'Unable to load this finding. Close and reopen to retry.'; }
    finally { loading = false; if (!loaded) row.addEventListener('toggle', () => { if (!row.open) notice.remove(); }, { once: true }); }
  });
  return row;
}
export function groupEntries(entries) {
  const groups = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (entry.outcome !== 'passed' && previous && previous[0].outcome !== 'passed') previous.push(entry);
    else groups.push([entry]);
  }
  return groups;
}
export function issueLabel(entries) {
  const failed = entries.filter(entry => entry.outcome === 'failed').length;
  return `${entries.length} requests ${failed === entries.length ? 'did not complete' : failed === 0 ? 'did not pass checks' : 'did not complete or pass checks'}`;
}
function renderHistory(entries, root, nodes) {
  // Reuse loaded entry nodes when extending a page, preserving open findings.
  const opened = new Set([...root.querySelectorAll('.journal-issues[open]')].flatMap(group => group.memberIds));
  const views = [];
  for (const group of groupEntries(entries)) {
    const rows = group.map(entry => {
      if (!nodes.has(entry.id)) nodes.set(entry.id, rowView(entry));
      return nodes.get(entry.id);
    });
    if (group.length === 1) { views.push(rows[0]); continue; }
    const view = el('details', undefined, 'journal-issues');
    view.memberIds = group.map(entry => entry.id);
    const title = el('summary');
    const at = el('time', date(group[0].completed_at), 'journal-time'); at.dateTime = group[0].completed_at;
    title.append(at, el('span', issueLabel(group), 'journal-title journal-failure'));
    const contents = el('div', undefined, 'journal-issue-records'); contents.append(...rows);
    view.append(title, contents);
    view.open = rows.some(row => row.open) || view.memberIds.some(id => opened.has(id));
    views.push(view);
  }
  root.replaceChildren(...views);
}
export function revealEntry(row) {
  // A stable link to a failed request must reveal its collapsed parent group.
  for (let parent = row.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true;
  }
  row.open = true;
  row.scrollIntoView({ block: 'start', behavior: 'instant' });
}
export async function startJournal() {
  const root = document.getElementById('journal'), more = document.getElementById('journal-more'), refresh = document.getElementById('journal-refresh'), status = document.getElementById('journal-status');
  if (!root) return;
  let cursor = null, loading = false, firstId = null;
  const seen = new Set();
  const entries = [], nodes = new Map();
  async function page({ append = false } = {}) {
    if (loading) return;
    loading = true; more.disabled = true;
    try {
      const data = await fetchData(API + (append && cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      if (data?.schema_version !== 1 || !Array.isArray(data.entries) || data.entries.length > 12 || !data.entries.every(validSummary) || (data.next_cursor !== null && !/^\d{15}:[a-f0-9]{64}$/.test(data.next_cursor))) throw new Error('Invalid history.');
      if (!append) { seen.clear(); entries.length = 0; nodes.clear(); root.replaceChildren(); firstId = data.entries[0]?.id || null; }
      for (const entry of data.entries) if (!seen.has(entry.id)) { entries.push(entry); seen.add(entry.id); }
      renderHistory(entries, root, nodes);
      cursor = data.next_cursor; more.hidden = cursor === null; status.textContent = data.entries.length || append ? '' : 'No research findings published yet.';
      refresh.hidden = true;
    } catch { status.textContent = 'Research history is temporarily unavailable. Please retry.'; }
    finally { root.setAttribute('aria-busy', 'false'); loading = false; more.disabled = false; }
  }
  async function openHash() {
    const id = location.hash.slice(1); if (!recordId(id)) return;
    let row = document.getElementById(id);
    if (!row) {
      try {
        const entry = await getEntry(id); entries.unshift(summary(entry)); seen.add(id);
        renderHistory(entries, root, nodes); row = nodes.get(id);
      }
      catch { status.textContent = 'This research entry is not available.'; return; }
    }
    revealEntry(row);
  }
  more.addEventListener('click', () => page({ append: true }));
  refresh.addEventListener('click', async () => { await page(); await openHash(); });
  window.addEventListener('hashchange', openHash);
  await page(); await openHash();
  setInterval(async () => {
    if (document.hidden || loading) return;
    try {
      const data = await fetchData(API);
      if (data?.schema_version === 1 && Array.isArray(data.entries) && data.entries.every(validSummary) && data.entries[0]?.id !== firstId) refresh.hidden = false;
    } catch { /* Preserve visible history and open entries during brief failures. */ }
  }, 60000);
}
if (typeof document !== 'undefined' && document.getElementById('journal')) startJournal();
