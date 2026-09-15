const text=(tag,value,className)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value);if(className)node.className=className;return node;};
const svg=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
const ms=value=>value===null?'No reply':`${value.toFixed(1)} ms`;
export function traceHops(result){
  if(!Array.isArray(result?.hops))return [];
  return result.hops.slice(0,64).map((hop,index)=>{
    const timings=(Array.isArray(hop?.timings)?hop.timings:[]).slice(0,100).map(t=>t?.rtt).filter(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0);
    return {number:index+1,address:typeof hop?.resolvedAddress==='string'?hop.resolvedAddress.slice(0,160):'',hostname:typeof hop?.resolvedHostname==='string'?hop.resolvedHostname.slice(0,250):'',timings,average:timings.length?timings.reduce((a,b)=>a+b,0)/timings.length:null};
  });
}
export function renderTrace(entry,{target='',sample=false,view='visual',onView=()=>{}}={}){
  const hops=traceHops(entry.result),section=text('article',undefined,'trace-explorer');
  const header=text('div',undefined,'trace-header'),intro=text('div');
  intro.append(text('p',sample?'SAMPLE DATA / NO PROBE USED':'GLOBALPING / NETWORK PATH','trace-eyebrow'),text('h3','Route Explorer'),text('p',`${[entry.probe?.city,entry.probe?.country].filter(Boolean).join(', ')||'Remote probe'} → ${target}`,'trace-subtitle'));
  const tabs=text('div',undefined,'trace-switch');tabs.setAttribute('aria-label','Traceroute display');
  const visualButton=text('button','Visual'),rawButton=text('button','Raw output');
  for(const button of [visualButton,rawButton])button.type='button';tabs.append(visualButton,rawButton);header.append(intro,tabs);section.append(header);
  const visual=text('div'),raw=text('pre',String(entry.result?.rawOutput||'Raw output is not available for this result.').slice(0,18000),'trace-raw');
  function setView(value){visual.hidden=value!=='visual';raw.hidden=value!=='raw';visualButton.setAttribute('aria-pressed',String(value==='visual'));rawButton.setAttribute('aria-pressed',String(value==='raw'));onView(value);}
  visualButton.addEventListener('click',()=>setView('visual'));rawButton.addEventListener('click',()=>setView('raw'));setView(view);
  if(!hops.length){visual.append(text('p',entry.result?.status==='in-progress'?'Tracing the route… hops appear when the probe returns them.':'No structured hops were returned. Check Raw output for probe details.','trace-empty'));section.append(visual,raw);return section;}
  const replies=hops.filter(h=>h.average!==null),highest=Math.max(0,...replies.map(h=>h.average)),peak=Math.max(1,highest);
  const reached=!!entry.result?.resolvedAddress&&hops.some(h=>h.address===entry.result.resolvedAddress&&h.average!==null);
  const stats=text('div',undefined,'trace-stats');
  for(const [label,value]of [['Hops observed',hops.length],['Responding',`${replies.length} / ${hops.length}`],['Highest mean RTT',replies.length?ms(highest):'No replies'],['Destination reply',reached?'Observed':'Not observed']]){const item=text('div');item.append(text('span',label),text('strong',value));stats.append(item);}visual.append(stats);
  const chart=svg('svg',{viewBox:'0 0 960 290',role:'img','aria-label':'Round-trip latency from the remote probe to each hop. Gaps indicate missing replies.',class:'trace-chart'});
  const top=34,bottom=226,left=42,right=922,y=value=>bottom-(value/peak)*(bottom-top),x=index=>left+index*(right-left)/Math.max(1,hops.length-1);
  for(let i=0;i<=4;i++){const yy=top+i*(bottom-top)/4;chart.append(svg('line',{x1:left,y1:yy,x2:right,y2:yy,class:'trace-grid'}));const label=svg('text',{x:left,y:yy-8,class:'trace-axis'});label.textContent=`${(peak*(4-i)/4).toFixed(1)} ms`;chart.append(label);}
  let previous=null;
  const dots=[];
  hops.forEach((hop,index)=>{
    const xx=x(index),yy=hop.average===null?bottom:y(hop.average);
    if(previous!==null&&hop.average!==null)chart.append(svg('line',{x1:x(index-1),y1:y(previous),x2:xx,y2:yy,class:'trace-line'}));
    previous=hop.average;
    chart.append(svg('line',{x1:xx,y1:yy,x2:xx,y2:bottom,class:'trace-stem'}));
    const dot=svg('circle',{cx:xx,cy:yy,r:hop.average===null?5:7,class:hop.average===null?'trace-dot trace-missing':'trace-dot'});dots.push(dot);chart.append(dot);
    if(hops.length<=20||index%Math.ceil(hops.length/20)===0||index===hops.length-1){const label=svg('text',{x:xx,y:bottom+27,'text-anchor':'middle',class:'trace-axis'});label.textContent=String(hop.number);chart.append(label);}
  });
  const chartWrap=text('div',undefined,'trace-chart-wrap');chartWrap.tabIndex=0;chartWrap.setAttribute('role','region');chartWrap.setAttribute('aria-label','Latency chart; scroll horizontally on small screens');chartWrap.append(chart);
  visual.append(chartWrap,text('p','HOP NUMBER →   • Filled: reply received   ◌ Hollow: no timing returned','trace-legend'));
  const lower=text('div',undefined,'trace-lower'),list=text('div',undefined,'trace-hop-list'),detail=text('div',undefined,'trace-detail');list.setAttribute('aria-label','Select a hop');detail.setAttribute('aria-live','polite');
  const buttons=[];
  function select(index){
    const hop=hops[index];buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));dots.forEach((dot,i)=>dot.setAttribute('r',i===index?11:hops[i].average===null?5:7));
    detail.replaceChildren(text('p',`HOP ${String(hop.number).padStart(2,'0')}`,'trace-eyebrow'),text('h4',hop.hostname||hop.address||'Unanswered hop'),text('p',hop.hostname?hop.address:hop.average===null?'This router did not return a timing.':'Router address','trace-address'),text('strong',ms(hop.average),'trace-big-rtt'),text('p',hop.average===null?'A hidden hop is not proof of an outage. Routers can suppress traceroute replies.':'Mean round-trip time from the probe, not delay added by this link.','trace-help'));
    if(hop.timings.length){const samples=text('div',undefined,'trace-samples');hop.timings.forEach((value,i)=>samples.append(text('span',`Reply ${i+1}: ${ms(value)}`)));detail.append(samples);}
  }
  hops.forEach((hop,index)=>{const button=text('button',undefined,'trace-hop');button.type='button';button.append(text('span',String(hop.number).padStart(2,'0'),'trace-hop-number'),text('span',hop.hostname||hop.address||'No reply','trace-hop-name'),text('span',ms(hop.average),'trace-hop-ms'));button.addEventListener('click',()=>select(index));dots[index].addEventListener('click',()=>select(index));buttons.push(button);list.append(button);});
  select(0);lower.append(list,detail);visual.append(lower,text('p','Schematic latency view, not a geographic map. Routes and reply times can vary; one high-latency hop alone does not identify a bottleneck.','trace-footnote'));section.append(visual,raw);return section;
}
export function sampleTrace(){
  const timings=[1.2,3.8,8.1,null,22.4,47.8,39.2,42.6];
  return {mode:'traceroute',host:'demo.example',address:'203.0.113.80',region:'Sample trace — not a live measurement',checkedAt:new Date().toISOString(),sample:true,measurement:{status:'finished',results:[{probe:{city:'Sample US probe',country:'',network:'Illustrative network'},result:{status:'finished',resolvedAddress:'203.0.113.80',hops:timings.map((rtt,i)=>({resolvedAddress:rtt===null?null:i===7?'203.0.113.80':`192.0.2.${i+1}`,resolvedHostname:rtt===null?null:['gateway.demo','access.demo','edge.demo','','transit.demo','peering.demo','destination-edge.demo','demo.example'][i],timings:rtt===null?[]:[{rtt},{rtt:rtt+0.8},{rtt:rtt+0.4}]})),rawOutput:'ILLUSTRATIVE SAMPLE — no network check was performed.\n'+timings.map((rtt,i)=>`${i+1}  ${rtt===null?'* * *':`${i===7?'203.0.113.80':`192.0.2.${i+1}`}  ${rtt} ms  ${(rtt+0.8).toFixed(1)} ms  ${(rtt+0.4).toFixed(1)} ms`}`).join('\n')}}]}};
}
