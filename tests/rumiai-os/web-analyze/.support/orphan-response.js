'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {startWebAnalyze} = require(path.join(process.argv[2],
  'lib/sys/js/web-analyze.lib.js'));
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const readLines = file => fs.readFileSync(file,'utf8').split('\n')
  .filter(Boolean).map(JSON.parse);

async function main()
{
  const count=16;
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(/^\/style-\d+\.css$/.test(pathname)) {
      res.setHeader('Content-Type','text/css');
      res.setHeader('Cache-Control','public,max-age=3600');
      return res.end(':root{--fixture-style-'+pathname.match(/\d+/)[0]+':loaded;}');
    }
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><html><head><title>CSS cache response provenance</title>'+
      Array.from({length:count},(_,i)=>'<link rel="stylesheet" href="/style-'+i+'.css">').join('')+
      '</head><body><h1>Cache response evidence</h1></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'web-analyze-orphan-'));
  const destination=path.join(work,'capture');
  let session;
  try {
    session=await startWebAnalyze({
      url:'http://127.0.0.1:'+server.address().port+'/index.html',
      outputDir:destination,headless:true,timeoutMs:20000
    });
    let ready=false;
    for(let i=0;i<80;i++) {
      const result=await session.sendPage('Runtime.evaluate',{
        expression:'document.readyState === "complete" && document.styleSheets.length === '+count,
        returnByValue:true},4000);
      if(result.result?.value===true){ready=true;break;}
      await sleep(150);
    }
    assert(ready,'Chromium never loaded all fixture stylesheets');
    await sleep(600);
    await session.sendPage('CSS.enable');
    await sleep(900);
    await session.stop();
    session=null;
    const events=readLines(path.join(destination,'network.jsonl'));
    const requests=new Set(events.filter(item=>item.type==='request')
      .map(item=>item.targetId+':'+item.requestId));
    const orphans=events.filter(item=>item.type==='response' &&
      item.resourceType==='Stylesheet' && item.fromDiskCache &&
      !requests.has(item.targetId+':'+item.requestId));
    assert(orphans.length>0,
      'Chromium did not emit a response-only cached stylesheet; fixture cannot exercise regression');
    const resources=readLines(path.join(destination,'resources.jsonl'));
    const recovered=orphans.filter(response=>resources.some(item=>
      item.requestId===response.requestId &&
      item.requestProvenance==='response-only' &&
      ['saved','body-unavailable'].includes(item.status) &&
      typeof item.url==='string' && item.mimeType==='text/css' &&
      item.httpStatus===200 && item.fromDiskCache===true));
    assert.equal(recovered.length,orphans.length,
      'Response-only CSS must retain CDP response metadata and honest body status');
    console.log('Chromium response-only cached CSS metadata preserved:',
      recovered.length,'of',orphans.length);
  }
  finally {
    if(session)await session.stop();
    server.closeAllConnections();server.close();
    // Chromium can flush the disposable profile after its CDP connection closes.
    await sleep(800);
    try {fs.rmSync(work,{recursive:true,force:true,maxRetries:40,retryDelay:250});}
    catch (error) {
      // Keep the original assertion error visible; the hosted runner discards
      // its temporary workspace even if Chromium closes unusually slowly.
      console.error('Fixture cleanup incomplete: '+(error.code||'unknown'));
      process.exitCode=1;
    }
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
