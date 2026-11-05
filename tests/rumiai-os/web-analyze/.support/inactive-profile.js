'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {startWebAnalyze} = require(path.join(process.argv[2],
  'lib/sys/js/web-analyze.lib.js'));
const {captureRestEvidence} = require(path.join(process.argv[2],
  'lib/sys/js/web-analyze-rest.lib.js'));
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));

function browserConnection(url) {
  return new Promise((resolve,reject) => {
    const ws = new WebSocket(url);
    let next = 0;
    const pending = new Map();
    ws.addEventListener('error',reject,{once:true});
    ws.addEventListener('open',()=>resolve({
      send(method,params={},sessionId) {
        return new Promise((resolve,reject) => {
          const id=++next;
          const timer=setTimeout(()=>{
            pending.delete(id);reject(Error('Fixture CDP timeout '+method));
          },8000);
          pending.set(id,{resolve,reject,timer});
          ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
        });
      },
      close(){ws.close();}
    }),{once:true});
    ws.addEventListener('message',e=>{
      let m;try{m=JSON.parse(e.data);}catch(_){return;}
      const p=pending.get(m.id);
      if(!p)return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if(m.error)p.reject(Error(m.error.message));
      else p.resolve(m.result||{});
    });
  });
}

async function endpoint(profile) {
  for(let i=0;i<150;i++) {
    try{
      const [port,route]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),
        'utf8').trim().split(/\r?\n/);
      if(/^\d+$/.test(port)&&route?.startsWith('/devtools/browser/'))
        return 'ws://127.0.0.1:'+port+route;
    }catch(e){if(e.code!=='ENOENT')throw e;}
    await pause(100);
  }
  throw Error('Fixture Chromium DevToolsActivePort unavailable');
}

async function site() {
  let scriptRequests=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/idle-worker.js') {
      scriptRequests++;
      res.setHeader('Content-Type','application/javascript');
      return res.end('self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));'+
        'self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));');
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const seed=req.url==='/seed';
    res.end('<!doctype html><html><body><h1>ServiceWorker profile fixture</h1>'+
      (seed?'<script>navigator.serviceWorker.register("/idle-worker.js",'+
        '{scope:"/idle/"}).then(()=>document.body.dataset.registered="yes")'+
        '.catch(()=>document.body.dataset.registered="no");</script>':'')+
      '</body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,scriptRequests:()=>scriptRequests,
    origin:'http://127.0.0.1:'+server.address().port};
}

async function seed(profile,origin,requests) {
  const args=['--headless=new','--no-first-run','--no-default-browser-check',
    '--no-proxy-server','--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0','--user-data-dir='+profile,origin+'/seed'];
  if(typeof process.getuid==='function' && process.getuid()===0)
    args.unshift('--no-sandbox');
  const child=spawn('chromium',args,{stdio:['ignore','ignore','pipe']});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  let stderr='';
  child.stderr.on('data',x=>{stderr+=x.toString().slice(0,2048);});
  let connection;
  try {
    connection=await browserConnection(await endpoint(profile));
    let target;
    for(let i=0;i<80;i++) {
      target=(await connection.send('Target.getTargets')).targetInfos.find(
        t=>t.type==='page' && t.url?.startsWith(origin+'/seed'));
      if(target)break;
      await pause(100);
    }
    assert(target,'Pre-seed navigation failed (Chromium did not open fixture page)');
    const {sessionId}=await connection.send('Target.attachToTarget',
      {targetId:target.targetId,flatten:true});
    assert(sessionId,'Pre-seed frame attachment missing');
    await connection.send('Runtime.enable',{},sessionId);
    let state;
    for(let i=0;i<75;i++) {
      const result=await connection.send('Runtime.evaluate',{
        expression:'(async()=>{const regs=await navigator.serviceWorker.getRegistrations();'+
          'return {origin:location.origin,secure:isSecureContext,'+
          'registrationReady:document.body.dataset.registered||"pending",'+
          'registrations:regs.map(r=>({scope:r.scope,active:r.active?.scriptURL||null,'+
          'installing:r.installing?.scriptURL||null}))};})()',
        returnByValue:true,awaitPromise:true},sessionId);
      state=result.result?.value;
      if(result.exceptionDetails)
        throw Error('Pre-seed read-only registration query failed: '+
          result.exceptionDetails.text);
      if(state?.registrations?.some(r=>
        r.scope===origin+'/idle/' && r.active===origin+'/idle-worker.js'))
        break;
      await pause(120);
    }
    assert(state?.registrations?.some(r=>
      r.scope===origin+'/idle/' && r.active===origin+'/idle-worker.js'),
      'Pre-seed registration never activated: '+
      JSON.stringify({secure:state?.secure,registrationReady:state?.registrationReady,
        scripts:requests(),registrations:state?.registrations?.length}));
    assert(requests()>0,'No actual Chromium worker script request during pre-seed');
    console.log('Independent Chromium profile seed: activated persistent registration');
    await connection.send('Browser.close').catch(()=>{});
    await Promise.race([exited,pause(8000).then(()=>{child.kill('SIGKILL');})]);
    await exited;
  } finally {
    connection?.close();
    child.kill('SIGKILL');
  }
  // Chromium sometimes leaves its ephemeral debugging endpoint after exit.
  fs.rmSync(path.join(profile,'DevToolsActivePort'),{force:true});
}

async function observe(profile,origin,outputDir) {
  let session;
  try {
    session=await startWebAnalyze({url:origin+'/inspect',outputDir,profileDir:profile,
      headless:true,timeoutMs:20000});
    let observed=false;
    for(let attempt=0;attempt<45;attempt++) {
      const reply=await session.sendPage('Runtime.evaluate',{
        expression:'(async()=>{if(location.pathname!=="/inspect")return null;'+
          'const regs=await navigator.serviceWorker.getRegistrations();'+
          'return regs.map(r=>({scope:r.scope,active:r.active?.scriptURL||null}));})()',
        returnByValue:true,awaitPromise:true},5000);
      if(Array.isArray(reply?.result?.value) &&
        reply.result.value.some(r=>
          r.scope===origin+'/idle/' && r.active===origin+'/idle-worker.js')) {
        observed=true;break;
      }
      await pause(120);
    }
    assert(observed,'Reopened Chromium profile lost the activated registration');
    await captureRestEvidence(session,outputDir);
  } finally {
    if(session)await session.stop();
  }
  const evidence=JSON.parse(fs.readFileSync(
    path.join(outputDir,'rest/worker-provenance/index.json'),'utf8'));
  const registration=evidence.browserRegistrations.find(r=>
    r.scopeURL===origin+'/idle/');
  assert(registration,'No persistent ServiceWorker in frozen browser evidence');
  assert.equal(registration.activeScriptURL,origin+'/idle-worker.js');
  assert.equal(registration.status,'registered-worker-stopped',
    'Persisted ServiceWorker was not CDP-confirmed stopped: '+
    JSON.stringify({state:registration.status,running:registration.runningStatus,
      version:!!registration.versionId,live:registration.workerTargetLiveAtRest}));
  assert.equal(registration.workerTargetLiveAtRest,false);
  assert(evidence.versions.some(v=>v.versionId===registration.versionId &&
    v.registrationObserved && v.runningStatus==='stopped'));
  const outbound=fs.readFileSync(path.join(outputDir,'cdp-wire.jsonl'),'utf8')
    .split('\n').filter(Boolean).map(JSON.parse)
    .filter(row=>row.direction==='outbound').map(row=>JSON.parse(row.raw).method);
  assert(outbound.filter(method=>method?.startsWith('ServiceWorker.'))
    .every(method=>method==='ServiceWorker.enable'),
    'Analyzer must not control ServiceWorker lifecycle');
  console.log('Persistent activated ServiceWorker observed stopped after Chromium restart');
}

async function main() {
  assert(typeof WebSocket==='function','Node 22 WebSocket is required');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'web-analyze-idle-profile-'));
  const fixture=await site();
  try {
    const profile=path.join(work,'profile');
    await seed(profile,fixture.origin,fixture.scriptRequests);
    await observe(profile,fixture.origin,path.join(work,'rest-analysis'));
  } finally {
    fixture.server.closeAllConnections();
    fixture.server.close();
    fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:350});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
