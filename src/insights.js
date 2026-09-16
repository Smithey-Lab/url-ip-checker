const LIMIT=2400;
const bound=value=>{const text=typeof value==='string'?value:String(value??'');let out='';for(let i=0;i<text.length&&out.length<LIMIT;i++){const code=text.charCodeAt(i);out+=(code<32&&code!==9&&code!==10&&code!==13)?' ':text[i];}return out+(text.length>LIMIT?' [truncated]':'');};
const clean=value=>typeof value==='string'?bound(value):value;
const num=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const stamp=data=>{
  const time=data&&data.checkedAt?new Date(data.checkedAt):null;
  return time&&!Number.isNaN(time.getTime())?time.toISOString():'Unknown time';
};

export function describe(data){
  const notes=[];
  if(!data||typeof data!=='object'){notes.push('No check data is available to describe.');return notes;}
  if(data.sample===true)notes.push('Sample display data only. No measurement was performed.');
  if(data.mode==='ping'){
    const m=data.measurement||{};
    const statusString=typeof m.status==='string'?m.status:'waiting';
    if(m.error)notes.push('The remote ping probe reported an error: '+clean(m.error)+'.');
    else if(statusString==='in-progress')notes.push('The remote ping probe is still running.');
    else notes.push('The remote ping probe reports status \u201c'+clean(statusString)+'\u201d.');
    const rtts=[];
    for(const entry of Array.isArray(m.results)?m.results.slice(0,1):[]){
      for(const item of Array.isArray(entry.result?.timings)?entry.result.timings.slice(0,200):[]){
        if(typeof item?.rtt==='number'&&Number.isFinite(item.rtt)&&item.rtt>=0)rtts.push(item.rtt);
      }
    }
    if(rtts.length)notes.push('The probe returned '+rtts.length+' round-trip timing sample'+(rtts.length===1?'':'s')+', with a minimum of '+Math.min(...rtts).toFixed(1)+' ms. These are probe-measured round-trip times; no packet-loss rate is estimated here.');
    else notes.push('No numeric round-trip timing was returned, so no round-trip time is shown.');
    return notes;
  }
  if(data.mode==='traceroute'){
    const m=data.measurement||{};
    const statusString=typeof m.status==='string'?m.status:'waiting';
    if(m.error)notes.push('The remote traceroute probe reported an error: '+clean(m.error)+'.');
    else if(statusString==='in-progress')notes.push('The remote traceroute probe is still running.');
    else notes.push('The remote traceroute probe reports status \u201c'+clean(statusString)+'\u201d.');
    let measured=0,unanswered=0,highest=null;
    const first=Array.isArray(m.results)?m.results[0]:null;
    const hops=Array.isArray(first?.result?.hops)?first.result.hops.slice(0,64):[];
    for(const hop of hops){
      const times=(Array.isArray(hop?.timings)?hop.timings.slice(0,100):[]).map(t=>num(t?.rtt)).filter(v=>v!==null);
      if(times.length){measured+=1;const mean=times.reduce((a,b)=>a+b,0)/times.length;highest=highest===null||mean>highest?mean:highest;}
      else unanswered+=1;
    }
    if(hops.length)notes.push(measured+' hop'+(measured===1?'':'s')+' returned a measured round-trip time and '+unanswered+' hop'+(unanswered===1?'':'s')+' did not return a timing. Missing responses provide no timing measurement; they are not treated as packet loss or proof of an outage.');
    if(highest!==null)notes.push('The highest measured mean round-trip time among returned hops is '+highest.toFixed(1)+' ms. This is a probe-measured round-trip time, not delay attributed to a specific link.');
    return notes;
  }
  if(data.dns)notes.push('Address records were resolved before the check; only the displayed address is probed.');
  if(data.tcp){
    const total=num(data.tcp.total),successful=num(data.tcp.successful),port=data.tcp.port;
    if(successful===null||total===null||total===0)notes.push('TCP connection counts were unavailable for this check.');
    else if(successful===0)notes.push('No TCP connection to port '+(port??'the target port')+' completed successfully in any of the '+total+' attempts. Connection failures are reported as observed and are not interpreted as packet loss.');
    else{const avg=num(data.tcp.averageMs);notes.push(successful+' of '+total+' TCP connection attempts to port '+(port??'the target port')+' completed successfully'+(avg===null?'.':', with a mean handshake time of '+avg.toFixed(1)+' ms.')+' Connection timings are TCP measurements from this check, not ICMP ping or packet-loss measurements.');}
  }else if(data.mode==='overview'||data.mode==='tcp')notes.push('No TCP connection measurement was returned.');
  if(data.http){
    if(data.http.error)notes.push('The HTTP request reported: '+clean(data.http.error)+'.');
    else if(typeof data.http.status==='number'){const code=data.http.status;notes.push('The HTTP HEAD request returned status '+code+'.');if(code>=500&&code<600)notes.push('A 5xx status means the server reported a server-side error for this request.');else if(code>=400&&code<500)notes.push('A 4xx status means the server refused or could not find this request; the path and method can affect this.');else if([301,302,303,307,308].includes(code))notes.push('The server returned a redirect, which the checker showed but did not follow.');}
    else notes.push('No HTTP status was returned.');
  }
  if(data.tls){
    if(data.tls.error)notes.push('The TLS certificate check reported: '+clean(data.tls.error)+'.');
    else{const days=typeof data.tls.daysRemaining==='number'&&Number.isFinite(data.tls.daysRemaining)?data.tls.daysRemaining:null;notes.push('The TLS certificate was verified for this connection.');if(days!==null)notes.push(days<0?'The certificate appears expired by '+Math.abs(Math.round(days))+' day'+(Math.abs(Math.round(days))===1?'':'s')+'.':'The certificate expires in about '+Math.round(days)+' day'+(Math.round(days)===1?'':'s')+'.');notes.push('A valid certificate alone does not establish that the site is trustworthy.');}
  }
  if(data.measurement&&data.mode!=='ping'&&data.mode!=='traceroute'){
    const m=data.measurement;if(m.error)notes.push('The remote '+(data.mode||'measurement')+' probe reported: '+clean(m.error)+'.');
  }
  return notes.length?notes:['No diagnostic details are available for this result.'];
}

export function buildExport(data,format){
  const lines=[];
  const isSample=data?.sample===true;
  if(format==='json'){let text;try{text=JSON.stringify(data,null,2);}catch{text='Unavailable';}return text;}
  lines.push('Smithey Lab Network Check \u2014 text export');
  if(isSample)lines.push('SAMPLE DATA: this output was not produced by a live measurement.');
  lines.push('Mode: '+String(data?.mode||'Unknown'));
  lines.push('Target: '+String(data?.host||'Unknown'));
  lines.push('Timestamp: '+stamp(data));
  lines.push('Probe location: '+String(data?.region||'Unknown'));
  if(data?.address)lines.push('Resolved address: '+String(data.address));
  lines.push('');
  if(data?.dns)lines.push('DNS records: '+JSON.stringify(data.dns));
  if(data?.tcp)lines.push('TCP: port '+String(data.tcp.port)+', successful '+String(data.tcp.successful)+'/'+String(data.tcp.total)+', average '+(num(data.tcp.averageMs)===null?'no successful connections':num(data.tcp.averageMs).toFixed(1)+' ms'));
  if(data?.http)lines.push('HTTP: '+(data.http.error?String(data.http.error):'status '+String(data.http.status)+' in '+String(data.http.ms)+' ms'));
  if(data?.http?.headers)for(const [name,value] of Object.entries(data.http.headers).slice(0,64))lines.push('HTTP header '+bound(name)+': '+bound(value));
  if(data?.tls)lines.push('TLS: '+(data.tls.error?String(data.tls.error):'verified, expires '+String(data.tls.validTo)+', days remaining '+String(data.tls.daysRemaining)));
  if(data?.tls&&!data.tls.error)for(const key of ['protocol','subject','issuer','validFrom'])if(data.tls[key])lines.push('TLS '+key+': '+bound(data.tls[key]));
  lines.push('');
  const m=data?.measurement;
  if(m){
    lines.push('Measurement status: '+String(m.status||'Unknown'));
    if(m.error)lines.push('Measurement error: '+clean(m.error));
    const results=Array.isArray(m.results)?m.results.slice(0,1):[];
    for(const entry of results){
      const probe=[entry.probe?.city,entry.probe?.country,entry.probe?.network].filter(Boolean).join(' / ');
      if(probe)lines.push('Probe: '+clean(probe));
      const raw=entry.result?.rawOutput;
      if(typeof raw==='string'&&raw.length)lines.push('Raw measurement output:',clean(raw),'');
      const hops=Array.isArray(entry.result?.hops)?entry.result.hops.slice(0,64):[];
      for(let i=0;i<hops.length;i++){
        const hop=hops[i];const times=(Array.isArray(hop?.timings)?hop.timings.slice(0,100):[]).map(t=>num(t?.rtt)).filter(v=>v!==null);
        const name=hop?.resolvedHostname||hop?.resolvedAddress||'';
        lines.push((i+1)+'. '+(name?clean(name):'No address returned')+(times.length?' \u2014 mean '+ (times.reduce((a,b)=>a+b,0)/times.length).toFixed(1)+' ms':(hop?.timings? ' \u2014 no reply received':' \u2014 no timing measured')));
      }
    }
  }
  lines.push('','Insights:');
  for(const note of describe(data))lines.push('\u2022 '+clean(note));
  const text=lines.map(bound).join('\n');
  return text.length>100000?text.slice(0,100000)+'\n[truncated]':text;
}
