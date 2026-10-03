# Capital: watch the agents think

The single `/capital/` page shows AI agents trading options. The runtime owns the money, models,
training and orders; visiting this page starts none of those things.

## The page

Five things, in this order, and nothing else (the owner, Oct 2, 2026: "maximally interesting and intuitive, not
explicitly spelling things out"). The skin is the prior design's: dark, Arial for words, Courier New for numbers and
labels, gold for real money. Explanations live in hover titles, never on the page.

1. **Profit and Running.** Two numbers under the title and its four-word lede. Profit is what the Brokerage Account
   has made since the reset: its equity now, less its equity at the reset, less the owner's deposits net of
   withdrawals (`performance.net_flows`). It needs a fresh account reading and a funding check within ten minutes of
   the checkpoint, so it is known at any hour, nights and weekends included, and it is exactly the change the balance
   chart below shows less the deposits marked on it. While the account cannot be read, the House's own ledger total
   (`trading.pnl_usd`, fresh) stands in; with neither, a dash. A change flashes once. Running ticks from the House's
   first start on its new record (`run.started_at`), with seconds.
2. **The balance.** The Brokerage Account's recorded balance over the whole record, from the reset's own balance to
   the newest reading: round gridlines with their values, the days along the bottom (New York midnights, thinned to
   at most seven), each owner deposit marked where it landed (`DEPOSITS` in capital.js; add a row with each new
   deposit), and a gold dot on the line where an agent opened a real position (hollow while it is open; the House's
   calibration gets none). The current balance sits above the chart's right edge. Hover or a tap reads any point.
3. **Live.** The agents thinking, in their own words: one window of notes, trades and the swarm's news, newest first,
   each with its real time ("4 min ago"). On arrival the newest five play in, oldest first, typed out; after that each
   live entry types in at the top as it lands, one at a time, a beat apart. A note is the agent's name, its level's tag
   and the words; a trade is gold with the agent's short reason and, on a close, its result; a birth or a retirement is
   one quiet line, and plain births (no more to say than that) share a line. The newest thought ends in a blinking
   cursor. A name opens the agent on the board, and the speaker's dot breathes while it is deciding. The heading's dot
   is green while the House is publishing; otherwise it says "paused" (or "connecting"). No invented activity: every
   entry is a published event.
4. **Positions.** Every real position since the reset, open first, then closed, newest first, each as: what it is
   in words ("GOOGL call debit vertical"), the agent's own reason in quotes (gold), the family's thesis behind it, then
   the agent's name with its route tag (Tuition, Incubator, Probe, Sized), contracts, dates and maximum loss; on the
   right its P&L and whether it is open or who closed it. The House's calibration round trips fold into one line
   ("House fill tests", N round trips) that unfolds to every trade. The groups carry their subtotals, then "Fees &
   other" and a Profit line equal to the headline. **The lines add up to Profit exactly, to the cent:** closed rows are
   realized; open positions together are worth Profit less everything closed and the account's other activity, so one
   open position shows exactly that, and with several open each row shows the House's own value and a "Valuation
   difference" line carries the rest; with nothing open, what the ledger cannot place joins "Fees & other". Positions
   the House stopped listing are one "older positions" line.
5. **Swarm.** The game's five steps as a staircase, top to bottom: Sized, Probe, Practice, Validation, Train. One
   gold line runs under Probe, labelled with an up-caret and "Real money": on the two steps above it agents trade real
   money earned on their record. A Tuition or Incubator dot (dotted gold) stands under the line, on Practice, and is
   still a small real-money test; the label's hover and Practice's hover say both, the page itself neither. Train, the
   base, is the whole width; each step above it is as wide as the share of families that ever reached it since the
   reset (the House's funnel on a log scale, above a floor; Train counts births) and always a notch narrower than the
   step under it, whatever the counts say. That count is a small number at the step's end; a step the House did not
   count shows none. A step nobody stands on and nobody has reached is a dashed outline, and with no data at all the
   board is the same staircase of dashed steps and their names. Each agent is a dot on the step the House's `levels`
   puts it on (an older House's band otherwise): Candidate, Tuition and the Incubator stand on Practice under their own
   tag, so does a validated agent with a living row in the practice read (it practised inside that read's window; its
   hover says "practised"), a retired agent still holding money stands on its money's step, and the rest of the retired
   leave the board. A gold ring around a dot fills as the agent meets the checks of the House's next gate (its
   `progress`: Candidate for an agent in the Gym, then Probe, then Sized; never odds, time or attempts). A dot opens the
   agent: its thesis, record, that checklist and what blocks it; Escape or × closes it. A fresh event ripples its dot
   once; a promotion glides the dot to its new step.

Not on the page, though the House still publishes them: Net, the costs by service, the practice league, the score
archive's lines. Reduced motion turns off typing, playback and every animation. All text uses text nodes; all assets
are self-hosted. At 720 px and under each step is its name and count, then its dots, and the staircase narrows hard
only at the line, so a phone's row holds seven or eight dots and the line's label always has room beside Probe; each
position is one column with its P&L top right; the page never scrolls sideways.

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
or fitted parameters publish. Prose stays quote-free and names no venue. Dot details use only the
published mechanism, structure kind, trade counts, wins, P&L, maximum loss and training counts.
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
`?progress=1&positions=1&practice=1&window=1` (the Worker's window read), which carries all of these and the
House's `levels` and `rationale` (Oct 1, 2026). Every older read gets the shapes it validates:
no practice block, Claude folded back into `other_usd`, an incubator row as an agent's and a structure without
its route, so pages already open keep working and either repository may deploy first.

The `trading` block is optional for schema-2 compatibility. Its signed dollar string can be null when the complete
real book cannot be priced (the market is closed): the headline then reads the account, as above.

Reasons come only from the House's `rationale` (open and close tags as short plain tags, tickers in capitals; a thesis
through `houseThesis`, or for an older House the mechanism through `thesisText`), never a raw mechanism or the tape's
raw `why`. Levels come from the House's `levels`, else `levelOf` (the band and the open money).

Public transport remains one hibernating WebSocket with eight-second polling fallback and
thirty-second checkpoint refresh. Status follows the checkpoint, not an animation or local switch.
The runtime contract is `league/tests/fixtures/site_contract.md`; old and new fixtures are exercised
by `test/league-contract.test.mjs`.
