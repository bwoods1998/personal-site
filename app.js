document.querySelector('#year').textContent = new Date().getFullYear();
const $ = selector => document.querySelector(selector);
const ticket = $('#ticket');
let side = 'buy', requestId, submittedPayload, busy = false;
async function api(path, body) {
  const response = await fetch(`./api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Exchange unavailable. Try again.'); error.status = response.status; throw error; }
  return result;
}
function render(data) {
  $('#price').textContent = data.price.toFixed(2);
  $('#change').textContent = `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)} since open`;
  $('#market-count').textContent = `${data.total} ${data.total === 1 ? 'order' : 'orders'}`;
  const prices = data.points.map(p => p.price);
  const low = Math.min(...prices) - 2, high = Math.max(...prices) + 2;
  const points = prices.length === 1 ? [prices[0], prices[0]] : prices;
  $('#chart-line').setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${i / (points.length - 1) * 320} ${85 - (p - low) / (high - low) * 76}`).join(' '));
  $('#chart').setAttribute('aria-label', `Fictional BW index: ${data.price.toFixed(2)}, ${data.total} orders. Chart of the most recent 120 orders.`);
  $('#orders').replaceChildren();
  for (const order of data.orders) {
    const li = document.createElement('li');
    const header = document.createElement('div'); header.className = 'order-line';
    const action = document.createElement('span'); action.className = order.side; action.textContent = order.side.toUpperCase();
    const name = document.createElement('span'); name.textContent = order.name;
    const price = document.createElement('span'); price.textContent = order.price.toFixed(2);
    header.append(action, name, price); li.append(header);
    if (order.note) { const note = document.createElement('p'); note.textContent = order.note; li.append(note); }
    $('#orders').append(li);
  }
  if (!data.orders.length) { const li = document.createElement('li'); li.textContent = 'No orders yet. You can be first.'; $('#orders').append(li); }
}
async function refresh(fresh = false) {
  $('#refresh').disabled = true;
  try { render(await api(fresh ? 'exchange?fresh=1' : 'exchange')); $('#market-status').textContent = ''; }
  catch { $('#market-status').textContent = 'Exchange offline. Try refresh.'; }
  finally { $('#refresh').disabled = false; }
}
for (const button of document.querySelectorAll('[data-side]')) button.addEventListener('click', async () => {
  side = button.dataset.side;
  requestId = crypto.randomUUID(); submittedPayload = null;
  $('#order-form').reset();
  $('#ticket-title').textContent = `${side === 'buy' ? 'Buy' : 'Sell'} BW`;
  $('#submit-order').textContent = `Place ${side} order ${side === 'buy' ? '↗' : '↘'}`;
  $('#submit-order').disabled = true;
  $('#ticket-status').textContent = 'Opening ticket…'; ticket.showModal();
  try {
    const { nextOrderAt } = await api('visitor', {});
    $('#ticket-status').textContent = nextOrderAt > Date.now() ? 'One order per minute. Give the market a moment.' : '';
    $('#submit-order').disabled = false;
  } catch { $('#ticket-status').textContent = 'Unable to open ticket. Close and try again.'; }
});
$('#close-ticket').addEventListener('click', () => { if (!busy) ticket.close(); });
ticket.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#order-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('#submit-order').disabled = true; $('#close-ticket').disabled = true;
  // Preserve the exact payload and reference after uncertain network failures.
  submittedPayload ||= { side, requestId, name: $('#order-name').value, note: $('#order-note').value, website: event.target.elements.website.value };
  $('#ticket-status').textContent = 'Placing order…';
  try {
    const result = await api('orders', submittedPayload);
    ticket.close(); await refresh(true);
    $('#market-status').textContent = `${side === 'buy' ? 'Buy' : 'Sell'} filled at ${result.price.toFixed(2)}.${result.review === 'pending' ? ' Your name and note await approval.' : ''}`;
  } catch (error) {
    $('#ticket-status').textContent = error.message || 'Connection interrupted. Retry this order.';
    if (error.status && error.status < 500) { submittedPayload = null; requestId = crypto.randomUUID(); }
  } finally { busy = false; $('#submit-order').disabled = false; $('#close-ticket').disabled = false; }
});
$('#refresh').addEventListener('click', () => refresh());
refresh();
