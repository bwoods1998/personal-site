# The floor, for a first-time visitor

*The brief for `/capital/`, the project's only page. A stranger lands and, in seconds, knows what
this is (AI agents on real money that rewrite themselves), how it is doing (two numbers), and can
watch it think. Focus: say no to everything else. The desk pages and the loop page are retired;
`/capital/desk/*` and `/capital/committee/*` redirect here.*

## Principles

1. **Live first.** The first screen is the name, one sentence, two numbers, and an agent's thought
   typing out above a feed of what the agents are thinking, researching and trading.
2. **Five elements, nothing else.** No navigation, no separate leaderboard, no arena, no partner grid, no
   genome detail, no "how it works". If it is not one of the five sections below, it is not here.
3. **No hyperlinks.** The page contains no `<a>` element, static or drawn: not to the home page,
   the repository or anywhere else. Agent names are plain text. A test enforces it.
4. **Real money is the story.** Both position tables, open and closed, list real money only. One
   quiet switch in the Positions heading shows the practice positions and trades in both, tagged,
   and it is off on every visit (the owner, Sept 23, 2026, as the agents' practice books filled).
5. **Honest when losing.** Losses are red and first-class. Total profit is a dash until both
   account balances and the funding history are verified; the run's own P&L claim never stands in.
6. **Words people use.** Tickers become markets ("Austin high 100–101°F · Sep 16"); tool calls
   become sentences; a strategy name is a small tag. At most 40 static words above the feed, 90 on
   the page.
7. **Phone first, no libraries, no external requests, CSS tokens from `:root`.** 16px gutters at
   390px; tables stack into rows; nothing scrolls sideways. Inline styles only via CSSOM.

## The page, top to bottom

1. **Masthead** (`#masthead`). "Long Term Capital Management", one sentence, and two numbers:
   **Total profit** (`portfolioPerformance`: balance change since the audited start, less net
   deposits) and **Running** (a ticking clock from `run.started_at`).
2. **Live** (`#live`). The heading is the status: one dot and one word, and it follows the data,
   not a switch in the code. The floor is running while the newest checkpoint the page holds was
   published in the last 15 minutes (`floorRunning`, `FLOOR_STALE_MS`; the runtime publishes one a
   minute): then the word is a green, pulsing **live** once the socket or polling is up, and
   **connecting** until it is. With no checkpoint, or none that recent, it is a red, still
   **stopped**, on the real floor and on a test tape alike. The page reads it again on every
   30-second refresh, so starting the runtime turns it live and stopping it turns it stopped, with
   no edit to the site. The stage: the newest thought, typed, with the agent, real money or practice,
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
5. **The ladder** (`#improvement`), a live capital board (the owner, Sept 23, 2026: an agent's
   rank is its capital). One lane per band, top first: **Star**, **Swing**, **Bunt** (real money),
   **Practice**, **Replay**. Each agent is one bar. A real-money bar is as wide as its stake (square
   root, so a $10 bunt shows beside a star's stake); a practice bar is as wide as its practice
   wealth multiple W (to the fourth power, so a few percent shows); a replay bar is a dot. Green is
   profit, red loss (practice reads by W, real money by P&L). Tap, hover or focus a bar for its
   record: band, stake, E and the two multiples, trades, P&L, credits, and the reason for its last
   move. Reads each desk's `band`, `stake_usd`, `evidence` {`W_paper`, `W_real`, `E`, `trades`,
   `real_trades`} and `last_move`, and the checkpoint's `board` {`bands` (count and capital per
   band per venue: the lane notes), `moves` (the trail), `throttle`, `enabled`}. A checkpoint from
   before the allocator publishes none of these: the band then follows `gate.evidence.rung` (0
   Replay, 1 Practice, 2 Bunt, 3 Swing) and a real desk's `capital_usd` stands in for its stake.
   - **Motion.** A move glides the bar from its old lane to its new one (FLIP with the Web
     Animations API, measured before and after each redraw); a birth rises into Replay; a death
     fades into the Retired row. A move seen for the first time within the hour glows once and
     keeps an arrow over its bar. Nothing moves until the roster agrees with the tape, and a band
     move on the tape asks for the checkpoint again six seconds later, so a crossing shows within
     seconds. Reduced motion stills all of it.
   - **Practice follows the Positions switch.** Off (every visit), the Practice and Replay lanes
     are one tick per agent, and pressing the ticks turns the switch on; on, every practice agent
     is a bar with its record.
   - Under the lanes: the Retired row (the recent exits the checkpoint carries), a two-word legend,
     the record of the selected bar, and the last five moves ("Mullins VII · Practice → Bunt ·
     $10"). A throttle that is on says so above the lanes.
   - The House's word for the practice band is `paper`; the page says Practice, everywhere.

**Footer.** "Blake Woods owns every position. Not investment advice."

## Copy rules

Sentence case. "Practice" for shadow; "real money" for live. Market names, not tickers. Numbers
short and signed (−$75.80, +0.25%).
