'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root=process.argv[2];
const command=path.join(root,'bin/sys/web-analyze');

async function serve() {
  const server=http.createServer((req,res)=>{
    if (req.url==='/idle-worker.js') {
      res.setHeader('Content-Type','text/javascript');
      return res.end('self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));'+
        'self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));');
    }
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>Inactive worker</title><body>'+
      '<script>navigator.serviceWorker.register("/idle-worker.js",{scope:"/idle/"})'+
      '.then(()=>document.body.dataset.registered="yes")'+
      '.catch(()=>document.body.dataset.registered="no");'+
      // Keep the page hydrating until the external fixture has stopped worker.
      'let n=0;const t=setInterval(()=>{document.body.dataset.progress=String(++n);'+
      'if(n>=100){clearInterval(t);document.body.dataset.ready="yes"}},100);'+
      '</script></body>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return server;
}

async function endpoint(base) {
  for (let attempt=0;attempt<150;attempt++) {
    await sleep(100);
    const runs=fs.existsSync(base) ? fs.readdirSync(base).filter(n=>n.startsWith('run-')) : [];
    for (const name of runs) {
      try {
        const lines=fs.readFileSync(path.join(base,name,'profile','DevToolsActivePort'),'utf8')
          .trim().split('\n');
        if (/^\d+$/.test(lines[0]) && lines[1]?.startsWith('/devtools/browser/'))
          return 'ws://127.0.0.1:'+lines[0]+lines[1];
      } catch(error) {if(error.code!=='ENOENT') throw error;}
    }
  }
  throw Error('Chromium debugger endpoint missing');
}

async function arrangeStoppedWorker(url) {
  // Out-of-band fixture setup. Analyzer code remains passive and its own
  // CDP ledger must contain ServiceWorker.enable only.
  const ws=new WebSocket(url), pending=new Map(),versions=new Map();
  let id=0;
  ws.addEventListener('message',event=>{
    let m;try{m=JSON.parse(event.data);}catch(_){return;}
    if(Number.isInteger(m.id)) {
      const p=pending.get(m.id);if(!p)return;
      pending.delete(m.id);clearTimeout(p.timer);
      if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result||{});
    }
    if(m.method==='ServiceWorker.workerVersionUpdated')
      for(const item of m.params?.versions||[])
        if(item.versionId)versions.set(item.versionId,item);
  });
  ws.addEventListener('error',()=>{});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const key=++id;
    const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method));},6000);
    pending.set(key,{resolve,reject,timer});
    ws.send(JSON.stringify({id:key,method,params,...(sessionId?{sessionId}:{})}));
  });
  try {
    await new Promise((resolve,reject)=>{
      if(ws.readyState===WebSocket.OPEN)return resolve();
      ws.addEventListener('open',resolve,{once:true});
      ws.addEventListener('error',reject,{once:true});
    });
    let page;
    for(let i=0;i<60;i++) {
      const targets=await send('Target.getTargets');
      page=(targets.targetInfos||[]).find(t=>t.type==='page' &&
        /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url||''));
      if(page)break;
      await sleep(100);
    }
    assert(page,'fixture page never navigated');
    const attach=await send('Target.attachToTarget',{targetId:page.targetId,flatten:true});
    assert(attach.sessionId,'no fixture CDP page session');
    const sessionId=attach.sessionId;
    await send('ServiceWorker.enable',{},sessionId);
    let active;
    for(let i=0;i<75;i++) {
      active=[...versions.values()].find(v=>v.scriptURL?.endsWith('/idle-worker.js') &&
        v.status==='activated' && v.runningStatus==='running');
      if(active)break;
      await sleep(100);
    }
    assert(active,'fixture did not observe activated running ServiceWorker');
    await send('ServiceWorker.stopWorker',{versionId:active.versionId},sessionId);
    let stopped=false;
    for(let i=0;i<75;i++) {
      if(versions.get(active.versionId)?.runningStatus==='stopped'){stopped=true;break;}
      await sleep(100);
    }
    assert(stopped,'fixture did not observe Chromium worker stop');
    return active.versionId;
  } finally {
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('fixture closed'));}
    pending.clear();
    if(ws.readyState===WebSocket.OPEN)ws.close();
  }
}

async function run(server,base) {
  const url='http://127.0.0.1:'+server.address().port+'/';
  const child=spawn(command,[url,base],{env:{...process.env,m_ROOT:root,
    m_LIB_DIR:path.join(root,'lib')},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',x=>{stdout+=x.toString();});
  child.stderr.on('data',x=>{stderr+=x.toString();});
  const done=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('analyzer timeout'));},120000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);resolve(code);});
  });
  let versionId;
  try {
    versionId=await arrangeStoppedWorker(await endpoint(base));
    assert.equal(await done,0,'analyzer exit failure: '+stderr);
  }catch(e){child.kill('SIGKILL');await done.catch(()=>{});throw e;}
  const report=stdout.trim();
  assert(report.endsWith('/README.md'),'analysis report missing: '+stderr);
  return {directory:path.dirname(report),versionId};
}

async function main() {
  assert(root,'target root missing');
  assert(typeof WebSocket==='function','Node.js native WebSocket required');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'web-analyze-sw-idle-'));
  const server=await serve();
  try {
    const {directory,versionId}=await run(server,path.join(work,'analysis'));
    const provenance=JSON.parse(fs.readFileSync(path.join(directory,
      'rest/worker-provenance/index.json'),'utf8'));
    const registration=provenance.browserRegistrations.find(r=>
      r.scopeURL?.endsWith('/idle/'));
    assert(registration,'registered ServiceWorker not captured from browser state');
    assert(registration.activeScriptURL?.endsWith('/idle-worker.js'),
      'browser did not preserve the activated ServiceWorker after stop');
    assert.equal(registration.status,'registered-worker-stopped',
      'inactive version and persistent browser registration were not reconciled');
    assert.equal(registration.workerTargetLiveAtRest,false);
    assert.equal(registration.versionId,versionId);
    assert(provenance.versions.some(v=>v.versionId===versionId &&
      v.runningStatus==='stopped' && v.registrationObserved),
      'CDP running status not retained');
    const wire=fs.readFileSync(path.join(directory,'cdp-wire.jsonl'),'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    const control=wire.filter(row=>{
      if(row.direction!=='outbound')return false;
      const method=JSON.parse(row.raw).method;
      return method?.startsWith('ServiceWorker.') && method!=='ServiceWorker.enable';
    });
    assert.equal(control.length,0,'analyzer issued forbidden worker lifecycle CDP commands');
    assert.equal(fs.statSync(path.join(directory,
      'rest/worker-provenance/index.json')).mode & 0o777,0o600);
    console.log('Real Chromium inactive ServiceWorker registration persisted; analyzer only observed');
  }finally {
    server.closeAllConnections();server.close();
    fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:250});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
