'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn, spawnSync} = require('node:child_process');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });
  return server.address().port;
}
async function run(command, args, env) {
  const child = spawn(command, args, {env, stdio:['ignore','pipe','pipe']});
  let stdout='', stderr='';
  child.stdout.on('data', data => {stdout += data.toString();});
  child.stderr.on('data', data => {stderr += data.toString();});
  const code = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('web-analyze OOPIF test timed out: ' + stderr));
    }, 120000);
    child.on('error', error => {clearTimeout(deadline);reject(error);});
    child.on('exit', value => {clearTimeout(deadline);resolve(value);});
  });
  return {code,stdout,stderr};
}
function jsonLines(file) {
  return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
}
function verifySameSessionLifecycleControl() {
  const {summarizeSessionLifecycle} = require('./physical-response-only.js');
  const start = (targetId,requestId,elapsedMs,extra={}) => ({
    type:'request',targetId,requestId,elapsedMs,...extra
  });
  const finish = (targetId,requestId,elapsedMs) => ({
    type:'finished',targetId,requestId,elapsedMs
  });
  const events=[
    start('a','shared',1,{frameId:'frame',loaderId:'loader'}),
    finish('a','shared',2),
    start('b','shared',1.2,{frameId:'other',loaderId:'other'}),
    finish('b','shared',2.2),
    start('a','redirect',3),start('a','redirect',4),
    finish('a','redirect',5),
    finish('a','orphan',6),
    start('b','unfinished',7),
    start('b','late',9),finish('b','late',8)
  ];
  const actual=summarizeSessionLifecycle(events);
  assert.equal(actual.uniqueSameSessionCompletions,2);
  assert.equal(actual.withFrameAndLoader,2);
  assert.equal(actual.ambiguousRepeatedStarts,1);
  assert.equal(actual.finishWithoutStart,1);
  assert.equal(actual.startWithoutFinish,1);
  assert.equal(actual.invalidOrdering,1);
  assert.equal(actual.confidence,
    'same-session-CDP-lifecycle-only-not-cross-session-HTTP-identity');
}
function verifyCollisionNegativeControl() {
  const {correlateCrossTargets} = require('./physical-response-only.js');
  const request = (targetId,elapsedMs) => ({
    type:'request',targetId,requestId:'reused-id',elapsedMs,
    timestamp:'2026-01-01T00:00:01.000Z',resourceType:'Document',
    frameId:'child'
  });
  const finish = {
    type:'finished',targetId:'child',requestId:'reused-id',
    elapsedMs:1200,timestamp:'2026-01-01T00:00:01.200Z'
  };
  const graph = {targets:[{
    targetId:'child',type:'iframe',parentTargetId:'parent',
    firstSeenAt:'2026-01-01T00:00:01.100Z'
  }]};
  const single = correlateCrossTargets([request('parent',1000),finish],graph);
  assert.equal(single.uniqueCrossTargetIdAndTimeCandidates,1);
  assert.equal(single.directlyRelatedAndAttachedWithinTransfer,1);
  assert.equal(single.frameIdentityForIframeCandidates,1);
  assert.equal(single.confidence,
    'lineage-evidence-candidates-only-no-automatic-cross-session-merge');
  // A separate target can legally reuse the same request ID at the same time.
  // Parent lineage does not authorize selecting the plausible match from a collision.
  const collision = correlateCrossTargets(
    [request('parent',1000),request('unrelated',1001),finish],graph);
  assert.equal(collision.ambiguousCandidates,1);
  assert.equal(collision.uniqueCrossTargetIdAndTimeCandidates,0);
  assert.equal(collision.directParentTargetCandidates,0);
  assert.equal(collision.frameIdentityForIframeCandidates,0);
  assert.equal(collision.withoutCandidate,0);
  const none = correlateCrossTargets([request('parent',1000),{
    ...finish,requestId:'different-id'
  }],graph);
  assert.equal(none.withoutCandidate,1);
  assert.equal(none.uniqueCrossTargetIdAndTimeCandidates,0);
}
async function main() {
  const root = process.argv[2];
  assert(root,'rumiai-os root is required');
  verifyCollisionNegativeControl();
  verifySameSessionLifecycleControl();
  const work = fs.mkdtempSync(path.join(os.tmpdir(),'web-analyze-oopif-'));
  const cross = http.createServer((req,res) => {
    res.setHeader('Content-Type',req.url === '/payload' ? 'text/plain' : 'text/html');
    if (req.url === '/payload') return res.end('remote-frame-payload');
    res.end('<!doctype html><title>Cross-site child</title><body>' +
      '<script>const node=document.createElement("i");' +
      'node.id="oopif-transient-marker";document.body.append(node);node.remove();' +
      'fetch("/payload").then(r=>r.text()).then(t=>document.body.dataset.remote=t)' +
      '</script></body>');
  });
  let local;
  try {
    const crossPort = await listen(cross);
    local = http.createServer((req,res) => {
      res.setHeader('Content-Type','text/html');
      if (req.url === '/same')
        return res.end('<!doctype html><title>Same-site child</title>' +
          '<body>same-site initial document</body>');
      res.end('<!doctype html><title>OOPIF swap parent</title><body>' +
        '<iframe id="swap" src="/same"></iframe>' +
        '<script>setTimeout(()=>{' +
        'document.querySelector("#swap").src=' +
        JSON.stringify('http://localhost:' + crossPort + '/cross') +
        '},900)</script></body>');
    });
    const localPort = await listen(local);
    const browser = spawnSync('sh',['-c','command -v chromium'],{
      encoding:'utf8'
    }).stdout.trim();
    assert(browser,'chromium unavailable');
    const bin = path.join(work,'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin,'chromium'),
      '#!/bin/sh\nexec ' + JSON.stringify(browser) + ' --site-per-process "$@"\n',
      {mode:0o700});
    const env = {...process.env,m_ROOT:root,m_LIB_DIR:path.join(root,'lib'),
      PATH:bin + path.delimiter + process.env.PATH};
    const output = path.join(work,'evidence');
    const command = path.join(root,'bin/sys/web-analyze');
    const result = await run(command,['http://127.0.0.1:' + localPort + '/',output],env);
    assert.equal(result.code,0,'command failed: ' + result.stderr);
    const runDir = path.dirname(result.stdout.trim());
    const graph = JSON.parse(fs.readFileSync(
      path.join(runDir,'rest/target-graph-final.json'),'utf8'));
    const wire = jsonLines(path.join(runDir,'cdp-wire.jsonl'))
      .filter(row=>row.direction==='inbound')
      .map(row=>({sequence:row.sequence,...JSON.parse(row.raw)}));
    const attached = wire.filter(row=>row.method==='Target.attachedToTarget' &&
      row.params?.targetInfo?.type==='iframe');
    assert(attached.length > 0,
      'Chromium did not attach an out-of-process iframe target');
    const swapped = wire.filter(row=>row.method==='Page.frameDetached' &&
      row.params?.reason==='swap');
    assert(swapped.length > 0,
      'Chromium did not report a frame process swap');
    const swappedFrames = new Set(swapped.map(row=>row.params?.frameId));
    const attachedFrameTargets = attached.filter(row=>
      swappedFrames.has(row.params?.targetInfo?.targetId));
    assert(attachedFrameTargets.length > 0,
      'process-swap frame identity was not preserved in attached OOPIF target');
    const network = jsonLines(path.join(runDir,'network.jsonl'));
    const {summarizeSessionLifecycle} = require('./physical-response-only.js');
    const lifecycle=summarizeSessionLifecycle(network);
    assert(lifecycle.uniqueSameSessionCompletions>0,
      'real Chromium produced no session-local complete request lifecycle');
    assert(lifecycle.withFrameAndLoader>0,
      'real Chromium produced no matched lifecycle with frame/loader provenance');
    const childDocumentRequests = network.filter(row=>
      row.type==='request' && row.resourceType==='Document' &&
      attachedFrameTargets.some(target=>
        target.params?.targetInfo?.targetId===row.frameId));
    assert(childDocumentRequests.some(row=>
      typeof row.loaderId==='string' && row.loaderId.length>0),
      'process-swapped iframe document has no observed frame and loader provenance');
    const childLoaders = new Set(childDocumentRequests
      .map(row=>row.loaderId).filter(Boolean));
    assert(childLoaders.size>0,
      'no loader identity observed for the process-swapped iframe document');
    const iframeSessions = new Set(attached.map(row=>row.params.sessionId));
    assert(wire.some(row=>row.method==='Runtime.executionContextCreated' &&
      iframeSessions.has(row.sessionId)),
      'new OOPIF execution context was not observed on attached target');
    assert(graph.targets.some(item=>item.type==='iframe' && item.attached),
      'final target graph omits the attached OOPIF');
    const mutations = jsonLines(path.join(runDir,'dom-mutations.jsonl'));
    assert(mutations.some(row=>iframeSessions.has(row.session) &&
      row.detail?.records?.some(record=>
        JSON.stringify(record).includes('oopif-transient-marker'))),
      'OOPIF transient DOM mutation missing after process swap');
    const resources = jsonLines(path.join(runDir,'resources.jsonl'));
    assert(resources.some(row=>row.url?.endsWith('/payload') && row.status==='saved'),
      'OOPIF natural response body not archived');
    const summary = JSON.parse(fs.readFileSync(path.join(runDir,'summary.json'),'utf8'));
    assert(summary,'summary must remain readable');
    console.log('Real Chromium OOPIF swap/frame/loader, context, DOM and resource evidence verified');
  } finally {
    local?.closeAllConnections();
    local?.close();
    cross.closeAllConnections();
    cross.close();
    fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
