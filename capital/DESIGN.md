# The options swarm, for a first-time visitor

*The brief for `/capital/`, the project's only page, as it started over on Sept 26, 2026. A stranger
lands and, in seconds, knows what this is (AI agents trading options), how it is doing (four numbers),
and can watch the swarm decide, train and trade. Focus: say no to everything else. The desk pages and
the loop page are retired; `/capital/desk/*` and `/capital/committee/*` redirect here.*

## Principles

1. **Live first.** The first screen is the name, one sentence, four numbers, and an agent's decision
   typing out above a feed of what the swarm is deciding, trading and becoming.
2. **Five sections, nothing else.** The masthead, live, the Brokerage Account, the swarm, open
   structures. No navigation beyond the two header links (the owner's site, the repository), no arena,
   no ladder, no "how it works".
3. **No venue is named.** The copy says "AI agents trading options."; the account is the "Brokerage
   Account". No venue's name appears anywhere a visitor can read: not in the copy, not in anything
   published (`schema.js` refuses it; the publisher writes "the broker").
4. **Never a quote.** The data licenses forbid publishing quotes, bids, asks, spreads, implied vols,
   greeks, surfaces or fitted parameters. The checkpoint has no field for any of them (every block is an
   allowlist), and every sentence published is quote-free: no decimal number, no dollar or cent price, no
   number beside a quote word. A structure is what it is (underlying, type, legs, expiry, size), what it
   can lose, and its P&L; never its strikes or its prices.
5. **Honest when losing.** Losses are red and first-class. Total profit is a dash until the balance is
   fresh and the funding history is verified; profit after compute is a dash until every input cost is
   metered. Nothing stands in for a number the House has not published.
6. **Words people use.** Bands are Gym, Candidate, Probe, Sized and Retired. Structures read as words
   ("XSP iron condor"). Numbers short and signed (−$74.87, +$212.72). At most 40 static words above the
   feed, 90 on the page.
7. **Phone first, no libraries, no external requests, CSS tokens from `:root`.** 16px gutters at
   390px; tables stack into rows; nothing scrolls sideways. Inline styles only via CSSOM.

## The page, top to bottom

1. **Masthead** (`#masthead`). "Long-Term Capital Management", "AI agents trading options.", and four
   numbers: **Brokerage Account** (the balance), **Total profit** (the balance less its equity at the
   reset, less the owner's deposits net of withdrawals), **After compute** (total profit less Sail,
   OpenAI, ThetaData, market data and anything else: the one number), and **Running** (a ticking clock
   from `run.started_at`, the House's first start on its new ledger).
2. **Live** (`#live`). The heading is the status: one dot and one word, following the data. The House is
   running while the newest checkpoint the page holds is under 15 minutes old (`floorRunning`); then the
   word is a green, pulsing **live** once the socket or polling is up, and **connecting** until it is.
   With no checkpoint, or none that recent, it is a red, still **stopped**. The stage: the newest agent
   note, typed, with the agent's name, its band and its mechanism; an agent keeps the stage while it is
   still talking (45 s hold). Below it, twelve lines, newest first: thinking (`agent.note`), trading
   (`agent.trade`: "opened 2 SPY debit verticals · Sep 28 · max loss $96", "closed … +$31.00", tagged real
   money or shadow; tap for the agent's reason), and the swarm's news (`swarm.news`). A repeat folds into
   one line with ×N. WebSocket first, polling after.
3. **Brokerage Account** (`#account`). One chart: the balance from the reset (its start point is the
   basis), every `account.mark` since, and the checkpoint's own reading, with a hover readout. Under it,
   the reconciliation in four lines: the balance now and at the reset; total profit and the flows netted
   out of it; compute, part by part ("not yet metered" where the House has no number); and profit after
   compute.
4. **The swarm** (`#swarm`). The Gym's pace in one line ("48,213 programs tested · 51,240.5
   market-years simulated · 11 families alive · 37 retired"), the count in each band (every band, empty
   ones too), then one row per living agent, highest band first: its name, its band, its structure as a
   tag and its mechanism in a sentence (tap to read it whole), and its record: real money's when it has
   one ("real 22 trades · 16 won · +$212.40"), else the forward record (nightly replays and live shadow),
   else the Gym's count of what its lineage has tried ("1,204 trials · 17 revisions"). Twenty-four rows,
   then a button for the rest and the retired.
5. **Open structures** (`#structures`). One line ("3 real · 1 shadow · $341 at risk on real money"),
   then real money first by maximum loss, then the shadow book: agent, structure, legs · expiry · size,
   maximum loss, P&L.

No footer.

## The numbers and the reset

- The profit basis is the checkpoint's `performance` block: the account's equity at the reset and the
  owner's net flows since, verified from the account's own history. `PERFORMANCE_START_AT` and
  `START_EQUITY` in `capital.js` are the fallback while no checkpoint carries one, and the floor under it:
  a basis dated before `PERFORMANCE_START_AT` is never read, so the old record cannot leak into the new
  one. The main session sets the pair at deploy time to `league/config.json` `performance`.
- Total profit needs `account` fresh (within ten minutes of `published_at`) and not stale, and
  `net_flows` verified within ten minutes. After compute needs every `compute` part.
- The reset (`POST /api/capital/reset?confirm=erase-everything` with the publish token, also under
  `/t/test` and `/t/canary`) erases the tape, the balance history, the checkpoint and the roster. Until
  the House's first checkpoint the page reads "stopped", every number is a dash, and every section says
  it is empty.

## Reads

The checkpoint (`schema.js` `validCheckpoint`, schema 2): `run {started_at}`, `account {equity, cash,
as_of, stale}`, `performance {start_at, start_equity, net_flows, verified_at}`, `compute {as_of,
sail_usd, openai_usd, thetadata_usd, market_data_usd, other_usd}`, `gym {as_of, trials, market_years,
families_alive, families_retired}`, `agents[]` `{id, family, mechanism, structure, band, born_at,
retired_at, record {trials, revisions, forward, real}}` and `structures[]` `{id, agent, underlying,
structure, legs, expiry, quantity, real, opened_at, max_loss_usd, pnl_usd}`. The tape: `agent.note`,
`agent.trade`, `swarm.news {agent, text}`, `account.mark`. An agent is named by its id. The publisher's side is
`long-term-capital-management/league/publish.py` and its contract, `league/tests/fixtures/site_contract.md`.

## Copy rules

Sentence case. "Real money" and "shadow" for the two books. Structures and bands in words. Numbers
short and signed.
