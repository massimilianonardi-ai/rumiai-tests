'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = process.argv[2];
const command = path.join(root,'bin/sys/web-analyze');
const env = {...process.env, m_ROOT:root,m_LIB_DIR:path.join(root,'lib')};
const sites = [
  {label:'MDN',host:'developer.mozilla.org',
    url:'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide'},
  {label:'web.dev',host:'web.dev',url:'https://web.dev/javascript'}
];
const json = file => JSON.parse(fs.readFileSync(file,'utf8'));
function jsonl(file)
{
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function _requestKey(session, requestId)
{
  return String(session)+':'+String(requestId);
}

function _responseOnlyEvidence(dir, summary, audit, resources)
{
  const details=jsonl(path.join(dir,'network-details.jsonl'));
  const seenRequests=new Set();
  const cacheResponses=new Map();
  for(const row of details)
  {
    const event=row.event||{};
    if(!event.requestId)continue;
    const id=_requestKey(row.session,event.requestId);
    if(row.method==='Network.requestWillBeSent')
      seenRequests.add(id);
    if(row.method==='Network.responseReceived' &&
       event.type==='Stylesheet' &&
       event.response?.fromDiskCache===true)
      cacheResponses.set(id,{
        url:event.response.url,
        status:event.response.status,
        mimeType:event.response.mimeType,
        frameId:event.frameId
      });
  }
  const orphaned=[...cacheResponses].filter(([id])=>!seenRequests.has(id));
  const index=new Map();
  for(const item of resources)
  {
    const id=_requestKey(item.session,item.requestId);
    if(!index.has(id))index.set(id,[]);
    index.get(id).push(item);
  }
  for(const [id,response] of orphaned)
  {
    assert((index.get(id)||[]).some(item=>
      item.requestProvenance==='response-only' &&
      item.url===response.url &&
      item.mimeType===response.mimeType &&
      item.frameId===response.frameId &&
      item.httpStatus===response.status &&
      item.resourceType==='Stylesheet' &&
      item.fromDiskCache===true &&
      ['saved','body-unavailable','unfinished-at-shutdown',
        'body-read-pending-at-shutdown'].includes(item.status)),
      'Cached response without request was not faithfully indexed');
  }
  const responseOnly=resources.filter(item=>
    item.requestProvenance==='response-only');
  assert.equal(responseOnly.length,summary.resourceCapture?.responseOnly||0,
    'Response-only summary counter disagrees with saved resource outcomes');
  assert(responseOnly.every(item=>
    item.url && item.resourceType &&
    Number.isFinite(item.httpStatus) &&
    item.requestTimestamp===null && item.method===null),
    'Response-only evidence has invented request fields or missing response metadata');
  if(responseOnly.length)
  {
    assert(audit.domains?.some(item=>item.domain==='network' &&
      item.status!=='saved'),
      'Incomplete request provenance was incorrectly audited as complete');
  }
  return {
    branch:orphaned.length?'EXERCISED_PASS':'NOT_EXERCISED',
    responseOnlyCount:responseOnly.length,
    orphanedCachedCssCount:orphaned.length,
    bodySaved:responseOnly.filter(x=>x.status==='saved').length,
    bodyUnavailable:responseOnly.filter(x=>x.status==='body-unavailable').length,
    otherOutcomes:responseOnly.filter(x=>!['saved','body-unavailable'].includes(x.status)).length,
    withoutMetadata:resources.filter(x=>x.status==='finished-without-metadata').length,
    unfinished:resources.filter(x=>x.status==='unfinished-at-shutdown').length,
    networkDrained:summary.resourceCapture?.networkDrained??null
  };
}

async function capture(site,base)
{
  const child=spawn(command,[site.url,base],{
    env,stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk.toString();});
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      child.kill('SIGKILL');
      reject(Error(site.label+' browser capture timeout'));
    },210000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',status=>{clearTimeout(timer);resolve(status);});
  });
  // Do not print possibly sensitive URLs, cookies, page HTML, script source,
  // browser transport packets or arbitrary exceptions from the live capture.
  assert.equal(code,0,site.label+' analyzer failed (exit '+code+')');
  const report=stdout.trim().split('\n').at(-1);
  assert(report && report.endsWith('/README.md') &&
    fs.existsSync(report) && report.startsWith(base+path.sep),
    site.label+' analysis report missing');
  return path.dirname(report);
}

function verify(site,dir)
{
  const dom=fs.readFileSync(path.join(dir,'states/dom-rest-initial.html'),'utf8');
  assert(/<title[^>]*>[^<]*JavaScript/i.test(dom),
    site.label+' did not render expected public JavaScript documentation');
  assert(/<body[\s>]/i.test(dom) && dom.length>2500,
    site.label+' rendered page is unexpectedly empty');

  const summary=json(path.join(dir,'summary.json'));
  const manifest=json(path.join(dir,'rest/manifest.json'));
  const audit=json(path.join(dir,'evidence-integrity.json'));
  const resources=jsonl(path.join(dir,'resources.jsonl'));
  const scripts=jsonl(path.join(dir,'scripts.jsonl'));
  const saved=resources.filter(item=>item.status==='saved');
  const own=saved.filter(item=>{
    try{return new URL(item.url).hostname===site.host;}
    catch(_){return false;}
  });
  assert(saved.length>=3,
    site.label+' failed to archive multiple real HTTPS response bodies');
  assert(own.length>=1,
    site.label+' did not archive an HTTPS response from the requested host');
  assert(scripts.some(item=>item.status==='saved'),
    site.label+' script-source capture unavailable');
  assert(manifest.targets?.some(target=>target.main===true),
    site.label+' main target missing from deep-rest manifest');
  assert(manifest.artifacts?.some(item=>item.name==='target-graph-final'),
    site.label+' final target graph missing from deep-rest manifest');
  assert(audit.status!=='failed' && audit.status!=='interrupted',
    site.label+' evidence integrity failed or capture was interrupted');
  assert(summary.resourceCapture?.saved>=saved.length,
    site.label+' archived response counter is inconsistent');
  assert(fs.existsSync(path.join(dir,'rest/worker-provenance/index.json')),
    site.label+' worker provenance missing');
  assert(fs.existsSync(path.join(dir,'rest/targets/target-000/environment.json')),
    site.label+' deep-rest browser environment missing');
  assert.equal(fs.statSync(dir).mode&0o777,0o700,
    site.label+' capture directory is not private');
  const responseOnly=_responseOnlyEvidence(dir,summary,audit,resources);
  const report={
    site:site.label,
    host:{platform:process.platform,architecture:process.arch},
    productRevision:process.env.GITHUB_SHA||null,
    testRevision:process.env.RUMIAI_PUBLIC_SITES_TEST_REVISION||null,
    capture:{
      savedResponses:saved.length,
      ownHostResponses:own.length,
      savedScriptRecords:scripts.filter(item=>item.status==='saved').length,
      auditStatus:audit.status,
      verifiedFiles:audit.counts?.verifiedFiles??null,
      missingOrCorrupt:audit.counts?.missingOrCorrupt??null,
      discrepancies:audit.counts?.discrepancies??null,
      limitations:manifest.limitations?.length||0
    },
    responseOnly
  };
  const reportDir=process.env.RUMIAI_PUBLIC_SITE_REPORT_DIR;
  if(reportDir)
  {
    fs.mkdirSync(reportDir,{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(reportDir,
      site.label==='MDN'?'mdn.json':'web-dev.json'),
      JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  console.log(site.label+' real HTTPS PASS: savedResponses='+saved.length+
    ' ownHostResponses='+own.length+' savedScriptRecords='+
    scripts.filter(item=>item.status==='saved').length+
    ' audit='+audit.status+' limitations='+(manifest.limitations?.length||0)+
    ' responseOnly='+responseOnly.responseOnlyCount+
    ' orphanedCachedCSS='+responseOnly.orphanedCachedCssCount+
    ' branch='+responseOnly.branch+
    ' bodySaved='+responseOnly.bodySaved+
    ' bodyUnavailable='+responseOnly.bodyUnavailable);
}

async function main()
{
  assert(root,'supplied rumiai-os root required');
  for(const site of sites)
  {
    const base=fs.mkdtempSync(path.join(os.tmpdir(),'web-analyze-public-site-'));
    try
    {
      const dir=await capture(site,base);
      verify(site,dir);
    }
    finally
    {
      fs.rmSync(base,{recursive:true,force:true,maxRetries:20,retryDelay:250});
    }
  }
  console.log('Public HTTPS browser capture complete: 2 separate real websites; no evidence uploaded');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
