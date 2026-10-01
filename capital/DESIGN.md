# Capital: the swarm window

The single `/capital/` page shows AI agents trading options. The runtime owns the money, models,
training and orders; visiting this page starts none of those things.

## The page

One screen on a desktop (at least 1180 × 720): no page scroll, and every panel scrolls inside itself. Narrower or shorter,
one column at natural heights; on a phone, one column in reading order with 16px gutters and nothing wider than the screen.
The reading order is the DOM's and the screen reader's: the top bar, the thought, the Climb, positions, the chart, the tape.
About forty static words in all; everything else is data, a title or an aria-label. Meaning rides position, stroke and
glyph, never colour alone: hollow researches, dashed trades the shadow book, dotted gold is the incubator, filled gold is
real money, and right of the gold line is real money. Dashes are never gridlines. Dark by default, light on a light system,
and a ◐ to choose; ⛶ (theatre) hides the lower panels so the Climb and the thought fill the screen, and Escape leaves it.
Both choices are remembered per viewer only.

1. **The top bar: Profit, Net and Running.** Exactly three numbers. Profit is the Brokerage Account's complete real
   options P&L since the reset, supplied in `trading {as_of, pnl_usd}`: every real options position after its fees (the
   agents' and the House's own calibration round trips), open ones at the House's current value, plus the account's other
   activity (fees no position carries, crypto fees, interest). Deposits, compute and simulated returns do not enter it,
   nor does the leftover crypto dust of the coins sold at the reset. A missing, null or stale total is a dash. Net is
   realized options P&L since the reset less every input cost since the reset: Profit without any open position's gain
   (an open loss still counts) and without an unreconciled difference unless it is a loss, less the itemized costs.
   Deposits never enter it. While Profit or Net is a dash, the last value the House could price sits under it, dated
   ("−$27.05 · 3:58 PM", title "Last value the House could price."), from the Worker's score archive and only when that
   value is younger than four days; with no archive nothing shows. One quiet line names each cost by service (Sail as Sail
   billed it, Claude, OpenAI, ThetaData, market data, other). A part not yet metered says so and Net is a dash; so is a
   bill that does not name Claude ("Costs are not itemized yet."), or a Profit or bill that is not fresh. Running ticks
   from the House's first start on its new record. The live pulse follows the checkpoint's freshness.
2. **Thinking now.** The newest published note, typed at about forty characters a second with a caret, its speaker's dot,
   name, level and true age (green under two minutes). A note stays at least its reading time (three and a half words a
   second, six to twenty seconds) and then until a newer note arrives; newer notes queue behind a "+N" pill that skips to
   the newest; the pointer over the card holds it; a long note clamps with ↓ and an expanded note stays until it is
   closed. After ten minutes with no newer note the card dims and keeps the last thought and its age. It never shows a
   placeholder. One announcement every twenty seconds at most. On a phone, a 48px ticker carries the typing note while the
   card and the tape are both off screen. While a note is on the card its speaker's dot breathes on the Climb and wears its
   name.
3. **The Climb: the levels.** A map read left to right and upward. The main stairs: Train, Validation, then across the gold
   line Tuition, the Holdout's gate (⌸, with a pip per look: filled for a pass, slashed for a fail), Probe and Sized. The
   side path leaves Train flat and dashed through Practice and, across the gold line, the Incubator, a dotted-gold ledge
   with a ╳: it never reaches the top. Every agent is a dot on the step it stands on, in a stable order by its name's
   ordinal; above each step its count now, below it its name and how many families have ever reached it since the reset.
   A count the House has not published is "—", never 0. Each level's meaning is its title. Retired agents are a heap at
   Train's foot with their count; tapping it lists recent retirements and their causes. A retired agent still holding
   open real money stands, dimmed with a ×, on that money's step. The House's own trades are a ⌂ off the stairs with the
   calibration count, never an agent; tapping it shows them in Positions. ⟳ is the Gym's count of programs tested,
   rolling to each checkpoint's value. With a House that publishes `levels`, every step and count is the House's; with an
   older House the page places dots by band and the ledger (real money on a Gym agent with no incubator tag can only be
   tuition) and shows "—" for Validation and Practice. Every dot is a native button (one tab stop per step; the arrow keys
   move between its dots) whose accessible name says its level, its money and its checks; the pointer need only come
   within twelve pixels. A dot opens its card: the agent's thesis in whole sentences, its record (trials, revisions, real
   and forward tallies), its open structures, its promotion checklist and blocker when the House publishes one, and its
   last five thoughts; the tape follows it. A step's name opens its roster; Practice opens the practice league (below).
   Motion follows real events only: a birth drops a dot onto Train, a retirement slides one into the heap, a move or a
   level change glides, a trade ripples (four at most at once), and dots that spoke in the last ten minutes glow faintly.
   Loading history moves nothing. On a phone the Climb is a ladder of 44px rungs, summit first.
4. **Positions, each with its reason.** Every real position on the Brokerage Account since the reset: open first, then
   closed, newest first, in the publisher's order. One line each: the agent's dot, its partner name, what it is in words
   ("GOOGL call debit vertical"), how long it has been open or was held, its P&L after fees (a dash while unpriced) and a
   bar diverging from zero on one scale for the table, losses left and gains right, the sign always in the text. An
   incubator line carries its "Incubator" tag. The House's calibration round trips fold into one line with a strip of
   ticks and their sum; the House live test gets its own. Hovering a line previews, and tapping opens in place (one at a
   time), its reason: the agent's **thesis** in whole sentences, the **trigger** that opened it (the order's own tag) and,
   once closed, why it closed and who closed it (the agent, the House or expiry), the **level** it was opened on, its
   **life** from opening to expiry, and its P&L against its **risk** (the most it can lose), as a share of that risk. No
   maximum gain is shown: beside the maximum loss it would reveal the strikes' width. A House line's reason is a fixed line
   ("Measures real fills."; "A pre-registered House test."). The thesis is the House's `rationale` when it sends one; an
   older House's page takes the tape's open trade (same agent, root, structure and expiry, within five minutes of the
   opening minute) and the roster's mechanism (or the agent's birth news), filtered by the same sentence rules, and shows
   no thesis rather than a raw one. Open and Closed filter the list. One quiet footer line keeps the sum: other activity,
   any positions not listed, any unreconciled difference, and Profit, a dash while it is unknown. ≡ swaps to the ledger
   table: **its lines sum to the Profit headline exactly, to the cent** (the rows, one "N positions not listed" line, other
   account activity, and any unreconciled difference, shown whenever it is not zero), with shares that add up to 100%;
   with no positions it says "No real positions yet." It is also the chart's table view.
5. **Profit & costs: performance over time.** One dollar axis. Realized is a solid line that steps at each close, exact
   from the ledger since the reset; Profit is a faint line through the archived points where the House could price them,
   broken across every unknown point and every gap over fifteen minutes; Costs is a solid line through the archived bills,
   anchored by a hollow dot at $0 at the reset and joined to nothing it did not record. A faint wash fills the gap between
   Realized and Costs by sign; it is not labelled Net (Net drops open gains and counts other activity). The end labels are
   the legend. Faint bands mark the hours outside 9:30 to 4:00 New York time on weekdays. Each closed position is a dot on
   Realized where it closed (the House's smaller and muted, the incubator's dotted) and each open one a ▸ where it opened;
   the crosshair snaps to every point and marker, ←/→ step through them, a tap pins it, and a marker opens its position.
   The Worker keeps the archive from its own deploy (`/api/capital/score`); with none yet the chart shows the Realized
   steps, the anchor and today's costs as one dot. **Balance** is the recorded account balance since the chart's start
   (the owner's Sept 27 deposit is funding, so the chart starts after it), with its current reading and time below it.
   Balance is not Profit.
6. **The tape.** Newest first, one line each: a mark for its kind (● a thought, ◆ a trade, ✦ a birth read as its idea, ↑
   a move, × a retirement read as its cause, ✓/✗ the auditor's verdict, ⌂ the House's own news), the name, the words and
   the age. Repeats fold into ×N. Tapping a line opens its whole text and a way to its agent. Thoughts, Trades and Life
   filter it; following an agent shows only it (its notes, trades and the swarm's news about it) until its chip is
   cleared. Balance marks never appear here.

**The practice league** is the Practice step's sheet, only while the House publishes it: one quiet table of the families
practising on live quotes in the shadow book under the Gym's fill rules, captioned "Shadow trades on live quotes, never
real money. Not in Profit or Net." Each row is the agent's name (a quiet "retired" tag once it has gone), structure kind,
version tier (validated or Train), sessions, closed trades, wins, realized P&L and return on maximum loss; the totals over
every family, with how many are not listed, sit in a dashed box labelled "practice". It never enters Profit, Net or
Positions.

**The incubator** (from Oct 1, 2026) is real money at tuition size, never evidence. Its positions are in Profit and
Positions under their agent's name with a quiet "Incubator" tag (title: "Incubator: real money at tuition size, never
evidence."), and its open structures carry an "incubator" tag in the agent's card instead of "real money".

No narrative paragraphs, section intros, footer prose or empty-state essays; the one empty state is "No real positions
yet." The only links are the owner's home page and the repository. Every string is a text node; every size is set
through the CSSOM (the policy refuses style attributes); every asset is self-hosted. Reduced motion turns off typing and
all animation. Every touch target on a phone is at least 44px. The chart's two colours and the levels' two ramps are
validated (dataviz `validate_palette.js`) against both themes' surfaces.

## Names and identity

The original twelve partner names return in their original order: Meriwether, Hilibrand, Scholes,
Rosenfeld, Haghani, Mullins, McEntee, Krasker, Hawkins, Hufschmid, Huang and Leahy. A durable site-owned
ordinal supplies the name, then numbered generations such as Meriwether 2. The same name appears on
a dot, its detail, a thought, its tape entries and its rows in the positions ledger (named after the
roster, so a position that outlives its agent's place on the roster keeps a name). Aliases survive
retirement, clipped rosters and restarts. They never change an agent's ID, lineage or evidence.

`agent_names` belongs to the site's existing Durable Object. Publication allocates names in the
same transaction as the event or checkpoint. Public reads and WebSocket delivery add a strict
`display_name` annotation; publisher inputs may not supply it. Original bodies and digests remain
untouched. A record reset also clears names.

## Honest public data

The schema still allowlists every field. No quotes, bids, asks, strikes, greeks, surfaces, programs
or fitted parameters publish. Prose stays quote-free and names no venue. An agent's card uses only the
published thesis or mechanism, structure kind, trade counts, wins, P&L, maximum loss and training counts.
Losses remain signed and visible. A roster subtotal never stands in for total options P&L.

The optional `agent.progress` block has a fixed target, complete ordered checklist and allowlisted
blocker. Each check carries only a public threshold and an integer count (or a binary outcome).
The page requests `?progress=1` on checkpoint reads. Default checkpoint and agent reads omit the
block so older pages can keep their strict schema-2 validation; POSTs still validate and store it.
Validation returns, statistical values, holdout details and fitted parameters remain private.
The schema rejects missing checks, duplicate checks, wrong-band targets and extra fields. Each
dot's accessible name includes its completion count; all progress details are reachable by keyboard.

The optional `positions {as_of, rows, earlier, other, unreconciled_usd}` block is the ledger. Each row is
exactly `{id, source, agent, underlying, structure, right, legs, quantity, open_quantity, status, expiry,
opened_at, closed_at, pnl_usd}`: `id` is `real:<n>`, `source` is agent, calibration or house (only an
agent row names an agent), `right` is call, put or both and must fit the structure, and every dollar
amount is whole cents. The schema checks each row's own consistency (open holds contracts and has no close;
closed holds none and closed after it opened; both times to the minute). `earlier` is `{positions,
pnl_usd}`, the positions not listed. `other` is `{as_of, fees_usd, crypto_usd, interest_usd, misc_usd}`.
The block needs `trading` at the same `as_of`. When Profit is known, every line is known and their exact
sum equals it, or the whole checkpoint is refused; while it is unknown, any line may be null. No field is
a strike, a fill price, a mark, a quote or a leg code; the page derives each share itself. An open row's
P&L is at the House's current value, though, so read with its maximum loss (a structure's `max_loss_usd`,
and the tape's trade) it implies that value per contract: the ledger's public-data rules allow a
position's dollar P&L, and valuing open rows from a quote at least fifteen minutes old instead is the
owner's decision. Public reads add a strict `display_name` to agent rows only. The page asks for
`?progress=1&positions=1`; default and `?progress=1` reads omit the block so already open pages keep
their exact keys. Either repository may deploy first: an older Worker refuses a checkpoint carrying the
block, and the House then sends the same checkpoint without it, with a warning quoting the refusal, and
offers the block again half an hour later. The planned order for this first release is the House, then the
site; until the site is out, the page shows Profit as the House now computes it under the older tooltip.

The `compute` block is the bill since the reset, part by part (`{as_of, sail_usd, claude_usd, openai_usd,
thetadata_usd, market_data_usd, other_usd}`, each money or null). Since Sept 30, 2026 Sail is what Sail billed
(its own balance meter, never the Gym's booked estimate) and Claude is its own part; an older House's five parts
(no `claude_usd`) still validate and read as not itemized. The optional `practice {as_of, sessions, capital_usd,
totals, rows}` block is the practice league: at most 48 rows, agents unique, exactly `{agent, family, structure,
tier, status, sessions, trades, wins, pnl_usd, return_on_risk}`, whole cents, and totals no smaller than the rows'
sums (equal to them when every family is listed). A position's `source` may be `incubator` (it names its agent,
like `agent`), and a real structure may carry `route: "incubator"`. The page asks for
`?progress=1&positions=1&practice=1`, which carries all of these. Every older read gets the shapes it validates:
no practice block, Claude folded back into `other_usd`, an incubator row as an agent's and a structure without
its route, so pages already open keep working and either repository may deploy first.

The `trading` block is optional for schema-2 compatibility. Its signed dollar string can be null
when the complete real book cannot be priced. Profit requires an as-of time within ten minutes of
both the checkpoint and the current browser clock. The account chart retains the published reset
basis, with `PERFORMANCE_START_AT` and `START_EQUITY` as fallbacks; neither defines headline Profit.

The optional `levels {as_of, agents, funnel}` and `rationale {as_of, agents, trades}` blocks (Oct 1, 2026) are the swarm
window. `levels.agents` places roster agents only, each at one of `train, practice, validation, incubator, tuition,
candidate, probe, sized, retired`, consistent with its band (a band above the Gym is its own level; a Gym agent stands
below the holdout; a retired agent is retired unless it still holds open real money, when it stands on that money's step).
`levels.funnel` counts families since the reset at each level by union (a family counts at a level when it reached it or
any higher level on its track): each a counter or null, and each track only narrows. `rationale.agents` is each agent's
thesis, whole sentences with no digit, number word (the pronoun "one" aside), colon, bracket, code mark or parameter name,
at most 280 characters, or null; `rationale.trades` is each ledger row's route (fitting its source), the opening and
closing orders' own tags (at most 80 characters, under the same rules, null on House rows and a close's on an open row),
the exit as an enum (agent, House or expiry) and the maximum loss. Never program code, parameter values, thresholds,
strikes, prices, marks or a maximum gain. Only the page's own read, `?progress=1&positions=1&practice=1&window=1`, carries
the two blocks; every older read is byte for byte what it was. `/api/capital/events?agent=<id>` reads one agent's notes,
trades and the swarm's news about it. `/api/capital/score` is the Worker's archive of `{at, profit_usd, costs_usd,
net_usd}` at five-minute buckets (each null when unknown, Net by the page's own rule), with the newest known Profit and Net;
it starts at the site's deploy and is never backfilled by guesswork. A reset clears it.

Public transport remains one hibernating WebSocket with eight-second polling fallback and
thirty-second checkpoint refresh. Status follows the checkpoint, not an animation or local switch.
The runtime contract is `league/tests/fixtures/site_contract.md`; old and new fixtures are exercised
by `test/league-contract.test.mjs`.
