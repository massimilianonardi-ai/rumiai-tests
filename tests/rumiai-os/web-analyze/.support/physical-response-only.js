'use strict';

// Opt-in operator-host validation. Raw CDP evidence remains in the private run;
// stdout and the standalone summary contain no URLs, bodies, cookies or IDs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn,spawnSync} = require('node:child_process');

const productRoot = process.argv[2];
const suiteRoot = process.argv[3];
const config = process.env;
process.umask(0o077);

function requireValue(condition,code)
{
  if (!condition) {
    const error = new Error(code);
    error.reason = code;
    throw error;
  }
}

function git(root,args)
{
  const result=spawnSync('git',['-C',root,...args],
    {encoding:'utf8',timeout:12000,maxBuffer:128*1024});
  requireValue(result.status===0,'git-revision-unavailable');
  return result.stdout.trim();
}

function revision(root)
{
  const sha=git(root,['rev-parse','--verify','HEAD']);
  requireValue(/^[0-9a-f]{40}$/.test(sha),'git-sha-invalid');
  requireValue(git(root,['status','--porcelain']).length===0,
    'checkout-has-local-changes');
  return sha;
}

function distribution()
{
  let fields={};
  try {
    for(const line of fs.readFileSync('/etc/os-release','utf8').split('\n')) {
      const match=line.match(/^([A-Z_]+)=(?:"([^"]*)"|([^#\s]+))$/);
      if(match)fields[match[1]]=match[2]??match[3];
    }
  }catch(_){}
  return {os:fields.ID||process.platform,version:fields.VERSION_ID||null,
    architecture:process.arch};
}

function readJson(filename)
{
  return JSON.parse(fs.readFileSync(filename,'utf8'));
}

function readJsonl(filename)
{
  const rows=[];
  for(const line of fs.readFileSync(filename,'utf8').split('\n'))
    if(line)rows.push(JSON.parse(line));
  return rows;
}

function key(item)
{
  return String(item.session)+':'+String(item.requestId);
}

async function capture(url,outputRoot,stderrFile)
{
  let out='';
  const child=spawn(path.join(productRoot,'m'),
    ['web-analyze',url,outputRoot,'--scroll'],
    {cwd:productRoot,stdio:['ignore','pipe',stderrFile]});
  child.stdout.on('data',bytes=>{
    out+=bytes.toString();
    if(out.length>16384)out=out.slice(-16384);
  });
  const status=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{
      child.kill('SIGTERM');
      reject(new Error('capture-timeout'));
    },300000);
    child.once('error',()=>{
      clearTimeout(timeout);
      reject(new Error('capture-launch-failed'));
    });
    child.once('exit',(code,signal)=>{
      clearTimeout(timeout);
      resolve({code,signal});
    });
  });
  requireValue(status.code===0 && !status.signal,'capture-command-failed');
  const report=out.split(/\r?\n/).map(row=>row.trim()).filter(Boolean).at(-1);
  requireValue(!!report && path.isAbsolute(report),'capture-report-unavailable');
  const runDir=path.dirname(report);
  requireValue(path.basename(report)==='README.md' &&
    path.dirname(runDir)===outputRoot &&
    path.basename(runDir).startsWith('run-'),'capture-run-directory-invalid');
  requireValue(fs.realpathSync(path.dirname(runDir))===
    fs.realpathSync(outputRoot),'capture-run-directory-mismatch');
  return runDir;
}

function summarize(runDir,host,productCommit,testCommit,label)
{
  const summary=readJson(path.join(runDir,'summary.json'));
  const captureInfo=summary.resourceCapture||{};
  const audit=readJson(path.join(runDir,'evidence-integrity.json'));
  const resources=readJsonl(path.join(runDir,'resources.jsonl'));
  const details=readJsonl(path.join(runDir,'network-details.jsonl'));

  const requests=new Set();
  const cachedCss=new Map();
  for(const record of details)
  {
    const event=record.event||{};
    if(!event.requestId)continue;
    if(record.method==='Network.requestWillBeSent')
      requests.add(key({session:record.session,requestId:event.requestId}));
    if(record.method==='Network.responseReceived' &&
       event.type==='Stylesheet' &&
       event.response?.fromDiskCache===true)
      cachedCss.set(key({session:record.session,requestId:event.requestId}),
        {url:event.response.url,status:event.response.status,
          mime:event.response.mimeType,frameId:event.frameId});
  }

  const unmatched=[...cachedCss].filter(([id])=>!requests.has(id));
  const indexed=new Map();
  for(const row of resources)
  {
    const id=key(row);
    if(!indexed.has(id))indexed.set(id,[]);
    indexed.get(id).push(row);
  }

  const unmatchedInvalid=unmatched.filter(([id,response])=>
    !(indexed.get(id)||[]).some(row=>
      row.requestProvenance==='response-only' &&
      row.url===response.url &&
      row.httpStatus===response.status &&
      row.mimeType===response.mime &&
      row.frameId===response.frameId &&
      row.resourceType==='Stylesheet' &&
      row.fromDiskCache===true &&
      ['saved','body-unavailable','unfinished-at-shutdown',
        'body-read-pending-at-shutdown'].includes(row.status))).length;

  const responseOnly=resources.filter(row=>row.requestProvenance==='response-only');
  const provenanceIncomplete=responseOnly.filter(row=>
    !row.url || !Number.isFinite(row.httpStatus) ||
    row.requestTimestamp!==null || row.method!==null ||
    !row.resourceType).length;
  const counts={
    requestsObserved:captureInfo.requests??null,
    archivedBodies:captureInfo.saved??null,
    responseOnlyObserved:captureInfo.responseOnly??null,
    responseOnlyIndexed:responseOnly.length,
    responseOnlyBodySaved:responseOnly.filter(row=>row.status==='saved').length,
    responseOnlyBodyUnavailable:responseOnly.filter(row=>row.status==='body-unavailable').length,
    responseOnlyOtherOutcomes:responseOnly.filter(row=>!['saved','body-unavailable'].includes(row.status)).length,
    cachedStylesheetWithoutRequest:unmatched.length,
    cachedStylesheetProvenanceInvalid:unmatchedInvalid,
    responseOnlyProvenanceInvalid:provenanceIncomplete,
    finishedWithoutMetadata:resources.filter(row=>row.status==='finished-without-metadata').length,
    unfinishedAtShutdown:resources.filter(row=>row.status==='unfinished-at-shutdown').length,
    networkDrained:captureInfo.networkDrained??null,
    verifiedFiles:audit.counts?.verifiedFiles??null,
    missingOrCorrupt:audit.counts?.missingOrCorrupt??null,
    discrepancies:audit.counts?.discrepancies??null
  };
  const invalid=unmatchedInvalid>0 || provenanceIncomplete>0 ||
    captureInfo.responseOnly!==responseOnly.length ||
    audit.counts?.missingOrCorrupt!==0 ||
    audit.counts?.discrepancies!==0 ||
    ['failed','interrupted'].includes(audit.status);
  const outcome=invalid?'FAIL':
    unmatched.length?'PASS':'NOT_EXERCISED';
  let browserProduct=null;
  try {
    const product=readJson(path.join(runDir,'cdp-capabilities.json')).browser?.product;
    if(/^(?:Chrome|HeadlessChrome|Chromium)\/[\d.]+$/.test(product||''))
      browserProduct=product;
  } catch(_){}

  return {
    test:'rumiai-os/web-analyze/physical-response-only',
    outcome,
    label,
    environment:{...host,chromiumProduct:browserProduct},
    revisions:{rumiaiOs:productCommit,rumiaiTests:testCommit},
    evidence:{retainedLocally:true,auditStatus:audit.status,counts},
    note:outcome==='NOT_EXERCISED'?
      'No cached CSS response without a request event; this branch was not exercised':
      outcome==='PASS'?
        'Cached CSS response-only provenance retained; body availability is reported separately':
        'Observed evidence conflicts with response-only metadata or integrity invariants'
  };
}

async function main()
{
  const label=config.RUMIAI_TEST_WEB_ANALYZE_LABEL||'site';
  requireValue(/^[a-z0-9_-]{1,32}$/.test(label),'label-invalid');
  const rawOutput=config.RUMIAI_TEST_WEB_ANALYZE_OUTPUT_ROOT;
  requireValue(rawOutput && path.isAbsolute(rawOutput),'private-output-root-must-be-absolute');
  const url=config.RUMIAI_TEST_WEB_ANALYZE_URL;
  let parsed;try{parsed=new URL(url);}catch(_){}
  requireValue(parsed?.protocol==='https:','authorized-https-url-required');
  const outputRoot=path.resolve(rawOutput);
  fs.mkdirSync(outputRoot,{recursive:true,mode:0o700});
  const meta=fs.lstatSync(outputRoot);
  requireValue(meta.isDirectory() && (meta.mode&0o077)===0,
    'private-output-root-permissions-invalid');

  const host=distribution();
  if(config.RUMIAI_TEST_WEB_ANALYZE_EXPECTED_HOST)
    requireValue(config.RUMIAI_TEST_WEB_ANALYZE_EXPECTED_HOST===
      [host.os,host.version,host.architecture].join('-'),
      'host-identity-mismatch');
  const productCommit=revision(productRoot);
  const testCommit=revision(suiteRoot);
  if(config.RUMIAI_TEST_WEB_ANALYZE_EXPECTED_PRODUCT_COMMIT)
    requireValue(productCommit===
      config.RUMIAI_TEST_WEB_ANALYZE_EXPECTED_PRODUCT_COMMIT,
      'product-revision-mismatch');

  const logfile=path.join(outputRoot,
    'capture-'+label+'-'+process.pid+'-stderr.log');
  const stderrFile=fs.openSync(logfile,'wx',0o600);
  let runDir;
  try{runDir=await capture(url,outputRoot,stderrFile);}
  finally{fs.closeSync(stderrFile);}
  const result=summarize(runDir,host,productCommit,testCommit,label);
  const reportName='response-only-'+label+'-'+process.pid+'.json';
  fs.writeFileSync(path.join(outputRoot,reportName),
    JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({...result,localReportFile:reportName},null,2)+'\n');
  process.exitCode=result.outcome==='PASS'?0:
    result.outcome==='NOT_EXERCISED'?2:1;
}
main().catch(error=>{
  const reason=typeof error?.reason==='string'?
    error.reason:/^(capture-timeout|capture-launch-failed)$/.test(error?.message||'')?
      error.message:'validation-infrastructure-error';
  process.stderr.write('physical-response-only: ERROR: '+reason+
    '; inspect the private local capture log if a run was started\n');
  process.exitCode=3;
});
