const ROOT_KEYS = ['schema_version', 'published_at', 'portfolio', 'research', 'latest_decision', 'sail'];
const PORTFOLIO_KEYS = ['schema_version', 'mode', 'currency', 'status', 'created_at', 'as_of', 'initial_cash', 'cash', 'equity', 'net_deposits', 'trading_fees', 'holdings', 'pending_decisions', 'performance', 'history'];
const DECIMAL_SCALE = 100000000000000n;
const MAX_BODY_BYTES = 524288;
const SVG_NS = 'http://www.w3.org/2000/svg';
const REPOSITORY = 'https://github.com/bwoods1998/portfolio-agent';
const responseCache = new Map();
const mounted = new WeakMap();
const loading = new WeakMap();
const TASK_KIND = {
  company: 'Company research', cache_control: 'Cache comparison', fresh_review: 'Fresh review',
  window_pair: 'Completion-window comparison', cache_write: 'Shared context', allocation: 'Portfolio allocation',
  portfolio_critic: 'Allocation review', memory_review: 'Memory review',
};
const TASK_PROFILE = {
  pro_flex: 'DeepSeek V4 Pro', pro_asap: 'DeepSeek V4 Pro · ASAP',
  kimi_flex: 'Kimi K2.6 · Flex', kimi_asap: 'Kimi K2.6 · ASAP',
  kimi_balanced: 'Kimi K2.6 · Balanced', glm_flex: 'GLM 5.3', k3: 'Kimi K3',
};

function keys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}
function text(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)) return false;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 19) === value.slice(0, 19);
}
function decimal(value, { signed = false, fraction = 14 } = {}) {
  if (typeof value !== 'string' || value.length > 32) return false;
  const pattern = new RegExp(`^${signed ? '-?' : ''}(?:0|[1-9]\\d{0,14})(?:\\.\\d{1,${fraction}})?$`);
  return pattern.test(value);
}
function scaled(value) {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return (BigInt(whole) * DECIMAL_SCALE + BigInt(fraction.padEnd(14, '0'))) * (negative ? -1n : 1n);
}
function nullable(value, check) { return value === null || check(value); }
function symbol(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value); }
function percentValue(value) { return decimal(value, { signed: true, fraction: 12 }); }
function before(left, right) { return Date.parse(left) <= Date.parse(right); }
function count(value, max = 100000) { return Number.isSafeInteger(value) && value >= 0 && value <= max; }
function validActivity(activity, publishedAt) {
  if (!keys(activity, ['heartbeat_at', 'completed_requests', 'total_requests', 'companies_researched', 'universe_size', 'reserved_cost_usd', 'tasks'])
    || !nullable(activity.heartbeat_at, instant) || (activity.heartbeat_at !== null && !before(activity.heartbeat_at, publishedAt))
    || !count(activity.completed_requests) || !count(activity.total_requests) || activity.completed_requests > activity.total_requests
    || !count(activity.companies_researched, 600) || !count(activity.universe_size, 600) || activity.universe_size < 1
    || activity.companies_researched > activity.universe_size || !decimal(activity.reserved_cost_usd)
    || !Array.isArray(activity.tasks) || activity.tasks.length > 3) return false;
  return activity.tasks.every(task => keys(task, ['symbol', 'kind', 'profile', 'status'])
    && nullable(task.symbol, symbol) && Object.hasOwn(TASK_KIND, task.kind) && Object.hasOwn(TASK_PROFILE, task.profile)
    && ['queued', 'running'].includes(task.status));
}

export function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    const hosts = ['sec.gov', 'www.sec.gov', 'spglobal.com', 'www.spglobal.com', 'sailresearch.com', 'www.sailresearch.com', 'docs.sailresearch.com'];
    if (hosts.includes(url.hostname)) return url.href;
    if (url.hostname === 'github.com' && url.pathname.startsWith('/bwoods1998/portfolio-agent/')) return url.href;
  } catch { /* Invalid or non-public source URL. */ }
  return null;
}

export function validPortfolio(p) {
  if (!keys(p, PORTFOLIO_KEYS) || p.schema_version !== 1 || p.mode !== 'paper' || p.currency !== 'USD'
    || !['cash', 'pending', 'invested', 'suspended'].includes(p.status)
    || !instant(p.created_at) || !nullable(p.as_of, instant)
    || (p.as_of !== null && !before(p.created_at, p.as_of))) return false;
  for (const field of ['initial_cash', 'cash', 'trading_fees']) if (!decimal(p[field])) return false;
  if (scaled(p.initial_cash) <= 0n || !decimal(p.net_deposits, { signed: true }) || !nullable(p.equity, decimal)) return false;
  if (!Array.isArray(p.holdings) || p.holdings.length > 600 || new Set(p.holdings.map(h => h?.symbol)).size !== p.holdings.length) return false;
  for (const h of p.holdings) {
    if (!keys(h, ['symbol', 'quantity', 'price', 'market_value']) || !symbol(h.symbol)
      || !decimal(h.quantity, { fraction: 6 }) || scaled(h.quantity) <= 0n
      || !nullable(h.price, v => decimal(v, { fraction: 8 }) && scaled(v) > 0n)
      || !nullable(h.market_value, decimal) || ((h.price === null) !== (h.market_value === null))) return false;
    if (h.price !== null && scaled(h.quantity) * scaled(h.price) !== scaled(h.market_value) * DECIMAL_SCALE) return false;
  }
  const allMarked = p.holdings.every(h => h.market_value !== null);
  if (allMarked && p.equity !== null && scaled(p.equity) !== scaled(p.cash) + p.holdings.reduce((sum, h) => sum + scaled(h.market_value), 0n)) return false;
  if (!allMarked && p.equity !== null) return false;
  if (!Array.isArray(p.pending_decisions) || p.pending_decisions.length > 100) return false;
  const decisionIds = new Set();
  for (const d of p.pending_decisions) {
    if (!keys(d, ['id', 'decided_at', 'targets', 'evidence_count']) || !text(d.id, 100) || decisionIds.has(d.id)
      || !instant(d.decided_at) || !before(p.created_at, d.decided_at)
      || !Number.isSafeInteger(d.evidence_count) || d.evidence_count < 0 || d.evidence_count > 10000
      || !Array.isArray(d.targets) || d.targets.length > 600) return false;
    decisionIds.add(d.id);
    let total = 0n;
    const symbols = new Set();
    for (const target of d.targets) {
      if (!keys(target, ['symbol', 'weight']) || !symbol(target.symbol) || symbols.has(target.symbol) || !decimal(target.weight)) return false;
      const weight = scaled(target.weight);
      if (weight > DECIMAL_SCALE) return false;
      total += weight; symbols.add(target.symbol);
    }
    if (total > DECIMAL_SCALE) return false;
  }
  if (p.status === 'cash' && (p.holdings.length || p.pending_decisions.length)) return false;
  if (p.status === 'pending' && !p.pending_decisions.length) return false;
  if (p.status === 'invested' && !p.holdings.length) return false;
  const perf = p.performance;
  if (!keys(perf, ['started_at', 'time_weighted_return_pct', 'investment_pnl', 'benchmark'])
    || !nullable(perf.started_at, instant) || !nullable(perf.time_weighted_return_pct, percentValue)
    || !nullable(perf.investment_pnl, value => decimal(value, { signed: true }))) return false;
  const benchmark = perf.benchmark;
  if (!keys(benchmark, ['name', 'status', 'return_pct', 'excess_return_percentage_points'])
    || benchmark.name !== 'S&P 500 Total Return' || !['available', 'unavailable'].includes(benchmark.status)
    || !nullable(benchmark.return_pct, percentValue) || !nullable(benchmark.excess_return_percentage_points, percentValue)) return false;
  if (benchmark.status === 'unavailable' && (benchmark.return_pct !== null || benchmark.excess_return_percentage_points !== null)) return false;
  if (benchmark.status === 'available' && benchmark.return_pct === null) return false;
  if (benchmark.status === 'available' && p.status !== 'suspended' && (benchmark.excess_return_percentage_points === null || perf.time_weighted_return_pct === null)) return false;
  if (perf.time_weighted_return_pct === null && benchmark.excess_return_percentage_points !== null) return false;
  if (benchmark.excess_return_percentage_points !== null && scaled(benchmark.excess_return_percentage_points) !== scaled(perf.time_weighted_return_pct) - scaled(benchmark.return_pct)) return false;
  if (perf.investment_pnl !== null && (p.equity === null || scaled(perf.investment_pnl) !== scaled(p.equity) - scaled(p.initial_cash) - scaled(p.net_deposits))) return false;
  if (perf.started_at === null && (perf.time_weighted_return_pct !== null || perf.investment_pnl !== null || benchmark.status !== 'unavailable')) return false;
  if (perf.started_at !== null && (!before(p.created_at, perf.started_at) || (perf.time_weighted_return_pct === null && p.status !== 'suspended'))) return false;
  if (!Array.isArray(p.history) || p.history.length > 2000 || (perf.started_at === null && p.history.length)) return false;
  let prior = null;
  for (const point of p.history) {
    if (!keys(point, ['at', 'equity', 'time_weighted_return_pct', 'benchmark_return_pct'])
      || !instant(point.at) || !before(p.created_at, point.at) || (prior !== null && Date.parse(point.at) <= Date.parse(prior))
      || (p.as_of !== null && !before(point.at, p.as_of))
      || !decimal(point.equity) || !percentValue(point.time_weighted_return_pct)
      || !nullable(point.benchmark_return_pct, percentValue)) return false;
    prior = point.at;
  }
  if (perf.started_at !== null) {
    if (!p.history.length || p.history[0].at !== perf.started_at || p.history.at(-1).at !== p.as_of) return false;
    const last = p.history.at(-1);
    if (perf.time_weighted_return_pct !== null && scaled(last.time_weighted_return_pct) !== scaled(perf.time_weighted_return_pct)) return false;
    if (p.equity !== null && scaled(last.equity) !== scaled(p.equity)) return false;
    if (benchmark.return_pct !== null && (last.benchmark_return_pct === null || scaled(last.benchmark_return_pct) !== scaled(benchmark.return_pct))) return false;
  }
  return true;
}

export function validRuntime(value) {
  try {
    if (!keys(value, [...ROOT_KEYS, ...(Object.hasOwn(value || {}, 'service') ? ['service'] : [])]) || value.schema_version !== 1 || !instant(value.published_at)
      || !nullable(value.portfolio, validPortfolio)) return false;
    if (Object.hasOwn(value, 'service')) {
      const s = value.service;
      if (!keys(s, ['id', 'status', 'next_wake_at', 'heartbeat_at', 'week_ends_at', 'reason_code'])
        || typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(s.id)
        || !['running', 'waiting', 'paused', 'needs_attention', 'complete'].includes(s.status)
        || !instant(s.heartbeat_at) || !before(s.heartbeat_at, value.published_at) || !instant(s.week_ends_at)
        || !nullable(s.next_wake_at, instant)
        || ![null, 'scheduled_wait', 'funding_needed', 'data_unavailable', 'recovering', 'manual_pause', 'week_complete', 'runtime_error'].includes(s.reason_code)) return false;
    }
    if (value.portfolio && (!before(value.portfolio.created_at, value.published_at)
      || (value.portfolio.as_of && !before(value.portfolio.as_of, value.published_at)))) return false;
    const research = value.research;
    if (!keys(research, ['status', 'updated_at', 'question', 'next'])
      || !['not_started', 'running', 'complete', 'paused', 'needs_attention'].includes(research.status)
      || !nullable(research.updated_at, instant) || !text(research.question, 200) || !text(research.next, 200)
      || (research.updated_at !== null && !before(research.updated_at, value.published_at))) return false;
    const decision = value.latest_decision;
    if (decision !== null) {
      if (!keys(decision, ['at', 'action', 'summary', 'sources']) || !instant(decision.at)
        || !before(decision.at, value.published_at) || !['hold', 'rebalance'].includes(decision.action)
        || !text(decision.summary, 350) || !Array.isArray(decision.sources) || decision.sources.length > 8) return false;
      for (const source of decision.sources) {
        if (!keys(source, ['title', 'url']) || !text(source.title, 120) || sourceUrl(source.url) === null) return false;
      }
    }
    const sail = value.sail;
    if (!keys(sail, ['status', 'started_at', 'ends_at', 'known_cost_usd', 'unsettled_requests', ...(Object.hasOwn(sail || {}, 'activity') ? ['activity'] : [])])
      || !['not_started', 'running', 'complete', 'needs_attention'].includes(sail.status)
      || !nullable(sail.started_at, instant) || !nullable(sail.ends_at, instant)
      || !decimal(sail.known_cost_usd) || !Number.isSafeInteger(sail.unsettled_requests)
      || sail.unsettled_requests < 0 || sail.unsettled_requests > 100000) return false;
    if (sail.status === 'not_started' && (sail.started_at !== null || sail.ends_at !== null)) return false;
    if (sail.status !== 'not_started' && (sail.started_at === null || sail.ends_at === null || !before(sail.started_at, sail.ends_at))) return false;
    if (sail.started_at !== null && !before(sail.started_at, value.published_at)) return false;
    if (Object.hasOwn(sail, 'activity') && !validActivity(sail.activity, value.published_at)) return false;
    return true;
  } catch { return false; }
}

function rounded(value, places = 2) {
  const number = scaled(value), negative = number < 0n;
  const absolute = negative ? -number : number;
  const divisor = 10n ** BigInt(14 - places);
  const result = (absolute + divisor / 2n) / divisor;
  return { value: result, negative: negative && result > 0n };
}
export function money(value) {
  if (value === null) return '—';
  const roundedValue = rounded(value);
  const whole = (roundedValue.value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${roundedValue.negative ? '−' : ''}$${whole}.${(roundedValue.value % 100n).toString().padStart(2, '0')}`;
}
export function percent(value, suffix = '%') {
  if (value === null) return '—';
  const roundedValue = rounded(value);
  const sign = roundedValue.negative ? '−' : roundedValue.value > 0n ? '+' : '';
  return `${sign}${roundedValue.value / 100n}.${(roundedValue.value % 100n).toString().padStart(2, '0')}${suffix}`;
}
function unsignedPercent(value) { return percent(value).replace(/^\+/, ''); }
function weight(value) { return unsignedPercent((Number(value) * 100).toFixed(8)).replace(/\.00%$/, '%'); }
function date(value, includeTime = false) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } : {}),
  }).format(new Date(value));
}
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined && content !== null) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function link(label, url) { const node = element('a', label); node.href = url; return node; }
function time(value, includeTime = false) { const node = element('time', date(value, includeTime)); node.dateTime = value; return node; }
function heading(title, note) {
  const row = element('div', null, 'section-heading'); row.append(element('h2', title));
  if (note) row.append(typeof note === 'string' ? element('span', note) : note);
  return row;
}
function metric(label, value, change) {
  const row = element('div'); row.append(element('dt', label));
  const result = element('dd', value);
  if (change !== null && change !== undefined) result.className = Number(change) > 0 ? 'positive' : Number(change) < 0 ? 'negative' : '';
  row.append(result); return row;
}

export function chartData(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const times = history.map(point => Date.parse(point.at));
  if (times.some((at, index) => !Number.isFinite(at) || (index > 0 && at <= times[index - 1]))) return null;
  const portfolio = history.map(point => Number(point.time_weighted_return_pct));
  const hasBenchmark = history.every(point => point.benchmark_return_pct !== null);
  const benchmark = hasBenchmark ? history.map(point => Number(point.benchmark_return_pct)) : [];
  const all = [...portfolio, ...benchmark, 0];
  if (all.some(value => !Number.isFinite(value))) return null;
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 0.5; max += 0.5; }
  const padding = (max - min) * 0.14; min -= padding; max += padding;
  const x = at => 2 + (at - times[0]) / (times.at(-1) - times[0]) * 746;
  const y = value => 18 + (max - value) / (max - min) * 168;
  const path = values => values.map((value, index) => `${index ? 'L' : 'M'}${x(times[index]).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
  return { portfolio: path(portfolio), benchmark: hasBenchmark ? path(benchmark) : null, min, max, zero: y(0), ticks: [max, (max + min) / 2, min].map(value => ({ value, y: y(value) })) };
}
function svgElement(tag, attributes, content) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content) node.textContent = content;
  return node;
}
function chart(history) {
  const data = chartData(history);
  if (!data) return null;
  const figure = element('figure', null, 'performance-chart');
  const frame = element('div', null, 'chart-frame');
  const axis = element('div', null, 'chart-axis');
  axis.setAttribute('aria-hidden', 'true');
  const svg = svgElement('svg', { viewBox: '0 0 760 210', preserveAspectRatio: 'none', role: 'img', 'aria-label': data.benchmark ? 'Recorded paper portfolio and S&P 500 total returns over time.' : 'Recorded paper portfolio returns. Benchmark history is unavailable.' });
  for (const tick of data.ticks) {
    svg.append(svgElement('line', { x1: 2, x2: 748, y1: tick.y, y2: tick.y, class: 'chart-grid' }));
    axis.append(element('span', `${tick.value.toFixed(1)}%`));
  }
  svg.append(svgElement('line', { x1: 2, x2: 748, y1: data.zero, y2: data.zero, class: 'chart-grid chart-zero' }));
  if (data.benchmark) svg.append(svgElement('path', { d: data.benchmark, class: 'chart-benchmark' }));
  svg.append(svgElement('path', { d: data.portfolio, class: 'chart-portfolio' }));
  frame.append(axis, svg);
  figure.append(frame);
  const caption = element('figcaption', null, 'history-caption');
  const legend = element('span', null, 'chart-legend'); legend.append(element('span', 'Paper portfolio'));
  if (data.benchmark) legend.append(element('span', 'S&P 500 Total Return'));
  caption.append(legend, element('span', `${date(history[0].at)} – ${date(history.at(-1).at)}`));
  figure.append(caption);
  const details = element('details', null, 'history-data'); details.append(element('summary', 'Recorded observations'));
  const table = element('table', null, 'history-table');
  const head = element('thead'), header = element('tr');
  for (const label of ['Date (ET)', 'Portfolio', 'S&P 500 TR']) header.append(element('th', label));
  head.append(header); table.append(head);
  const body = element('tbody');
  // Full exported history remains in runtime.json; the table shows recent observations.
  for (const point of history.slice(-30)) {
    const row = element('tr'); row.append(element('td', date(point.at, true)), element('td', percent(point.time_weighted_return_pct)), element('td', percent(point.benchmark_return_pct))); body.append(row);
  }
  table.append(body); details.append(table); figure.append(details);
  return figure;
}

function portfolioView(portfolio) {
  const section = element('section', null, 'portfolio');
  section.append(heading('Paper portfolio', portfolio ? `${money(portfolio.equity)} virtual capital` : 'Preparing'));
  if (!portfolio) {
    section.append(element('p', 'The paper portfolio has not started. Live brokerage integration will follow.', 'empty-state'));
    return section;
  }
  const performance = portfolio.performance;
  const metrics = element('dl', null, 'metrics');
  metrics.append(metric('Portfolio return', percent(performance.time_weighted_return_pct), performance.time_weighted_return_pct));
  metrics.append(metric('S&P 500 total return', percent(performance.benchmark.return_pct)));
  metrics.append(metric('Difference', percent(performance.benchmark.excess_return_percentage_points, ' pp'), performance.benchmark.excess_return_percentage_points));
  section.append(metrics);
  if (performance.started_at === null) section.append(element('p', 'No performance record yet.', 'portfolio-note'));
  else {
    section.append(element('p', `Since ${date(performance.started_at)} · Time-weighted, after recorded trading costs.${performance.benchmark.status === 'unavailable' ? ' Benchmark data unavailable.' : ''}`, 'portfolio-note'));
    const performanceChart = chart(portfolio.history);
    if (performanceChart) section.append(performanceChart);
  }
  const allocation = element('div', null, 'allocation');
  for (const holding of portfolio.holdings) {
    const row = element('div', null, 'allocation-row');
    row.append(element('span', holding.symbol), element('span', `${holding.quantity} shares · ${money(holding.market_value)}`)); allocation.append(row);
  }
  const cash = element('div', null, 'allocation-row'); cash.append(element('span', 'Cash'), element('span', money(portfolio.cash))); allocation.append(cash);
  section.append(allocation);
  if (portfolio.pending_decisions.length) {
    const pending = element('div', null, 'pending'); pending.append(element('h3', 'Pending allocation'));
    const latest = portfolio.pending_decisions.at(-1);
    const targets = element('ul', null, 'target-list');
    for (const target of latest.targets) { const item = element('li', target.symbol); item.append(element('span', weight(target.weight))); targets.append(item); }
    if (latest.targets.length) pending.append(targets);
    else pending.append(element('p', 'Move to cash.'));
    pending.append(element('p', 'Paper orders await market-session prices.'));
    section.append(pending);
  }
  if (portfolio.status === 'suspended') section.append(element('p', 'Paper execution is paused pending a state check.', 'portfolio-note'));
  return section;
}
function decisionView(decision) {
  const section = element('section', null, 'decision');
  section.append(heading('Latest decision', decision ? time(decision.at) : null));
  if (!decision) section.append(element('p', 'No allocation decision published yet.', 'empty-state'));
  else {
    section.append(element('p', decision.summary, 'decision-summary'));
    if (decision.sources.length) {
      const sources = element('div', null, 'evidence');
      for (const source of decision.sources) sources.append(link(source.title + ' ↗', sourceUrl(source.url)));
      section.append(sources);
    }
  }
  return section;
}
const RESEARCH_STATUS = { not_started: 'Preparing', running: 'Research running', complete: 'Research complete', paused: 'Research paused', needs_attention: 'Needs attention' };
export function activityStatus(sail, at = Date.now()) {
  const heartbeat = sail.activity?.heartbeat_at;
  if (!heartbeat) return { text: 'Awaiting first update', delayed: false };
  const age = Math.max(0, Math.floor((at - Date.parse(heartbeat)) / 1000));
  const elapsed = age < 60 ? 'just now' : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`;
  const delayed = sail.status === 'running' && age > 180;
  return { text: `${delayed ? 'Checkpoint delayed' : 'Updated'} · ${elapsed}`, delayed };
}
function updateFreshness(target, sail, service) {
  const status = activityStatus(service ? { ...sail, status: service.status === 'running' ? 'running' : 'complete', activity: { ...sail.activity, heartbeat_at: service.heartbeat_at } } : sail);
  for (const node of target.querySelectorAll?.('.run-heartbeat') || []) {
    node.textContent = status.text;
    node.className = `run-heartbeat${status.delayed ? ' delayed' : ''}`;
  }
}
function activityView(sail) {
  const activity = sail.activity;
  const view = element('div', null, 'run-activity');
  if (activity.tasks.length) {
    const list = element('ul', null, 'active-tasks');
    list.setAttribute('aria-label', 'Current Sail tasks');
    for (const task of activity.tasks) {
      const item = element('li');
      const title = element('span', `${task.symbol ? task.symbol + ' · ' : ''}${TASK_KIND[task.kind]}`);
      const state = task.status === 'running' ? 'In progress' : 'Queued';
      item.append(title, element('span', `${TASK_PROFILE[task.profile]} · ${state}`, 'task-status'));
      list.append(item);
    }
    view.append(list);
  }
  const note = element('div', null, 'activity-note');
  const status = activityStatus(sail);
  note.append(element('span', status.text, `run-heartbeat${status.delayed ? ' delayed' : ''}`));
  view.append(note);
  return view;
}
function activityDetails(sail) {
  const activity = sail.activity;
  const details = element('div', null, 'activity-details');
  const stats = element('dl', null, 'run-stats');
  for (const [label, value] of [
    ['Requests completed', `${activity.completed_requests.toLocaleString('en-US')} / ${activity.total_requests.toLocaleString('en-US')}`],
    ['Companies researched', `${activity.companies_researched} / ${activity.universe_size}`],
    ['Known inference cost', money(sail.known_cost_usd)],
  ]) stats.append(metric(label, value));
  details.append(stats);
  if (sail.unsettled_requests || scaled(activity.reserved_cost_usd) > 0n) {
    details.append(element('p', `${money(activity.reserved_cost_usd)} reserved · ${sail.unsettled_requests} unsettled request${sail.unsettled_requests === 1 ? '' : 's'}`, 'reservation-note'));
  }
  return details;
}
function researchView(research, sail, service) {
  const labels = { running: 'Research running', waiting: 'Between research sessions', paused: 'Research paused', needs_attention: 'Needs attention', complete: 'Week complete' };
  const section = element('section', null, 'research'); section.append(heading('Current work', service ? labels[service.status] : RESEARCH_STATUS[research.status]));
  section.append(element('p', research.question, 'question'));
  if (sail.activity) section.append(activityView(service ? { ...sail, status: service.status === 'running' ? 'running' : 'complete', activity: { ...sail.activity, heartbeat_at: service.heartbeat_at, tasks: service.status === 'running' ? sail.activity.tasks : [] } } : sail));
  section.append(element('p', research.next, 'next-step'));
  const historyLink = link('Research history →', '/portfolio/research/'); historyLink.className = 'research-history-link'; section.append(historyLink);
  if (sail.started_at !== null) {
    const details = element('details', null, 'run-details'); details.append(element('summary', 'Run details'));
    if (sail.activity) details.append(activityDetails(sail));
    const data = element('dl');
    const rows = service ? [['Week ends', date(service.week_ends_at, true)], ...(service.next_wake_at ? [['Next session', date(service.next_wake_at, true)]] : [])] : [['Started', date(sail.started_at, true)], ['Run deadline', date(sail.ends_at, true)]];
    if (!sail.activity) rows.push(['Known Sail cost', money(sail.known_cost_usd)], ['Unsettled requests', String(sail.unsettled_requests)]);
    for (const [label, value] of rows) data.append(element('dt', label), element('dd', value));
    details.append(data, element('p', 'Agent operating costs are tracked separately from portfolio returns.'));
    section.append(details);
  }
  return section;
}
export function mountRuntime(data, target) {
  if (!validRuntime(data)) throw new Error('Invalid public portfolio checkpoint.');
  const checkpoint = element('div', null, 'checkpoint');
  checkpoint.append(element('span', 'Paper trading · Schwab not connected', 'phase'));
  const updated = element('span', 'Published '); updated.append(time(data.published_at, true)); checkpoint.append(updated);
  target.replaceChildren(checkpoint, portfolioView(data.portfolio), decisionView(data.latest_decision), researchView(data.research, data.sail, data.service));
  target.setAttribute('aria-busy', 'false');
  return target;
}
async function fetchCheckpoint(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const cached = responseCache.get(path);
    const response = await fetch(path, { method: 'GET', cache: 'no-store', credentials: 'omit', signal: controller.signal, headers: cached?.etag ? { 'If-None-Match': cached.etag } : {} });
    if (response.status === 304 && cached) return cached.value;
    if (!response.ok) throw new Error('Checkpoint unavailable.');
    const length = Number(response.headers?.get('content-length') || 0);
    if (length > MAX_BODY_BYTES) throw new Error('Checkpoint exceeds size limit.');
    const raw = await response.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new Error('Checkpoint exceeds size limit.');
    const value = JSON.parse(raw);
    if (!validRuntime(value)) throw new Error('Checkpoint failed validation.');
    responseCache.set(path, { value, etag: response.headers?.get('etag') || null });
    return value;
  } finally { clearTimeout(timeout); }
}
async function refreshRuntime(target) {
  try {
    let data;
    try { data = await fetchCheckpoint('/api/portfolio/state'); }
    catch { data = await fetchCheckpoint('./runtime.json'); }
    const previous = mounted.get(target);
    // A temporary endpoint failure must not replace a newer checkpoint with
    // the older static fallback. The visible publication timestamp stays honest.
    if (previous && Date.parse(data.published_at) < Date.parse(previous.published_at)) { updateFreshness(target, previous.sail, previous.service); return; }
    if (previous && JSON.stringify(previous) === JSON.stringify(data)) { updateFreshness(target, previous.sail, previous.service); return; }
    const opened = [...(target.querySelectorAll?.('details[open]') || [])].map(node => node.className);
    mountRuntime(data, target);
    for (const details of target.querySelectorAll?.('details') || []) {
      if (opened.includes(details.className)) details.open = true;
    }
    mounted.set(target, data);
  } catch {
    if (mounted.has(target)) { updateFreshness(target, mounted.get(target).sail, mounted.get(target).service); return; }
    const notice = element('p', 'The latest checkpoint is unavailable. ', 'unavailable');
    notice.append(link('View the project on GitHub.', REPOSITORY));
    target.replaceChildren(notice); target.setAttribute('aria-busy', 'false');
  }
}
export function loadRuntime(target = document.querySelector('#portfolio-runtime')) {
  if (!target) return Promise.resolve();
  if (loading.has(target)) return loading.get(target);
  const request = refreshRuntime(target).finally(() => loading.delete(target));
  loading.set(target, request);
  return request;
}
export function startRuntime(target = document.querySelector('#portfolio-runtime')) {
  if (!target) return () => {};
  loadRuntime(target);
  const refreshVisible = () => {
    if (document.visibilityState === 'visible') loadRuntime(target);
  };
  const interval = setInterval(refreshVisible, 60000);
  document.addEventListener('visibilitychange', refreshVisible);
  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', refreshVisible);
  };
}
if (typeof document !== 'undefined' && document.querySelector('#portfolio-runtime')) startRuntime();
