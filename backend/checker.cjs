'use strict';
const { createHash } = require('node:crypto');
const { isIP, BlockList, connect } = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const { Resolver } = require('node:dns').promises;

// Conservative public-address policy. IPv6 transition mechanisms are excluded.
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blocked.addSubnet(address,prefix,'ipv6');
function publicIP(address) {
  const family=isIP(address);
  return family===4 ? !blocked.check(address,'ipv4') : family===6 && global6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
function parseTarget(value) {
  // Reject control characters in submitted targets.
  // eslint-disable-next-line no-control-regex
  if (typeof value!=='string' || value.length>2048 || /[\s\\\x00-\x1f]/.test(value.trim())) throw new Error('Enter a public hostname, IP address, or HTTP(S) URL.');
  let raw=value.trim();
  if (isIP(raw)===6) raw=`[${raw}]`;
  let url; try { url=new URL(raw.includes('://')?raw:`https://${raw}`); } catch { throw new Error('Enter a valid hostname, IP address, or URL.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Use HTTP or HTTPS on its standard port, without credentials.');
  const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  if (isIP(host)) { if (!publicIP(host)) throw new Error('Only public internet addresses can be checked.'); }
  else if (host.length>253 || !host.includes('.') || !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || /\.(localhost|local|internal|test|invalid|example|home|lan|onion)$/.test(host)) throw new Error('Enter a public internet hostname.');
  return {host, protocol:url.protocol, port:url.protocol==='https:'?443:80, origin:`${url.protocol}//${isIP(host)===6?`[${host}]`:host}`, pathIgnored:url.pathname!=='/' || !!url.search || !!url.hash};
}
function networkKey(ip) {
  if (isIP(ip)===4) return ip;
  if (isIP(ip)!==6) throw new Error('Invalid source');
  let value=ip.toLowerCase();
  if(value.includes('.')) {const i=value.lastIndexOf(':');const b=value.slice(i+1).split('.').map(Number);value=value.slice(0,i+1)+((b[0]<<8)|b[1]).toString(16)+':'+((b[2]<<8)|b[3]).toString(16);}
  const [a,b]=value.split('::'),left=a?a.split(':'):[],right=b?b.split(':'):[];
  const groups=value.includes('::')?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  const n=groups.map(x=>parseInt(x,16));
  if(n.slice(0,5).every(x=>x===0)&&n[5]===65535)return `${n[6]>>8}.${n[6]&255}.${n[7]>>8}.${n[7]&255}`;
  return n.slice(0,4).map(x=>x.toString(16)).join(':')+'::/64';
}
async function resolveTarget(target, resolver=new Resolver({timeout:1500,tries:1})) {
  if (isIP(target.host)) return {addresses:[target.host],records:{},note:'An IP literal does not require forward DNS.'};
  const timer=setTimeout(()=>resolver.cancel(),2000);
  try {
    const results=await Promise.allSettled([resolver.resolve4(target.host),resolver.resolve6(target.host)]);
    for(const result of results) if(result.status==='rejected' && !['ENODATA','ENOTFOUND'].includes(result.reason.code)) throw new Error('DNS lookup timed out or failed.');
    const addresses=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
    if(!addresses.length) throw new Error('No public A or AAAA records found.');
    if(addresses.length>32 || addresses.some(ip=>!publicIP(ip))) throw new Error('This hostname resolves to a restricted address and cannot be checked.');
    return {addresses,records:{A:addresses.filter(ip=>isIP(ip)===4),AAAA:addresses.filter(ip=>isIP(ip)===6)}};
  } finally {clearTimeout(timer);resolver.cancel();}
}
async function extraDNS(host) {
  if(isIP(host))return {};
  const resolver=new Resolver({timeout:1500,tries:1});
  const timer=setTimeout(()=>resolver.cancel(),2000);
  try {
    const types=['MX','NS','TXT','CAA'];
    const results=await Promise.allSettled(types.map(type=>resolver.resolve(host,type)));
    return Object.fromEntries(results.map((r,i)=>[types[i],r.status==='fulfilled'?r.value.slice(0,12).map(v=>JSON.stringify(v).slice(0,400)):['No records or lookup unavailable']]));
  } finally {clearTimeout(timer);resolver.cancel();}
}
const errorText=error=>({ECONNREFUSED:'Connection refused',ENETUNREACH:'Network unreachable from this probe',EHOSTUNREACH:'Host unreachable',ETIMEDOUT:'Timed out',CERT_HAS_EXPIRED:'TLS certificate has expired',ERR_TLS_CERT_ALTNAME_INVALID:'TLS certificate does not match the hostname',DEPTH_ZERO_SELF_SIGNED_CERT:'Self-signed TLS certificate',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'TLS certificate chain could not be verified'}[error.code]||'Connection or TLS verification failed');
function tcpSample(address,port) {
  return new Promise(resolve=>{
    const start=performance.now();let done=false;
    const socket=connect({host:address,port});
    const timer=setTimeout(()=>finish({error:'Timed out'}),1500);
    function finish(value){if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);}
    socket.once('connect',()=>finish({ms:Math.round((performance.now()-start)*10)/10}));
    socket.once('error',error=>finish({error:errorText(error)}));
  });
}
async function tcpProbe(address,port) {
  const samples=[];for(let i=0;i<3;i++)samples.push(await tcpSample(address,port));
  const ok=samples.filter(s=>Number.isFinite(s.ms));
  return {port,samples,successful:ok.length,total:3,averageMs:ok.length?Math.round(ok.reduce((sum,s)=>sum+s.ms,0)/ok.length*10)/10:null};
}
function pinnedLookup(address) {return (_host,options,callback)=>options?.all?callback(null,[{address,family:isIP(address)}]):callback(null,address,isIP(address));}
function httpProbe(target,address) {
  return new Promise(resolve=>{
    const start=performance.now();let done=false;
    const req=(target.protocol==='https:'?https:http).request(`${target.origin}/`,{method:'HEAD',agent:false,lookup:pinnedLookup(address),maxHeaderSize:8192,headers:{'User-Agent':'SmitheyLab-Checker/1.0','Accept':'*/*','Connection':'close'}},res=>{
      const headers={};for(const key of ['content-type','server','location','strict-transport-security','x-content-type-options','content-security-policy'])if(res.headers[key])headers[key]=String(res.headers[key]).slice(0,500);
      finish({status:res.statusCode,ms:Math.round(performance.now()-start),headers,redirectFollowed:false});res.destroy();
    });
    const timer=setTimeout(()=>finish({error:'Timed out'}),3000);
    function finish(value){if(done)return;done=true;clearTimeout(timer);req.destroy();resolve(value);}
    req.once('error',error=>finish({error:errorText(error)}));req.end();
  });
}
function tlsProbe(target,address) {
  return new Promise(resolve=>{
    let done=false;
    const socket=tls.connect({host:address,port:443,servername:isIP(target.host)?undefined:target.host,rejectUnauthorized:true,checkServerIdentity:(_host,cert)=>tls.checkServerIdentity(target.host,cert)},()=>{
      const cert=socket.getPeerCertificate();
      finish({valid:true,protocol:socket.getProtocol(),issuer:cert.issuer?.O||cert.issuer?.CN||'Unknown',subject:cert.subject?.CN||target.host,validFrom:cert.valid_from,validTo:cert.valid_to,daysRemaining:Math.floor((Date.parse(cert.valid_to)-Date.now())/86400000)});
    });
    const timer=setTimeout(()=>finish({error:'Timed out'}),3000);
    function finish(value){if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);}
    socket.once('error',error=>finish({error:errorText(error)}));
  });
}
async function startMeasurement(address,mode,fetcher=fetch) {
  const response=await fetcher('https://api.globalping.io/v1/measurements',{method:'POST',redirect:'error',signal:AbortSignal.timeout(3500),headers:{'Content-Type':'application/json','User-Agent':'SmitheyLab-Checker/1.0 (https://smitheylab.com)','Accept-Encoding':'gzip'},body:JSON.stringify({type:mode,target:address,limit:1,locations:[{country:'US'}],timeout:20,inProgressUpdates:true,measurementOptions:{protocol:'ICMP',...(mode==='ping'?{packets:3}:{})}})});
  if(!response.ok){await response.body?.cancel();return {error:response.status===429?'The probe service has reached its free quota. Please try later.':'The probe service is unavailable. Please try later.'};}
  const body=await response.json();
  if(typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.id))return {error:'The probe service returned an invalid response.'};
  return {id:body.id,provider:'Globalping',status:'in-progress'};
}
async function diagnose(target,mode,{resolve=resolveTarget,tcp=tcpProbe,httpCheck=httpProbe,tlsCheck=tlsProbe,dns=extraDNS,measurement=startMeasurement}={}) {
  const resolved=await resolve(target);
  // Validate again at the connection boundary; never let a client supply the pinned address.
  if(!resolved.addresses.length || resolved.addresses.some(ip=>!publicIP(ip)))throw new Error('Restricted destination.');
  const address=resolved.addresses.find(ip=>isIP(ip)===4)||resolved.addresses[0];
  const result={host:target.host,origin:target.origin,pathIgnored:target.pathIgnored,address,addresses:resolved.addresses,mode,region:'AWS us-east-1 (Northern Virginia)',checkedAt:new Date().toISOString()};
  if(['ping','traceroute'].includes(mode)) {
    result.region='One US Globalping probe (location shown with results)';
    try {result.measurement=await measurement(address,mode);}catch {result.measurement={error:'The probe request could not be confirmed. Please try later; it is not retried automatically.'};}
    return result;
  }
  const jobs=[];
  if(['overview','dns'].includes(mode))jobs.push(dns(target.host).then(extra=>{result.dns={...resolved.records,...extra};}));
  if(['overview','tcp'].includes(mode))jobs.push(tcp(address,target.port).then(value=>{result.tcp=value;}));
  if(['overview','http'].includes(mode))jobs.push(httpCheck(target,address).then(value=>{result.http=value;}));
  if(['overview','tls'].includes(mode))jobs.push(tlsCheck(target,address).then(value=>{result.tls=value;}));
  await Promise.all(jobs);return result;
}
function reservation(table,digest,seconds,mode) {
  const counter=(id,limit,expires)=>({Update:{TableName:table,Key:{id:{S:id}},UpdateExpression:'SET expires = :expires ADD #count :one',ConditionExpression:'attribute_not_exists(#count) OR #count < :limit',ExpressionAttributeNames:{'#count':'count'},ExpressionAttributeValues:{':expires':{N:String(expires)},':one':{N:'1'},':limit':{N:String(limit)}}}});
  const probe=['ping','traceroute'].includes(mode);
  return {TransactItems:[counter(`checker:hour:${digest}:${Math.floor(seconds/3600)}`,20,seconds+7200),counter(`checker:day:${Math.floor(seconds/86400)}`,1000,seconds+172800),{Update:{TableName:table,Key:{id:{S:`checker:cooldown:${digest}`}},UpdateExpression:'SET allowedAfter = :next, expires = :expires',ConditionExpression:'attribute_not_exists(allowedAfter) OR allowedAfter <= :now',ExpressionAttributeValues:{':next':{N:String(seconds+(probe?30:10))},':now':{N:String(seconds)},':expires':{N:String(seconds+7200)}}}},...(probe?[counter(`checker:probe:ip:${digest}:${Math.floor(seconds/3600)}`,5,seconds+7200),counter(`checker:probe:hour:${Math.floor(seconds/3600)}`,100,seconds+7200),counter(`checker:probe:day:${Math.floor(seconds/86400)}`,200,seconds+172800)]:[])]};
}
function createHandler({reserve,run=diagnose,env=process.env,now=Date.now}) {
  const origins=new Set((env.ALLOWED_ORIGINS||'').split(','));
  return async event=>{
    const headers={'content-type':'application/json','cache-control':'no-store','vary':'Origin'};
    const origin=event.headers?.origin;
    if(origins.has(origin))headers['access-control-allow-origin']=origin;
    const respond=(statusCode,payload,extra={})=>({statusCode,headers:{...headers,...extra},body:JSON.stringify(payload)});
    if(env.CHECKER_ENABLED!=='true')return respond(503,{message:'The checker is temporarily paused.'});
    if(!origins.has(origin))return respond(403,{message:'Request not permitted.'});
    if(event.requestContext?.http?.method!=='POST')return respond(405,{message:'Use POST.'});
    if(!(event.headers?.['content-type']||'').toLowerCase().startsWith('application/json'))return respond(415,{message:'Use JSON.'});
    if(typeof event.body!=='string'||event.body.length>4096)return respond(413,{message:'Request too large.'});
    let input,target,network;
    try {
      input=JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body);
      if(!input||!['overview','dns','tcp','http','tls','ping','traceroute'].includes(input.mode))throw new Error('Choose a supported check.');
      target=parseTarget(input.target);network=networkKey(event.requestContext.http.sourceIp);
    }catch(error){return respond(400,{message:error instanceof SyntaxError?'Invalid request.':error.message});}
    const seconds=Math.floor(now()/1000),digest=createHash('sha256').update(`${Math.floor(seconds/86400)}:${network}`).digest('hex');
    try {await reserve({digest,seconds,mode:input.mode});}
    catch(error){
      if(error.name==='TransactionCanceledException'&&error.CancellationReasons?.some(r=>r.Code==='ConditionalCheckFailed'))return respond(429,{message:'Check limit reached. Limits: 20 checks/network/hour; ping and traceroute share 5/network/hour and a 30-second cooldown. Site-wide limits also apply. Try later.'},{'retry-after':'60'});
      return respond(503,{message:'The checker is temporarily unavailable. Please try later.'});
    }
    try {return respond(200,await run(target,input.mode));}
    catch {return respond(422,{message:'The hostname could not be resolved safely. It may have no address records, a DNS timeout, or a restricted address.'});}
  };
}
let handler;
exports.handler=async event=>{
  if(!handler){
    const {DynamoDBClient,TransactWriteItemsCommand}=require('@aws-sdk/client-dynamodb');
    const client=new DynamoDBClient({region:process.env.AWS_REGION,maxAttempts:1,requestHandler:{connectionTimeout:800,requestTimeout:1500}});
    handler=createHandler({reserve:({digest,seconds,mode})=>client.send(new TransactWriteItemsCommand(reservation(process.env.RATE_TABLE,digest,seconds,mode)))});
  }
  return handler(event);
};
Object.assign(exports,{publicIP,parseTarget,networkKey,resolveTarget,pinnedLookup,diagnose,startMeasurement,reservation,createHandler});

