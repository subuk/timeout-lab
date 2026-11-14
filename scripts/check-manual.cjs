// Exercise the real Go/WASM bridge and Worker controller, including offline packaging.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const dist = path.resolve(__dirname, '../dist');
async function check(source, offline) {
  let message, tick;
  const context = vm.createContext({
    console, WebAssembly, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    performance, crypto:webcrypto, setTimeout, clearTimeout, atob,
    setInterval(fn){tick=fn;},
    postMessage(value){message=structuredClone(value);},
    fetch:async url=>{
      assert.equal(offline,false,'offline worker must not fetch');
      const bytes=fs.readFileSync(path.join(dist,url.split('?')[0]));
      return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
    }
  });
  context.self=context;
  context.importScripts=url=>vm.runInContext(fs.readFileSync(path.join(dist,url.split('?')[0]),'utf8'),context);
  vm.runInContext(source,context);
  for(let i=0;i<200&&!message;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(message?.type,'snapshot',message?.message);
  const send=data=>{context.onmessage({data});assert.notEqual(message.type,'error',message.message);return message;};
  send({type:'mode',manual:true,requestId:17});assert.equal(message.paused,true);assert.equal(message.requestId,17);
  tick();assert.equal(message.requestId,undefined);
  const config=message.data.config;config.jitter=0;
  send({type:'reset',config});assert.equal(message.data.manualMode,true);
  tick();assert.equal(message.data.t,0);
  send({type:'request',request:{weight:2,deadline:3000,labels:{custom:'<kept verbatim>'}}});
  assert.equal(message.paused,false);assert.equal(message.data.focus.end,-1);
  send({type:'step',ms:10,requestId:18});assert.equal(message.requestId,18);assert.equal(message.paused,true);assert.equal(message.data.t,10);
  send({type:'pause',requestId:19});assert.equal(message.requestId,19);
  send({type:'speed',value:1,requestId:20});assert.equal(message.requestId,20);
  for(let i=0;i<100&&message.data.focusRunning;i++)tick();
  assert.equal(message.data.focus.ok,true);assert.equal(message.paused,true);
  assert.equal(message.data.metrics.arrivals,1);
  assert.equal(message.data.focus.weight,2);
  assert.equal(message.data.focus.labels.custom,'<kept verbatim>');
  assert.ok(message.data.focus.events.some(e=>e.kind==='Resource visit'));
  const before=message.data.t;tick();assert.equal(message.data.t,before);
  send({type:'request',request:{weight:1,deadline:1,labels:{}}});
  tick();assert.equal(message.data.focus.reason,'client_deadline');assert.equal(message.paused,true);
  context.onmessage({data:{type:'request',request:{weight:0,deadline:100}}});
  assert.equal(message.type,'error');
  send({type:'snapshot'});assert.equal(message.paused,true);
  const snapshot=JSON.stringify(message.data);
  for(const field of ['edges','join','quorum']){
    const invalid=structuredClone(message.data.config);invalid.groups[0][field]=field==='edges'?[]:field==='join'?'all':1;
    context.onmessage({data:{type:'reset',config:invalid,requestId:99}});
    assert.equal(message.type,'error');assert.equal(message.requestId,99);assert.match(message.message,/unknown field/);
    send({type:'snapshot'});assert.equal(JSON.stringify(message.data),snapshot,'invalid import changed the experiment');
  }
  for(const preset of ['normal','slow','fanout','hang','autoscale','az','numa','composition','lamp']){
    send({type:'preset',preset});assert.equal(message.data.config.version,2);assert.equal(message.data.config.rps,preset==='lamp'?120:30);
    const walk=box=>{assert.ok(Array.isArray(box.stages));assert.equal(box.edges,undefined);assert.equal(box.join,undefined);for(const stage of box.stages){assert.ok(stage.calls.length>0);assert.equal(stage.resource,undefined);assert.equal(stage.downstream,undefined);for(const call of stage.calls)assert.ok(['network','ideal'].includes(call.transport));}for(const child of box.resources||[])walk(child);};
    message.data.config.groups.forEach(walk);
  }
  send({type:'preset',preset:'numa'});assert.equal(message.data.manualMode,true);assert.equal(message.data.focus,undefined);
  send({type:'mode',manual:false});send({type:'pause'});tick();
  assert.ok(message.data.metrics.arrivals>0);
  console.log(`${offline?'Standalone embedded':'HTTP'} Worker: manual request, exact inputs, events, step, auto-pause, timeout, validation, preset and load mode OK`);
}
(async()=>{
  await check(fs.readFileSync(path.join(dist,'worker.js'),'utf8'),false);
  const html=fs.readFileSync(path.join(dist,'standalone.html'),'utf8');
  const bootstrap=html.match(/<script>(window.LAB_WORKER_URL=.*?)<\/script>/s)?.[1];
  assert.ok(bootstrap,'standalone worker bootstrap missing');
  let offlineSource;
  vm.runInNewContext(bootstrap,{window:{},URL:{createObjectURL:()=>''},Blob:class{constructor(parts){offlineSource=parts.join('');}}});
  await check(offlineSource,true);
})().catch(error=>{console.error(error);process.exitCode=1;});
