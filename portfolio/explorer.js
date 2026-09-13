export const SYMBOLS = Object.freeze([
  "NVDA",
  "TSM",
  "AVGO",
  "CEG",
  "VRT",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
]);
const fields = [
  "symbol",
  "company",
  "group",
  "role",
  "period",
  "period_end",
  "prior_period",
  "currency",
  "unit",
  "operating_cash",
  "prior_operating_cash",
  "deductions",
  "capital_spending",
  "prior_capital_spending",
  "cash_remaining",
  "prior_cash_remaining",
  "lesson",
  "explanation",
  "watch",
  "definition",
  "source",
];
const exact = (v, names) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === names.length &&
  names.every((key) => Object.hasOwn(v, key));
const text = (v, n = 300) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= n &&
  !/[\u0000-\u001f]/.test(v);
const day = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const groups = {
  NVDA: "chips",
  TSM: "chips",
  AVGO: "chips",
  CEG: "power",
  VRT: "power",
  MSFT: "cloud",
  AMZN: "cloud",
  GOOGL: "cloud",
  META: "cloud",
};
const hosts = {
  NVDA: ["nvidianews.nvidia.com"],
  TSM: ["investor.tsmc.com"],
  AVGO: ["investors.broadcom.com"],
  CEG: ["www.sec.gov"],
  VRT: ["investors.vertiv.com"],
  MSFT: ["www.microsoft.com"],
  AMZN: ["www.sec.gov"],
  GOOGL: ["www.sec.gov"],
  META: ["investor.atmeta.com"],
};

// Fixed thousandths of a reported million; exact through every displayed bridge.
export function amount(value) {
  if (
    typeof value !== "string" ||
    !/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,3})?$/.test(value)
  )
    throw new TypeError("Invalid reported amount");
  const negative = value[0] === "-";
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return (
    (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"))) *
    (negative ? -1n : 1n)
  );
}
function sourceUrl(source, symbol) {
  if (
    !exact(source, ["title", "url", "sha256", "fetched_at"]) ||
    !text(source.title, 240) ||
    !text(source.url, 600) ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isFinite(Date.parse(source.fetched_at))
  )
    return false;
  try {
    const u = new URL(source.url);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      hosts[symbol].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
export function validCashMap(data) {
  if (
    !exact(data, [
      "schema_version",
      "as_of",
      "scope",
      "review_basis",
      "companies",
    ]) ||
    data.schema_version !== 1 ||
    !day(data.as_of) ||
    data.scope !== "company_wide" ||
    data.review_basis !== "primary_source_tables_and_arithmetic" ||
    !Array.isArray(data.companies) ||
    data.companies.length !== 9
  )
    return false;
  return data.companies.every((c, index) => {
    if (
      !exact(c, fields) ||
      c.symbol !== SYMBOLS[index] ||
      c.group !== groups[c.symbol] ||
      c.currency !== (c.symbol === "TSM" ? "TWD" : "USD") ||
      c.unit !== "millions" ||
      !day(c.period_end) ||
      c.period_end > data.as_of ||
      !sourceUrl(c.source, c.symbol)
    )
      return false;
    if (
      ![
        "company",
        "role",
        "period",
        "prior_period",
        "lesson",
        "explanation",
        "watch",
        "definition",
      ].every((key) => text(c[key], key === "definition" ? 500 : 300))
    )
      return false;
    if (
      !Array.isArray(c.deductions) ||
      c.deductions.length < 1 ||
      c.deductions.length > 4
    )
      return false;
    try {
      const labels = new Set();
      let spending = 0n,
        previous = 0n;
      for (const d of c.deductions) {
        if (
          !exact(d, ["label", "value", "prior_value"]) ||
          !text(d.label, 160) ||
          labels.has(d.label) ||
          amount(d.value) < 0n ||
          amount(d.prior_value) < 0n
        )
          return false;
        labels.add(d.label);
        spending += amount(d.value);
        previous += amount(d.prior_value);
      }
      return (
        amount(c.operating_cash) > 0n &&
        amount(c.prior_operating_cash) > 0n &&
        spending === amount(c.capital_spending) &&
        previous === amount(c.prior_capital_spending) &&
        amount(c.operating_cash) - spending === amount(c.cash_remaining) &&
        amount(c.prior_operating_cash) - previous ===
          amount(c.prior_cash_remaining)
      );
    } catch {
      return false;
    }
  });
}
export function scenario(
  company,
  cashChange = 0,
  spendingChange = 0,
  prior = false,
) {
  if (
    ![cashChange, spendingChange].every(
      (v) => Number.isInteger(v) && v >= -50 && v <= 50,
    ) ||
    typeof prior !== "boolean"
  )
    throw new TypeError("Scenario outside the displayed controls");
  const prefix = prior ? "prior_" : "";
  // Numerator keeps an extra two digits: no rounding before subtraction.
  const cash =
    amount(company[prefix + "operating_cash"]) * BigInt(100 + cashChange);
  const investment =
    amount(company[prefix + "capital_spending"]) * BigInt(100 + spendingChange);
  return {
    cash,
    investment,
    remaining: cash - investment,
    changed: cashChange !== 0 || spendingChange !== 0,
    prior,
  };
}
export function money(value, currency = "USD") {
  if (typeof value !== "bigint" || !["USD", "TWD"].includes(currency))
    throw new TypeError("Invalid money");
  // Scenario values are hundredths of a thousandth of a reported million.
  const sign = value < 0n ? "−" : "";
  const absolute = value < 0n ? -value : value;
  const prefix = currency === "TWD" ? "NT$" : "$";
  const unit = absolute >= 100000000n ? "B" : "M";
  const divisor = unit === "B" ? 100000000n : 100000n;
  const scaled = (absolute * 1000n + divisor / 2n) / divisor;
  const whole = scaled / 1000n,
    fraction = (scaled % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return (
    sign + prefix + whole.toString() + (fraction ? "." + fraction : "") + unit
  );
}
export function waterfall(values) {
  const cash = Number(values.cash),
    left = Number(values.remaining);
  const minimum = Math.min(0, left),
    maximum = Math.max(cash, left, 1);
  const y = (v) => 24 + ((maximum - v) / (maximum - minimum)) * 134;
  return {
    zero: y(0),
    cash: { x: 26, y: y(cash), width: 140, height: y(0) - y(cash) },
    investment: { x: 264, y: y(cash), width: 140, height: y(left) - y(cash) },
    remaining: {
      x: 502,
      y: y(Math.max(0, left)),
      width: 140,
      height: Math.abs(y(left) - y(0)),
    },
    cashTop: y(cash),
    leftTop: y(left),
    negative: left < 0,
  };
}
function element(tag, content, cls) {
  const e = document.createElement(tag);
  if (content !== undefined) e.textContent = content;
  if (cls) e.className = cls;
  return e;
}
function svgElement(tag, attrs) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function link(url, label) {
  const a = element("a", label);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

export function mountExplorer(data, target) {
  if (!validCashMap(data)) throw new TypeError("Unreviewed cash-map data");
  let selected = "NVDA",
    cashChange = 0,
    spendingChange = 0,
    prior = false;
  const map = element("div", undefined, "money-map");
  map.setAttribute("role", "group");
  map.setAttribute("aria-label", "Explore companies in the AI spending cycle");
  const buttons = [];
  for (const [key, title, note] of [
    ["cloud", "Cloud & applications", "Fund the buildout"],
    ["chips", "Chips & networks", "Supply the compute"],
    ["power", "Power & cooling", "Support the capacity"],
  ]) {
    const group = element("div", undefined, "money-group money-" + key);
    const heading = element("div", undefined, "money-group-heading");
    heading.append(element("h3", title), element("span", note));
    group.append(heading);
    const list = element("div", undefined, "money-companies");
    for (const c of data.companies.filter((c) => c.group === key)) {
      const b = element("button", c.symbol);
      b.type = "button";
      b.dataset.company = c.symbol;
      b.setAttribute("aria-label", c.company + " · " + c.symbol);
      b.addEventListener("click", () => {
        selected = c.symbol;
        cashChange = spendingChange = 0;
        prior = false;
        cashInput.value = spendInput.value = "0";
        assumptions.open = false;
        sourceDetail.open = false;
        render();
      });
      list.append(b);
      buttons.push(b);
    }
    group.append(list);
    map.append(group);
  }
  const card = element("article", undefined, "cash-case");
  card.id = "company-case";
  const heading = element("div", undefined, "cash-case-heading");
  const title = element("h3");
  const identity = element("div", undefined, "cash-identity");
  const ticker = element("span", undefined, "company-code");
  identity.append(ticker, title);
  const periods = element("div", undefined, "cash-periods");
  periods.setAttribute("role", "group");
  periods.setAttribute("aria-label", "Reported period");
  const currentButton = element("button"),
    priorButton = element("button");
  currentButton.type = priorButton.type = "button";
  currentButton.addEventListener("click", () => {
    prior = false;
    render();
  });
  priorButton.addEventListener("click", () => {
    prior = true;
    render();
  });
  periods.append(currentButton, priorButton);
  heading.append(identity, periods);
  const role = element("p", undefined, "cash-role");
  const definition = element("p", undefined, "cash-scope");
  const figure = element("figure", undefined, "cash-waterfall");
  const svg = svgElement("svg", {
    viewBox: "0 0 668 176",
    role: "presentation",
    "aria-hidden": "true",
  });
  const axis = svgElement("line", { x1: 10, x2: 658, class: "cash-axis" });
  const beforeLine = svgElement("line", {
      x1: 166,
      x2: 264,
      class: "cash-connector",
    }),
    afterLine = svgElement("line", {
      x1: 404,
      x2: 502,
      class: "cash-connector",
    });
  const cashBar = svgElement("rect", {
      class: "cash-bar cash-generated",
      rx: 2,
    }),
    spendBar = svgElement("rect", { class: "cash-bar cash-spent", rx: 2 }),
    leftBar = svgElement("rect", { class: "cash-bar cash-left", rx: 2 });
  svg.append(axis, beforeLine, afterLine, cashBar, spendBar, leftBar);
  const caption = element("figcaption", undefined, "cash-values");
  const numbers = [];
  for (const label of [
    "Operating cash",
    "Capital deductions",
    "Cash remaining",
  ]) {
    const cell = element("div");
    const name = element("span", label),
      value = element("strong");
    cell.append(name, value);
    numbers.push({ name, value });
    caption.append(cell);
  }
  figure.append(svg, caption);
  const lesson = element("div", undefined, "cash-lesson");
  const lessonHeading = element("h4"),
    lessonText = element("p");
  lesson.append(lessonHeading, lessonText);
  const assumptions = element("details", undefined, "cash-assumptions");
  assumptions.append(element("summary", "Change the assumptions"));
  const controls = element("div", undefined, "cash-controls");
  function slider(id, label) {
    const root = element("div");
    const line = element("div", undefined, "slider-label");
    const name = element("label", label);
    name.htmlFor = id;
    const output = element("output");
    output.htmlFor = id;
    const input = element("input");
    input.type = "range";
    input.id = id;
    input.min = "-50";
    input.max = "50";
    input.step = "1";
    input.value = "0";
    line.append(name, output);
    root.append(line, input);
    controls.append(root);
    return { input, output };
  }
  const { input: cashInput, output: cashOutput } = slider(
    "cash-assumption",
    "Operating cash",
  );
  const { input: spendInput, output: spendOutput } = slider(
    "spending-assumption",
    "Capital deductions",
  );
  const reset = element("button", "Reset");
  reset.type = "button";
  reset.addEventListener("click", () => {
    cashChange = spendingChange = 0;
    cashInput.value = spendInput.value = "0";
    render();
  });
  const scenarioNote = element(
    "p",
    "Sensitivity to the selected period; not a forecast.",
    "scenario-note",
  );
  assumptions.append(controls, reset, scenarioNote);
  cashInput.addEventListener("input", () => {
    cashChange = Number(cashInput.value);
    render();
  });
  spendInput.addEventListener("input", () => {
    spendingChange = Number(spendInput.value);
    render();
  });
  const sourceDetail = element("details", undefined, "cash-sources");
  sourceDetail.append(element("summary", "Source & calculation"));
  const sourceBody = element("div");
  sourceDetail.append(sourceBody);
  const foot = element("div", undefined, "cash-case-footer");
  const status = element("span", undefined, "cash-mode");
  status.setAttribute("aria-live", "polite");
  foot.append(status, sourceDetail);
  card.append(heading, role, definition, figure, lesson, assumptions, foot);
  target.replaceChildren(map, card);
  function render() {
    const company = data.companies.find((c) => c.symbol === selected),
      values = scenario(company, cashChange, spendingChange, prior),
      geometry = waterfall(values);
    for (const b of buttons)
      b.setAttribute("aria-pressed", String(b.dataset.company === selected));
    title.textContent = company.company;
    ticker.textContent = company.symbol;
    role.textContent = company.role;
    currentButton.textContent = company.period;
    priorButton.textContent = company.prior_period;
    currentButton.setAttribute("aria-pressed", String(!prior));
    priorButton.setAttribute("aria-pressed", String(prior));
    definition.textContent =
      ({ MSFT: "12 months", AMZN: "12 months", CEG: "6 months" }[
        company.symbol
      ] || "3 months") +
      " · Company-wide · " +
      (company.currency === "TWD" ? "New Taiwan dollars" : "US dollars") +
      " · Not AI-only returns" +
      (selected === "CEG"
        ? ". Calpine included in 2026; excluded in 2025."
        : "");
    for (const [bar, rect] of [
      [cashBar, geometry.cash],
      [spendBar, geometry.investment],
      [leftBar, geometry.remaining],
    ])
      for (const [k, v] of Object.entries(rect)) bar.setAttribute(k, v);
    axis.setAttribute("y1", geometry.zero);
    axis.setAttribute("y2", geometry.zero);
    for (const [line, y] of [
      [beforeLine, geometry.cashTop],
      [afterLine, geometry.leftTop],
    ]) {
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
    }
    leftBar.setAttribute(
      "class",
      "cash-bar " + (geometry.negative ? "cash-deficit" : "cash-left"),
    );
    for (const [index, key] of ["cash", "investment", "remaining"].entries())
      numbers[index].value.textContent = money(values[key], company.currency);
    numbers[2].name.textContent = geometry.negative
      ? "Funding gap"
      : "Cash remaining";
    numbers[2].value.className = geometry.negative ? "is-negative" : "";
    lessonHeading.textContent = values.changed
      ? "What changes in this scenario?"
      : prior
        ? "The earlier cash picture."
        : company.lesson;
    lessonText.textContent = values.changed
      ? geometry.negative
        ? "Capital deductions exceed operating cash by " +
          money(-values.remaining, company.currency) +
          "."
        : "After these capital deductions, " +
          money(values.remaining, company.currency) +
          " remains from operating cash."
      : prior
        ? "The same calculation for " +
          company.prior_period +
          ". Choose the current period to see what changed."
        : company.explanation;
    for (const [output, value] of [
      [cashOutput, cashChange],
      [spendOutput, spendingChange],
    ])
      output.textContent = (value > 0 ? "+" : "") + value + "%";
    cashInput.setAttribute("aria-valuetext", cashOutput.textContent);
    spendInput.setAttribute("aria-valuetext", spendOutput.textContent);
    reset.disabled = !values.changed;
    status.textContent = values.changed
      ? "Scenario · assumptions changed"
      : "Reported · " +
        (prior
          ? company.prior_period
          : new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(company.period_end)));
    sourceBody.replaceChildren();
    sourceBody.append(element("p", company.definition));
    const breakdown = element("dl");
    for (const d of company.deductions) {
      breakdown.append(
        element("dt", d.label),
        element(
          "dd",
          money(
            amount(d[prior ? "prior_value" : "value"]) * 100n,
            company.currency,
          ),
        ),
      );
    }
    sourceBody.append(breakdown);
    sourceBody.append(
      element(
        "p",
        "Operating cash minus the listed cash capital deductions. Acquisitions, financing and other cash uses can remain outside this bridge.",
      ),
    );
    sourceBody.append(link(company.source.url, "Open the primary source ↗"));
    target.dispatchEvent(
      new CustomEvent("cash-map:company", {
        detail: { symbol: selected },
        bubbles: true,
      }),
    );
  }
  render();
  return {
    select(symbol) {
      if (!SYMBOLS.includes(symbol)) throw new TypeError("Unknown company");
      buttons.find((b) => b.dataset.company === symbol).click();
    },
  };
}
export async function loadExplorer(target, fetcher = fetch) {
  try {
    const response = await fetcher("./cash-map.json", {
      cache: "no-cache",
      credentials: "omit",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Snapshot unavailable");
    const raw = await response.text();
    if (raw.length > 40000) throw new Error("Oversized snapshot");
    mountExplorer(JSON.parse(raw), target);
    target.removeAttribute("aria-busy");
    return true;
  } catch {
    target.replaceChildren(
      element("p", "The interactive snapshot is unavailable."),
    );
    target.append(
      link(
        "https://github.com/bwoods1998/portfolio-agent/blob/main/docs/AI-STACK.md",
        "Read the research ↗",
      ),
    );
    target.removeAttribute("aria-busy");
    return false;
  }
}
if (typeof document !== "undefined" && document.querySelector("#cash-explorer"))
  loadExplorer(document.querySelector("#cash-explorer"));
