import { buildHistory, selectHistory } from './chart.js';
document.querySelector('#year').textContent = new Date().getFullYear();
const $ = selector => document.querySelector(selector);
const ticket = $('#ticket');
let side = 'buy', requestId, submittedPayload, busy = false, opening = 0, lastSnapshot;
let cooldownUntil = 0, cooldownTimer;
let period = 'all', chartPoints = [], chartIndex = 0, chartGeometry;
const priceText = value => value == null ? '—' : new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(value);
const signed = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const utc = value => new Date(value).toISOString().slice(11, 19);
const stamp = value => `${new Date(value).toISOString().slice(0, 10)} ${utc(value)} UTC`;
async function api(path, body) {
  const response = await fetch(`./api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Exchange unavailable. Try again.'); error.status = response.status; error.retryAt = result.retryAt; throw error; }
  return result;
}
function render(data) {
  lastSnapshot = data;
  $('#price').textContent = priceText(data.price);
  $('#quote-label').textContent = data.total ? 'Last / USD' : 'Reference / USD';
  $('#change').textContent = `${data.session.change >= 0 ? '+' : '−'}${priceText(Math.abs(data.session.change))} (${signed(data.session.changePercent)}%) / 24h`;
  $('#change').dataset.direction = data.session.change < 0 ? 'down' : 'up';
  $('#market-count').textContent = `${data.total.toLocaleString()} ${data.total === 1 ? 'trade' : 'trades'}`;
  $('#as-of').textContent = `As of ${utc(data.asOf)} UTC`;
  $('#as-of').title = stamp(data.asOf);
  renderChart();
  $('#memos').replaceChildren();
  for (const memo of data.memos) {
    const li = document.createElement('li');
    const line = document.createElement('div'); line.className = 'memo-byline';
    const name = document.createElement('strong'); name.textContent = memo.name;
    const action = document.createElement('span'); action.className = memo.side; action.textContent = `${memo.side.toUpperCase()} ×${memo.quantity || 1} · ${priceText(memo.price)}`;
    const note = document.createElement('p'); note.textContent = memo.note;
    const time = document.createElement('time'); time.dateTime = new Date(memo.time).toISOString(); time.textContent = stamp(memo.time);
    line.append(name, action); li.append(line, note, time); $('#memos').append(li);
  }
  if (!data.memos.length) { const li = document.createElement('li'); li.textContent = 'Memos appear after approval.'; $('#memos').append(li); }
}
const dateLabel = time => new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
function renderChart() {
  if (!lastSnapshot) return;
  chartPoints = selectHistory(buildHistory(lastSnapshot), period, lastSnapshot.asOf);
  if (!chartPoints.length) return;
  const prices = chartPoints.map(point => point.price);
  const min = Math.min(...prices), max = Math.max(...prices), padding = Math.max((max - min) * .08, .5);
  const low = Math.max(0, min - padding), high = max + padding;
  const first = chartPoints[0].time, span = Math.max(1, chartPoints.at(-1).time - first);
  chartGeometry = { x: time => 36 + (time - first) / span * 314, y: price => 140 - (price - low) / (high - low) * 124 };
  const path = chartPoints.map((point, i) => `${i ? 'L' : 'M'}${chartGeometry.x(point.time).toFixed(2)} ${chartGeometry.y(point.price).toFixed(2)}`).join(' ');
  $('#chart-line').setAttribute('d', path);
  $('#chart-fill').setAttribute('d', `${path} L350 140 L36 140 Z`);
  $('#chart-high').textContent = high.toFixed(0); $('#chart-low').textContent = low.toFixed(0);
  $('#chart-start').textContent = dateLabel(first); $('#chart-end').textContent = dateLabel(lastSnapshot.asOf);
  $('#chart').setAttribute('aria-valuemax', String(chartPoints.length - 1));
  chartIndex = chartPoints.length - 1;
  inspectPoint(chartIndex, false);
  for (const button of document.querySelectorAll('[data-range]')) button.setAttribute('aria-pressed', String(button.dataset.range === period));
}
function inspectPoint(index, visible = true) {
  if (!chartPoints.length) return;
  chartIndex = Math.max(0, Math.min(chartPoints.length - 1, index));
  const point = chartPoints[chartIndex], x = chartGeometry.x(point.time), y = chartGeometry.y(point.price);
  const description = `${new Date(point.time).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'})} · ${priceText(point.price)}`;
  $('#chart').setAttribute('aria-valuenow', String(chartIndex)); $('#chart').setAttribute('aria-valuetext', description);
  $('#chart-inspect').textContent = visible ? description : '';
  $('#chart-crosshair').setAttribute('d', `M${x} 16V140`);
  $('#chart-dot').setAttribute('cx', x); $('#chart-dot').setAttribute('cy', y);
  for (const element of [$('#chart-crosshair'), $('#chart-dot')]) {
    if (visible) element.removeAttribute('hidden'); else element.setAttribute('hidden', '');
  }
}
for (const button of document.querySelectorAll('[data-range]')) button.addEventListener('click', () => { period = button.dataset.range; renderChart(); });
$('#chart').addEventListener('pointermove', event => {
  if (!chartPoints.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const position = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 360 - 36) / 314));
  const time = chartPoints[0].time + position * (chartPoints.at(-1).time - chartPoints[0].time);
  let nearest = 0;
  for (let i = 1; i < chartPoints.length; i++) if (Math.abs(chartPoints[i].time - time) < Math.abs(chartPoints[nearest].time - time)) nearest = i;
  inspectPoint(nearest);
});
$('#chart').addEventListener('pointerleave', () => { if (document.activeElement !== $('#chart')) inspectPoint(chartIndex, false); });
$('#chart').addEventListener('focus', () => inspectPoint(chartIndex));
$('#chart').addEventListener('blur', () => inspectPoint(chartIndex, false));
$('#chart').addEventListener('keydown', event => {
  const offsets = {ArrowLeft:-1, ArrowDown:-1, ArrowRight:1, ArrowUp:1, PageDown:-20, PageUp:20};
  if (event.key in offsets) inspectPoint(chartIndex + offsets[event.key]);
  else if (event.key === 'Home') inspectPoint(0);
  else if (event.key === 'End') inspectPoint(chartPoints.length - 1);
  else return;
  event.preventDefault();
});
async function refresh(fresh = false) {
  $('#refresh').disabled = true;
  try { render(await api(fresh ? 'exchange?fresh=1' : 'exchange')); $('#market-status').textContent = ''; }
  catch { $('#market-status').textContent = 'Quote unavailable. Try refresh.'; }
  finally { $('#refresh').disabled = false; }
}
function setInputs(disabled) { for (const field of [$('#order-name'), $('#order-note')]) field.disabled = disabled; }
function updateSubmit() {
  clearTimeout(cooldownTimer);
  const seconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
  $('#submit-order').disabled = busy || seconds > 0;
  $('#submit-order').textContent = seconds > 0 ? `Next trade in ${seconds}s` : submittedPayload ? 'Retry this order' : `Submit ${side} order ${side === 'buy' ? '↗' : '↘'}`;
  if (seconds > 0 && ticket.open) cooldownTimer = setTimeout(updateSubmit, Math.min(seconds * 1000, 1000));
}
for (const button of document.querySelectorAll('[data-side]')) button.addEventListener('click', async () => {
  const attempt = ++opening;
  side = button.dataset.side;
  requestId = crypto.randomUUID(); submittedPayload = null; cooldownUntil = 0;
  $('#order-form').reset(); setInputs(false);
  $('#ticket-title').textContent = `${side === 'buy' ? 'Buy' : 'Sell'} Blake Woods Stock`;
  $('#submit-order').disabled = true; $('#submit-order').textContent = 'Loading quote…';
  $('#ticket-last').textContent = $('#ticket-estimate').textContent = '—';
  $('#ticket-status').textContent = ''; ticket.showModal();
  try {
    const [visitor, quote] = await Promise.all([api('visitor', {}), api('exchange?fresh=1')]);
    if (attempt !== opening || !ticket.open) return;
    render(quote); cooldownUntil = visitor.nextOrderAt;
    $('#ticket-last').textContent = priceText(quote.price);
    $('#ticket-estimate').textContent = priceText(Math.max(1, quote.price + (side === 'buy' ? 1 : 0)));
    updateSubmit();
  } catch { if (attempt === opening) $('#ticket-status').textContent = 'Unable to open ticket. Close and try again.'; }
});
$('#close-ticket').addEventListener('click', () => { if (!busy) ticket.close(); });
ticket.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
ticket.addEventListener('close', () => { ++opening; clearTimeout(cooldownTimer); });
$('#order-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || Date.now() < cooldownUntil) return;
  busy = true; $('#submit-order').disabled = true; $('#close-ticket').disabled = true;
  submittedPayload ||= { side, requestId, name: $('#order-name').value, note: $('#order-note').value, website: event.target.elements.website.value };
  setInputs(true); $('#ticket-status').textContent = 'Submitting…';
  try {
    const result = await api('orders', submittedPayload);
    ticket.close(); await refresh(true);
    $('#market-status').textContent = `$WOODS ${side.toUpperCase()} #${String(result.id).padStart(4, '0')} · ${priceText(result.price)}.${result.review === 'pending' ? ' Name/memo pending approval.' : ''}`;
  } catch (error) {
    $('#ticket-status').textContent = error.status ? error.message : 'Connection interrupted. Retry to check this order.';
    if (error.status && error.status < 500) { submittedPayload = null; requestId = crypto.randomUUID(); setInputs(false); }
    if (error.retryAt) cooldownUntil = error.retryAt;
  } finally { busy = false; $('#close-ticket').disabled = false; updateSubmit(); }
});
$('#refresh').addEventListener('click', () => refresh(true));
refresh();
