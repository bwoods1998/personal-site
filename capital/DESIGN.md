# The floor, for a first-time visitor

*The brief for `/capital/`. A stranger lands and, in seconds, knows what this is (AI traders on
real money that rewrite themselves), how it is doing (five numbers), and can watch it think.
Focus: say no to everything else. Depth lives on the desk pages and the loop page.*

## Principles

1. **Live first.** The first screen is the name, one sentence, five numbers, and a partner's
   thought typing out above a feed of what the partners are thinking, researching and trading.
2. **Only what earns its place.** No credit pill, session counts, box ids, night desk, explainer
   diagram, working orders, exit chips or tool plumbing on the floor. If it is not one of the
   five sections below, it belongs on a desk page or the loop page.
3. **Real money is the story; practice is the training ground.** Positions list real money only.
   Shadow desks appear in the feed and the race with a quiet "practice" tag, never hidden.
4. **Honest when losing.** Losses are red and first-class. The balance line starts after money
   moved in or out, so a deposit never reads as a gain.
5. **Words people use.** Tickers become markets ("Austin high 100–101°F · Sep 16", "Fed Sep · hike
   25bp"); tool calls become sentences ("reading the NWS forecast for Chicago"); a strategy name
   is a small tag, not a sentence opener. At most 60 static words above the feed.
6. **Phone first, no libraries, no external requests, CSS tokens from `:root`.** 16px gutters at
   390px; tables stack into rows; nothing scrolls sideways. Inline styles only via CSSOM.

## Floor page, top to bottom

1. **Masthead.** "Long Term Capital Management" and one sentence. One row of five numbers:
   Portfolio (`floor.account_equity`), Profit (`run.pnl_total_usd`, with its share of net deposits,
   or of equity less profit until the runtime publishes deposits), Self-improving (a ticking clock
   from `run.started_at`), Sail spent, Profit per Sail $.
2. **Live.** Status (streaming, partners in session) and "Everything ↗" to the loop page. The stage:
   the newest thought, typed, with the desk, real money or practice, why it sat down, and its latest
   research. A desk keeps the stage while it is still talking (45s hold). Below it, twelve lines,
   newest first, of exactly three kinds: thinking (`desk.thought`), researching (research
   `desk.tool_call`s in plain words), trading (`broker.fill`, `desk.outcome`). Orders, memos,
   settlements, reversals, tool results, marks, budgets and risk records stay out. A desk repeating
   itself folds into one line with ×N. WebSocket first, polling when it drops.
3. **Portfolio.** Kalshi and Coinbase balances; the balance line from `floor.mark` with a hover
   readout. Open positions, real money only, dust under $0.50 hidden: Agent, Market, Side, Value,
   P&L, Why (first sentence; tap for the full thesis). One line counts practice positions.
4. **Past trades.** The real-money record in one line, then eight closed trades, newest first:
   Agent, Market, Result (won, lost, sold), P&L, Held, Why. "include practice" and "more" toggle.
5. **Who's winning / Getting better?** Side by side on desktop. A leaderboard ranked by lifetime
   P&L (rank, name with generation numeral, real money or practice, P&L, return, trades). A grid of
   families by generation, return on capital per cell, the live desk outlined, the family's best
   starred, an "All" row per generation, one sentence counting families where a practice child
   beats the live partner, and "bred · retired · promoted · experiments".
6. **Footer.** How it works in one sentence, The loop and GitHub, and the disclaimer.

## Loop page, top to bottom (`/capital/committee/`)

How the floor improves itself and who is winning, in two screens. Same principles as the floor.
1. **Masthead.** "The loop", one sentence, eight numbers: families, partners (with how many trade
   real money), bred, promoted, demoted, retired, founded, experiments. Under them the nightly
   clock in Eastern time with the next job pulsing: committee 6:00 PM, evolution 7:00 PM, lab
   8:00 PM, founding 9:30 PM.
2. **Is it getting better?** The floor's family × generation grid, larger, each cell's P&L under
   its return. Hover (or a first tap) reads a cell out below with its decisions; the readout starts
   on the best child. One sentence counts families where a practice child beats the live partner.
3. **The race.** "Closest to promotion: X, gate A: 5 of 6 met; short on days live (1)." Then a row
   per family: live partner first, challengers with return, a star for the family's best, a
   six-bar gate meter, "demoted" and "founded by the floor" tags. Gate evidence and how the
   children differ sit behind two quiet disclosures.
4. **What changed.** One timeline, newest first, fifteen lines and "more": bred, founded,
   promoted, moved back to a shadow book, retired, lab experiments and verdicts, a real-money sleeve
   resized ("Meriwether moved Hilibrand $487 → $369"), a playbook rewritten. A child's first
   playbook is its birth, not a second line.
5. **Capital.** Real-money sleeves only: partner, sleeve, P&L, Meriwether's latest reason. One line
   for the rest: "17 shadow partners score against notional books."
6. **Meriwether's memo** (first paragraph, "read the memo") and **calibration by family** render
   only when the log holds them.

## Desk page, top to bottom (`/capital/desk/?id=`)

Who the partner is, how it is doing, what it is thinking, what it holds, what it has learned.
1. **Header.** Name with generation numeral; real money or practice, "demoted", "founded by the
   floor"; family, generation, parent. The mandate in one sentence (founders from the manifests,
   a founded family from its universe), what a child was born with, a live sleeve and its reason,
   the demotion and its reason. Five numbers: equity, lifetime P&L, return, trades, compute (×).
2. **Now.** The newest session: six thoughts clamped to three lines (tap to open), tool calls in
   plain words, repeats folded (×2, +5 more), the last thought typed while live, the desk's own
   end-of-session summary. Earlier sessions are one disclosure, a line each, opening in place.
3. **Holdings** (floor table, eight rows, dust counted), **Record** (one line, then eight closed
   trades), **Strategies** (one row each; settings and code runs behind disclosures), **What it
   learned** (post-mortem, playbook reason with its diff, the three newest lessons), and
   **Calibration**. A section with nothing to show is not drawn.

A demotion is published as `evolution.promoted` with `to: "shadow"`; every page reads it as
"moved back to a shadow book", never as a promotion.

## Copy rules

Sentence case. "Practice" for shadow on the floor; "real money" for live. "Sail credit" not
"inference budget". Market names, not tickers. Numbers short and signed (−$75.80, +0.25%).
