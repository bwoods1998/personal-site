# The floor, for a first-time visitor

*The brief for `/capital/`. Every page here is judged by one test: a stranger lands on it and,
without reading a paragraph, knows what this is, whether it is alive, whether it is working, and
where to look to watch it think. Fewer words, more live things.*

## Principles

1. **One screen answers the three questions.** What is this (one sentence). Is it alive (a
   clock that ticks and a thought that streams). Is it working (balance, profit, profit per
   Sail dollar). Everything else is one tap away.
2. **Show, don't label.** A thought typing itself out beats a heading that says "Thinking".
   A holding card with the desk's own sentence beats a table. A generation badge beats a
   paragraph about evolution.
3. **Word budget.** Floor page: at most 120 static words above the tape. Panel titles: one to
   three words. No paragraph anywhere except the explainer, and that one is under 60 words.
   Numbers short in headlines ($980), exact in details ($979.60). Times relative ("14 min ago").
4. **Progressive disclosure.** Compact by default; a chevron or "why" control opens the detail
   in place; the desk page is the deep dive. Nothing important is only in a tooltip.
5. **Live, not refreshed.** The run clock counts up in the browser between checkpoints. The
   tape and the "now" cards update from the WebSocket. A page left open for an hour should look
   alive the whole hour.
6. **Honest about shadow.** Shadow desks are the training ground; real money is only on live
   sleeves. One small "shadow" tag with a one-line hover, never a wall of text.
7. **No libraries, no external resources, phone width first, theme-aware, same tokens.**

## Floor page, top to bottom

1. **Masthead.** Name. One sentence: "Six AI partners trading real money on Kalshi and Coinbase,
   breeding better versions of themselves, in public." Under it the **run clock strip**:
   `running 2h 14m` (ticking) · `$0.19 of Sail credit spent` · `profit $0.00` · `$0.00 per
   Sail dollar` · a small credit pill (`$280 credit · open`). The infra strip and the status
   bar fold into this; the box id and checkpoint count move behind a chevron.
2. **Now.** One card per desk that is in session: name, why it sat down (trigger, plain words),
   the newest thought streaming in (typed out; the WebSocket delivers it), the tool it just
   called. Idle desks are one line each: `Mullins · next 16:30 ET · last: passed on FOMC, edge
   too thin`. The night desk is one line: `watching 3 markets · 0 wakes today`.
3. **Holdings.** The balance chips (Kalshi, Coinbase, total) and one compact card per holding:
   instrument, side, size, mark, P&L, the desk's sentence, exit chips. A "why" control opens
   the full rationale and links to the trade story. Empty state in one line: `Flat. $980 in
   cash across two accounts. Passed on N ideas today.` The balance history becomes a sparkline
   inside this panel, not its own section.
4. **The race.** One row per family: the live desk and its shadow children as chips with
   generation numerals and a score, the leader marked, mutation badges on hover or expand
   (model, effort, times). One line under it: `2 experiments running · generation II vs I:
   +0.9%`. The full lineage tree, experiments and the improvement curve live on the loop page.
5. **The tape.** Live. Default filter shows thoughts, decisions, forecasts, orders, fills,
   memos, wakes, experiments and verdicts; a toggle shows everything (tool calls, marks,
   budgets). Each line is one sentence in plain words.
6. **How it works.** The three loops as a compact diagram with under 60 words total, and one
   line naming what cannot change (keys, caps, risk engine, critic, reserve, kill switch).

## Desk page

Hero is **watch it think**: the live thought stream for the running session (auto-scroll,
typed), or the last session's thoughts with "ended 14 min ago · no trade". Then holdings with
reasons; trade stories as a compact timeline (thesis → engine → order → fills → exit plan →
outcome); calibration (event desks); the toolbox and code runs (when any); the playbook behind a
chevron; lineage badges in the header. Under 60 static words.

## The loop page (was "committee")

Retitle to **The loop**. Hero: the improvement curve with one sentence reading it. Then
experiments and verdicts, the house genome per family, allocations and why (bandit draws),
gates with evidence, promotions and retirements, calibration by family, Meriwether's memo
behind a chevron. Under 100 static words.

## Copy rules

Sentence case. No acronym without its expansion the first time on the page (FOMC, P&L are
fine). "Shadow" not "paper" or "hypothetical". "Sail credit" not "inference budget". "Woke"
not "triggered". Never "hypothetical" more than once on a page. Tape lines: subject, verb,
object, number; no jargon.


## Floor page, revised Sept 16, 2026

Five things, in this order, nothing else: the run strip (hours running, Sail credit spent,
profit, profit per Sail dollar); **Live** (the partners in session with their thoughts typing,
then the tape of thoughts, research and trades; "everything" is one toggle away); **Portfolio**
(balance, venues, sparkline, every open position with its reason, resting orders); **Closed
trades** (every settled trade with the partner and its reason, real first, shadow behind a
chevron); **Partners** (one row each, sorted by profit per Sail dollar, with hours of
self-improvement, sessions, decisions and whether the newest generation beats the last). The
race, the box facts and the explainer diagram moved to the loop page. Idle partners are rows in
the table, not lines in the live panel.
