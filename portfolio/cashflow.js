// Checked issuer data only. Visitor controls perform local integer arithmetic.
export const GROUPS = Object.freeze({
  net_income: 'Net income',
  depreciation_amortization_other: 'D&A and other',
  stock_based_compensation: 'Stock compensation',
  investment_gains_losses_adjustment: 'Investment adjustment',
  deferred_income_taxes_adjustment: 'Deferred taxes',
  operating_assets_liabilities_total: 'Operating assets & liabilities',
});
export const DETAILS = Object.freeze({
  accounts_receivable: 'Accounts receivable', inventories: 'Inventories',
  other_current_assets: 'Other current assets', other_long_term_assets: 'Other long-term assets',
  accounts_payable: 'Accounts payable', unearned_revenue: 'Unearned revenue',
  income_taxes: 'Income taxes', other_current_liabilities: 'Other current liabilities',
  other_long_term_liabilities: 'Other long-term liabilities',
});
const PERIODS = ['FY2025', 'FY2026', 'change'];
const SOURCE_URL = 'https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast';
const SOURCE_HASH = '6e6918e055dbd54df109ce2da8e3e628fb923c7c35315eafba34ec7a248c02a8';
const RESEARCH_URL = 'https://github.com/bwoods1998/portfolio-agent/blob/main/data/research/';
const exact = (v, names) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const integer = v => typeof v === 'string' && /^(?:0|-?[1-9][0-9]{0,8})$/.test(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const stamp = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().replace('.000Z', 'Z') === v;
const rowsValid = (rows, labels) => Array.isArray(rows) && rows.length === Object.keys(labels).length && rows.every((row, i) => exact(row, ['id', 'FY2025', 'FY2026']) && row.id === Object.keys(labels)[i] && integer(row.FY2025) && integer(row.FY2026));

export function validCashflow(data) {
  if (!exact(data, ['schema_version', 'company', 'unit', 'scope', 'basis', 'source', 'provenance', 'groups', 'details', 'totals']) || data.schema_version !== 1 || data.company !== 'Microsoft' || data.unit !== 'USD millions' || data.scope !== 'company_wide' || data.basis !== 'annual_unaudited') return false;
  const s = data.source;
  if (!exact(s, ['id', 'title', 'url', 'published_at', 'fetched_at', 'sha256']) || s.id !== 'fy26-results' || s.title !== 'Microsoft FY2026 results · Cash flow statements (unaudited)' || s.url !== SOURCE_URL || s.published_at !== '2026-07-29' || s.sha256 !== SOURCE_HASH || !stamp(s.fetched_at) || s.fetched_at.slice(0, 10) < s.published_at) return false;
  if (!exact(data.provenance, ['rubric_sha256', 'audit_sha256']) || !Object.values(data.provenance).every(hash) || !rowsValid(data.groups, GROUPS) || !rowsValid(data.details, DETAILS) || !exact(data.totals, ['FY2025', 'FY2026']) || !Object.values(data.totals).every(integer)) return false;
  return PERIODS.slice(0, 2).every(year => {
    const sum = rows => rows.reduce((total, row) => total + BigInt(row[year]), 0n);
    return BigInt(data.totals[year]) > 0n && sum(data.groups) === BigInt(data.totals[year]) && sum(data.details) === BigInt(data.groups.at(-1)[year]);
  });
}

export function periodValue(row, period) {
  if (!PERIODS.includes(period) || !integer(row?.FY2025) || !integer(row?.FY2026)) throw new TypeError('Invalid annual cash-flow value');
  return period === 'change' ? BigInt(row.FY2026) - BigInt(row.FY2025) : BigInt(row[period]);
}

export function formatMillions(value, signed = false) {
  if (typeof value !== 'bigint') throw new TypeError('Expected exact integer millions');
  const absolute = (value < 0n ? -value : value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0n ? '−' : signed && value > 0n ? '+' : ''}${absolute}`;
}

export function cashflowView(data, period = 'change', detail = false) {
  if (!validCashflow(data) || !PERIODS.includes(period)) throw new TypeError('Invalid cash-flow publication or period');
  let cumulative = 0n;
  const rows = (detail ? data.details : data.groups).map(row => {
    const value = periodValue(row, period), start = cumulative;
    cumulative += value;
    return { id: row.id, label: (detail ? DETAILS : GROUPS)[row.id], value, start, end: cumulative };
  });
  const positions = [0n, ...rows.flatMap(row => [row.start, row.end])];
  return { period, rows, total: cumulative,
    minimum: positions.reduce((a, b) => a < b ? a : b), maximum: positions.reduce((a, b) => a > b ? a : b) };
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function svg(tag, attrs = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function drawBridge(target, view, totalLabel) {
  target.replaceChildren();
  const span = Number(view.maximum - view.minimum) || 1;
  const x = value => 6 + 988 * Number(value - view.minimum) / span;
  for (const row of [...view.rows, { label: totalLabel, value: view.total, start: 0n, end: view.total, total: true }]) {
    const line = node('div', undefined, 'cashflow-row' + (row.total ? ' cashflow-total' : ''));
    const label = node('span', row.label, 'cashflow-label');
    const value = node('span', formatMillions(row.value, !row.total || view.period === 'change'), 'cashflow-value');
    const plot = svg('svg', { viewBox: '0 0 1000 24', preserveAspectRatio: 'none', 'aria-hidden': 'true', class: 'cashflow-bar' });
    const title = svg('title'); title.textContent = `${row.label}: ${formatMillions(row.value)} USD millions. Running total: ${formatMillions(row.end)}.`;
    plot.append(title, svg('path', { d: `M${x(0n)} 0V24`, class: 'cashflow-zero' }));
    if (!row.total) plot.append(svg('path', { d: `M${x(row.start)} 0V6M${x(row.end)} 18V24`, class: 'cashflow-connector' }));
    plot.append(svg('rect', { x: Math.min(x(row.start), x(row.end)), y: 6,
      width: Math.abs(x(row.end) - x(row.start)), height: 12,
      class: row.total ? 'cashflow-total-bar' : row.value < 0n ? 'cashflow-negative' : 'cashflow-positive' }));
    line.append(label, plot, value); target.append(line);
  }
}

export function mountCashflow(data, target) {
  if (!validCashflow(data)) throw new TypeError('Invalid checked cash-flow publication');
  let period = 'change';
  const top = node('div', undefined, 'cashflow-top');
  const controls = node('div', undefined, 'cashflow-periods'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Cash-flow period');
  const buttons = PERIODS.map(id => {
    const button = node('button', { FY2025: 'FY25', FY2026: 'FY26', change: 'Change' }[id]);
    button.type = 'button'; button.setAttribute('data-period', id);
    button.addEventListener('click', () => { period = id; draw(); }); controls.append(button); return button;
  });
  const unit = node('span', 'USD millions', 'cashflow-unit'); top.append(controls, unit);
  const caption = node('p', undefined, 'cashflow-caption');
  const chart = node('div', undefined, 'cashflow-chart'); chart.setAttribute('role', 'group');
  const status = node('span', undefined, 'sr-only'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const detail = node('details', undefined, 'cashflow-detail');
  detail.append(node('summary', 'Operating assets & liabilities · 9 rows'));
  const detailChart = node('div', undefined, 'cashflow-detail-chart');
  detail.append(node('p', 'Cash-flow adjustments, including long-term items.', 'cashflow-note'), detailChart);
  const notes = node('details', undefined, 'cashflow-source'); notes.append(node('summary', 'Source & scope'));
  notes.append(node('p', 'Microsoft · Annual, unaudited, company-wide. Changes compare FY2026 with FY2025. D&A includes other adjustments; investment adjustments reverse recognized gains or losses. These amounts do not measure AI returns.'));
  const links = node('p', undefined, 'cashflow-links');
  for (const [label, href] of [['Issuer statement ↗', data.source.url], ['Checked figures ↗', RESEARCH_URL + 'dossier-rubric.json'], ['Nine-row audit ↗', RESEARCH_URL + 'working-capital-audit.json']]) {
    const a = node('a', label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', label.replace(' ↗', '') + ' (opens in a new tab)'); links.append(a);
  }
  notes.append(links, node('p', `Published ${data.source.published_at} · Captured ${data.source.fetched_at.slice(0, 10)}`));
  for (const [label, value] of [['Source SHA256', data.source.sha256], ['Figures SHA256', data.provenance.rubric_sha256], ['Audit SHA256', data.provenance.audit_sha256]]) notes.append(node('p', `${label} · ${value}`, 'cashflow-hash'));
  target.replaceChildren(top, caption, chart, status,
    node('p', 'Annual · Unaudited · Company-wide', 'cashflow-scope'), detail, notes);
  function draw() {
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(PERIODS[index] === period)));
    const label = period === 'change' ? 'FY2026 − FY2025' : period;
    caption.textContent = label + ' · Operating cash flow';
    chart.setAttribute('aria-label', label + ' contributions in USD millions');
    const view = cashflowView(data, period);
    drawBridge(chart, view, period === 'change' ? 'Cash-flow change' : 'Operating cash flow');
    drawBridge(detailChart, cashflowView(data, period, true), 'Net adjustment');
    status.textContent = `${label}. Operating cash flow ${formatMillions(view.total, period === 'change')} USD millions.`;
  }
  draw();
}

if (typeof document !== 'undefined' && document.querySelector('#cashflow-content')) {
  (async () => {
    try {
      const response = await fetch('./cashflow.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 16000) return;
      const text = await response.text(); if (text.length > 16000) return;
      const data = JSON.parse(text); if (!validCashflow(data)) return;
      mountCashflow(data, document.querySelector('#cashflow-content'));
      document.querySelector('#cashflow').hidden = false;
    } catch { /* Optional checked data cannot interrupt the research ledger. */ }
  })();
}
