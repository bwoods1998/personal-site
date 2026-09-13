// A local sensitivity calculation from checked issuer figures, never a forecast.
const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const URL = 'https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast';
const HASH = '6e6918e055dbd54df109ce2da8e3e628fb923c7c35315eafba34ec7a248c02a8';
const FIGURES_HASH = '21649dd53e1b00e10c2092e4aec40b318197879c8d1e21ad2507f2d13f9632fa';
const basisPoints = v => Number.isInteger(v) && v >= -5000 && v <= 10000;
export function validScenario(data, cashflow = null) {
  if (!exact(data, ['schema_version', 'company', 'period', 'unit', 'scope', 'basis', 'operating_cash_flow', 'cash_ppe', 'cash_after_ppe', 'source', 'rubric_sha256']) || data.schema_version !== 1 || data.company !== 'Microsoft' || data.period !== 'FY2026' || data.unit !== 'USD millions' || data.scope !== 'company_wide' || data.basis !== 'annual_unaudited' || data.operating_cash_flow !== '182935' || data.cash_ppe !== '115948' || data.cash_after_ppe !== '66987' || data.rubric_sha256 !== FIGURES_HASH) return false;
  const s = data.source;
  if (!exact(s, ['id', 'title', 'url', 'published_at', 'fetched_at', 'sha256']) || s.id !== 'fy26-results' || s.title !== 'Microsoft FY2026 results · Cash flow statements (unaudited)' || s.url !== URL || s.sha256 !== HASH || s.published_at !== '2026-07-29' || s.fetched_at !== '2026-09-12T22:38:09Z') return false;
  if (BigInt(data.operating_cash_flow) - BigInt(data.cash_ppe) !== BigInt(data.cash_after_ppe)) return false;
  return !cashflow || (cashflow.totals?.FY2026 === data.operating_cash_flow && cashflow.source?.sha256 === s.sha256 && cashflow.provenance?.rubric_sha256 === data.rubric_sha256);
}
export function scenarioResult(data, cashGrowth = 0, investmentGrowth = 0) {
  if (!validScenario(data) || !basisPoints(cashGrowth) || !basisPoints(investmentGrowth)) throw new TypeError('Invalid checked scenario or growth basis points');
  // Original amounts are whole USD millions. Multiplying by 100 preserves exact dollars for every 1bp step.
  const generation = BigInt(data.operating_cash_flow) * 100n * (10000n + BigInt(cashGrowth));
  const investment = BigInt(data.cash_ppe) * 100n * (10000n + BigInt(investmentGrowth));
  const baseline = BigInt(data.cash_after_ppe) * 1000000n;
  const numerator = BigInt(data.cash_ppe) * BigInt(investmentGrowth), denominator = BigInt(data.operating_cash_flow);
  // Signed ceiling: the smallest 1bp generation change that preserves the FY26 cash remainder.
  const requiredGrowth = Number(numerator / denominator + (numerator > 0n && numerator % denominator ? 1n : 0n));
  return { generation, investment, remaining: generation - investment, baseline,
    change: generation - investment - baseline, requiredGrowth };
}
export function growthLabel(bps) {
  if (!basisPoints(bps)) throw new TypeError('Invalid basis points');
  const abs = Math.abs(bps), decimal = String(abs % 100).padStart(2, '0').replace(/0+$/, '');
  return `${bps < 0 ? '−' : bps > 0 ? '+' : ''}${Math.floor(abs / 100)}${decimal ? '.' + decimal : ''}%`;
}
export function billions(dollars, signed = false) {
  if (typeof dollars !== 'bigint') throw new TypeError('Exact dollars required');
  const magnitude = dollars < 0n ? -dollars : dollars, millions = (magnitude + 500000n) / 1000000n;
  return `${dollars < 0n ? '−' : signed && dollars > 0n ? '+' : ''}$${millions / 1000n}.${String(millions % 1000n).padStart(3, '0')}B`;
}
function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function svg(tag, attrs = {}) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, String(value)); return e; }
export function mountScenario(data, target) {
  if (!validScenario(data)) throw new TypeError('Invalid scenario publication');
  const badge = node('p', 'Scenario · Company cash flow', 'scenario-badge');
  const controls = node('div', undefined, 'scenario-controls');
  const settings = [['generation', 'Cash generation'], ['investment', 'Cash investment']].map(([id, labelText]) => {
    const label = node('label'); const heading = node('span', labelText); const value = node('output', '0%');
    const input = node('input'); input.type = 'range'; input.min = '-5000'; input.max = '10000'; input.step = '100'; input.value = '0'; input.id = 'scenario-' + id;
    label.htmlFor = input.id; heading.append(value); label.append(heading, input); controls.append(label);
    return { input, value };
  });
  const outputs = node('dl', undefined, 'scenario-outputs');
  const values = [['Cash after investment', 'scenario-remaining'], ['vs. FY26 baseline', 'scenario-change']].map(([label, id]) => {
    const cell = node('div'), value = node('dd'); value.id = id; cell.append(node('dt', label), value); outputs.append(cell); return value;
  });
  const graph = svg('svg', { viewBox: '0 0 620 175', role: 'img', class: 'scenario-graph' });
  const axis = node('div', undefined, 'scenario-axis'); axis.append(node('span', '−50% investment'), node('span', '+100%'));
  const required = node('p', undefined, 'scenario-required');
  const actions = node('div', undefined, 'scenario-actions'); const reset = node('button', 'Reset'); reset.type = 'button'; actions.append(node('span', 'Changes from FY2026'), reset);
  const status = node('span', undefined, 'sr-only'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const source = node('details', undefined, 'scenario-source'); source.append(node('summary', 'Inputs & limits'));
  source.append(node('p', 'FY2026: $182.935B operating cash flow − $115.948B cash property-and-equipment outlays = $66.987B cash remaining. Annual, unaudited, company-wide.'));
  source.append(node('p', 'Hypothetical changes, not forecasts or AI-only returns. Cash investment here means cash PP&E; it excludes finance-lease additions and other commitments. Dollars are calculated exactly; the display rounds to the nearest $1M. The required growth rounds up to the next 0.01 percentage point.'));
  const links = node('p', undefined, 'scenario-links');
  for (const [text, href] of [['Issuer statement ↗', data.source.url], ['Checked inputs ↗', 'https://github.com/bwoods1998/portfolio-agent/blob/main/data/research/dossier-rubric.json']]) { const a = node('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a); }
  source.append(links);
  target.replaceChildren(badge, controls, outputs, graph, axis, required, actions, status, source);
  function draw() {
    const cash = Number(settings[0].input.value), investment = Number(settings[1].input.value);
    if (!basisPoints(cash) || !basisPoints(investment)) return;
    const result = scenarioResult(data, cash, investment);
    settings.forEach((s, i) => { const growth = i ? investment : cash; s.value.textContent = growthLabel(growth); s.input.setAttribute('aria-valuetext', growthLabel(growth) + ' from FY2026'); });
    values[0].textContent = billions(result.remaining); values[1].textContent = billions(result.change, true);
    values[0].title = `${result.remaining.toLocaleString('en-US')} USD`; values[1].title = `${result.change.toLocaleString('en-US')} USD`;
    values[1].setAttribute('data-direction', result.change < 0n ? 'down' : 'up');
    required.textContent = `Cash generation ≥ ${growthLabel(result.requiredGrowth)} preserves ${billions(result.baseline)}.`;
    const low = scenarioResult(data, cash, -5000).remaining, high = scenarioResult(data, cash, 10000).remaining;
    const minimum = Number(high < result.baseline ? high : result.baseline), maximum = Number(low > result.baseline ? low : result.baseline), range = maximum - minimum || 1;
    const width = graph.clientWidth || 620;
    graph.setAttribute('viewBox', `0 0 ${width} 175`);
    const x = bps => 8 + (bps + 5000) / 15000 * (width - 16), y = dollars => 153 - (Number(dollars) - minimum) / range * 130;
    graph.replaceChildren();
    graph.setAttribute('aria-label', `Cash remaining across investment changes from minus 50 to plus 100 percent, holding generation at ${growthLabel(cash)}. Selected ${growthLabel(investment)} leaves ${billions(result.remaining)}; FY2026 baseline ${billions(result.baseline)}.`);
    graph.append(svg('path', { d: `M8 ${y(result.baseline)}H${width - 8}`, class: 'scenario-baseline' }));
    graph.append(svg('path', { d: `M8 ${y(low)}L${width - 8} ${y(high)}`, class: 'scenario-line' }));
    graph.append(svg('path', { d: `M${x(investment)} 10V157`, class: 'scenario-marker' }));
    graph.append(svg('circle', { cx: x(investment), cy: y(result.remaining), r: 5, class: 'scenario-dot' }));
    const label = svg('text', { x: width - 10, y: Math.max(13, y(result.baseline) - 7), 'text-anchor': 'end', class: 'scenario-baseline-label' }); label.textContent = 'FY26 baseline'; graph.append(label);
    status.textContent = `${growthLabel(cash)} cash generation; ${growthLabel(investment)} cash investment. ${billions(result.remaining)} remaining, ${billions(result.change, true)} versus baseline.`;
  }
  settings.forEach(s => s.input.addEventListener('input', draw));
  reset.addEventListener('click', () => { settings.forEach(s => { s.input.value = '0'; }); draw(); });
  draw();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(draw).observe(graph);
}
if (typeof document !== 'undefined' && document.querySelector('#scenario-content')) {
  (async () => { try {
    const response = await fetch('./scenario.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) }); if (!response.ok) return;
    const body = await response.text(); if (body.length > 6000) return;
    const data = JSON.parse(body); if (!validScenario(data)) return;
    mountScenario(data, document.querySelector('#scenario-content')); document.querySelector('#scenario').hidden = false;
  } catch { /* Optional local calculation does not block reviewed research. */ } })();
}
