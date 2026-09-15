'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publicIP,parseTarget,networkKey,resolveTarget,pinnedLookup,diagnose,startMeasurement,reservation,createHandler}=require('./checker.cjs');
const env={ALLOWED_ORIGINS:'https://smitheylab.com',CHECKER_ENABLED:'true'};
const event=(input={target:'smitheylab.com',mode:'overview'},sourceIp='8.8.8.8')=>({headers:{origin:'https://smitheylab.com','content-type':'application/json'},body:JSON.stringify(input),requestContext:{http:{method:'POST',sourceIp}}});
const rejected=()=>Object.assign(new Error('limit'),{name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'}]});
test('public address policy blocks private, special, encoded and transition addresses',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','0.0.0.0','100.100.100.200','169.254.169.254','172.31.0.1','192.168.1.1','192.0.0.5','192.0.2.1','198.19.1.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1','fe80::1','ff02::1','64:ff9b::a00:1','2002:0808:0808::1','2001::1','2001:db8::1','3fff::1'])assert.equal(publicIP(ip),false,ip);
  for(const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(publicIP(ip),true,ip);
  for(const target of ['http://2130706433','http://0177.0.0.1','http://0x7f000001','localhost','http://[::1]','http://a@8.8.8.8','https://x.com:444','ftp://x.com','http://8.8.8.8\\@127.0.0.1','x.local','-bad.com','x.com;whoami'])assert.throws(()=>parseTarget(target),target);
});
test('target normalization strips query/path and supports IPv6 and trailing dot',()=>{
  assert.deepEqual(parseTarget('https://SMITHEYLAB.com/a?secret=yes#hash'),{host:'smitheylab.com',protocol:'https:',port:443,origin:'https://smitheylab.com',pathIgnored:true});
  assert.equal(parseTarget('2606:4700:4700::1111').host,'2606:4700:4700::1111');assert.equal(parseTarget('smitheylab.com.').host,'smitheylab.com');
});
test('IPv6 grouping and mapped IPv4 cannot split network quotas',()=>{
  assert.equal(networkKey('2606:4700:1234:5678::1'),networkKey('2606:4700:1234:5678:abcd::2'));
  assert.equal(networkKey('::ffff:8.8.8.8'),'8.8.8.8');assert.equal(networkKey('::ffff:808:808'),'8.8.8.8');assert.throws(()=>networkKey('unknown'));
});
test('mixed DNS public/private answers and incomplete DNS checks fail closed',async()=>{
  let cancelled=0;
  const resolver={resolve4:async()=>['8.8.8.8'],resolve6:async()=>['::1'],cancel:()=>cancelled++};
  await assert.rejects(resolveTarget(parseTarget('smitheylab.com'),resolver),/restricted/);assert.equal(cancelled,1);
  resolver.resolve6=async()=>{throw Object.assign(new Error(),{code:'ETIMEOUT'});};await assert.rejects(resolveTarget(parseTarget('smitheylab.com'),resolver),/failed/);
  resolver.resolve6=async()=>{throw Object.assign(new Error(),{code:'ENODATA'});};assert.deepEqual((await resolveTarget(parseTarget('smitheylab.com'),resolver)).addresses,['8.8.8.8']);
});
test('outbound DNS lookup is pinned in both Node callback formats',()=>{
  const lookup=pinnedLookup('8.8.8.8');lookup('rebound.example',{},(e,address,family)=>{assert.equal(e,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  lookup('rebound.example',{all:true},(e,addresses)=>assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]));
});
test('diagnostics revalidate destination, select one address, and isolate probe modes',async()=>{
  let calls=[];const deps={resolve:async()=>({addresses:['8.8.8.8','1.1.1.1'],records:{}}),tcp:async(...args)=>{calls.push(args);return{};},measurement:async(...args)=>{calls.push(args);return{id:'id'};}};
  await diagnose(parseTarget('x.com'),'tcp',deps);assert.deepEqual(calls,[['8.8.8.8',443]]);
  calls=[];await diagnose(parseTarget('x.com'),'traceroute',deps);assert.deepEqual(calls,[['8.8.8.8','traceroute']]);
  deps.resolve=async()=>({addresses:['127.0.0.1'],records:{}});await assert.rejects(diagnose(parseTarget('x.com'),'tcp',deps));
});
test('Globalping request fixes destination, one probe, packets, timeout, and has no paid credentials',async()=>{
  for(const mode of ['ping','traceroute']){
    const result=await startMeasurement('8.8.8.8',mode,async(url,options)=>{assert.equal(url,'https://api.globalping.io/v1/measurements');const body=JSON.parse(options.body);assert.equal(body.target,'8.8.8.8');assert.equal(body.limit,1);assert.equal(body.timeout,20);assert.deepEqual(body.locations,[{country:'US'}]);assert.equal(body.measurementOptions.protocol,'ICMP');assert.equal(options.headers.Authorization,undefined);if(mode==='ping')assert.equal(body.measurementOptions.packets,3);return{ok:true,json:async()=>({id:'abc123'})};});assert.equal(result.id,'abc123');
  }
  const denied=await startMeasurement('8.8.8.8','ping',async()=>({ok:false,status:429,body:{cancel:async()=>{}}}));assert.match(denied.error,/quota/);
});
test('handler validates input and never runs networking before rate reservation',async()=>{
  let reservations=0,runs=0;
  const handler=createHandler({env,reserve:async()=>{reservations++;throw rejected();},run:async()=>{runs++;}});
  assert.equal((await handler(event())).statusCode,429);assert.equal(reservations,1);assert.equal(runs,0);
  for(const invalid of [{target:'127.0.0.1',mode:'ping'},{target:'x.com',mode:'shell'},null])assert.equal((await handler(event(invalid))).statusCode,400);
  const spoof=event();spoof.headers.origin='https://evil.test';assert.equal((await handler(spoof)).statusCode,403);
  assert.equal(reservations,1);
  const unavailable=createHandler({env,reserve:async()=>{throw new Error('offline');},run:async()=>runs++});assert.equal((await unavailable(event())).statusCode,503);assert.equal(runs,0);
});
test('trusted source IP only, switch off, malformed/base64/oversized requests',async()=>{
  const digests=[];const handler=createHandler({env,reserve:async r=>digests.push(r.digest),run:async()=>({ok:true}),now:()=>172800000});
  const a=event();a.headers['x-forwarded-for']='1.1.1.1';const b=event();b.headers['x-forwarded-for']='9.9.9.9';await handler(a);await handler(b);assert.equal(digests[0],digests[1]);
  const encoded=event();encoded.body=Buffer.from(encoded.body).toString('base64');encoded.isBase64Encoded=true;assert.equal((await handler(encoded)).statusCode,200);
  const big=event();big.body='x'.repeat(4097);assert.equal((await handler(big)).statusCode,413);
  const broken=event();broken.body='{';assert.equal((await handler(broken)).statusCode,400);
  const off=createHandler({env:{...env,CHECKER_ENABLED:'false'},reserve:()=>assert.fail('must not charge'),run:()=>assert.fail()});assert.equal((await off(event())).statusCode,503);
});
// Interpret the exact transaction emitted to DynamoDB, including atomic rollback.
function limiter(){const items=new Map();return (digest,seconds,mode)=>{
  const updates=reservation('table',digest,seconds,mode).TransactItems.map(x=>x.Update);
  for(const u of updates){const old=items.get(u.Key.id.S)||{};const values=u.ExpressionAttributeValues;if(values[':limit']&&old.count>=Number(values[':limit'].N))throw rejected();if(values[':now']&&old.allowedAfter>Number(values[':now'].N))throw rejected();}
  for(const u of updates){const old=items.get(u.Key.id.S)||{};const v=u.ExpressionAttributeValues;items.set(u.Key.id.S,{...old,...(v[':one']?{count:(old.count||0)+1}:{allowedAfter:Number(v[':next'].N)})});}
};}
test('atomic limits enforce cooldowns, hourly network caps, shared probe cap and UTC rollover',()=>{
  const reserve=limiter();reserve('a',100,'ping');assert.throws(()=>reserve('a',110,'overview'));reserve('a',130,'traceroute');
  for(let i=0;i<3;i++)reserve('a',160+i*30,'ping');assert.throws(()=>reserve('a',300,'traceroute'));
  for(let i=0;i<15;i++)reserve('a',400+i*10,'overview');assert.throws(()=>reserve('a',600,'overview'));reserve('a',3700,'overview');
  const all=limiter();for(let i=0;i<1000;i++)all('user'+i,100,'overview');assert.throws(()=>all('other',200,'overview'));all('other',86400,'overview');
  const probes=limiter();for(let i=0;i<100;i++)probes('user'+i,100,'ping');assert.throws(()=>probes('other',200,'traceroute'));for(let i=0;i<100;i++)probes('next'+i,3700,'traceroute');assert.throws(()=>probes('last',7300,'ping'));
});

