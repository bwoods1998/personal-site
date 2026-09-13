import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validProjectStatus,overviewModel,activateProjectView} from '../portfolio/portfolio.js';
const snapshot=JSON.parse(await readFile(new URL('../portfolio/snapshot.json',import.meta.url),'utf8'));
const investigations=JSON.parse(await readFile(new URL('../portfolio/investigations.json',import.meta.url),'utf8'));
function fixture(){return{schema_version:1,saved_at:snapshot.published_at,state:'checkpoint',current_focus:{company:'Microsoft',symbol:'MSFT',question:'What changes the company cash-flow case?'},next_milestone:'Complete a source-checked research cycle.',costs:{inference_known_usd:snapshot.costs.known_estimated_usd??snapshot.costs.estimated_usd??'0',inference_unknown_requests:snapshot.costs.unknown_runs,compute_known_usd:'0.01',compute_unknown_items:1},reviewed:{theses:snapshot.thesis.revisions.length,investigations:investigations.investigations.length},sail:[{product:'inference',status:'used',detail:'Source-based reasoning.',docs_url:'https://docs.sailresearch.com/inference'}],links:[{label:'Current state',href:'https://github.com/bwoods1998/portfolio-agent/blob/main/docs/CURRENT-STATE.md'}]}}

test('project status is strict, explicitly recorded and bound to accompanying reviewed costs/counts',()=>{
  assert(validProjectStatus(fixture(),snapshot,investigations));
  for(const mutate of [d=>{d.secret='private'},d=>{d.costs.secret='private'},d=>{d.sail[0].raw_response='private'},d=>{d.state='live'},d=>{d.state='__proto__'},d=>{d.saved_at='2026-02-30T00:00:00Z'},d=>{d.current_focus.symbol='OTHER'},d=>{d.costs.inference_known_usd='NaN'},d=>{d.costs.compute_unknown_items=-1},d=>{d.costs.compute_known_usd=null},d=>{d.reviewed.theses=-1},d=>{d.sail.push(structuredClone(d.sail[0]))},d=>{d.sail[0].docs_url='https://docs.sailresearch.com.evil.test/inference'},d=>{d.links[0].href='https://github.com/bwoods1998/portfolio-agent/blob/main/.data/credentials.json'},d=>{d.links[0].href+='?secret=bad'}]){
    const data=fixture();mutate(data);assert.equal(validProjectStatus(data),false);
  }
  for(const mutate of [d=>{d.costs.inference_known_usd='999'},d=>{d.costs.inference_unknown_requests++},d=>{d.reviewed.theses++},d=>{d.reviewed.investigations++},d=>{d.saved_at='2026-01-01T00:00:00Z'}]){
    const data=fixture();mutate(data);assert.equal(validProjectStatus(data,snapshot,investigations),false);
  }
});

test('Now uses reviewed prose and honest absent/malformed status fallbacks without inventing compute or liveness',()=>{
  const current=snapshot.thesis.revisions.at(-1), fallback=overviewModel(snapshot,null,2);
  assert.equal(fallback.summary,current.summary);assert.equal(fallback.invalidation,current.invalidation[0]);assert.equal(fallback.computeKnown,null);assert.equal(fallback.computeUnknown,null);assert.equal(fallback.state,'Published research');assert.equal(fallback.reviewed,2);
  const data=fixture();data.state='running';const model=overviewModel(snapshot,data,2);assert.equal(model.state,'Recorded · Research running');assert.equal(model.computeUnknown,1);assert.equal(model.summary,current.summary);assert.equal(model.next,data.next_milestone);
  data.costs.inference_known_usd='999';assert.equal(overviewModel(snapshot,data,2).status,null);
});

test('Now/Case navigation keeps one panel visible and never selects nonexistent views',()=>{
  const nodes=Object.fromEntries(['now','research'].flatMap(id=>[[`#view-${id}`,{attrs:{},setAttribute(k,v){this.attrs[k]=v},focus(){this.focused=true}}],[`#panel-${id}`,{hidden:false}]]));
  const doc={querySelector:key=>nodes[key]};
  assert.equal(activateProjectView('research',doc,true),true);assert.equal(nodes['#panel-now'].hidden,true);assert.equal(nodes['#panel-research'].hidden,false);assert.equal(nodes['#view-research'].attrs['aria-selected'],'true');assert.equal(nodes['#view-now'].tabIndex,-1);assert.equal(nodes['#view-research'].focused,true);
  assert.equal(activateProjectView('lab',doc),false);assert.equal(nodes['#panel-research'].hidden,false);
  activateProjectView('now',doc);assert.equal(nodes['#panel-research'].hidden,true);
});

test('visitor page keeps one research case, disconnect status, and repository-only technical experiments',async()=>{
  const html=await readFile(new URL('../portfolio/index.html',import.meta.url),'utf8');
  assert.match(html,/Follow the AI spending cycle/);
  assert.match(html,/Schwab disconnected · No trades/);
  assert.match(html,/data-view="research"[^>]*>Case</);assert.doesNotMatch(html,/data-view="lab"|id="panel-lab"|src="\.\/(?:replay|cache|evaluations)\.js"/);
  assert.match(html,/Experiments &amp; implementation/);
  const source=await readFile(new URL('../portfolio/scenario.js',import.meta.url),'utf8');assert.equal((source.match(/\bfetch\(/g)||[]).length,1);assert.doesNotMatch(source,/\.innerHTML|localStorage|sessionStorage|sendBeacon|\/api\//);
  const build=await readFile(new URL('../build.mjs',import.meta.url),'utf8');assert.match(build,/validProjectStatus\(JSON\.parse\(status\), JSON\.parse\(snapshot\), JSON\.parse\(investigations\)\)/);
});
