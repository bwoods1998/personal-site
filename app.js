document.querySelector('#year').textContent = new Date().getFullYear();
const $ = selector => document.querySelector(selector);
const ticket = $('#ticket');
let side = 'buy', requestId, submittedPayload, busy = false, opening = 0, lastSnapshot;
let cooldownUntil = 0, cooldownTimer;
const priceText = value => value == null ? '—' : value.toFixed(2);
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
  $('#quote-label').textContent = data.total ? 'Last / points' : 'Reference / points';
  $('#change').textContent = `${signed(data.session.change)} (${signed(data.session.changePercent)}%) / 24h`;
  $('#change').dataset.direction = data.session.change < 0 ? 'down' : 'up';
  $('#day-high').textContent = priceText(data.session.high);
  $('#day-low').textContent = priceText(data.session.low);
  $('#day-trades').textContent = data.session.trades.toLocaleString();
  $('#market-count').textContent = `${data.total.toLocaleString()} ${data.total === 1 ? 'trade' : 'trades'} · all time`;
  $('#as-of').textContent = `As of ${utc(data.asOf)} UTC`;
  $('#as-of').title = stamp(data.asOf);
  const prices = data.points.map(p => p.price);
  const low = Math.min(...prices) - 2, high = Math.max(...prices) + 2;
  const points = prices.length === 1 ? [prices[0], prices[0]] : prices;
  $('#chart-line').setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${i / (points.length - 1) * 320} ${85 - (p - low) / (high - low) * 76}`).join(' '));
  $('#chart').setAttribute('aria-label', `Woods Company simulation: ${priceText(data.price)} points, ${data.total} trades. Most recent 120 trades, equally spaced by trade order.`);
  $('#orders').replaceChildren();
  for (const order of data.orders) {
    const row = document.createElement('tr');
    const time = document.createElement('td'); time.textContent = utc(order.time); time.title = stamp(order.time);
    const action = document.createElement('td'); action.className = order.side; action.textContent = order.side.toUpperCase();
    const price = document.createElement('td'); price.textContent = priceText(order.price);
    row.title = `#${order.id} · ${order.name} · ${stamp(order.time)}`;
    row.append(time, action, price); $('#orders').append(row);
    const attribution = document.createElement('tr'); attribution.className = 'trade-attribution';
    const cell = document.createElement('td'); cell.colSpan = 3; cell.textContent = order.name;
    attribution.append(cell); $('#orders').append(attribution);
  }
  if (!data.orders.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 3; cell.textContent = 'No trades yet.'; row.append(cell); $('#orders').append(row); }
  $('#memos').replaceChildren();
  for (const memo of data.memos) {
    const li = document.createElement('li');
    const line = document.createElement('div'); line.className = 'memo-byline';
    const name = document.createElement('strong'); name.textContent = memo.name;
    const action = document.createElement('span'); action.className = memo.side; action.textContent = `${memo.side.toUpperCase()} · ${priceText(memo.price)}`;
    const note = document.createElement('p'); note.textContent = memo.note;
    const time = document.createElement('time'); time.dateTime = new Date(memo.time).toISOString(); time.textContent = stamp(memo.time);
    line.append(name, action); li.append(line, note, time); $('#memos').append(li);
  }
  if (!data.memos.length) { const li = document.createElement('li'); li.textContent = 'Memos appear after approval.'; $('#memos').append(li); }
}
const tabs = [...document.querySelectorAll('[data-view]')];
function selectView(tab, focus = false) {
  for (const item of tabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
    $(`#${item.dataset.view}-panel`).hidden = !active;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectView(tab));
  tab.addEventListener('keydown', event => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else if (/^[123]$/.test(event.key)) index = Number(event.key) - 1;
    else return;
    event.preventDefault(); selectView(tabs[index], true);
  });
}
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
  $('#ticket-title').textContent = `${side === 'buy' ? 'Buy' : 'Sell'} The Woods Company`;
  $('#submit-order').disabled = true; $('#submit-order').textContent = 'Loading quote…';
  $('#ticket-last').textContent = $('#ticket-estimate').textContent = '—';
  $('#ticket-status').textContent = ''; ticket.showModal();
  try {
    const [visitor, quote] = await Promise.all([api('visitor', {}), api('exchange?fresh=1')]);
    if (attempt !== opening || !ticket.open) return;
    render(quote); cooldownUntil = visitor.nextOrderAt;
    $('#ticket-last').textContent = priceText(quote.price);
    $('#ticket-estimate').textContent = priceText(Math.max(1, quote.price + (side === 'buy' ? 1 : -1)));
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
    $('#market-status').textContent = `WOODS ${side.toUpperCase()} #${String(result.id).padStart(4, '0')} · ${priceText(result.price)} pts.${result.review === 'pending' ? ' Name/memo pending approval.' : ''}`;
  } catch (error) {
    $('#ticket-status').textContent = error.status ? error.message : 'Connection interrupted. Retry to check this order.';
    if (error.status && error.status < 500) { submittedPayload = null; requestId = crypto.randomUUID(); setInputs(false); }
    if (error.retryAt) cooldownUntil = error.retryAt;
  } finally { busy = false; $('#close-ticket').disabled = false; updateSubmit(); }
});
$('#refresh').addEventListener('click', () => refresh(true));
// The chart is a sequence of trades, not evenly spaced clock time.
$('#chart').addEventListener('pointermove', event => {
  if (!lastSnapshot?.points.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const index = Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (lastSnapshot.points.length - 1));
  const point = lastSnapshot.points[index];
  $('.chart-caption').textContent = `${point.id ? `#${point.id}` : 'Launch'} · ${priceText(point.price)} · ${stamp(point.time)}`;
});
$('#chart').addEventListener('pointerleave', () => { $('.chart-caption').textContent = 'Last 120 trades · in trade order'; });
refresh();
