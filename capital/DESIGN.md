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
5. **The ladder** (`#improvement`), three floors and one dot per agent (the owner, Sept 23, 2026:
   "level 1, 2, 3 with very limited text", and dots, not bars). Top first: **Level 3** · Increased
   capital (the House's `swing` and `star` bands), **Level 2** · Live trading (`bunt`, and since Sept 24, 2026 `probe`: a first real stake at pocket-change size for an agent whose family has not proven its edge), **Level 1** ·
   Practice (`paper`, and `replay` agents still being tested on history). The level number is the
   headline and the word is a small tag; the House's band names never appear, and `LEVELS` in
   `capital.js` is the one table that maps them. Every row is centred, so the counts alone draw the
   pyramid, and an empty level keeps its place ("No one yet").
   - **Dots.** Level 1 is a 12px disc in a 24px cell (the tap target): green up, red down, grey flat,
     by practice growth W. A hollow ring has no closed trade yet (its colour is its open positions);
     a dotted ring is a new agent on history. Order reads like text: nearest Level 2 top left, the
     untested middle, losers last, the new agents at the end.
   - **Coins.** Levels 2 and 3 are gold-rimmed coins, the rim meaning real money, the diameter the
     stake on one absolute scale (`coinSize`: 6√stake px, 18 to 56, so $10 is 19px and $25 is 30px),
     the fill the real P&L and the glyph (+ − ·) its sign, so a loss reads without colour. The top
     three earners (`star`) stay on Level 3 with a gold medal ring.
   - **Arcs.** A gold arc round a dot or coin is its progress toward the next level (`NEXT_LEVEL`,
     mirroring league/constitution.py): practice to live trading at evidence 1.01 over five closed
     trades, live trading to increased capital at 1.5 over eight real trades with real results at or
     above even (capped at 95% until they are). It is the allocator's main rule only: Kalshi's
     three-settlement route and the evaluator's screen are not published, so a closed ring is a
     floor, never a promise. An arc is drawn over a faint full-circle track, so how far is left
     shows at a glance. The copy says "Ready", never "next", and the readout's last move shows
     which route a climb took. With no `board`, `board.enabled` false, an accounting issue or no
     evidence there is no arc and no claim.
   - **Gates.** A small ▲ notch in the top line of Levels 1 and 2 is the way up; it has no border
     and no circle, so it never looks like a button. A crossing travels
     through it (FLIP with the Web Animations API, measured before and after each redraw): the dot
     grows into its coin, the rim sweeps shut, one ripple, the gate flashes; a drop runs back through
     it in red. Once a visit, when 40% of the ladder is first in view, the newest climb of the last
     day that still stands plays again, and the readout says "Latest climb" so it never reads as
     live. A birth rises into Level 1, a death fades into Retired, a thought, research call or fill
     sends one faint ring out from its agent's dot (one per agent per 8 s, four at once, only while
     the ladder is in view). Nothing moves until the roster agrees with the tape; a move on the tape
     asks for the checkpoint again six seconds later. Reduced motion stills all of it.
   - **Readout.** Tap, hover (fine pointers), or focus a dot: name, venue and strategy tag; its
     level and money ("Level 1 · practice +1.2% · 4 trades", "Level 2 · $56.11 stake · +$1.29 real ·
     4 real trades"); its family line (below); an XP bar ("62% to Level 2 · evidence 1.006 of 1.01 ·
     4 of 5 trades"); and its last move, with the reason rebuilt from fixed phrasings
     (`reasonWords`), never the House's text. Arrow keys walk a floor (one tab stop each), Esc
     clears; a redraw puts focus back but never changes what the visitor chose. With nothing
     chosen it names the agent closest to Level 2. Lines break only between their phrases. Dots
     carry no `title`: hover already fills the readout, and a tooltip would cover the
     neighbouring dots.
   - **Families** (Sept 24, 2026, the House's mechanism ledger). A family is one mechanism on one
     venue: every agent ever born with it, living or dead. Its pooled record over independent
     settlements, practice and real, is what moves real money: "unproven" (a first real stake is
     pocket change), "proven" (its lower bound is above zero: full stakes), "compounding" (the
     House's family swing: its real stakes double as its real record holds). The readout's family
     line is the strategy tag, the state and the evidence ("weather favorites · proven · 16
     settlements"): proven in green, compounding in gold, unproven quiet. With it the tag leads
     that line and leaves the head; without a tag the line says "Proven family · 16 settlements";
     before the House publishes the record there is no line.
   - Above the floors: the caption, a legend of only what is on the board (Up, Down, Flat, No
     trades yet, Toward next level, Top 3), and a throttle that is on. Below: Retired (rings tinted
     by how each ended), "Level unknown" when a desk has no band, the readout, and the last five
     moves as buttons ("Huang · Level 1 → 2 · $10"; a new agent starting practice is not a
     crossing and is not listed). Only a level crossing replays when pressed; a restake, birth or
     exit only selects its agent. Restakes (`settleStakes`): one that repeats the previous stake
     is dropped, an agent keeps only its newest, and when the tape's amount disagrees with the
     checkpoint's stake (the one the coin is drawn at) the line says "restaked" with no amount, so
     the page never states two stakes for one coin.
   - **Births and exits say why** (Sept 24, 2026), in the moves list ("Mullins XXVI · born · lab
     graduate", "Hawkins XX · retired · lost its seat"), the readout's move line and the feed, from
     fixed phrasings only. A birth: "lab graduate", "tweak of <parent>" (its parent's settings
     nudged), "child of <parent>" (its parent's own research), "founding agent". An exit, from the
     House's cause: displaced "lost its seat", evidence "lost too much", superseded "replaced by
     its fix", redundant "a duplicate", credits "out of credits", never qualified "never passed its
     history test", stuck "idle too long"; any other cause says nothing. A desk's own record knows
     when an agent was born and the tape also how: the tape's telling fills in the reason.
   - **Proven edges** (Sept 24, 2026). Under the moves, one line per proven or compounding family,
     at most eight, compounding first and then by settlements: its tag, its state, its
     settlements (real money's among them), its lower bound on growth a settlement, the agents on
     real money and each one's stake, and its capacity (what the edge earns a day at that stake,
     said only once it is measured above nothing): "sports central run under · proven · 11
     settlements, 2 real · lower bound +14.2% · 1 agent at $30 · capacity $57/day". Then the
     unproven count ("44 strategies still unproven"), or with none proven "No proven edge yet ·
     45 strategies unproven". Nothing here is a button.
   - **Lab** (Sept 24, 2026). One quiet line last, headed Lab: "84 strategies tested in the last
     hour · 3 graduates waiting for a seat" (no graduate waiting says nothing). The lab's reading is
     drawn only while it is at most half an hour older than its checkpoint (`LAB_STALE_MS`).
   - **The flywheel** (Sept 25, 2026, the forward-first run: the owner's "compute a day, evidence a
     day, real profit a day, restarts a day"). Under the moves and above the proven edges, one strip
     headed "Last 24 hours", up to four cells that wrap as a row, each drawn only when the House
     publishes its number: **Compute** ("$122 · 6.3× real profit": compute over real profit is the
     parity the owner reads; with no profit there is no ratio), **Evidence** ("182 winning blocks · 8
     graduates · 1 edge proven": forward blocks that grew, lab graduates, families newly proven),
     **Real profit** ("+$19.38", green or red) and **Restarts** ("24"). Drawn while the reading is at
     most half an hour older than its checkpoint (`FLYWHEEL_STALE_MS`); a reading with no number draws
     no strip. Each proven edge then gains up to two indented lines: its clock to compounding
     ("Compounding review at 15 real settlements · 4 to go at 5.6 a day · about 17 hours"; "· passed ·
     the audit is next" once the count is reached; "settlements on 2 more days" while the review lacks
     distinct days; "Level 3 not yet released" while the owner's grant holds stakes at Level 2; a
     compounding family has no clock) and its capacity at the real size, size by size ("Capacity
     $32/day at $5.39 · $65/day at $11 · not measured at $22"; "incl. practice" where the fill rate
     counts practice fills; a size never bid enough is never priced). With a curve, the edge's own line
     drops its "capacity $X/day", so the page never states two capacities for one family.
   - Reads each desk's `band`, `stake_usd`, `evidence` {`W_paper`, `W_real`, `E`, `trades`,
     `real_trades`}, `last_move`, and `family_state` with `family_n` (together or not at all), and
     the checkpoint's `board` {`bands`, `moves`, `throttle`, `enabled`, `families` {`unproven`,
     `rows`}, `lab` {`at`, `tested_last_hour`, `graduates_waiting`}}, a family row's optional
     `swing_clock` {`look_at`, `to_go`, `per_day`, `days`[, `dates_to_go`][, `grant_holds`]} and
     `capacity_curve` [{`multiple`, `size_usd`, `fill_rate`, `usd_per_day`, `basis`}], and the
     checkpoint's `flywheel` {`at`[, `compute_usd_per_day`][, `real_profit_usd_per_day`][,
     `positive_blocks_per_day`][, `graduates_per_day`][, `proofs_per_day`][, `restarts_per_day`]}. A checkpoint from before the
     allocator publishes none of these: the level then follows `gate.evidence.rung` (0 and 1 Level
     1, 2 Level 2, 3 Level 3) and a real desk's `capital_usd` stands in for its stake; one from
     before the mechanism ledger draws no family line, no proven edges and no lab line.
   - The Positions switch does not touch the ladder: every agent is always a dot.
   - The League's lines in the live feed speak the same way ("Huang climbs to Level 2 with $10
     real", "Hawkins XX retired: lost its seat"), and any other league line has the House's band
     words swapped for the page's. The House's word for the practice band is `paper`, and for a
     compounding family `swing`; the page says practice and compounding, everywhere.

**Footer.** "Blake Woods owns every position. Not investment advice."

## Copy rules

Sentence case. "Practice" for shadow; "real money" for live. Market names, not tickers. Numbers
short and signed (−$75.80, +0.25%).
