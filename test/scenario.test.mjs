import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validScenario, scenarioResult, growthLabel, billions, mountScenario} from '../portfolio/scenario.js';
const data = JSON.parse(await readFile(new URL('../portfolio/scenario.json', import.meta.url), 'utf8'));
const bridge = JSON.parse(await readFile(new URL('../portfolio/cashflow.json', import.meta.url), 'utf8'));

test('scenario baseline is the checked FY26 company cash remainder, not prior-year FCF or AI returns', () => {
  assert(validScenario(data, bridge));
  assert.deepEqual(scenarioResult(data), {generation:182935000000n,investment:115948000000n,remaining:66987000000n,baseline:66987000000n,change:0n,requiredGrowth:0});
  assert.equal(scenarioResult(data, 1000, 0).remaining,85280500000n);
  assert.equal(scenarioResult(data, 0, 1000).remaining,55392200000n);
  assert.equal(scenarioResult(data, 1, 1).change,6698700n);
  assert.equal(scenarioResult(data, -5000, 10000).remaining,-140428500000n);
});

test('signed break-even is the first sufficient basis point, including negative investment growth', () => {
  for (const investment of [-5000,-1999,-100,-1,0,1,99,100,1000,4321,9999,10000]) {
    const r=scenarioResult(data,0,investment), at=scenarioResult(data,r.requiredGrowth,investment), below=scenarioResult(data,r.requiredGrowth-1,investment);
    assert(at.remaining>=r.baseline, String(investment));
    assert(below.remaining<r.baseline,String(investment));
  }
  assert.equal(scenarioResult(data,0,1000).requiredGrowth,634);
  assert.equal(scenarioResult(data,0,-1000).requiredGrowth,-633);
});

test('publication binds exact source values and rejects private fields, ambiguous scope and tampering', () => {
  for (const mutate of [d=>{d.private_note='secret'},d=>{d.source.token='secret'},d=>{d.period='FY2025'},d=>{d.scope='ai_only'},d=>{d.unit='USD'},d=>{d.cash_ppe='115947'},d=>{d.cash_after_ppe='66988'},d=>{d.operating_cash_flow=182935},d=>{d.source.url='https://example.com'},d=>{d.source.sha256='0'.repeat(64)},d=>{d.rubric_sha256='0'.repeat(64)}]) {
    const bad=structuredClone(data);mutate(bad);assert.equal(validScenario(bad),false);assert.throws(()=>scenarioResult(bad),TypeError);
  }
  const changed=structuredClone(bridge);changed.totals.FY2026='182934';assert.equal(validScenario(data,changed),false);
  for (const growth of [NaN,Infinity,'100',100.1,-5001,10001]) assert.throws(()=>scenarioResult(data,growth,0),TypeError);
});

test('presentation preserves signs, exact basis points and explicit billion-dollar rounding', () => {
  assert.equal(growthLabel(634),'+6.34%');assert.equal(growthLabel(-633),'−6.33%');assert.equal(growthLabel(0),'0%');
  assert.equal(billions(66987000000n),'$66.987B');assert.equal(billions(-11594800000n,true),'−$11.595B');assert.equal(billions(0n,true),'$0.000B');
  assert.equal(billions(500000n), '$0.001B');assert.throws(()=>billions(1000000),TypeError);
});

test('scenario inputs update outputs and reset entirely locally with accessible controls', () => {
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.textContent='';this.listeners={};}
    append(...children){this.children.push(...children)} replaceChildren(...children){this.children=children}
    setAttribute(k,v){this.attrs[k]=v} addEventListener(k,f){this.listeners[k]=f}
    all(tag){return[...(this.tagName===tag?[this]:[]),...this.children.flatMap(e=>e.all(tag))]}
    text(){return this.textContent+this.children.map(e=>e.text()).join(' ')}
  }
  const previous=globalThis.document, fetch=globalThis.fetch;
  globalThis.document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};globalThis.fetch=()=>{throw new Error('No network from controls')};
  try {
    const target=new Element('div');mountScenario(data,target);const controls=target.all('input');
    assert.equal(controls.length,2);assert(controls.every(e=>e.type==='range'&&e.attrs['aria-valuetext']));
    assert.match(target.text(),/Scenario · Company cash flow/);assert.match(target.text(),/\$66\.987B/);
    controls[1].value='1000';controls[1].listeners.input();assert.match(target.text(),/\$55\.392B/);assert.match(target.text(),/\+6\.34%/);
    assert.match(target.all('svg')[0].attrs['aria-label'],/minus 50 to plus 100 percent/);
    target.all('button')[0].listeners.click();assert(controls.every(e=>e.value==='0'));assert.match(target.text(),/\$66\.987B/);
    assert(target.all('span').some(e=>e.attrs['aria-live']==='polite'));
    assert(target.all('a').every(e=>e.rel==='noopener noreferrer'));
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;globalThis.fetch=fetch}
});
