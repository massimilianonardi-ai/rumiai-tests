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

// Read only Network lifecycle events from the private lossless CDP wire ledger.
// The top-level sessionId, not targetId in diagnostic logs, owns the request ID.
function cdpWireLifecycleEvents(rows)
{
  const events=[];
  for(const row of rows)
  {
    if(row.direction!=='inbound')continue;
    let packet;
    try{packet=JSON.parse(row.raw);}catch(_){continue;}
    if(packet.method!=='Network.requestWillBeSent' &&
       packet.method!=='Network.loadingFinished')continue;
    const params=packet.params||{};
    if(params.requestId===undefined || params.requestId===null ||
       !Number.isSafeInteger(row.sequence))continue;
    events.push({
      type:packet.method==='Network.requestWillBeSent'?'request':'finished',
      targetId:packet.sessionId||'__root__',
      requestId:params.requestId,elapsedMs:row.sequence,
      frameId:params.frameId,loaderId:params.loaderId
    });
  }
  return events;
}

// A requestId is scoped to a CDP session. Multiple starts can also
// represent redirects; do not manufacture a one-to-one lifecycle in that case.
function summarizeSessionLifecycle(events)
{
  const starts=new Map();
  const finishes=new Map();
  for(const row of events)
  {
    if(row.type!=='request' && row.type!=='finished')continue;
    if(typeof row.targetId!=='string' || !row.targetId ||
       row.requestId===undefined || row.requestId===null)continue;
    const id=key({session:row.targetId,requestId:row.requestId});
    const bucket=row.type==='request'?starts:finishes;
    if(!bucket.has(id))bucket.set(id,[]);
    bucket.get(id).push(row);
  }
  let uniqueSameSessionCompletions=0;
  let withFrameAndLoader=0;
  let ambiguousRepeatedStarts=0;
  let ambiguousRepeatedFinishes=0;
  let finishWithoutStart=0;
  let startWithoutFinish=0;
  let invalidOrdering=0;
  for(const [id,done] of finishes)
  {
    const began=starts.get(id)||[];
    if(!began.length){finishWithoutStart+=done.length;continue;}
    if(began.length!==1 || done.length!==1)
    {
      if(began.length>1)ambiguousRepeatedStarts++;
      if(done.length>1)ambiguousRepeatedFinishes++;
      continue;
    }
    if(!Number.isFinite(began[0].elapsedMs) ||
       !Number.isFinite(done[0].elapsedMs) ||
       began[0].elapsedMs>done[0].elapsedMs)
    {
      invalidOrdering++;
      continue;
    }
    uniqueSameSessionCompletions++;
    if(typeof began[0].frameId==='string' && began[0].frameId &&
       typeof began[0].loaderId==='string' && began[0].loaderId)
      withFrameAndLoader++;
  }
  for(const [id,began] of starts)
    if(!finishes.has(id))startWithoutFinish+=began.length;
  return {
    uniqueSameSessionCompletions,withFrameAndLoader,
    ambiguousRepeatedStarts,ambiguousRepeatedFinishes,
    finishWithoutStart,startWithoutFinish,invalidOrdering,
    confidence:'same-session-CDP-lifecycle-only-not-cross-session-HTTP-identity'
  };
}

function _crossTargetCandidates(runDir)
{
  return correlateCrossTargets(
    readJsonl(path.join(runDir,'network.jsonl')),
    readJson(path.join(runDir,'rest/target-graph-final.json')));
}

// Session-scoped request IDs are only candidates, never correlation keys.
// This pure boundary also permits collision-negative fixture verification.
function correlateCrossTargets(events,graph)
{
  const targets=new Map((graph.targets||[]).map(item=>[item.targetId,item]));
  const requests=new Map();
  const finished=new Set();
  for(const item of events)
  {
    if(item.type==='request')
    {
      if(!requests.has(item.requestId))requests.set(item.requestId,[]);
      requests.get(item.requestId).push(item);
    }
    if(item.type==='finished')
      finished.add(key({session:item.targetId,requestId:item.requestId}));
  }
  const orphanFinishes=events.filter(item=>
    item.type==='finished' && !(requests.get(item.requestId)||[])
      .some(request=>request.targetId===item.targetId));
  const matched=orphanFinishes.map(item=>(requests.get(item.requestId)||[])
    .filter(request=>request.targetId!==item.targetId &&
      request.elapsedMs<=item.elapsedMs &&
      item.elapsedMs-request.elapsedMs<=120000));
  const unique=orphanFinishes.flatMap((item,index)=>
    matched[index].length===1?[{request:matched[index][0],finish:item}]:[]);
  const sourceWithoutOwnFinish=unique.filter(({request})=>
    !finished.has(key({session:request.targetId,requestId:request.requestId})));
  const lineage=unique.map(({request,finish})=>
  {
    const target=targets.get(finish.targetId);
    const directParent=target?.parentTargetId===request.targetId;
    const seenAt=Date.parse(target?.firstSeenAt||'');
    const requestAt=Date.parse(request.timestamp||'');
    const finishedAt=Date.parse(finish.timestamp||'');
    const attachedInWindow=Number.isFinite(seenAt) &&
      Number.isFinite(requestAt) && Number.isFinite(finishedAt) &&
      seenAt>=requestAt-500 && seenAt<=finishedAt+500;
    return {
      directParent,
      attachedInWindow,
      iframeFrameIdentity:directParent && target?.type==='iframe' &&
        request.frameId===finish.targetId,
      workerFromParentScript:directParent && target?.type==='worker' &&
        request.resourceType==='Script'
    };
  });
  return {
    finishedWithoutSameTargetRequest:orphanFinishes.length,
    uniqueCrossTargetIdAndTimeCandidates:unique.length,
    candidateSourcesWithoutSameTargetFinish:sourceWithoutOwnFinish.length,
    ambiguousCandidates:matched.filter(items=>items.length>1).length,
    withoutCandidate:matched.filter(items=>!items.length).length,
    candidateDocument:unique.filter(item=>item.request.resourceType==='Document').length,
    candidateScript:unique.filter(item=>item.request.resourceType==='Script').length,
    directParentTargetCandidates:lineage.filter(item=>item.directParent).length,
    directlyRelatedAndAttachedWithinTransfer:lineage.filter(item=>
      item.directParent && item.attachedInWindow).length,
    frameIdentityForIframeCandidates:lineage.filter(item=>item.iframeFrameIdentity).length,
    workerChildOfScriptRequesterCandidates:lineage.filter(item=>
      item.workerFromParentScript).length,
    confidence:'lineage-evidence-candidates-only-no-automatic-cross-session-merge'
  };
}
function _stylesheetSourceEvidence(runDir)
{
  const details=readJsonl(path.join(runDir,'network-details.jsonl'));
  const requests=new Set();
  const responses=new Map();
  for(const row of details)
  {
    const event=row.event||{};
    if(!event.requestId)continue;
    const id=key({session:row.session,requestId:event.requestId});
    if(row.method==='Network.requestWillBeSent')requests.add(id);
    if(row.method==='Network.responseReceived' &&
      event.type==='Stylesheet' && event.response?.fromDiskCache===true)
      responses.set(id,event.response.url);
  }
  const missing=[...responses].filter(([id])=>!requests.has(id));
  const styles=readJson(path.join(runDir,'rest/stylesheets/index.json'));
  const sources=new Map();
  for(const item of styles)
  {
    if(item.sourceURL && item.status==='saved' &&
      Number.isFinite(item.bytes) && item.bytes>0 &&
      typeof item.file==='string' &&
      /^stylesheets\/[0-9a-f]{64}\.css$/.test(item.file) &&
      fs.existsSync(path.join(runDir,'rest',item.file)))
    {
      if(!sources.has(item.sourceURL))sources.set(item.sourceURL,[]);
      sources.get(item.sourceURL).push(item);
    }
  }
  const covered=missing.filter(([,url])=>sources.has(url));
  return {
    cachedStylesheetResponsesWithoutRequest:missing.length,
    withSavedIndependentCssSource:covered.length,
    withoutSavedIndependentCssSource:missing.length-covered.length,
    cssSourceIndexEntries:styles.length,
    cssSourceIndexSaved:styles.filter(item=>item.status==='saved').length,
    sourceMeaning:'CDP CSS.getStyleSheetText; NOT original HTTP response body'
  };
}


function _cdpBodyFailures(runDir,resources)
{
  // Match outbound getResponseBody with its native numeric CDP reply code.
  // Raw packet bodies, headers, URL values and error messages remain local.
  const ids=new Set(resources.filter(item=>
    item.requestProvenance==='response-only' && item.status==='body-unavailable')
    .map(key));
  const commands=new Map();
  const replies=new Map();
  const wire=readJsonl(path.join(runDir,'cdp-wire.jsonl'));
  for(const row of wire)
  {
    if(row.direction!=='outbound' && row.direction!=='inbound')continue;
    let packet;try{packet=JSON.parse(row.raw);}catch(_){continue;}
    if(row.direction==='outbound' &&
       packet.method==='Network.getResponseBody' &&
       ids.has(key({session:packet.sessionId,requestId:packet.params?.requestId})))
      commands.set(packet.id,key({session:packet.sessionId,
        requestId:packet.params.requestId}));
    else if(row.direction==='inbound' && packet.id!==undefined &&
      (packet.error || packet.result) && commands.has(packet.id))
    {
      const type=packet.error && Number.isInteger(packet.error.code)?
        'cdp-'+String(packet.error.code):
        packet.error?'cdp-other-error':'cdp-success';
      replies.set(commands.get(packet.id),type);
    }
  }
  const buckets={};
  for(const id of ids)
  {
    const kind=replies.get(id)||'no-matched-cdp-reply';
    buckets[kind]=(buckets[kind]||0)+1;
  }
  return {responseOnlyBodiesUnavailable:ids.size,cdpOutcomeCounts:buckets};
}

function _amazonPageClass(runDir,label)
{
  if(label!=='amazon')return 'not-applicable';
  const file=path.join(runDir,'states/dom-rest-final.html');
  const html=fs.readFileSync(file,'utf8');
  if(/(?:id=["']item_[^"']+["']|data-itemid=["'][^"']+["'])/i.test(html))
    return 'wishlist-items-observed';
  if(/(?:id=["']captchacharacters["']|name=["']captcha["']|validateCaptcha)/i.test(html))
    return 'captcha-challenge-observed';
  if(/(?:\/ap\/signin|id=["']ap_email["'])/i.test(html))
    return 'signin-indicators-without-items';
  return 'no-wishlist-items-unclassified';
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

  const runToken=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
  const logfile=path.join(outputRoot,
    'capture-'+label+'-'+runToken+'-stderr.log');
  const stderrFile=fs.openSync(logfile,'wx',0o600);
  let runDir;
  try{runDir=await capture(url,outputRoot,stderrFile);}
  finally{fs.closeSync(stderrFile);}
  const result=summarize(runDir,host,productCommit,testCommit,label);
  result.diagnostics={
    sameSessionLifecycle:summarizeSessionLifecycle(cdpWireLifecycleEvents(
      readJsonl(path.join(runDir,'cdp-wire.jsonl')))),
    crossTarget:_crossTargetCandidates(runDir),
    bodyUnavailable:_cdpBodyFailures(runDir,readJsonl(path.join(runDir,'resources.jsonl'))),
    independentCssSource:_stylesheetSourceEvidence(runDir),
    pageClassification:_amazonPageClass(runDir,label)
  };
  const reportName='response-only-'+label+'-'+runToken+'.json';
  fs.writeFileSync(path.join(outputRoot,reportName),
    JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({...result,localReportFile:reportName},null,2)+'\n');
  process.exitCode=result.outcome==='PASS'?0:
    result.outcome==='NOT_EXERCISED'?2:1;
}
if (require.main===module) main().catch(error=>{
  const reason=typeof error?.reason==='string'?
    error.reason:/^(capture-timeout|capture-launch-failed)$/.test(error?.message||'')?
      error.message:'validation-infrastructure-error';
  process.stderr.write('physical-response-only: ERROR: '+reason+
    '; inspect the private local capture log if a run was started\n');
  process.exitCode=3;
});

module.exports={correlateCrossTargets,summarizeSessionLifecycle,cdpWireLifecycleEvents};
