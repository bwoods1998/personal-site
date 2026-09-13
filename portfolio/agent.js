const symbols = [
  "NVDA",
  "TSM",
  "AVGO",
  "CEG",
  "VRT",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
];
const exact = (v, keys) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const integer = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const keys = [
  "schema_version",
  "saved_at",
  "state",
  "companies",
  "source_documents",
  "model_count",
  "requests",
  "known_inference_usd",
  "unknown_requests",
  "supercache_tokens",
  "cloud_checks",
  "cloud_persistence_verified",
  "cloud_finished",
  "trace_recorded",
  "scope",
];
export function validAgentState(v) {
  if (
    !exact(v, keys) ||
    v.schema_version !== 1 ||
    v.scope !==
      "One research run. Model preferences and mechanical checks do not approve financial conclusions." ||
    !["running", "complete", "deadline", "needs_attention"].includes(v.state)
  )
    return false;
  if (
    typeof v.saved_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v.saved_at) ||
    !Number.isFinite(Date.parse(v.saved_at)) ||
    new Date(v.saved_at).toISOString().replace(".000Z", "Z") !== v.saved_at
  )
    return false;
  if (
    !integer(v.requests, 86) ||
    !integer(v.unknown_requests, v.requests) ||
    !integer(v.model_count, 3) ||
    !integer(v.source_documents, 90) ||
    v.source_documents < 9 ||
    !integer(v.supercache_tokens, 10000000) ||
    !integer(v.cloud_checks, 9)
  )
    return false;
  if (
    typeof v.known_inference_usd !== "string" ||
    !/^(?:0|[1-9]\d{0,4})(?:\.\d{1,20})?$/.test(v.known_inference_usd) ||
    !["cloud_persistence_verified", "cloud_finished", "trace_recorded"].every(
      (k) => typeof v[k] === "boolean",
    )
  )
    return false;
  if (
    (v.cloud_persistence_verified && v.cloud_checks === 0) ||
    v.model_count > v.requests ||
    (v.supercache_tokens > 0 && v.requests === 0)
  )
    return false;
  if (!Array.isArray(v.companies) || v.companies.length !== 9) return false;
  return (
    v.companies.every(
      (c, i) =>
        exact(c, [
          "symbol",
          "finished",
          "initial_check",
          "revised_check",
          "judge_preferences",
        ]) &&
        c.symbol === symbols[i] &&
        typeof c.finished === "boolean" &&
        [c.initial_check, c.revised_check].every(
          (x) => x === null || typeof x === "boolean",
        ) &&
        Array.isArray(c.judge_preferences) &&
        c.judge_preferences.length <= 2 &&
        c.judge_preferences.every((x) =>
          ["baseline", "revision", "tie"].includes(x),
        ) &&
        (!c.finished || (c.initial_check !== null && c.revised_check !== null)),
    ) &&
    (v.state !== "complete" || v.companies.every((c) => c.finished))
  );
}
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
function notesLink(label, path = "docs/NIGHT-SHIFT.md") {
  const a = node("a", label);
  a.href = "https://github.com/bwoods1998/portfolio-agent/blob/main/" + path;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
export function mountAgent(v, target) {
  if (!validAgentState(v)) throw new TypeError("Invalid research checkpoint");
  const completed = v.companies.filter((c) => c.finished).length;
  const header = node("div", undefined, "agent-record");
  const label = node(
    "span",
    v.state === "running"
      ? "Researching · saved checkpoint"
      : v.state === "complete"
        ? "Last run · ready for review"
        : "Last run · review needed",
  );
  const date = node(
    "time",
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(v.saved_at)) + " UTC",
  );
  date.dateTime = v.saved_at;
  header.append(label, date);
  const stats = node("dl", undefined, "agent-stats");
  for (const [value, label] of [
    [completed + "/9", "company cases finished"],
    [String(v.model_count), "models on Sail"],
    ["$" + Number(v.known_inference_usd).toFixed(2), "inference · this run"],
  ]) {
    const item = node("div");
    item.append(node("dd", value), node("dt", label));
    stats.append(item);
  }
  const proof = v.companies.find(
    (c) =>
      c.revised_check === false &&
      c.judge_preferences.length === 2 &&
      c.judge_preferences.every((x) => x === "revision"),
  );
  const finding = node("div", undefined, "agent-finding");
  if (proof) {
    finding.append(
      node("span", "Observed · " + proof.symbol, "eyebrow"),
      node("h3", "Agreement isn’t verification."),
      node(
        "p",
        "Both model judges preferred a revision. Its mechanical evidence checks still failed.",
      ),
    );
  } else {
    finding.append(
      node("span", "Evidence before confidence", "eyebrow"),
      node("h3", "A revision has to survive its checks."),
      node(
        "p",
        "The run preserves first drafts, opposing reviews, failed checks and the final revisions.",
      ),
    );
  }
  const detail = node("details", undefined, "agent-checks");
  detail.append(node("summary", "See the checks"));
  const explanation = node(
    "p",
    "First draft → revision. These checks cover source quotations and arithmetic, not investment approval.",
  );
  const rows = node("div", undefined, "agent-check-grid");
  for (const c of v.companies) {
    const row = node("div");
    const status = (x) => (x === null ? "—" : x ? "Pass" : "Check");
    row.append(
      node("span", c.symbol),
      node("span", status(c.initial_check) + " → " + status(c.revised_check)),
    );
    rows.append(row);
  }
  detail.append(explanation, rows, notesLink("Read the experiment ↗"));
  const products = node("div", undefined, "sail-products");
  const definitions = [
    [
      "Inference",
      "Independent analysts and opposing critics.",
      v.model_count + " models",
    ],
    [
      "Supercache",
      "Reuse the same evidence across company questions.",
      v.supercache_tokens.toLocaleString("en-US") + " tokens reused",
    ],
    [
      "Sailbox",
      "Run frozen checks in a persistent cloud workspace.",
      v.cloud_checks +
        " checks · " +
        (v.cloud_persistence_verified
          ? "sleep/resume verified"
          : "verification pending"),
    ],
    [
      "Voyages",
      "Follow the requests and revisions in one trace.",
      v.trace_recorded ? "Trace recorded" : "Trace unconfirmed",
    ],
  ];
  for (const [name, description, measurement] of definitions) {
    const item = node("details", undefined, "sail-product");
    const summary = node("summary");
    summary.append(node("span", name), node("span", "+", "product-plus"));
    item.append(
      summary,
      node("p", description),
      node("p", measurement, "product-measurement"),
    );
    products.append(item);
  }
  const foot = node(
    "p",
    v.unknown_requests
      ? `Known inference estimate; ${v.unknown_requests} requests remain unsettled.`
      : "Token-price estimate for this run; compute is recorded separately.",
    "agent-cost-note",
  );
  target.replaceChildren(header, stats, finding, detail, products, foot);
}
export async function loadAgent(target, fetcher = fetch) {
  try {
    const response = await fetcher("./agent-state.json", {
      cache: "no-cache",
      credentials: "omit",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("No checkpoint");
    const raw = await response.text();
    if (raw.length > 12000) throw new Error("Oversized checkpoint");
    mountAgent(JSON.parse(raw), target);
    return true;
  } catch {
    target.replaceChildren(
      node("p", "The latest checkpoint is available in the research notes."),
      notesLink("Open the research record ↗"),
    );
    return false;
  }
}
if (typeof document !== "undefined" && document.querySelector("#agent-report"))
  loadAgent(document.querySelector("#agent-report"));
