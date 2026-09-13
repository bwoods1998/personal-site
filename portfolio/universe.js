const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
export const LAYERS = Object.freeze({chips_fabrication:'Chips & fabrication',networking:'Networking',power_cooling:'Power & cooling',cloud:'Cloud',applications:'Applications'});
const COMPANIES = Object.freeze({
  NVDA:{layer:'chips_fabrication',domains:['nvidia.com']},TSM:{layer:'chips_fabrication',domains:['tsmc.com']},
  AVGO:{layer:'networking',domains:['broadcom.com']},CEG:{layer:'power_cooling',domains:['constellationenergy.com']},VRT:{layer:'power_cooling',domains:['vertiv.com']},
  MSFT:{layer:'cloud',domains:['microsoft.com']},AMZN:{layer:'cloud',domains:['amazon.com','aboutamazon.com']},GOOGL:{layer:'cloud',domains:['abc.xyz','google.com'],hosts:['blog.google']},META:{layer:'applications',domains:['meta.com','fb.com'],hosts:['investor.atmeta.com']},
});
function issuerUrl(value, symbol) {
  if (!text(value, 500) || !Object.hasOwn(COMPANIES,symbol)) return false;
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(COMPANIES[symbol].hosts?.includes(u.hostname)||COMPANIES[symbol].domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)));}catch{return false;}
}
export function validUniverse(data) {
  if(!exact(data,['schema_version','saved_at','nodes'])||data.schema_version!==1||typeof data.saved_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(data.saved_at)||!Number.isFinite(Date.parse(data.saved_at))||new Date(data.saved_at).toISOString().replace('.000Z','Z')!==data.saved_at||!Array.isArray(data.nodes)||data.nodes.length!==9)return false;
  return data.nodes.every((row,i)=>exact(row,['symbol','company','layer','status','role','question','sources'])&&row.symbol===Object.keys(COMPANIES)[i]&&text(row.company,60)&&row.layer===COMPANIES[row.symbol].layer&&['queued','profiled','reviewed'].includes(row.status)&&(row.status!=='reviewed'||row.symbol==='MSFT')&&text(row.role,180)&&text(row.question,240)&&Array.isArray(row.sources)&&row.sources.length>=1&&row.sources.length<=3&&row.sources.every(s=>exact(s,['label','url'])&&text(s.label,60)&&issuerUrl(s.url,row.symbol)));
}
function node(tag,content,cls){const e=document.createElement(tag);if(content!==undefined)e.textContent=content;if(cls)e.className=cls;return e;}
export function mountUniverse(data,target,onSelect=()=>{},onOpenCase=()=>{}) {
  if(!validUniverse(data))throw new TypeError('Invalid checked research universe');
  let selected='NVDA';const map=node('div',undefined,'universe-map');map.setAttribute('role','group');map.setAttribute('aria-label','Select an AI-stack company');
  const buttons=[];
  for(const [layer,label]of Object.entries(LAYERS)) {
    const row=node('div',undefined,'universe-layer');row.append(node('span',label));const items=node('div',undefined,'universe-companies');
    for(const company of data.nodes.filter(c=>c.layer===layer)) {
      const button=node('button',company.symbol);button.type='button';button.setAttribute('data-company',company.symbol);button.setAttribute('aria-label',company.company+' · '+company.symbol);button.addEventListener('click',()=>{selected=company.symbol;draw()});items.append(button);buttons.push(button);
    }
    row.append(items);map.append(row);
  }
  const card=node('article',undefined,'universe-card');card.setAttribute('aria-live','polite');
  target.replaceChildren(map,card);
  function draw(){
    const company=data.nodes.find(c=>c.symbol===selected);buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute('data-company')===selected)));
    card.replaceChildren();const header=node('div',undefined,'universe-card-heading');header.append(node('h3',company.company),node('span',{queued:'Queued',profiled:'Profiled',reviewed:'Reviewed case'}[company.status]));card.append(header,node('p',company.role,'universe-role'),node('p',company.question,'universe-question'));
    const links=node('p',undefined,'universe-sources');for(const source of company.sources){const a=node('a',source.label+' ↗');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';links.append(a)}card.append(links);
    if(selected==='MSFT'){const open=node('button','Explore first case →','text-action');open.type='button';open.addEventListener('click',onOpenCase);card.append(open)}
    onSelect(selected);
  }
  draw();
}
if(typeof document!=='undefined'&&document.querySelector('#universe-content')){
  (async()=>{try{
    const response=await fetch('./universe.json',{cache:'no-cache',signal:AbortSignal.timeout(12000)});if(!response.ok)return;
    const body=await response.text();if(body.length>16000)return;const data=JSON.parse(body);if(!validUniverse(data))return;
    mountUniverse(data,document.querySelector('#universe-content'),()=>{},()=>document.dispatchEvent(new CustomEvent('portfolio:open-case')));document.querySelector('#universe').hidden=false;
    const overview=document.querySelector('#universe-overview');if(overview){overview.textContent=`${data.nodes.length} companies · Not holdings`;overview.hidden=false;}
  }catch{/* The reviewed Microsoft case works without optional universe data. */}})();
}
