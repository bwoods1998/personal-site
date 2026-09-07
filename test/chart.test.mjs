import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHistory,selectHistory,rangeStart} from '../chart.js';

test('illustrative growth is deterministic, ends at launch and never changes real prices',()=>{
  const anchor={time:Date.UTC(2026,8,7,12),price:100};
  const data={history:{anchor,daily:[{time:anchor.time+1000,price:99}]},points:[{id:1,time:anchor.time+1000,price:99}],asOf:anchor.time+5000,price:99};
  const series=buildHistory(data);assert.deepEqual(series,buildHistory(data));assert.equal(series[0].time,Date.UTC(2021,5,1));assert.equal(series[0].price,1);
  const fake=series.filter(p=>p.kind==='illustrative');assert.ok(fake.length>1000);
  for(let i=1;i<fake.length;i++)assert.ok(fake[i].price>fake[i-1].price);
  assert.ok(fake.at(-1).time<anchor.time);assert.ok(fake.at(-1).price<100);
  assert.equal(series.find(p=>p.time===anchor.time).price,100);assert.equal(series.at(-1).price,99);
  assert.equal(series.find(p=>p.kind==='trade').price,99);
  for(const range of ['6m','1y','all']){
    const selected=selectHistory(series,range,data.asOf);assert.equal(selected.at(-1).time,data.asOf);assert.equal(selected.at(-1).price,99);
    assert.equal(selected[0].time,rangeStart(data.asOf,range));
  }
  assert.ok(selectHistory(series,'6m',data.asOf).length<selectHistory(series,'1y',data.asOf).length);
});
test('calendar ranges clamp month ends and leap days',()=>{
  assert.equal(rangeStart(Date.UTC(2024,7,31),'6m'),Date.UTC(2024,1,29));
  assert.equal(rangeStart(Date.UTC(2024,1,29),'1y'),Date.UTC(2023,1,28));
});
