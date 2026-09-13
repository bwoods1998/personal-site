import test from 'node:test';
import assert from 'node:assert/strict';
import {validUniverse,mountUniverse} from '../portfolio/universe.js';
// Synthetic labels test the finite public contract; none are a published company profile.
function fixture(){return {schema_version:1,saved_at:'2026-09-13T12:00:00Z',nodes:[
  ['NVDA','chips_fabrication','nvidia.com'],['TSM','chips_fabrication','tsmc.com'],['AVGO','networking','broadcom.com'],['CEG','power_cooling','constellationenergy.com'],['VRT','power_cooling','vertiv.com'],['MSFT','cloud','microsoft.com'],['AMZN','cloud','aboutamazon.com'],['GOOGL','cloud','abc.xyz'],['META','applications','meta.com']
].map(([symbol,layer,domain])=>({symbol,layer,company:'Synthetic '+symbol,status:symbol==='MSFT'?'reviewed':'profiled',role:'Synthetic business role.',question:'Synthetic research question?',sources:[{label:'Synthetic source',url:'https://investor.'+domain+'/source'}]}))}}

test('universe distinguishes profiled candidates from the one reviewed case and fixes issuer/layer identity',()=>{
  assert(validUniverse(fixture()));
  const ir=fixture();ir.nodes[7].sources[0].url='https://blog.google/company-news/source';ir.nodes[8].sources[0].url='https://investor.atmeta.com/source';assert(validUniverse(ir));
  ir.nodes[7].sources[0].url='https://fake.blog.google/source';assert.equal(validUniverse(ir),false);
  for(const mutate of [d=>{d.private_note='private'},d=>{d.nodes[0].raw_response='private'},d=>{d.nodes[0].sources[0].token='private'},d=>{d.nodes[0].status='holding'},d=>{d.nodes[0].status='reviewed'},d=>{d.nodes[0].layer='cloud'},d=>{d.nodes.pop()},d=>{d.nodes.reverse()},d=>{d.nodes[0].sources=[]},d=>{d.nodes[0].sources[0].url='https://nvidia.com.evil.test/source'},d=>{d.nodes[0].sources[0].url='https://name:secret@nvidia.com/source'},d=>{d.nodes[0].sources[0].url='http://nvidia.com/source'},d=>{d.saved_at='2026-02-30T00:00:00Z'}]){const d=fixture();mutate(d);assert.equal(validUniverse(d),false)}
});

test('local company selection starts across the stack and exposes the checked Microsoft case explicitly',()=>{
  class Element{constructor(tag){this.tagName=tag;this.children=[];this.textContent='';this.attrs={};this.listeners={}}append(...c){this.children.push(...c)}replaceChildren(...c){this.children=c}setAttribute(k,v){this.attrs[k]=v}getAttribute(k){return this.attrs[k]}addEventListener(k,f){this.listeners[k]=f}all(tag){return[...(this.tagName===tag?[this]:[]),...this.children.flatMap(e=>e.all(tag))]}text(){return this.textContent+this.children.map(e=>e.text()).join(' ')}}
  const prior=globalThis.document,fetch=globalThis.fetch;globalThis.document={createElement:tag=>new Element(tag)};globalThis.fetch=()=>{throw new Error('No network on selection')};
  try{const target=new Element('div'),selections=[];let opens=0;mountUniverse(fixture(),target,id=>selections.push(id),()=>opens++);const buttons=target.all('button');assert.equal(buttons.length,9);assert.deepEqual(selections,['NVDA']);assert.equal(buttons[0].attrs['aria-pressed'],'true');assert.match(target.text(),/Profiled/);buttons[5].listeners.click();assert.deepEqual(selections,['NVDA','MSFT']);assert.equal(buttons[0].attrs['aria-pressed'],'false');assert.match(target.text(),/Synthetic MSFT/);assert.match(target.text(),/Reviewed case/);target.all('article')[0].all('button')[0].listeners.click();assert.equal(opens,1);buttons[0].listeners.click();assert.equal(target.all('article')[0].all('button').length,0);assert(target.all('a').every(a=>a.rel==='noopener noreferrer'))}finally{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;globalThis.fetch=fetch}
});
