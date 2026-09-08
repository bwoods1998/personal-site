import { createHash } from 'node:crypto';

// Original jokes, not quotations or endorsements. The simulation rules disclose these fictional cameos.
export const cameos = [
  ['Warren Buffett', ['The moat is a laptop with excellent battery anxiety.', 'Bought one share. Holding until the charger becomes an antique.']],
  ['Charlie Munger', ['Avoiding stupidity was going well until I found this exchange.', 'A one-dollar position. Finally, appropriate diversification.']],
  ['John Bogle', ['The entire index appears to be one guy in Oceanside.', 'Expense ratio: zero. Laptop fan ratio: concerning.']],
  ['Peter Lynch', ['Invest in what you know. I know this laptop is trying its best.', 'Found this ten-bagger between the terminal and the beach.']],
  ['Benjamin Graham', ['The margin of safety is a backup charger.', 'Book value includes one heavily depreciated MacBook.']],
  ['Adam Smith', ['The invisible hand keeps pressing buy.', 'The division of labor: Blake, agents, and one exhausted fan.']],
  ['John Maynard Keynes', ['Animal spirits have obtained a shell account.', 'In the long run, we are all waiting for the build.']],
  ['Milton Friedman', ['There is no free lunch. Apparently there is free hosting.', 'The money supply has increased by one fictional dollar.']],
  ['Elinor Ostrom', ['A commons with memo moderation. Promising governance.', 'Eight billion people, one laptop. Please share the CPU.']],
  ['Joseph Schumpeter', ['Creative destruction, except we kept the old computer.', 'The next wave of innovation runs suspiciously warm.']],
  ['Alan Turing', ['The machine passed my test. It asked for more RAM.', 'Can machines think? This one is thinking about a cooling pad.']],
  ['Grace Hopper', ['Found a bug. It was the bearish thesis.', 'The most dangerous phrase: we need a new laptop.']],
  ['Ada Lovelace', ['An analytical engine with a suspiciously good stylesheet.', 'The first algorithm was not a trading strategy. This barely is.']],
  ['Steve Wozniak', ['Perfectly good hardware. Finally, someone noticed.', 'A second life for a computer is my kind of capital allocation.']],
  ['Steve Jobs', ['One more thing: it runs Linux now.', 'A thousand side projects in your terminal.']],
  ['Jensen Huang', ['No GPUs were harmed in the making of this purchase.', 'The leather jacket budget exceeds the compute budget.']],
  ['Bill Gates', ['The spreadsheet says buy. It may be a very small spreadsheet.', 'I have reviewed the fundamentals: there is a computer.']],
  ['Ray Dalio', ['Principle 148: diversify your charging cables.', 'An all-weather portfolio, provided the laptop stays indoors.']],
  ['Jim Simons', ['The signal is weak. The ASCII is strong.', 'Our model found a statistically significant lack of sellers moving the price.']],
  ['George Soros', ['Reflexivity: I bought, the chart rose, I felt clever.', 'Testing the hypothesis that one dollar changes everything.']],
];

export function dailyCameo(day) {
  const hash = createHash('sha256').update(`woods-cameo-v1:${day}`).digest();
  const [name, notes] = cameos[hash.readUInt32BE(0) % cameos.length];
  return { name, quantity: 1 + hash.readUInt32BE(8) % 10, note: notes[hash.readUInt32BE(4) % notes.length] };
}
