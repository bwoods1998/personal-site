import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  amount,
  validCashMap,
  scenario,
  money,
  waterfall,
} from "../portfolio/explorer.js";
import { validAgentState } from "../portfolio/agent.js";
const raw = await readFile(
  new URL("../portfolio/cash-map.json", import.meta.url),
);
const bank = JSON.parse(raw),
  state = JSON.parse(
    await readFile(new URL("../portfolio/agent-state.json", import.meta.url)),
  );

test("all 18 cash bridges balance and the exact published data has a source review", async () => {
  assert(validCashMap(bank));
  const review = JSON.parse(
    await readFile(
      new URL("../portfolio/cash-map-review.json", import.meta.url),
    ),
  );
  assert.equal(
    review.dataset_sha256,
    createHash("sha256").update(raw).digest("hex"),
  );
  for (const c of bank.companies)
    for (const prior of [false, true]) {
      const v = scenario(c, 0, 0, prior),
        p = prior ? "prior_" : "";
      assert.equal(v.remaining, amount(c[p + "cash_remaining"]) * 100n);
      assert.equal(v.cash - v.investment, v.remaining);
    }
});

test("cash publication rejects altered arithmetic, currency, dates, sources and extra private fields", () => {
  for (const mutate of [
    (d) => (d.secret = "private"),
    (d) => (d.companies[0].cash_remaining = "999"),
    (d) => (d.companies[0].deductions[0].prior_value = "0"),
    (d) => (d.companies[1].currency = "USD"),
    (d) => (d.as_of = "2026-02-30"),
    (d) => (d.companies[0].period_end = "2027-01-01"),
    (d) =>
      (d.companies[0].source.url = "https://nvidianews.nvidia.com.evil.test/"),
    (d) => (d.companies[0].source.url = "javascript:alert(1)"),
    (d) => d.companies.reverse(),
    (d) => (d.companies[0].source.private_note = "private"),
  ]) {
    const v = structuredClone(bank);
    mutate(v);
    assert.equal(validCashMap(v), false);
  }
});

test("sensitivities preserve exact arithmetic, original currency and negative funding gaps", () => {
  const msft = bank.companies.find((c) => c.symbol === "MSFT");
  assert.equal(money(scenario(msft).remaining), "$66.987B");
  assert.equal(money(scenario(msft, 0, 0, true).remaining), "$71.611B");
  assert.equal(money(scenario(msft, 0, 1).remaining), "$65.828B");
  assert.equal(
    money(
      scenario(bank.companies.find((c) => c.symbol === "TSM")).remaining,
      "TWD",
    ),
    "NT$287.363B",
  );
  assert.equal(
    money(scenario(bank.companies.find((c) => c.symbol === "AMZN")).remaining),
    "−$7.604B",
  );
  for (const c of bank.companies)
    for (const prior of [false, true])
      for (const cash of [-50, 0, 50])
        for (const spend of [-50, 0, 50]) {
          const v = scenario(c, cash, spend, prior),
            g = waterfall(v);
          assert.equal(v.remaining, v.cash - v.investment);
          for (const r of [g.cash, g.investment, g.remaining])
            assert(r.height >= 0 && r.y >= 23.999 && r.y + r.height <= 158.001);
          assert.equal(g.negative, v.remaining < 0n);
        }
  for (const bad of [51, -51, 0.5, NaN, Infinity, "1"])
    assert.throws(() => scenario(msft, bad, 0));
  assert.throws(() => amount("1e9"));
  assert.throws(() => amount("0.0001"));
  assert.equal(money(0n), "$0M");
  assert.equal(money(-1n), "−$0M");
});

test("checkpoint rejects private fields and contradictory completion claims", () => {
  assert(validAgentState(state));
  for (const mutate of [
    (d) => (d.prompt = "private"),
    (d) => (d.requests = 87),
    (d) => (d.known_inference_usd = "NaN"),
    (d) => (d.companies[0].finished = false),
    (d) => (d.companies[0].revised_check = null),
    (d) => (d.companies[0].judge_preferences = ["approved"]),
    (d) => (d.companies[0].raw_response = "private"),
    (d) => (d.cloud_checks = 10),
    (d) => (d.saved_at = "2026-02-30T00:00:00Z"),
  ]) {
    const v = structuredClone(state);
    mutate(v);
    assert.equal(validAgentState(v), false);
  }
});
