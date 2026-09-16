import {renderTrace,sampleTrace} from './trace-view.js';
import {describe,buildExport} from './insights.js';
const form=document.querySelector('#checker-form');
const status=document.querySelector('#checker-status');
const runButton=document.querySelector('#checker-run');
const stopButton=document.querySelector('#checker-stop');
const results=document.querySelector('#checker-results');
const cards=document.querySelector('#checker-result-cards');
let controller,lastResult,cooldownUntil=0;
let traceView='visual';
const labels={overview:'Overview',ping:'Ping',traceroute:'Traceroute',dns:'DNS records',tcp:'TCP latency',http:'HTTP headers',tls:'TLS certificate'};
function say(text,error=false){status.textContent=text;status.dataset.state=error?'error':'info';}
function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));const link=element('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function card(title,values,note){
  const section=element('article');section.className='checker-result-card';section.append(element('h3',title));
  const list=element('dl');for(const [key,value] of Object.entries(values)){if(value===undefined)continue;list.append(element('dt',key),element('dd',Array.isArray(value)?value.join('\n'):value??'Unavailable'));}section.append(list);if(note)section.append(element('p',note));cards.append(section);return section;
}
function renderInsights(data){
  const notes=describe(data);if(!notes.length)return;
  const section=element('article');section.className='checker-result-card checker-insights';section.append(element('h3','Diagnostic insights'));
  const list=element('ul');for(const note of notes)list.append(element('li',note));section.append(list);cards.prepend(section);
}
function render(data){
  results.hidden=false;cards.replaceChildren();
  document.querySelector('#checker-results-title').textContent=`${labels[data.mode]} \u00b7 ${data.host}`;
  document.querySelector('#checker-result-meta').textContent=`${data.address} \u00b7 ${data.region} \u00b7 ${new Date(data.checkedAt).toLocaleString()}`;
  if(data.pathIgnored)card('Root website check',{URL:data.origin+'/'},'The path, query string, and fragment were ignored.');
  if(data.dns)card('DNS records',Object.keys(data.dns).length?data.dns:{Address:data.address},'Address records are resolved before every check. Only the displayed IP is probed.');
  if(data.tcp)card('TCP latency',{Port:data.tcp.port,'Successful connections':`${data.tcp.successful} / ${data.tcp.total}`,'Average latency':data.tcp.averageMs===null?'No successful connections':`${data.tcp.averageMs} ms`,Samples:data.tcp.samples.map((s,i)=>`${i+1}. ${s.error||s.ms+' ms'}`)},'TCP connection timing, not ICMP ping or packet-loss measurement.');
  if(data.http)card('HTTP response',data.http.error?{Result:data.http.error}:{Status:data.http.status,'Time to headers':`${data.http.ms} ms`,...data.http.headers},'HEAD request to the root. Redirects are shown but never followed. Some sites reject HEAD requests.');
  if(data.tls)card('TLS certificate',data.tls.error?{Result:data.tls.error}:{Trust:'Certificate verified',Protocol:data.tls.protocol,Subject:data.tls.subject,Issuer:data.tls.issuer,'Valid from':data.tls.validFrom,'Valid until':data.tls.validTo,'Days remaining':data.tls.daysRemaining},'TLS on port 443. A valid certificate alone does not establish that a site is trustworthy.');
  renderInsights(data);
  if(data.measurement){
    if(data.mode==='traceroute'&&data.measurement.results?.length){
      cards.append(renderTrace(data.measurement.results[0],{target:data.host,sample:data.sample===true,view:traceView,onView:value=>{traceView=value;}}));
      return;
    }
    const m=data.measurement;const section=card(labels[data.mode],{Provider:'Globalping',Status:m.error||m.status||'Waiting for probe'},'This is a remote measurement. Hidden hops or unanswered packets do not necessarily mean a host is offline.');
    if(m.results){for(const entry of m.results.slice(0,1)){
      section.append(element('p',[entry.probe?.city,entry.probe?.country,entry.probe?.network].filter(Boolean).join(' \u00b7 ')));
      section.append(element('pre',String(entry.result?.rawOutput||entry.result?.status||'Waiting for results\u2026').slice(0,18000)));
    }}
  }
}
function delay(ms,signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}
async function poll(data,signal){
  const id=data.measurement.id;if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new Error('Invalid measurement ID.');
  const deadline=Date.now()+40000;let etag;
  while(Date.now()<deadline){
    await delay(1500,signal);
    const response=await fetch(`https://api.globalping.io/v1/measurements/${id}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),headers:etag?{'If-None-Match':etag}:{},credentials:'omit',referrerPolicy:'no-referrer'});
    if(response.status===304)continue;
    if(!response.ok)throw new Error(response.status===429?'The probe service is limiting result requests. Try again later.':'Could not retrieve probe results.');
    etag=response.headers.get('etag')||undefined;
    const body=await response.json();data.measurement={...data.measurement,status:body.status,results:body.results};render(data);
    if(body.status!=='in-progress'){
      const complete=body.status==='finished' && body.results?.length>0 && body.results.every(x=>x.result?.status==='finished');
      say(complete?'Check complete.':'The probe finished with an error or incomplete result. See details below.',!complete);return;
    }
    say('Probe running. Results update below\u2026');
  }
  data.measurement.status='Results wait timed out';render(data);say('Stopped waiting after 40 seconds. The remote probe may still finish; no new check was started.',true);
}
form.addEventListener('change',()=>{document.querySelector('#checker-provider-note').hidden=!['ping','traceroute'].includes(new FormData(form).get('mode'));});
const demoButton=element('button','Explore a sample trace');demoButton.type='button';demoButton.className='checker-secondary trace-demo';
form.querySelector('.checker-actions').append(demoButton);
demoButton.addEventListener('click',()=>{if(controller)return;traceView='visual';lastResult=sampleTrace();render(lastResult);say('Sample data only. No probe was started and no allowance was used.');results.scrollIntoView({block:'start',behavior:'instant'});});
stopButton.addEventListener('click',()=>controller?.abort());
form.addEventListener('submit',async event=>{
  event.preventDefault();if(controller)return;
  if(Date.now()<cooldownUntil){say(`Please wait ${Math.ceil((cooldownUntil-Date.now())/1000)} seconds before checking again.`,true);return;}
  const fields=new FormData(form),mode=fields.get('mode'),target=String(fields.get('target')).trim();
  if(!target){say('Enter a target.',true);return;}
  controller=new AbortController();const signal=controller.signal;runButton.disabled=true;stopButton.hidden=false;form.setAttribute('aria-busy','true');results.hidden=true;lastResult=null;say('Starting check\u2026');
  try{
    const configResponse=await fetch('/checker-config.json',{signal,cache:'no-store'});if(!configResponse.ok)throw new Error('The checker configuration could not be loaded.');
    const config=await configResponse.json();if(!config.endpoint)throw new Error('This preview has no live checker backend. Checks become available after deployment.');
    const endpoint=new URL(config.endpoint);if(endpoint.protocol!=='https:')throw new Error('Invalid checker configuration.');
    cooldownUntil=Date.now()+(['ping','traceroute'].includes(mode)?30000:10000);
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,mode}),signal:AbortSignal.any([signal,AbortSignal.timeout(14000)]),credentials:'omit'});
    let data;try{data=await response.json();}catch{throw new Error('The checker is busy or unavailable. Please try later.');}
    if(!response.ok){if(response.status===429){const retry=Number(response.headers.get('retry-after'));cooldownUntil=Math.max(cooldownUntil,Date.now()+Math.min(Number.isFinite(retry)&&retry>0?retry:60,3600)*1000);}throw new Error(data.message||'The checker is busy or unavailable. Please try later.');}
    lastResult=data;render(data);
    if(data.measurement?.id){say('Probe started. Waiting for results\u2026');await poll(data,signal);}
    else say(data.measurement?.error||'Check complete. Review individual results below.',!!data.measurement?.error);
  }catch(error){
    const message=signal.aborted?'Stopped waiting. A submitted remote check may still finish and count toward limits.':error.name==='TimeoutError'?'The request timed out. It was not retried automatically.':error.message||'The request failed. Please try later.';
    if(lastResult?.measurement){lastResult.measurement.status=message;render(lastResult);}say(message,true);
  }finally{controller=null;runButton.disabled=false;stopButton.hidden=true;form.removeAttribute('aria-busy');}
});
document.querySelector('#checker-download').addEventListener('click',()=>{
  if(!lastResult)return;download('smithey-lab-network-check.json',buildExport(lastResult,'json'),'application/json');
});
const textButton=element('button','Download text summary');textButton.type='button';textButton.className='checker-secondary';
document.querySelector('#checker-download').after(textButton);
textButton.addEventListener('click',()=>{if(!lastResult)return;download('smithey-lab-network-check.txt',buildExport(lastResult,'text'),'text/plain');});
