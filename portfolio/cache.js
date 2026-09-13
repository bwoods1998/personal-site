// Frozen Sep 13, 2026 rate card. Visitor-side arithmetic only; no provider calls.
// https://docs.sailresearch.com/pricing · https://docs.sailresearch.com/supercache
// Rates are integer milli-USD per million input tokens; costs share a 10^10 denominator.
export const PRICE_DATE = '2026-09-13';
export const PROFILES = Object.freeze({
  'pro-flex': Object.freeze({ label: 'DeepSeek Pro · Flex', input: 660n, cached: 22n }),
  'kimi-balanced': Object.freeze({ label: 'Kimi K2.6 · Balanced', input: 450n, cached: 200n }),
  'kimi-flex': Object.freeze({ label: 'Kimi K2.6 · Flex', input: 350n, cached: 100n }),
});
export const COST_DENOMINATOR = 10000000000n;
const MIN_TOKENS = 1025, MAX_TOKENS = 128000, MAX_REUSES = 4000;

function integer(value, minimum, maximum) {
  if (typeof value === 'string' && /^\d{1,8}$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Outside the modeled range');
  return value;
}

function profile(id) {
  if (!Object.hasOwn(PROFILES, id)) throw new RangeError('Unknown frozen price profile');
  return PROFILES[id];
}

export function crossover(id) {
  const rates = profile(id), numerator = 110n * rates.input, denominator = rates.cached;
  return { numerator, denominator, equalAt: numerator % denominator === 0n ? Number(numerator / denominator) : null,
    firstCheaper: Number(numerator / denominator + 1n) };
}

export function modeledCost(id, tokens, reuses) {
  const rates = profile(id);
  tokens = integer(tokens, MIN_TOKENS, MAX_TOKENS); reuses = integer(reuses, 0, MAX_REUSES);
  const n = BigInt(tokens), r = BigInt(reuses);
  const ordinary = n * (10n * rates.input + 10n * r * rates.cached);
  const supercache = n * (1000n * rates.input + r * rates.cached);
  return { tokens, reuses, ordinary, supercache, denominator: COST_DENOMINATOR,
    cheaper: ordinary === supercache ? 'equal' : ordinary < supercache ? 'ordinary' : 'supercache' };
}

export function dollars(numerator) {
  if (typeof numerator !== 'bigint' || numerator < 0n) throw new TypeError('Expected an exact nonnegative cost');
  const fraction = (numerator % COST_DENOMINATOR).toString().padStart(10, '0').replace(/0+$/, '').padEnd(4, '0');
  return `$${numerator / COST_DENOMINATOR}.${fraction}`;
}

function fractionText(numerator, denominator) {
  const whole = numerator / denominator; let remainder = numerator % denominator, fraction = '';
  while (remainder && fraction.length < 8) { remainder *= 10n; fraction += remainder / denominator; remainder %= denominator; }
  return `${whole}${fraction ? `.${fraction}` : ''}${remainder ? '…' : ''}`;
}

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function svg(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

export function mountCache(target) {
  const controls = node('div', undefined, 'cache-controls');
  const modelLabel = node('label', 'Price profile'); const model = node('select'); model.id = 'cache-model';
  modelLabel.htmlFor = model.id;
  for (const [id, rates] of Object.entries(PROFILES)) { const option = node('option', rates.label); option.value = id; model.append(option); }
  model.value = 'pro-flex'; modelLabel.append(model); controls.append(modelLabel);
  const tokenLabel = node('label', 'Prefix tokens'); const tokens = node('input');
  Object.assign(tokens, { id: 'cache-tokens', type: 'number', min: String(MIN_TOKENS), max: String(MAX_TOKENS), step: '1', value: '8000', inputMode: 'numeric' });
  tokenLabel.htmlFor = tokens.id; tokenLabel.append(tokens); controls.append(tokenLabel);
  const reuseGroup = node('div', undefined, 'cache-reuses');
  const reuseLabel = node('label', 'Subsequent reuses / 24h'); const reuseNumber = node('input');
  Object.assign(reuseNumber, { id: 'cache-reuses', type: 'number', min: '0', max: String(MAX_REUSES), step: '1', value: '1', inputMode: 'numeric' });
  reuseLabel.htmlFor = reuseNumber.id;
  const range = node('input'); Object.assign(range, { type: 'range', min: '0', max: String(MAX_REUSES), step: '1', value: '1' });
  range.setAttribute('aria-label', 'Subsequent prefix reuses within 24 hours');
  reuseGroup.append(reuseLabel, reuseNumber, range); controls.append(reuseGroup);

  const error = node('p', '', 'cache-error'); error.id = 'cache-error'; error.setAttribute('role', 'status');
  tokens.setAttribute('aria-describedby', error.id); reuseNumber.setAttribute('aria-describedby', error.id);
  const result = node('div', undefined, 'cache-result');
  const values = node('dl', undefined, 'cache-values'); const ordinary = node('dd'), supercache = node('dd');
  for (const [label, output, name] of [['Ordinary', ordinary, 'ordinary'], ['Supercache', supercache, 'supercache']]) {
    const group = node('div', undefined, `cache-${name}`); group.append(node('dt', label), output); values.append(group);
  }
  const point = node('p', '', 'cache-crossover'); point.setAttribute('aria-live', 'polite'); point.setAttribute('aria-atomic', 'true');
  const graph = svg('svg', { viewBox: '0 0 600 142', role: 'img', class: 'cache-plot', preserveAspectRatio: 'none' });
  const axes = node('div', undefined, 'cache-axis'); const left = node('span', '0 reuses'), right = node('span'); axes.append(left, right);
  result.append(values, graph, axes, point);
  const notes = node('details', undefined, 'cache-assumptions'); notes.append(node('summary', 'Assumptions · 13 Sep 2026 prices'));
  notes.append(node('p', 'Hypothetical input cost for the same prefix within 24h. First ordinary request uncached; every reuse hits ordinary cache. Supercache: one write at 100× input, then reads at 0.1× cached input.'));
  notes.append(node('p', 'Prefix ≥1,025 tokens. Output, latency and availability excluded. This is a calculation, not a Supercache test. All controls run locally.'));
  const links = node('p');
  for (const [label, href] of [['Rates', 'https://docs.sailresearch.com/pricing'], ['Supercache', 'https://docs.sailresearch.com/supercache'], ['Math', 'https://github.com/bwoods1998/portfolio-agent/blob/main/docs/SAIL-PRODUCTS.md#cache-economics-before-enabling-another-product']]) {
    const link = node('a', label); link.href = href; links.append(link);
  }
  notes.append(links); target.replaceChildren(controls, error, result, notes);

  function draw() {
    let cost;
    try {
      cost = modeledCost(model.value, tokens.value, reuseNumber.value);
      tokens.removeAttribute('aria-invalid'); reuseNumber.removeAttribute('aria-invalid');
    } catch {
      for (const [control, min, max] of [[tokens, MIN_TOKENS, MAX_TOKENS], [reuseNumber, 0, MAX_REUSES]]) {
        try { integer(control.value, min, max); control.removeAttribute('aria-invalid'); } catch { control.setAttribute('aria-invalid', 'true'); }
      }
      result.hidden = true; error.textContent = 'Use 1,025–128,000 tokens and 0–4,000 reuses.'; return;
    }
    result.hidden = false; error.textContent = ''; range.value = String(cost.reuses);
    ordinary.textContent = dollars(cost.ordinary); supercache.textContent = dollars(cost.supercache);
    const cross = crossover(model.value);
    point.textContent = `Break-even ${fractionText(cross.numerator, cross.denominator)} · Supercache cheaper from ${cross.firstCheaper.toLocaleString('en-US')} reuses.`;
    const max = Math.min(MAX_REUSES, Math.max(50, Math.ceil(cross.firstCheaper * 1.2), cost.reuses));
    const endpoint = modeledCost(model.value, cost.tokens, max), initial = modeledCost(model.value, cost.tokens, 0);
    const peakExact = endpoint.ordinary > endpoint.supercache ? endpoint.ordinary : endpoint.supercache;
    const peak = Number(peakExact);
    const x = r => 5 + 590 * r / max, y = value => 134 - Number(value) / peak * 121;
    graph.replaceChildren();
    graph.setAttribute('aria-label', `Modeled input dollars, zero to ${dollars(peakExact)}. Zero to ${max} subsequent reuses. Amber ordinary; green Supercache.`);
    for (const at of [13, 53, 93, 134]) graph.append(svg('path', { d: `M5 ${at}H595`, class: 'cache-grid' }));
    for (const name of ['ordinary', 'supercache']) {
      graph.append(svg('path', { d: `M5 ${y(initial[name])}L595 ${y(endpoint[name])}`, class: `cache-line cache-${name}` }));
      graph.append(svg('circle', { cx: x(cost.reuses), cy: y(cost[name]), r: 3.5, class: `cache-dot cache-${name}` }));
    }
    graph.append(svg('path', { d: `M${x(cost.reuses)} 7V137`, class: 'cache-marker' }));
    right.textContent = `${max.toLocaleString('en-US')} reuses`;
  }
  model.addEventListener('change', draw); tokens.addEventListener('input', draw); reuseNumber.addEventListener('input', draw);
  range.addEventListener('input', () => { reuseNumber.value = range.value; draw(); });
  draw();
}

if (typeof document !== 'undefined') {
  const target = document.querySelector('#cache-content');
  if (target) {
    try {
      mountCache(target); document.querySelector('#cache-calculator').hidden = false;
      // The local calculator also works if an optional evaluation snapshot is unavailable.
      document.querySelector('#evaluations').hidden = false;
    } catch { /* An optional calculator cannot interrupt the research ledger. */ }
  }
}
