const assert=require('node:assert');
const test=require('node:test');
const {describe,buildExport}=require('../src/insights.js');
const join=notes=>notes.join(' ');

test('incomplete sample is labeled and produces no invented measurements',()=>{
  const data={sample:true,mode:'traceroute',host:'demo.example',address:'203.0.113.80',region:'Sample region',checkedAt:new Date().toISOString(),measurement:{status:'in-progress',results:[]}};
  const notes=join(describe(data));
  assert.match(notes,/Sample display data only/i);
  assert.match(notes,/still running/i);
  assert.doesNotMatch(notes,/%|packet loss/i);
  assert.doesNotMatch(notes,/latency added|bottleneck/i);
  const text=buildExport(data,'text');
  assert.match(text,/SAMPLE DATA/);
  assert.match(text,/Mode: traceroute/);
  assert.match(text,/Target: demo.example/);
  assert.match(text,/Measurement status: in-progress/);
  assert.ok(text.length<20000);
});

test('zero rtt samples are reported as zero without inventing loss',()=>{
  const data={mode:'ping',host:'target.example',checkedAt:'2024-01-02T03:04:05.000Z',measurement:{status:'finished',results:[{result:{status:'finished',timings:[{rtt:0},{rtt:0}]}}]}};
  const notes=join(describe(data));
  assert.match(notes,/2 round-trip timing samples/);
  assert.match(notes,/minimum of 0\.0 ms/);
  assert.doesNotMatch(notes,/packet loss/i);
  const text=buildExport(data,'text');
  assert.match(text,/Timestamp: 2024-01-02T03:04:05\.000Z/);
  assert.match(text,/Insights:/);
});

test('invalid and negative measurement fields are ignored safely',()=>{
  const data={mode:'ping',host:'x.example',checkedAt:'not-a-date',measurement:{status:'finished',results:[{result:{status:'finished',timings:[{rtt:-5},{rtt:'twelve'},{rtt:null}]}}]}};
  const notes=join(describe(data));
  assert.match(notes,/No numeric round-trip timing/);
  assert.doesNotMatch(notes,/%/);
  const text=buildExport(data,'text');
  assert.match(text,/Timestamp: Unknown time/);
  assert.doesNotMatch(text,/NaN/);
});

test('tcp, http, tls and traceroute insights stay conservative',()=>{
  const data={mode:'traceroute',host:'t.example',address:'198.51.100.9',region:'Test probe',checkedAt:'2024-05-06T07:08:09.000Z',dns:{A:'198.51.100.9'},tcp:{port:443,total:4,successful:0,averageMs:null,samples:[]},http:{status:503,ms:10,headers:{}},tls:{protocol:'TLSv1.3',subject:'CN=t.example',issuer:'CN=Test',validFrom:'2024-01-01',validTo:'2024-12-31',daysRemaining:12},measurement:{status:'finished',results:[{probe:{city:'Testville',country:'US',network:'ExampleNet'},result:{status:'finished',resolvedAddress:'198.51.100.9',rawOutput:'1  192.0.2.1  1.0 ms\n2  * * *',hops:[{resolvedAddress:'192.0.2.1',timings:[{rtt:1.0}]},{resolvedAddress:null,timings:[]}]}}]}};
  const notes=join(describe(data));
  const overview=join(describe({...data,mode:'overview'}));
  assert.match(overview,/No TCP connection to port 443 completed successfully/);
  assert.match(overview,/not interpreted as packet loss/);
  assert.match(notes,/1 hop returned a measured round-trip time and 1 hop did not return a timing/);
  assert.match(overview,/valid certificate alone does not establish that the site is trustworthy/i);
  assert.doesNotMatch(notes,/geograph|country of origin|link latency/i);
  const text=buildExport(data,'text');
  assert.match(text,/Raw measurement output:/);
  assert.match(text,/1\. 192\.0\.2\.1/);
  assert.match(text,/Probe location: Test probe/);
});

test('DNS-only results do not invent missing TCP checks and 304 is not a redirect',()=>{
  assert.doesNotMatch(join(describe({mode:'dns',dns:{A:['203.0.113.5']}})),/No TCP/);
  assert.doesNotMatch(join(describe({mode:'http',http:{status:304}})),/redirect/);
  assert.match(join(describe({mode:'http',http:{status:302}})),/redirect/);
});

test('text export labels truncation while JSON preserves original data',()=>{
  const data={mode:'traceroute',host:'x'.repeat(5000),measurement:{results:[{result:{rawOutput:'line\n'.repeat(3000)}}]}};
  const text=buildExport(data,'text');
  assert.match(text,/\[truncated\]/);
  assert.ok(text.length<100100);
  assert.deepEqual(JSON.parse(buildExport(data,'json')),data);
});
