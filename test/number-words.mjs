// The fixed lists of sentences the number rules are held to (the safety reviews of Oct 1, 2026), shared by the window tests
// and the House parity test. Each LEAK carries a number the public must never read; each PLAIN sentence must pass whole. The
// lists are fixed, never the filter graded against itself; the House's own case list (league/tests/fixtures/number_words.json)
// is checked too when its checkout is beside this one (test/league-contract.test.mjs). Not a test file itself.

// The House's adversarial lists (league/tests/test_site_window.py), word for word.
export const HOUSE_LEAKS = [
  'IWM breaks to a fresh 60-day low.', 'Sell a twenty five delta put.', 'Exit at one standard deviation.', 'Hold it for one day.', 'Buy one twenty strike calls.',
  'Sell at point one eight.', 'Take half the credit.', 'Hold two sessions then exit.', 'Enter in the first hour.', 'Buy one contract when it breaks.',
  'Wait a dozen sessions.', 'Exit at the third bar.',
  'Buy the call when GOOGL lags MSFT by more than one stdev.', 'Enter when the gap exceeds one ATR over the prior close.', 'Enter at one sd.',
  'Use a lookback of one hr.', 'Exit after one trading session if the gap has not closed.', 'Buy when the move is one full standard deviation below the mean.',
  'Hold for one more week before rolling.', 'Buy GOOGL calls with a strike one notch above spot.', 'Stop out at negative one ATR.', 'One leg is enough.',
  'Exit at the eleventh session.', 'Enter when the lag reaches a twelfth of the range.', 'Hold until the ninetieth minute.', 'Buy when the drop exceeds twelve hundredths.',
  'The move must be threefold the median.', 'Wait for a twentyfive delta call.', 'Enter on a tenpercent move.', 'Exit after a oneday hold.', 'Enter at a single sigma move.',
  'Enter at a sigma move.', 'Exit after an ATR against it.', 'Hold for a fortnight.', 'Enter when the spread is wider than a nickel.', 'Enter when the move tops a dime.',
  'Enter when the move tops a penny.', 'Enter when IV rank is in the top decile.', 'Sell when IV sits in the twenties.', 'Enter when volume doubles.',
  'Exit when ONE SIGMA is breached.', 'Enter when the lag tops one-and-a-half sigma.', 'Stop out at minus one hundred bps.', 'Enter when RSI tops seventy.',
  'Exit in the last quarter of the session.', 'Sell at a quarter of the range.', 'Hold a quarter.',
  'Enter when the gap exceeds \u00bd of the prior move.', 'Sell when IV rank tops \u00be of its range.', 'Use the \u216b month lookback.', 'Wait for a \u3007 reading.',
  'Enter when IV is \u0663 points over realized.', 'Exit at \u2460 sigma.', 'Exit when \uff4f\uff4e\uff45 sigma is breached.', 'Exit when \u03bfne sigma is breached.',
  'Exit when \u043ene sigma is breached.', 'Wait sev\u00aden days.', 'Wait sev\u200den days.', 'Wait o\u0336ne day.', 'Exit after \u{1f51f} sessions.', 'Exit at \u00b2 sigma.',
];
// The post-fix verification's cases (Oct 1, 2026, 09:30Z): apostrophes, accents, plural cardinals, run-together tails,
// multiples, words split by marks, and the words that count ("a couple", "unity", "a score of").
export const S1_LEAKS = [
  "Exit after a 'twenty-day' hold.", "Sell into the fifty's highs.", 'Wait \u2018twenty\u2019 sessions.', 'Enter at FIFTY\u2019S level.', "Wait twenty'five sessions.",
  'Wait tw\u00e9nty sessions.', 'Hold n\u00efne sessions.', 'Buy in fives.', 'Scale out in threes.', 'Exit when the sevens print.', 'Exit near the fiftyish mark.',
  'Hold twentyodd sessions.', 'Enter on a thirtysomething move.', 'Enter on a tenpct move.', 'Stop out at fivebps.', 'The move must quintuple.',
  'Enter when delta nears unity.', 'Hold a couple of sessions.', 'Wait a score of days.', 'Wait scores of sessions.', 'Hold for twen\u00b7ty sessions.',
  'Sell the fif-ty\u2019s high.', 'Buy in ones and twos.', 'Enter at a halfsigma move.', 'Exit after one business day.', 'Hold the one whole session.',
];
export const LEAKS = [...HOUSE_LEAKS, ...S1_LEAKS];
// Plain words, the pronoun "one" and the calendar's quarter, which must pass whole. "pair" is never a number (a pairs trade).
export const PLAIN = [
  'Investors reprice one on the other. The rest follows.', 'No one knows the open.', 'The legs move one against the other.', 'Each one decays.',
  'One of the names leads.', 'They reprice one after another.', 'Buyers favour one or the other.', 'One\u2019s edge is patience.', "One's edge is patience.",
  'A single stock leads.', 'Uses a single-name option on the laggard.', 'The edge is one-sided.', 'Investors reprice one on the other\u2019s news.',
  'The tape drifts \u2014 then the gap closes.', 'The flow is predictable within the final sessions of each quarter.', 'Funds dress their books at quarter-end.',
  "Funds dress their books at the quarter's end.", 'Trades the MSFT and GOOGL pair.', 'The z-score tops its band.', 'The cheap ones decay fastest.',
  'The caf\u00e9 crowd trades late.', 'Prices move one from the other.', "No one's sure.",
  "MSFT and GOOGL sell competing products, and investors reprice one on the other's capex with a delay.",
];

// Sentences built at random from words the rules turn on (numbers, units, pronoun contexts, apostrophes, accents, typographic
// quotes, marks inside words, capitals, run-together forms) and plain words, from a fixed seed: the parity test runs both
// sides on them.
const BANK = ['one', 'One', 'ONE', "one's", 'one\u2019s', 'ones', 'two', 'twenty', 'twenty-five', 'twentyfive', "'twenty", "twenty's", 'tw\u00e9nty', 'fifty\u2019s',
  'fives', 'sevens', 'zeroes', 'fiftyish', 'tenodd', 'thirtysomething', 'tenpct', 'fivebps', 'threefold', 'oneday', 'quintuple', 'trebled', 'unity',
  'couple', 'couples', 'coupled', 'pair', 'pairs', 'score', 'scores', 'z-score', 'half', 'halfsigma', 'quarter', 'quarters', 'quarter-end', "quarter's",
  'twelfths', 'first', 'second', 'seconds', 'dozen', 'fortnight', 'decile', 'single', 'a', 'an', 'the', 'no', 'each', 'of', 'on', 'or', 'from', 'and',
  'than', 'after', 'other', "other's", 'others', 'another', 'its', 'sided', 'day', 'days', 'session', 'sessions', 'sigma', 'stdev', 'sd', 'ATR', 'standard',
  'deviation', 'trading', 'business', 'whole', 'full', 'more', 'extra', 'week', 'calendar', 'every', 'new', 'end', 'close', 'MSFT', 'GOOGL', 'QQQ', 'gap',
  'tape', 'lags', 'leads', 'reprice', 'drift', 'caf\u00e9', 'na\u00efve', 'z', 'point', 'percent', 'bps', 'pct', 'x', 'times', 'twice', 'nine', 'n\u00efne',
  'ten', 'tenth', 'tenths', 'often', 'tent', "o'clock", "don't", "won't", 'twen\u00b7ty', 't.e.n', 'fif-ty', "'", '\u2018', '-', '.'];
export function randomSentences(count, seed = 20261001) {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const pick = list => list[Math.floor(next() * list.length)];
  return Array.from({ length: count }, () => {
    const words = Array.from({ length: 2 + Math.floor(next() * 9) }, () => pick(BANK));
    const joined = words.reduce((text, word) => (text ? `${text}${next() < 0.15 ? '' : next() < 0.1 ? '-' : ' '}${word}` : word), '');
    return `${joined}${pick(['.', '!', '?', ',', ''])}${next() < 0.3 ? ` ${pick(BANK)} ${pick(BANK)}.` : ''}`;
  });
}
