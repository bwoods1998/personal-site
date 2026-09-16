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

## Desk page and loop page

Unchanged by the floor redesign. The desk page leads with "watch it think", then holdings with
reasons, trade stories, calibration, strategies, toolbox and playbook. The loop page leads with the
improvement curve, then the race, experiments, house genome, capital, gates and the memo.

## Copy rules

Sentence case. "Practice" for shadow on the floor; "real money" for live. "Sail credit" not
"inference budget". Market names, not tickers. Numbers short and signed (−$75.80, +0.25%).
