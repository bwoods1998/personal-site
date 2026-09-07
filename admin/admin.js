const $ = selector => document.querySelector(selector);
let filter = 'pending', before;
async function api(path, body) {
  const response = await fetch(`../api/admin/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (response.status === 401) { $('#login').hidden = false; $('#review').hidden = true; }
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
async function load(append = false) {
  try {
    const data = await api(`orders?status=${filter}${append && before ? `&before=${before}` : ''}`);
    $('#login').hidden = true; $('#review').hidden = false; $('#status').textContent = '';
    $('#filter-label').textContent = `${filter[0].toUpperCase() + filter.slice(1)} notes`;
    if (!append) $('#queue').replaceChildren();
    for (const order of data.orders) {
      const article = document.createElement('article');
      const label = document.createElement('p'); label.textContent = `#${order.id} · ${order.side.toUpperCase()} · ${new Date(order.time).toLocaleString()}`;
      const name = document.createElement('strong'); name.textContent = order.name || 'Guest';
      const note = document.createElement('p'); note.textContent = order.note || '(No note)';
      article.append(label, name, note);
      for (const action of ['approve', 'reject']) {
        if ((action === 'approve' && filter === 'approved') || (action === 'reject' && filter === 'rejected')) continue;
        const button = document.createElement('button'); button.textContent = action === 'approve' ? 'Approve' : filter === 'approved' ? 'Hide' : 'Reject';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await api(`orders/${order.id}/moderate`, { action }); await load(); }
          catch (error) { $('#status').textContent = error.message; button.disabled = false; }
        }); article.append(button);
      }
      $('#queue').append(article);
    }
    if (!$('#queue').children.length) $('#queue').textContent = 'Nothing here.';
    before = data.next; $('#more').hidden = !before;
  } catch (error) { $('#status').textContent = error.message; }
}
$('#login').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('login', { key: $('#key').value }); $('#key').value = ''; await load(); }
  catch (error) { $('#status').textContent = error.message; }
});
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => { filter = button.dataset.filter; load(); });
$('#more').addEventListener('click', () => load(true));
$('#logout').addEventListener('click', async () => {
  try { await api('logout', {}); $('#review').hidden = true; $('#login').hidden = false; $('#queue').replaceChildren(); $('#status').textContent = 'Signed out.'; }
  catch (error) { $('#status').textContent = error.message; }
});
// Fragment never reaches server access logs. Remove it before making any request.
const key = new URLSearchParams(location.hash.slice(1)).get('key');
if (location.hash) history.replaceState(null, '', location.pathname);
if (key) { $('#key').value = key; $('#login').requestSubmit(); } else load();
