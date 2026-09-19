# The floor, for a first-time visitor

*The brief for `/capital/`, the project's only page. A stranger lands and, in seconds, knows what
this is (AI agents on real money that rewrite themselves), how it is doing (two numbers), and can
watch it think. Focus: say no to everything else. The desk pages and the loop page are retired;
`/capital/desk/*` and `/capital/committee/*` redirect here.*

## Principles

1. **Live first.** The first screen is the name, one sentence, two numbers, and an agent's thought
   typing out above a feed of what the agents are thinking, researching and trading.
2. **Five elements, nothing else.** No navigation, no leaderboard, no arena, no partner grid, no
   genome detail, no "how it works". If it is not one of the five sections below, it is not here.
3. **No hyperlinks.** The page contains no `<a>` element, static or drawn: not to the home page,
   the repository or anywhere else. Agent names are plain text. A test enforces it.
4. **Real money is the story.** Positions list real money only. Practice trades are offered behind
   one quiet button, and only while no real-money trade has closed.
5. **Honest when losing.** Losses are red and first-class. Total profit is a dash until both
   account balances and the funding history are verified; the run's own P&L claim never stands in.
6. **Words people use.** Tickers become markets ("Austin high 100–101°F · Sep 16"); tool calls
   become sentences; a strategy name is a small tag. At most 40 static words above the feed, 90 on
   the page.
7. **Phone first, no libraries, no external requests, CSS tokens from `:root`.** 16px gutters at
   390px; tables stack into rows; nothing scrolls sideways. Inline styles only via CSSOM.

## The page, top to bottom

1. **Masthead** (`#masthead`). "Long Term Capital Management", one sentence, the status indicator
   (`IN_DEVELOPMENT` says "in development" and stills the pulse), and two numbers: **Total profit**
   (`portfolioPerformance`: balance change since the audited start, less net deposits) and
   **Running** (a ticking clock from `run.started_at`).
2. **Live** (`#live`). The stage: the newest thought, typed, with the agent, real money or practice,
   why it sat down, and its latest research. An agent keeps the stage while it is still talking
   (45s hold). Below it, twelve lines, newest first: thinking (`desk.thought`), researching
   (research `desk.tool_call`s in plain words), trading (`broker.fill`, `desk.outcome`), and the
   lab's `lab.progress`. A repeat folds into one line with ×N. WebSocket first, polling after.
3. **Performance** (`#performance`). One chart: total balance since inception from `floor.mark`
   history (`/api/capital/history`), hover readout, the reconciliation to tracked profit, and each
   account's balance under it.
4. **Positions** (`#positions`). **Open**: real money, dust under $0.50 hidden: Agent, Market, Side,
   Value, P&L, Why (first sentence; tap for the full thesis). **Closed**: the record in one line,
   then eight trades, newest first, "N more" for the rest: Agent, Market, Result, P&L, Held, Why.
5. **Self-improvement** (`#improvement`). One sentence ("Generation 4 agents return +1.2% after
   costs; generation 1 returned −0.8%.") over one bar per generation, standing on a zero line, the
   newest generation at full strength. Reads `lab.curve[]`: `generation`,
   `cost_adjusted_excess_pct` (the bar), `decisions` (a generation counts once above zero),
   `desks`, `pnl_usd` and `cost_usd` (the tooltip). Without a curve, the desks' return on capital
   stands in, grouped by `generation`. Nothing yet: "No generations have finished yet."

**Footer.** "Blake Woods owns every position. Not investment advice."

## Copy rules

Sentence case. "Practice" for shadow; "real money" for live. Market names, not tickers. Numbers
short and signed (−$75.80, +0.25%).
