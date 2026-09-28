# Capital: watch the agents think

The single `/capital/` page shows AI agents trading options. The runtime owns the money, models,
training and orders; visiting this page starts none of those things.

## The page

1. **Profit and Running.** Exactly two headline numbers. Profit is the Brokerage Account's complete real
   options P&L since the reset, supplied in `trading {as_of, pnl_usd}`: every real options position after
   its fees (the agents' and the House's own calibration round trips), open ones at the House's current
   value, plus the account's other activity (fees no position carries, crypto fees, interest). Deposits,
   compute and simulated returns do not enter it, nor does the leftover crypto dust of the coins sold at
   the reset (worth cents; its value at the reset was never recorded). A missing, null or stale total is
   a dash. Running ticks from the House's first start on its new record.
2. **Thoughts first.** A generous, legible space for an actual published note, the agent's name, a
   subtle band and when it was written. New notes wait long enough for the current one to be read.
   Long thoughts expand and remain until the reader closes them. The feed below carries actual
   thinking, trades and news, newest first; repeats fold into one line. No invented activity.
3. **The balance chart.** The recorded account balance since the reset (or since the chart's own later
   start: the owner's Sept 27 deposit is funding, so the chart starts after it), without a heading, axes or
   reconciliation paragraphs. Only the current balance and its timestamp sit below it. Hover can
   inspect a recorded point. This balance is distinct from the Profit headline.
4. **Positions.** Directly below the chart, one quiet table of every real position on the Brokerage
   Account since the reset: open first, then closed, newest first. Each row says who traded it (the
   agent's partner name, or House calibration), what it is in words ("SPY call debit vertical", "QQQ long
   put"), the contracts, the expiry, when it opened and closed (to the minute), its P&L after fees
   (realized, or at the current value while open) and its share of Profit. The footer carries the
   positions not listed, "Other account activity" and the Profit total. **The lines sum to the Profit
   headline exactly, to the cent**: the rows, one "N positions not listed" line (the oldest closed past
   300, and any position the table's fields cannot describe, open or closed: the House alerts on those),
   other account activity, and any unreconciled difference, which is shown as its own line whenever it
   is not zero and never hidden. A
   stale or unknown Profit leaves the total and every share a dash, as in the headline. Shares add up to
   100%; a negative share moved against the total; a zero Profit has no shares. With no positions the
   table says "No real positions yet." and still shows the footer. On a phone each row stacks into a short
   block (who and P&L, what and share, then contracts and dates); on a narrow desktop the table scrolls
   inside its own box. The page never scrolls sideways. Nothing in it moves.
5. **Agents.** Three horizontal stages of dots: 3 Increased capital (Sized), 2 Live trading (Probe),
   1 Practice (Candidate and Gym). Candidates are filled dots; Gym agents are rings. The published
   band determines a dot's stage. A quiet gold ring fills from the House's current promotion
   prerequisites, including partial trade/day counts; it is a checklist, never odds or a deadline.
   No progress is inferred from training attempts, age or aggregate profit. Missing or stale
   evidence leaves a bare track. Each dot is
   a native button. Click, tap or press Enter for name, strategy, concise performance and open
   positions, plus the exact remaining checks and the current blocker. The top stage shows what
   keeps its capital rather than inventing another level. Close or Escape returns focus to its dot.
   Retired agents remain in a collapsed row. Dots stay in a stable order within each band. A fresh
   note, trade or agent news produces one short ripple, only on screen and at most four at once;
   historical playback creates none. A confirmed change of stage can glide to its new row.
   A dot's detail lists its open structures, real and shadow; the Positions table holds real money only.

No extra narrative paragraphs, footer or explanatory dashboard panels. The only links are the
owner's home page and the repository. On a phone the stages stack; dots have 44px touch targets.
Reduced motion turns off typing and animation. All text uses text nodes; all assets are self-hosted.

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

The `trading` block is optional for schema-2 compatibility. Its signed dollar string can be null
when the complete real book cannot be priced. Profit requires an as-of time within ten minutes of
both the checkpoint and the current browser clock. The account chart retains the published reset
basis, with `PERFORMANCE_START_AT` and `START_EQUITY` as fallbacks; neither defines headline Profit.

Public transport remains one hibernating WebSocket with eight-second polling fallback and
thirty-second checkpoint refresh. Status follows the checkpoint, not an animation or local switch.
The runtime contract is `league/tests/fixtures/site_contract.md`; old and new fixtures are exercised
by `test/league-contract.test.mjs`.
