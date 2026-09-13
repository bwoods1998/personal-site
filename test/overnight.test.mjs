import test from 'node:test';
import assert from 'node:assert/strict';
import {validOvernight, mountOvernight, loadOvernight} from '../portfolio/overnight.js';

export function fixture() {
  return {schema_version:1, saved_at:'2026-09-13T07:30:00Z', state:'running', started_at:'2026-09-13T07:00:00Z', deadline:'2026-09-13T15:00:00Z', planned_steps:86, completed_steps:2, submitted_requests:6, unknown_requests:4, estimated_usd:'0.042189', max_reservation_usd:'30', inflight_requests:4, source_documents:18, scope:'Mechanical checks and fallible model comparisons. Company cases and dependency maps remain unapproved drafts.', companies:['NVDA','TSM','AVGO','CEG','VRT','MSFT','AMZN','GOOGL','META'].map((symbol,i)=>({symbol,completed_steps:i===0?2:0,baseline_mechanical_pass:i===0?true:null,revised_mechanical_pass:null,judge_preferences:[],approved:false}))};
}

test('checkpoint contract rejects private fields, contradictions and impossible timestamps',()=>{
  assert(validOvernight(fixture()));
  const finished=fixture();finished.completed_steps=86;finished.inflight_requests=0;finished.state='complete';finished.companies.forEach(c=>{c.completed_steps=9;c.revised_mechanical_pass=true});assert(validOvernight(finished));
  for(const mutate of [d=>{d.raw_response='private'},d=>{d.companies[0].headline='unreviewed'},d=>{d.companies[0].approved=true},d=>{d.companies.reverse()},d=>{d.companies.pop()},d=>{d.companies[0].judge_preferences=['guaranteed']},d=>{d.completed_steps=0},d=>{d.companies[0].completed_steps=0},d=>{d.state='complete'},d=>{d.unknown_requests=3},d=>{d.inflight_requests=7},d=>{d.saved_at='2026-02-30T12:00:00Z'},d=>{d.saved_at='2026-09-13T06:00:00Z'},d=>{d.deadline='2026-09-14T15:00:00Z'},d=>{d.estimated_usd='NaN'},d=>{d.estimated_usd=1},d=>{d.scope='All research verified'},d=>{d.state='deadline'}]){const value=fixture();mutate(value);assert.equal(validOvernight(value),false)}
});

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.textContent='';this.attrs={};this.hidden=true}
  append(...children){this.children.push(...children)}
  replaceChildren(...children){this.children=children}
  setAttribute(key,value){this.attrs[key]=value}
  all(tag){return [...(this.tagName===tag?[this]:[]),...this.children.flatMap(c=>c.all(tag))]}
  text(){return this.textContent+' '+this.children.map(c=>c.text()).join(' ')}
}

test('static checkpoint stays concise and all interactions are local',()=>{
  const old=globalThis.document,oldFetch=globalThis.fetch;
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.fetch=()=>{throw Error('No network in controls')};
  try{const target=new Element('div');assert(mountOvernight(fixture(),target));assert.match(target.text(),/2\/86 stages · 9 companies · \$0.04 known \+ 4 unsettled/);assert.match(target.text(),/Researching · recorded/);assert.match(target.text(),/findings still need review/);assert.equal(target.all('progress')[0].value,2);assert.equal(target.all('details').length,1);assert.equal(target.all('a').length,1);assert.equal(target.all('a')[0].href,'https://github.com/bwoods1998/portfolio-agent/blob/main/docs/NIGHT-SHIFT.md');assert.equal(target.all('time')[0].dateTime,fixture().saved_at);assert.equal(target.all('button').length,0)}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;globalThis.fetch=oldFetch}
});

test('optional absent or malformed checkpoint remains hidden with one GET and no retry',async()=>{
  for(const response of [{ok:false},{ok:true,json:async()=>({...fixture(),private_key:'never publish'})},{ok:true,json:async()=>{throw Error('broken JSON')}}]){let requests=0;const section=new Element('section');assert.equal(await loadOvernight(new Element('div'),section,async(url,options)=>{requests++;assert.equal(url,'./overnight-research.json');assert.equal(options.credentials,'omit');return response}),false);assert.equal(requests,1);assert.equal(section.hidden,true)}
});
