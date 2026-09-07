import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../lib/database.mjs';
import { createExchange } from '../lib/exchange.mjs';
import { createApi } from '../lib/api.mjs';

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
    assert.equal(snapshot.orders[0].name,'Guest'); assert.equal(snapshot.orders[0].note,'');
    assert.ok(!JSON.stringify(snapshot).includes('Private pending'));
    await assert.rejects(market.submit({...order,note:'changed'},'visitor','network'),{status:409});
    await assert.rejects(market.submit({...order,requestId:randomUUID()},'visitor','network'),{status:429});
    const pending = await market.reviewQueue(); assert.equal(pending.orders[0].note,order.note);
    await market.moderate(receipts[0].id,'approve');
    assert.equal((await market.snapshot()).orders[0].note,order.note);
    await market.moderate(receipts[0].id,'reject');
    assert.equal((await market.snapshot()).orders[0].note,'');
    await Promise.all(Array.from({length:15},(_,i)=>market.submit({side:i%2?'buy':'sell',requestId:randomUUID()},`v${i}`,`n${i}`)));
    snapshot=await market.snapshot(); assert.equal(snapshot.total,16); assert.equal(snapshot.price,100);
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
    assert.equal((await market.snapshot()).price,70);
    assert.equal((await market.snapshot()).total,30);
    for(let i=0;i<75;i++)await market.submit({side:'sell',requestId:randomUUID()},`other-${i}`,`network-${i}`);
    assert.equal((await market.snapshot()).price,1);
    const snapshot=await market.snapshot();assert.equal(snapshot.orders.length,20);
    await assert.rejects(market.submit({side:'buy',requestId:randomUUID(),note:'x'.repeat(161)},'bad','bad'),{status:400});
    assert.equal((await market.snapshot()).total,105);
  }finally{await db.close();}
});
