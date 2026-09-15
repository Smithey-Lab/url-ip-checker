const {test}=require('node:test');
const assert=require('node:assert/strict');
test('trace normalization preserves unanswered hops, zero RTT and IPv6 addresses',async()=>{
  const {traceHops}=await import('../src/trace-view.js');
  const hops=traceHops({hops:[{resolvedAddress:'2001:db8::1',timings:[{rtt:0},{rtt:2}]},{timings:[]},{timings:[{rtt:null},{rtt:'4'},{rtt:-1},{rtt:Infinity},{rtt:NaN}]}]});
  assert.deepEqual(hops.map(h=>h.average),[1,null,null]);assert.deepEqual(hops.map(h=>h.number),[1,2,3]);assert.equal(hops[0].address,'2001:db8::1');
});
test('malformed and oversized structured results are bounded without parsing raw text',async()=>{
  const {traceHops}=await import('../src/trace-view.js');
  assert.deepEqual(traceHops({rawOutput:'1 192.0.2.1 4 ms'}),[]);
  assert.deepEqual(traceHops({hops:{}}),[]);
  const hops=traceHops({hops:Array(1000).fill({resolvedHostname:'x'.repeat(1000),timings:Array(1000).fill({rtt:5})})});
  assert.equal(hops.length,64);assert.equal(hops[0].timings.length,100);assert.equal(hops[0].hostname.length,250);
});
test('sample is explicitly labeled and cannot be mistaken for a pollable measurement',async()=>{
  const {sampleTrace,traceHops}=await import('../src/trace-view.js');const data=sampleTrace();
  assert.equal(data.sample,true);assert.equal(data.measurement.id,undefined);assert.match(data.measurement.results[0].result.rawOutput,/ILLUSTRATIVE SAMPLE/);assert.equal(traceHops(data.measurement.results[0].result).length,8);
});
