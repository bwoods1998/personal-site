import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../lib/database.mjs';
import { createExchange } from '../lib/exchange.mjs';
import { createApi } from '../lib/api.mjs';
import { dailyCameo } from '../lib/cameos.mjs';

test('moderation, idempotency, concurrency, limits and session expiry', async () => {
  const db = await openDatabase({ filename: ':memory:' });
  let now = 1800000000000;
  const market = await createExchange(db, { now: () => now });
  try {
    assert.equal((await market.snapshot()).total, 0);
    const order = { side:'buy', requestId:randomUUID(), name:'<img onerror=alert(1)>', note:'Private pending note' };
    const receipts = await Promise.all(Array.from({length:8}, () => market.submit(order,'visitor','network')));
    assert.equal(new Set(receipts.map(r => r.id)).size,1);
    let snapshot = await market.snapshot();
    assert.equal(snapshot.total,1); assert.equal(snapshot.price,101);
    assert.equal(snapshot.orders[0].cameo,false); assert.equal(snapshot.orders[0].name,'Guest'); assert.equal(snapshot.orders[0].note,'');
    assert.ok(!JSON.stringify(snapshot).includes('Private pending'));
    await assert.rejects(market.submit({...order,note:'changed'},'visitor','network'),{status:409});
    await assert.rejects(market.submit({...order,requestId:randomUUID()},'visitor','network'),{status:429});
    const pending = await market.reviewQueue(); assert.equal(pending.orders[0].note,order.note);
    await market.moderate(receipts[0].id,'approve');
    assert.equal((await market.snapshot()).orders[0].note,order.note);
    await market.moderate(receipts[0].id,'reject');
    assert.equal((await market.snapshot()).orders[0].note,'');
    await Promise.all(Array.from({length:15},(_,i)=>market.submit({side:i%2?'buy':'sell',requestId:randomUUID()},`v${i}`,`n${i}`)));
    snapshot=await market.snapshot(); assert.equal(snapshot.total,16); assert.equal(snapshot.price,108);
    for(let i=0;i<4;i++){now+=60001;await market.submit({side:'buy',requestId:randomUUID()},'visitor','network');}
    now+=60001;
    await assert.rejects(market.submit({side:'buy',requestId:randomUUID()},'visitor','network'),{status:429});
    const token=await market.createAdminSession(); assert.equal(await market.authenticated(token),true);
    now+=9*3600000; assert.equal(await market.authenticated(token),false);
    const token2=await market.createAdminSession();await market.logout(token2);assert.equal(await market.authenticated(token2),false);
  } finally {await db.close();}
});

test('API rejects unauthenticated moderation, cross-origin writes, huge bodies and forged cookies', async () => {
  const db=await openDatabase({filename:':memory:'});
  const market=await createExchange(db);
  const api=createApi(market,{sessionSecret:'s'.repeat(43),adminKey:'a'.repeat(43)});
  const call=(path,body,extra={})=>api(new Request('https://example.com/api/'+path,{method:body?'POST':'GET',headers:{origin:'https://example.com','content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})}),'127.0.0.1');
  try {
    assert.equal((await call('admin/orders')).status,401);
    assert.equal((await call('visitor',{}, {origin:'https://evil.com'})).status,403);
    assert.equal((await call('admin/login',{key:'x'.repeat(5000)})).status,413);
    assert.equal((await call('admin/login',{key:'wrong'})).status,401);
    assert.equal((await call('orders',{side:'buy',requestId:randomUUID()},{cookie:'bw_visitor=forged.fake'})).status,401);
    const visitor=await call('visitor',{}); const vc=visitor.headers.get('set-cookie').split(';')[0];
    assert.match(visitor.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    assert.match(visitor.headers.get('set-cookie'),/Secure/);
    const placed=await call('orders',{side:'buy',requestId:randomUUID(),name:'Hidden name',note:'Hidden note'},{cookie:vc});assert.equal(placed.status,201);
    const receipt=await placed.json();
    assert.ok(!(await (await call('exchange')).text()).includes('Hidden'));
    const login=await call('admin/login',{key:'a'.repeat(43)});const ac=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await call(`admin/orders/${receipt.id}/moderate`,{action:'approve'},{cookie:ac})).status,200);
    assert.ok((await(await call('exchange')).text()).includes('Hidden note'));
    await call('admin/logout',{}, {cookie:ac});assert.equal((await call('admin/orders',null,{cookie:ac})).status,401);
  }finally{await db.close();}
});

test('network quota survives visitor resets and rejected requests roll back', async () => {
  const db = await openDatabase({filename:':memory:'});
  const market = await createExchange(db);
  try {
    for(let i=0;i<30;i++)await market.submit({side:'sell',requestId:randomUUID()},`new-cookie-${i}`,'shared-network');
    await assert.rejects(market.submit({side:'buy',requestId:randomUUID()},'another-cookie','shared-network'),{status:429});
    assert.equal((await market.snapshot()).price,100);
    assert.equal((await market.snapshot()).total,30);
    for(let i=0;i<75;i++)await market.submit({side:'sell',requestId:randomUUID()},`other-${i}`,`network-${i}`);
    assert.equal((await market.snapshot()).price,100);
    const snapshot=await market.snapshot();assert.equal(snapshot.orders.length,20);
    await assert.rejects(market.submit({side:'buy',requestId:randomUUID(),note:'x'.repeat(161)},'bad','bad'),{status:400});
    assert.equal((await market.snapshot()).total,105);
  }finally{await db.close();}
});

test('24-hour statistics use executed prices and the price at the window boundary', async () => {
  const db = await openDatabase({filename:':memory:'});
  let now = 1800000000000;
  const market = await createExchange(db,{now:()=>now});
  try {
    let view = await market.snapshot();
    assert.equal(view.session.trades,0); assert.equal(view.session.high,null); assert.equal(view.lastTradeAt,null);
    await market.submit({side:'buy',requestId:randomUUID()},'first','first');
    const firstTime=now;
    now+=86400000;
    view=await market.snapshot();
    assert.equal(view.session.reference,101); assert.equal(view.session.trades,0); assert.equal(view.session.change,0);
    await market.submit({side:'buy',requestId:randomUUID()},'second','second');
    now+=1;
    await market.submit({side:'sell',requestId:randomUUID()},'third','third');
    view=await market.snapshot();
    assert.equal(view.session.high,102); assert.equal(view.session.low,102); assert.equal(view.session.trades,2);
    assert.equal(view.session.reference,101); assert.equal(view.session.changePercent,1/101*100);
    assert.equal(view.lastTradeAt,now); assert.equal(view.asOf,now); assert.ok(view.session.since>firstTime);
  }finally{await db.close();}
});

test('approved memos survive leaving the tape and hide immediately when revoked', async () => {
  const db=await openDatabase({filename:':memory:'});const market=await createExchange(db);
  try {
    const receipt=await market.submit({side:'buy',requestId:randomUUID(),name:'Private name',note:'Private memo'},'author','author');
    assert.equal((await market.snapshot()).memos.length,0);
    assert.deepEqual((await market.reviewQueue()).counts,{pending:1,approved:0,rejected:0});
    await market.moderate(receipt.id,'approve');
    for(let i=0;i<22;i++)await market.submit({side:'buy',requestId:randomUUID()},`new${i}`,`net${i}`);
    let snapshot=await market.snapshot();
    assert.equal(snapshot.orders.length,20);assert.ok(!snapshot.orders.some(o=>o.id===receipt.id));
    assert.equal(snapshot.memos[0].note,'Private memo');assert.equal(snapshot.memos[0].name,'Private name');
    await market.moderate(receipt.id,'reject');
    snapshot=await market.snapshot();assert.equal(snapshot.memos.length,0);assert.ok(!JSON.stringify(snapshot).includes('Private'));
    assert.deepEqual((await market.reviewQueue()).counts,{pending:0,approved:0,rejected:1});
  }finally{await db.close();}
});

test('deleting approved text preserves prices, chart history and idempotency', async () => {
  const db=await openDatabase({filename:':memory:'}); const market=await createExchange(db);
  try {
    const order={side:'buy',requestId:randomUUID(),name:'Remove this name',note:'Remove this memo'};
    const receipt=await market.submit(order,'v','n');await market.moderate(receipt.id,'approve');
    const before=await market.snapshot();assert.equal(before.memos.length,1);
    await market.moderate(receipt.id,'delete');
    const after=await market.snapshot();assert.equal(after.memos.length,0);assert.equal(after.total,before.total);assert.equal(after.price,before.price);assert.deepEqual(after.history,before.history);
    assert.ok(!JSON.stringify(after).includes('Remove this'));assert.equal((await market.reviewQueue('approved')).orders.length,0);
    await assert.rejects(market.moderate(receipt.id,'approve'),{status:409});
    await market.submit(order,'v','n');assert.equal((await market.snapshot()).memos.length,0);
    const [row]=await db.transaction(q=>q('SELECT display_name,note FROM orders WHERE id=?',[receipt.id]),true);
    assert.equal(row.display_name,'');assert.equal(row.note,'');
  }finally{await db.close();}
});

test('admin password rotation rejects existing sessions without changing visitor signatures', async () => {
  const db=await openDatabase({filename:':memory:'});const market=await createExchange(db);
  const config={sessionSecret:'s'.repeat(43),adminKey:randomUUID().slice(0,8)};
  const old=createApi(market,config);
  const req=(path,key,cookie)=>new Request('https://example.com/api/'+path,{method:key?'POST':'GET',headers:{origin:'https://example.com','content-type':'application/json',...(cookie?{cookie}:{})},...(key?{body:JSON.stringify({key})}:{})});
  try{
    const login=await old(req('admin/login',config.adminKey),'network');assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await old(req('admin/orders',null,cookie),'network')).status,200);
    const next=createApi(market,{...config,adminKey:randomUUID().slice(0,8)});
    assert.equal((await next(req('admin/orders',null,cookie),'network')).status,401);
    assert.equal((await next(req('admin/login',config.adminKey),'network')).status,401);
  }finally{await db.close();}
});

test('daily chart migration recovers existing trades without changing the ledger', async () => {
  const db=await openDatabase({filename:':memory:'});let now=Date.UTC(2026,8,1,12);
  let market=await createExchange(db,{now:()=>now});
  try{
    await market.submit({side:'buy',requestId:randomUUID()},'a','a');now+=1000;
    await market.submit({side:'buy',requestId:randomUUID()},'b','b');now+=86400000;
    await market.submit({side:'sell',requestId:randomUUID()},'c','c');
    const before=await market.snapshot();
    await db.transaction(async q=>{await q('DROP TABLE chart_daily');await q("DELETE FROM schema_migrations WHERE name='chart-daily-v1'");});
    market=await createExchange(db,{now:()=>now});const after=await market.snapshot();
    assert.equal(after.total,3);assert.equal(after.price,102);assert.deepEqual(after.history,before.history);assert.deepEqual(after.history.daily.map(p=>p.price),[102,102]);
  }finally{await db.close();}
});


test('daily cameo is atomic, once per UTC day, removable and durable across restarts', async () => {
  const db=await openDatabase({filename:':memory:'}); let now=Date.UTC(2026,8,7,23,59);
  let market=await createExchange(db,{now:()=>now});
  const firstQuantity=dailyCameo(Date.UTC(2026,8,7)).quantity, secondQuantity=dailyCameo(Date.UTC(2026,8,8)).quantity;
  try {
    const orders=await Promise.all(Array.from({length:12},()=>market.dailyBuy()));
    assert.equal(new Set(orders.map(o=>o.id)).size,1);
    let view=await market.snapshot(); assert.equal(view.total,1); assert.equal(view.price,100+firstQuantity); assert.equal(view.memos[0].quantity,firstQuantity);
    assert.ok(!view.memos[0].name.includes('(fictional)')); assert.equal(view.memos[0].cameo,true); assert.ok(view.memos[0].note);
    assert.equal((await market.reviewQueue('approved')).orders.length,1);
    await db.transaction(q=>q("UPDATE orders SET display_name=display_name || ' (fictional)' WHERE id=?",[orders[0].id]));
    assert.ok(!(await market.snapshot()).memos[0].name.includes('(fictional)'));
    assert.ok(!(await market.reviewQueue('approved')).orders[0].name.includes('(fictional)'));
    await market.moderate(orders[0].id,'delete');
    market=await createExchange(db,{now:()=>now});
    assert.equal((await market.dailyBuy()).replay,true);
    assert.equal((await market.snapshot()).memos.length,0);
    now+=60000;
    await Promise.all([market.dailyBuy(),market.submit({side:'sell',requestId:randomUUID()},'v','n')]);
    view=await market.snapshot(); assert.equal(view.price,100+firstQuantity+secondQuantity); assert.equal(view.total,3);
    assert.equal(view.buys,2); assert.equal(view.sells,1); assert.equal(view.memos.length,1);
    assert.deepEqual(view.history.daily.map(p=>p.price),[100+firstQuantity,100+firstQuantity+secondQuantity]);
    await market.moderate(view.memos[0].id,'reject'); await market.dailyBuy();
    assert.equal((await market.snapshot()).memos.length,0);
  } finally { await db.close(); }
});

test('a failed daily buy rolls back its ledger and can retry', async () => {
  const db=await openDatabase({filename:':memory:'}); let fail=true;
  const wrapped={kind:db.kind,transaction:fn=>db.transaction(q=>fn((sql,args)=>{
    if(fail && sql.startsWith('UPDATE exchange_state SET price=?,buys=buys+1')) throw new Error('test failure');
    return q(sql,args);
  }))};
  const market=await createExchange(wrapped);
  try {
    await assert.rejects(market.dailyBuy(),/test failure/);
    assert.equal((await market.snapshot()).total,0);
    fail=false; await market.dailyBuy(); assert.equal((await market.snapshot()).total,1);
  } finally { await db.close(); }
});


test('daily share sizes span 1–10 and stay stable on retries', () => {
  const sizes=new Set();
  for(let day=0;day<365;day++) {
    const time=Date.UTC(2026,0,1)+day*86400000;
    const cameo=dailyCameo(time); assert.ok(cameo.quantity>=1 && cameo.quantity<=10);
    assert.deepEqual(cameo,dailyCameo(time)); sizes.add(cameo.quantity);
  }
  assert.equal(sizes.size,10);
});
