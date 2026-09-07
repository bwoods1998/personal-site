// Illustrative prices never enter the trade ledger. The fixed seed keeps history stable.
const DAY = 86400000;
export function buildHistory({ history, points, asOf, price }) {
  const start = Date.UTC(2021, 5, 1), anchor = history.anchor;
  const dates = [];
  for (let time = start; time < anchor.time; time += DAY) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(time);
  }
  let seed = 20210601, sum = 0;
  const weights = dates.map(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const weight = .25 + (seed / 4294967296) * 1.5;
    sum += weight; return weight;
  });
  let progress = 0;
  const generated = dates.map((time, index) => {
    const value = { time, price: Math.exp(Math.log(anchor.price) * progress / (sum || 1)), kind: 'illustrative' };
    progress += weights[index]; return value;
  });
  const values = new Map(generated.map(point => [point.time, point]));
  values.set(anchor.time, { ...anchor, kind: 'reference' });
  for (const point of history.daily) values.set(point.time, { ...point, kind: 'trade' });
  for (const point of points) if (point.id > 0) values.set(point.time, { ...point, kind: 'trade' });
  // Extend the latest price to now without inventing another execution.
  values.set(asOf, { time: asOf, price, kind: 'current' });
  return [...values.values()].filter(point => point.time <= asOf).sort((a, b) => a.time - b.time);
}
export function rangeStart(asOf, range) {
  if (range === 'all') return Date.UTC(2021, 5, 1);
  const date = new Date(asOf), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - (range === '6m' ? 6 : 12));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay)); return date.getTime();
}
export function selectHistory(series, range, asOf) {
  const start = Math.max(series[0]?.time || 0, rangeStart(asOf, range));
  const selected = series.filter(point => point.time >= start && point.time <= asOf);
  const prior = series.findLast(point => point.time <= start);
  if (prior && selected[0]?.time !== start) selected.unshift({ ...prior, time: start });
  return selected;
}
