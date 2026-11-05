'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');

const root = process.argv[2];
const command = path.join(root, 'bin/sys/web-analyze');
const env = {...process.env, m_ROOT: root, m_LIB_DIR: path.join(root, 'lib')};
const html = `<!DOCTYPE html><html><head><title>Dynamic evidence fixture</title>
<link rel="stylesheet" href="/view.css"><link rel="manifest" href="/app.webmanifest">
<script type="speculationrules">{"prefetch":[{"source":"list","urls":["/preload-candidate"],"eagerness":"conservative"}]}</script>
<script defer src="/app.js"></script></head>
<body><h1>private-heading-audit-marker</h1><div id="list" class="scroll">
${Array.from({length: 50}, (_,i)=>`<p>row ${i}</p>`).join('')}
</div><form action="/submit" method="post"><input name="search" aria-label="Search term"></form></body></html>`;
const wasmPayload = Buffer.from(
  '0061736d010000000105016000017f030201000707010372756e00000a06010400412a0b', 'hex');
const inlineMap = {
  version:3, sources:['app.source.js'],
  sourcesContent:['// private-inline-original-source-marker'],
  names:[], mappings:''
};
const workerMap = {
  version:3, sources:['worker.source.js'],
  sourcesContent:['// private-external-original-source-marker'],
  names:[], mappings:''
};
const pwaManifest = {name:'Observed PWA resource fixture',short_name:'PWA fixture',
  start_url:'/?token=private-query-audit-marker',scope:'/',display:'standalone',
  icons:[
    {src:'/pwa-icon.png',sizes:'1x1',type:'image/png'},
    {src:'/pwa-icon-not-observed.png',sizes:'1x1',type:'image/png'}
  ]};
const pwaIcon = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YuzpgAAAABJRU5ErkJggg==',
  'base64');
// A valid 0.5-second PCM WAV: the real browser creates its player naturally.
const wav = Buffer.alloc(44 + 4000,128);
wav.write('RIFF',0,'ascii');
wav.writeUInt32LE(wav.length-8,4);
wav.write('WAVEfmt ',8,'ascii');
wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);
wav.writeUInt16LE(1,22);
wav.writeUInt32LE(8000,24);
wav.writeUInt32LE(8000,28);
wav.writeUInt16LE(1,32);
wav.writeUInt16LE(8,34);
wav.write('data',36,'ascii');
wav.writeUInt32LE(4000,40);
const sampleWavURL = 'data:audio/wav;base64,' + wav.toString('base64');
const inlineMapURL = 'data:application/json;base64,' +
  Buffer.from(JSON.stringify(inlineMap)).toString('base64');
const largePayload = Buffer.alloc(3 * 1024 * 1024);
for (let index = 0; index < largePayload.length; index++)
  largePayload[index] = (index * 31 + 19) & 255;
const app = `document.addEventListener('DOMContentLoaded', () => {
  const host = document.createElement('section');
  host.id = 'shadow-probe';
  host.attachShadow({mode:'open'}).innerHTML = '<b id="shadow-inner">Shadow content</b>';
  document.body.append(host);
  const observedIcon = new Image();
  observedIcon.src = '/pwa-icon.png';
  document.body.append(observedIcon);
  // A transient node is created, changed and removed within one task.
  const transient = document.createElement('aside');
  transient.id = 'ephemeral-dom-history';
  transient.textContent = 'private-transient-value';
  document.body.append(transient);
  transient.setAttribute('data-phase', 'created');
  transient.firstChild.nodeValue = 'private-transient-after-change';
  transient.remove();
  const secretHost = document.createElement('article');
  secretHost.id = 'closed-shadow-host';
  const closedRoot = secretHost.attachShadow({mode:'closed'});
  const nestedHost = document.createElement('div');
  nestedHost.id = 'nested-shadow-host';
  closedRoot.append(nestedHost);
  nestedHost.attachShadow({mode:'open'}).innerHTML =
    '<span id="nested-shadow-content">nested content</span>';
  document.body.append(secretHost);
  nestedHost.setAttribute('data-visible-inside-closed', 'yes');
  const dynamicStyle = document.createElement('style');
  dynamicStyle.textContent = '.dynamic-probe { color: blue; } ' +
    '@keyframes fixture-motion { from {transform:translateX(0px)} ' +
    'to {transform:translateX(16px)} } ' +
    '.fixture-animated {animation:fixture-motion 2s linear both}';
  document.head.append(dynamicStyle);
  const animationElement = document.createElement('div');
  animationElement.id = 'fixture-css-animation';
  animationElement.className = 'fixture-animated';
  document.body.append(animationElement);
  const audioElement = document.createElement('audio');
  audioElement.id = 'fixture-media-player';
  audioElement.src = '${sampleWavURL}';
  audioElement.muted = true;
  audioElement.autoplay = true;
  document.body.append(audioElement);
  audioElement.play().catch(() => {});
  // The page owns this disconnected audio graph; the observer never starts
  // playback or drives the WebAudio API. Keep the context alive until rest.
  if ('AudioContext' in window) {
    window.__fixtureAudioContext = new AudioContext();
    window.__fixtureAudioContext.createGain();
  }
  document.addEventListener('rest-probe', () => {});
  WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,7,1,3,114,117,110,0,0,10,6,1,4,0,65,42,11]))
    .then(({instance}) => {
      document.body.dataset.wasmResult = String(instance.exports.run());
    });
  // The page itself naturally requests the worker map: web-analyze must
  // recover the archived response without issuing another network request.
  fetch('/background-worker.js.map');
  const worker = new Worker('/background-worker.js');
  worker.addEventListener('message', event => {
    document.body.dataset.workerReply = String(event.data);
  });
  if ('SharedWorker' in window) {
    const shared = new SharedWorker('/shared-worker.js');
    shared.port.onmessage = event => {
      document.body.dataset.sharedWorkerReply = String(event.data);
    };
    shared.port.start();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(() => {document.body.dataset.serviceWorkerRegistered = 'yes';})
      .catch(() => {document.body.dataset.serviceWorkerRegistered = 'no';});
    // The fixture, not the analyzer, registers an independently scoped
    // short-lived worker that terminates itself after activation. Its
    // registration must remain discoverable without a running worker.
    navigator.serviceWorker.register('/inactive-service-worker.js', {scope:'/inactive/'})
      .then(async registration => {
        for (let i=0; i<25 && registration.active?.state !== 'activated'; i++)
          await new Promise(resolve => setTimeout(resolve, 100));
        await new Promise(resolve => setTimeout(resolve, 700));
        const persisted = await navigator.serviceWorker.getRegistration('/inactive/');
        document.body.dataset.inactiveServiceWorkerPersisted =
          persisted?.active?.scriptURL.endsWith('/inactive-service-worker.js') ? 'yes' : 'no';
      }).catch(() => {document.body.dataset.inactiveServiceWorkerPersisted = 'no';});
  }
  const sameFrame = document.createElement('iframe');
  sameFrame.id = 'same-origin-frame';
  sameFrame.src = '/frame.html';
  document.body.append(sameFrame);
  const crossFrame = document.createElement('iframe');
  crossFrame.id = 'other-origin-frame';
  crossFrame.src = document.documentElement.dataset.crossOriginFrame;
  document.body.append(crossFrame);
  localStorage.setItem('fixtureSession', 'fixture-only-access');
  sessionStorage.setItem('fixtureView', 'test-123');
  const database = indexedDB.open('rest-database', 1);
  database.onupgradeneeded = () => database.result.createObjectStore('records', {keyPath:'id'});
  database.onsuccess = () => {
    const transaction = database.result.transaction('records', 'readwrite');
    transaction.objectStore('records').put({id:'alpha', value:'idb-payload'});
    transaction.oncomplete = () => {
      document.body.dataset.idbReady = 'yes';
      database.result.close();
    };
  };
  caches.open('rest-cache')
    .then(cache => cache.put('/cached-fixture', new Response('cached-payload')))
    .then(() => {document.body.dataset.cacheReady = 'yes';});
  if (typeof navigator.storage?.getDirectory === 'function') {
    navigator.storage.getDirectory().then(async root => {
      const file = await root.getFileHandle('default-opfs-file', {create:true});
      const writable = await file.createWritable();
      await writable.write(new Uint8Array([0,7,255,42,0,128]));
      await writable.close();
      document.body.dataset.defaultOpfsReady = 'yes';
    }).catch(() => {document.body.dataset.defaultOpfsReady = 'no';});
  }
  if (typeof navigator.storageBuckets?.open === 'function') {
    navigator.storageBuckets.open('analyze-fixture-bucket').then(async bucket => {
      if (bucket.caches?.open) {
        const cache = await bucket.caches.open('named-bucket-cache');
        await cache.put('/named-bucket-fixture', new Response('named-bucket-payload'));
      }
      if (typeof bucket.getDirectory === 'function') {
        const root = await bucket.getDirectory();
        const file = await root.getFileHandle('named-bucket-file', {create:true});
        const writable = await file.createWritable();
        await writable.write('named-bucket-file-body');
        await writable.close();
      }
      document.body.dataset.namedBucketReady = 'yes';
    }).catch(() => {document.body.dataset.namedBucketReady = 'no';});
  }
  fetch('/data.json', {headers:{'X-Fixture-Request':'captured'}});
  fetch('/submit-data', {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({marker:'request-body-marker'})});
  fetch('/redirect-start');
  fetch('/large.bin');
  fetch('/burst').then(response => response.text()).then(text => {
    document.body.dataset.burstComplete =
      text === 'alpha-piece-beta-piece-gamma-piece' ? 'yes' : 'no';
  });
  fetch('/cacheable').then(() => fetch('/cacheable'));
  const feed = new EventSource('/live-events');
  feed.onmessage = event => {
    document.body.dataset.lastEvent = event.data;
    if (event.data === 'last-event') feed.close();
  };
  setTimeout(() => feed.close(), 1500);
  const aborted = new AbortController();
  fetch('/abort-stream', {signal:aborted.signal}).catch(() => {});
  setTimeout(() => aborted.abort(), 450);
  setTimeout(() => {
    const hydrated = document.createElement('section');
    hydrated.id = 'hydrated'; hydrated.textContent = 'Delayed hydrated content';
    document.body.append(hydrated);
    fetch('/hydrated.json');
  }, 1200);
  document.querySelector('#list').addEventListener('scroll', () => {
    if (document.querySelector('#list').scrollTop > 50 && !document.querySelector('#lazy')) {
      setTimeout(() => {
        const button = document.createElement('button');
        button.id = 'lazy'; button.textContent = 'Lazy control'; document.body.append(button);
        fetch('/lazy.json');
      }, 700);
    }
  });
});
//# sourceMappingURL=${inlineMapURL}`;

async function run(args)
{
  const processHandle = spawn(command, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  processHandle.stdout.on('data', chunk => {stdout += chunk.toString();});
  processHandle.stderr.on('data', chunk => {stderr += chunk.toString();});
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      processHandle.kill('SIGKILL');
      reject(new Error('web-analyze timeout: ' + stderr));
    }, 120000);
    processHandle.on('error', error => {clearTimeout(timeout);reject(error);});
    processHandle.on('exit', exitCode => {clearTimeout(timeout);resolve(exitCode);});
  });
  return {code, stdout, stderr};
}

async function main()
{
  const noEnvironment = spawnSync(command, [], {env: {...process.env, m_ROOT: ''}, encoding: 'utf8'});
  assert.equal(noEnvironment.status, 1);
  assert.match(noEnvironment.stderr, /m-environment-missing/);
  const noOperands = spawnSync(command, [], {env, encoding: 'utf8'});
  assert.equal(noOperands.status, 2);
  assert.match(noOperands.stderr, /invalid-arguments/);
  const wrongScheme = spawnSync(command, ['file:///etc/passwd', '/tmp/unused'], {env, encoding: 'utf8'});
  assert.equal(wrongScheme.status, 4);

  const burstStats = {started:0, chunks:0, ended:0, closed:0};
  let secondaryBucketReady = 0;
  let secondaryCacheReady = 0;
  const crossServer = http.createServer((req, res) => {
    const location = new URL(req.url, 'http://localhost');
    const endpoint = location.pathname;
    if (endpoint === '/secondary-bucket-ready')
    {
      secondaryBucketReady++;
      if (location.searchParams.get('cache') === '1')
        secondaryCacheReady++;
      res.setHeader('Content-Type','text/plain');
      res.end('ready');
      return;
    }
    if (endpoint === '/process-payload')
    {
      res.setHeader('Content-Type', 'text/plain');
      res.end('process-ready');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (endpoint === '/process-done')
    {
      res.end('<!doctype html><title>Process destination</title>' +
        '<body><h1>Natural cross-origin navigation</h1>' +
        '<script>fetch("/process-payload").then(r=>r.text()).then(t=>' +
        '{document.body.dataset.processReady=t})</script></body>');
      return;
    }
    res.end('<!doctype html><title>Cross-origin frame</title>' +
      '<body><p id="cross-origin-content">Independent origin</p>' +
      '<script>const marker=document.createElement("b");' +
      'marker.id="cross-frame-transient";document.body.append(marker);' +
      'marker.remove();' +
      '(async()=>{' +
      'if(typeof navigator.storageBuckets?.open!=="function") return;' +
      'const bucket=await navigator.storageBuckets.open("secondary-frame-bucket");' +
      'let cacheReady=false;' +
      'if(typeof bucket.caches?.open==="function"){' +
      'const cache=await bucket.caches.open("secondary-frame-cache");' +
      'await cache.put("/secondary-cache-entry",new Response("secondary-cache-body"));' +
      'cacheReady=true;}' +
      'document.body.dataset.secondaryBucketReady="yes";' +
      'fetch("/secondary-bucket-ready?cache="+(cacheReady?"1":"0"));' +
      '})().catch(()=>{document.body.dataset.secondaryBucketReady="no"});' +
      '</script></body>');
  });
  await new Promise(resolve => crossServer.listen(0, '127.0.0.1', resolve));
  const crossUrl = 'http://127.0.0.1:' + crossServer.address().port + '/child.html';
  const server = http.createServer((req, res) => {
    const location = new URL(req.url, 'http://127.0.0.1').pathname;
    if (location === '/process-start')
    {
      const destination = 'http://localhost:' + crossServer.address().port +
        '/process-done';
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Process origin</title><body>' +
        '<script>fetch("/before-process").then(r=>r.text()).catch(()=>{});' +
        'setTimeout(()=>location.href=' + JSON.stringify(destination) +
        ',700)</script></body>');
      return;
    }
    if (location === '/before-process')
    {
      res.setHeader('Content-Type', 'text/plain');
      setTimeout(() => res.end('late-before-process'), 1300);
      return;
    }
    if (location === '/churn')
    {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Continuous mutations</title><body><div id="churn"></div><script>' +
        'setInterval(() => document.querySelector("#churn").textContent = String(Date.now()), 90)' +
        '</script></body>');
      return;
    }
    if (location === '/redirect-start')
    {
      res.statusCode = 302;
      res.setHeader('Location', '/redirect-end');
      res.end();
      return;
    }
    if (location === '/large.bin')
    {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(largePayload);
      return;
    }
    if (location === '/burst' || location === '/abort-stream' ||
        location === '/live-events')
    {
      if (location === '/burst') burstStats.started++;
      res.setHeader('Content-Type',
        location === '/live-events' ? 'text/event-stream' : 'text/plain');
      res.setHeader('Cache-Control', 'no-store');
      res.flushHeaders();
      const fragments = location === '/live-events' ?
        ['data: first-event\\n\\n', 'data: last-event\\n\\n'] :
        ['alpha-piece-', 'beta-piece-', 'gamma-piece'];
      let index = 0;
      const timer = setInterval(() =>
      {
        if (res.destroyed || index >= fragments.length)
        {
          clearInterval(timer);
          return;
        }
        res.write(fragments[index++]);
        if (location === '/burst') burstStats.chunks++;
        if (index === fragments.length && location === '/burst')
        {
          clearInterval(timer);
          burstStats.ended++;
          res.end();
        }
      }, 120);
      res.on('close', () => {
        if (location === '/burst') burstStats.closed++;
        clearInterval(timer);
      });
      return;
    }
    const data = {
      '/': [html, 'text/html'],
      '/app.webmanifest': [JSON.stringify(pwaManifest), 'application/manifest+json'],
      '/pwa-icon.png': [pwaIcon, 'image/png'],
      '/view.css': [':root {--fixture-accent: rgb(12, 34, 56)} ' +
        '.scroll {height: 160px; overflow-y: auto} ' +
        '#list {color: var(--fixture-accent)} p {height: 35px} ' +
        '.unused-css-coverage-marker {outline: 9px solid magenta}', 'text/css'],
      '/app.js': [app, 'text/javascript'],
      '/background-worker.js': [
        'postMessage("worker-ready");setInterval(()=>{},5000);' +
          '\n//# sourceMappingURL=/background-worker.js.map',
        'text/javascript'],
      '/background-worker.js.map': [JSON.stringify(workerMap), 'application/json'],
      '/shared-worker.js': [
        'onconnect=e=>{e.ports[0].postMessage("shared-ready");e.ports[0].start()};',
        'text/javascript'],
      '/service-worker.js': [
        'self.addEventListener("install",()=>{});self.addEventListener("activate",()=>{});',
        'text/javascript'],
      '/inactive-service-worker.js': [
        'self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));' +
          'self.addEventListener("activate",e=>{' +
          'e.waitUntil(self.clients.claim());' +
          'setTimeout(()=>self.close(),250)' +
          '});',
        'text/javascript'],
      '/frame.html': [
        '<!doctype html><title>Frame child</title><body><p>Same-origin iframe</p>' +
          '<script>const marker=document.createElement("b");' +
          'marker.id="same-frame-transient";document.body.append(marker);' +
          'marker.remove();</script></body>',
        'text/html'],
      '/data.json': ['{"initial":true}', 'application/json'],
      '/preload-candidate': ['prefetch-candidate', 'text/plain'],
      '/lazy.json': ['{"lazy":true}', 'application/json'],
      '/hydrated.json': ['{"hydrated":true}', 'application/json'],
      '/submit-data': ['{"accepted":true}', 'application/json'],
      '/redirect-end': ['redirect-target', 'text/plain'],
      '/cacheable': ['cached-once', 'text/plain']
    }[location];
    if (!data) {res.statusCode=404;res.end('not found');return;}
    res.setHeader('Content-Type', data[1]);
    if (location === '/')
      res.setHeader('Set-Cookie', 'fixture_cookie=fixture-only-secret; HttpOnly; SameSite=Lax; Path=/');
    if (location === '/cacheable')
      res.setHeader('Cache-Control', 'public, max-age=300');
    if (location === '/hydrated.json')
      setTimeout(() => res.end(data[0]), 600);
    else if (location === '/')
      res.end(data[0].replace('<html>', '<html data-cross-origin-frame="' +
        crossUrl + '">'));
    else
      res.end(data[0]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'web-analyze-command-'));
  try
  {
    const uri = `http://127.0.0.1:${server.address().port}/?token=private-query-audit-marker`;
    const base = path.join(work, 'reports');
    const result = await run([uri, base, '--scroll']);
    assert.equal(result.code, 0, `analysis exit ${result.code}: ${result.stderr}`);
    const report = result.stdout.trim();
    assert(report.endsWith('/README.md'), 'command did not emit README path');
    assert(fs.existsSync(report), 'report path is not present');
    const capture = path.dirname(report);
    assert.equal(fs.statSync(capture).mode & 0o777, 0o700, 'recording directory is not private');
    for (const file of ['DOM.md', 'NETWORK.md', 'SCRIPTS.md', 'FLOWS.md',
      'LIMITATIONS.md', 'summary.json', 'resources.jsonl', 'scripts.jsonl',
      'cdp-wire.jsonl', 'cdp-capabilities.json', 'cdp-protocol.json',
      'states/state-000.json', 'states/screen-000.png',
      'states/dom-rest-initial.html', 'states/dom-rest-initial.json',
      'states/dom-rest-final.html', 'states/dom-rest-final.json',
      'rest/manifest.json', 'rest/security/index.json',
       'rest/worker-provenance/index.json',
       'rest/optional-domains/index.json',
       'rest/pwa-resources/index.json', 'rest/page.mhtml',
      'rest/targets/target-000/dom-tree.json',
      'rest/targets/target-000/dom-snapshot.json',
      'rest/resources-at-rest.jsonl', 'rest/scripts-at-rest.jsonl',
      'rest/cookies.json', 'rest/targets/target-000/storage.json',
      'network-details.jsonl', 'rest/network-details-at-rest.jsonl',
      'rest/targets/target-000/indexeddb/index.json',
      'rest/targets/target-000/cache-storage/index.json',
      'rest/targets/target-000/storage-usage.json',
      'rest/target-graph-initial.json', 'rest/target-graph-final.json',
      'dom-mutations.jsonl', 'rest/dom-mutations-at-rest.jsonl',
      'rest/dom-history-contexts.json'])
      assert(fs.existsSync(path.join(capture, file)),
        'missing ' + file + '; capture stderr: ' + result.stderr +
        '; rest entries: ' + (fs.existsSync(path.join(capture, 'rest')) ?
          fs.readdirSync(path.join(capture, 'rest')).join(', ') : 'absent') +
        '; limitations: ' + (fs.existsSync(path.join(capture, 'LIMITATIONS.md')) ?
          fs.readFileSync(path.join(capture, 'LIMITATIONS.md'), 'utf8') :
          'not generated'));
    const states = fs.readdirSync(path.join(capture, 'states'))
      .filter(name => /^state-\d+\.json$/.test(name))
      .map(name => JSON.parse(fs.readFileSync(path.join(capture, 'states', name), 'utf8')));
    assert(states.length >= 2, 'nested scroll was not explored');
    const capabilities = JSON.parse(fs.readFileSync(path.join(capture,
      'cdp-capabilities.json'), 'utf8'));
    assert.equal(capabilities.status, 'saved',
      'local Chromium version/protocol schema not discovered');
    assert.equal(capabilities.browser.status, 'saved');
    assert.match(capabilities.browser.product, /Chrome|Chromium/);
    const protocol = JSON.parse(fs.readFileSync(path.join(capture,
      'cdp-protocol.json'), 'utf8'));
    assert(protocol.domains.some(domain => domain.domain === 'Runtime'));
    assert(capabilities.protocol.domains.some(domain =>
      domain.name === 'Network' && domain.commands.includes('getResponseBody')));
    assert(capabilities.protocol.domains.some(domain =>
      domain.name === 'Accessibility' && domain.commands.includes('getFullAXTree')),
      'Chromium fixture needs the full accessibility tree CDP method');
    const wire = fs.readFileSync(path.join(capture,'cdp-wire.jsonl'),'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    assert(wire.length > 20, 'CDP wire ledger is unexpectedly small');
    assert(wire.every((entry,i) => entry.sequence === i + 1),
      'wire ledger ordering or sequence has a gap');
    const parsedWire = wire.map(entry => ({
      direction:entry.direction, packet:JSON.parse(entry.raw)
    }));
    const pageScriptSchema = protocol.domains.find(item =>
      item.domain === 'Page')?.commands?.find(item =>
      item.name === 'addScriptToEvaluateOnNewDocument');
    const runImmediately = !!pageScriptSchema?.parameters?.some(item =>
      item.name === 'runImmediately');
    assert.equal(capabilities.protocol.pageScriptRunImmediatelySupported,
      runImmediately, 'existing-context injection support must match installed schema');
    const installedScripts = parsedWire.filter(entry =>
      entry.direction === 'outbound' &&
      entry.packet.method === 'Page.addScriptToEvaluateOnNewDocument');
    assert(installedScripts.length > 0,
      'document-start observer injection was never negotiated with Chromium');
    assert(installedScripts.every(entry =>
      entry.packet.params?.runImmediately === (runImmediately ? true : undefined)),
      'existing-context observer injection was not browser-schema gated');
    assert(parsedWire.some(entry => entry.direction === 'inbound' &&
      entry.packet.method === 'Runtime.executionContextCreated'),
      'unhandled-by-dispatcher CDP event was silently discarded');
    assert(parsedWire.some(entry => entry.direction === 'outbound' &&
      entry.packet.method === 'Browser.getVersion'),
      'browser-level CDP commands were not archived');
    const securityCommands = parsedWire.filter(entry =>
      entry.direction === 'outbound' && typeof entry.packet.method === 'string' &&
      (entry.packet.method.startsWith('Security.') ||
        entry.packet.method === 'Network.getCertificate'));
    assert.deepEqual(securityCommands.map(entry => entry.packet.method), [],
      'passive HTTP capture must neither change certificate handling nor ' +
      'request a TLS chain from a non-HTTPS origin');
    assert(!parsedWire.some(entry => entry.direction === 'outbound' &&
      ['ServiceWorker.startWorker','ServiceWorker.stopWorker',
        'ServiceWorker.stopAllWorkers','ServiceWorker.unregister',
        'ServiceWorker.updateRegistration','ServiceWorker.skipWaiting',
        'ServiceWorker.deliverPushMessage','ServiceWorker.setForceUpdateOnPageLoad']
        .includes(entry.packet.method)),
      'passive worker inventory must never change registration or worker state');
    assert(!parsedWire.some(entry => entry.direction === 'outbound' &&
      ['Page.getResourceContent','Page.navigateToHistoryEntry',
        'Page.reload'].includes(entry.packet.method)),
      'PWA evidence must not issue new page resource fetches or navigations');
    const sent = new Set(parsedWire.filter(entry => entry.direction === 'outbound')
      .map(entry => entry.packet.id));
    assert(parsedWire.some(entry => entry.direction === 'inbound' &&
      sent.has(entry.packet.id)), 'no CDP request/response correlation survives');
    const wireSummary = JSON.parse(fs.readFileSync(path.join(capture,
      'summary.json'),'utf8')).resourceCapture.wireCapture;
    assert.equal(wireSummary.status, 'saved');
    assert.equal(wireSummary.packets, wire.length);
    assert.equal(wireSummary.errors.length, 0);
    assert(wire.some(entry => entry.raw.includes('X-Fixture-Request')),
      'wire archive omitted an observed HTTP request header');
    const diagnosticNetwork = fs.readFileSync(path.join(capture,
      'network.jsonl'), 'utf8');
    assert(!diagnosticNetwork.includes('X-Fixture-Request'),
      'privacy-redacted network diagnostics exposed raw request headers');
    for (const file of ['cdp-wire.jsonl','cdp-capabilities.json','cdp-protocol.json'])
      assert.equal(fs.statSync(path.join(capture,file)).mode & 0o777, 0o600,
        'CDP evidence files must be private: ' + file);
    const history = fs.readFileSync(path.join(capture,
      'dom-mutations.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert(history.length > 10, 'DOM history did not record page activity');
    assert(history.every((item, index) => item.sequence === index + 1),
      'raw DOM history contains a missing/reordered event');
    const batches = history.filter(item => item.detail.type === 'mutation-batch');
    const changes = batches.flatMap(item => item.detail.records);
    const appeared = changes.flatMap(change => change.added || [])
      .find(node => node?.html?.value?.includes('ephemeral-dom-history'));
    assert(appeared, 'short-lived element was not captured at insertion');
    assert(changes.some(change => change.removed?.some(node =>
      node.id === appeared.id)), 'transient element removal was not preserved');
    assert(changes.some(change => change.type === 'attributes' &&
      change.name === 'data-phase'), 'DOM attribute history was not saved');
    assert(changes.some(change => change.type === 'characterData' &&
      change.current?.value === 'private-transient-after-change'),
      'DOM text change was not preserved');
    assert(history.some(item => item.detail.type === 'shadow-attached' &&
      item.detail.mode === 'closed'), 'closed ShadowRoot attachment missing');
    assert(history.some(item => item.detail.type === 'shadow-attached' &&
      item.detail.mode === 'open'), 'nested open ShadowRoot attachment missing');
    assert(changes.some(change => change.added?.some(node =>
      node?.html?.value?.includes('nested-shadow-content'))),
      'nested shadow subtree missing from private mutation history');
    const sameFrameHistory = history.filter(item =>
      item.detail.documentURL?.endsWith('/frame.html'));
    const sameFrameMutationRecords = sameFrameHistory
      .filter(item => item.detail.type === 'mutation-batch')
      .flatMap(item => item.detail.records);
    const frameNavigation = parsedWire.find(item =>
      item.direction === 'inbound' &&
      item.packet.method === 'Page.frameNavigated' &&
      item.packet.params?.frame?.url?.endsWith('/frame.html'));
    const frameId = frameNavigation?.packet.params?.frame?.id;
    const frameContexts = parsedWire.filter(item =>
      item.direction === 'inbound' &&
      item.packet.method === 'Runtime.executionContextCreated' &&
      item.packet.params?.context?.auxData?.frameId === frameId);
    const frameBindings = parsedWire.filter(item =>
      item.direction === 'inbound' &&
      item.packet.method === 'Runtime.bindingCalled' &&
      frameContexts.some(context =>
        context.packet.params?.context?.id === item.packet.params?.executionContextId &&
        context.packet.sessionId === item.packet.sessionId));
    assert(sameFrameHistory.length > 0,
      'same-origin frame mutation chronology missing: ' +
      JSON.stringify({frameNavigated:!!frameId, contexts:frameContexts.length,
        bindings:frameBindings.length, historyEvents:sameFrameHistory.length}));
    assert(sameFrameMutationRecords.some(change => change.added?.some(node =>
      node?.html?.value?.includes('same-frame-transient'))),
      'synchronous same-origin iframe insertion was not captured');
    assert(sameFrameMutationRecords.some(change => change.removed?.some(node =>
      node?.html?.value?.includes('same-frame-transient'))),
      'synchronous same-origin iframe removal was not captured');
    assert(history.some(item => item.detail.documentURL?.endsWith('/child.html')),
      'cross-origin iframe mutation chronology missing');
    assert(history.some(item => item.frameId),
      'DOM history lacks individual frame identifiers');
    assert(history.every(item => !!item.targetId && item.executionContextId > 0),
      'DOM history lacks CDP execution-context provenance');
    const atRestHistory = fs.readFileSync(path.join(capture,
      'rest/dom-mutations-at-rest.jsonl'), 'utf8');
    assert(atRestHistory.includes('ephemeral-dom-history'),
      'rest-phase history omitted transient node');
    const historyContexts = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/dom-history-contexts.json'), 'utf8'));
    assert(historyContexts.contexts.some(context =>
      context.status === 'saved' &&
      context.observer?.closedRootsIntercepted >= 1 &&
      context.observer?.hookStillInstalled === true),
      'document instrumentation did not report a healthy shadow-root observer');
    const domSummary = JSON.parse(fs.readFileSync(path.join(capture,
      'summary.json'), 'utf8')).resourceCapture.domHistory;
    assert.equal(domSummary.status, 'saved');
    assert.equal(domSummary.events, history.length);
    assert(domSummary.records >= changes.length);
    assert.equal(domSummary.errors.length, 0);
    for (const file of ['dom-mutations.jsonl', 'rest/dom-mutations-at-rest.jsonl',
      'rest/dom-history-contexts.json'])
      assert.equal(fs.statSync(path.join(capture,file)).mode & 0o777, 0o600,
        'DOM history evidence must remain private: ' + file);
    assert(!fs.readFileSync(path.join(capture, 'dom.jsonl'),'utf8')
      .includes('private-transient-value'), 'private DOM contents leaked into diagnostics');
    assert(!fs.readFileSync(path.join(capture,
      'states/dom-rest-initial.html'),'utf8').includes('ephemeral-dom-history'),
      'transient element must not appear in the final-state DOM snapshot');
    const targetGraph = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/target-graph-final.json'), 'utf8'));
    assert.equal(targetGraph.discovery.status, 'saved');
    assert(targetGraph.targets.some(target => target.type === 'page' && target.attached),
      'initial page missing from CDP target inventory');
    const workerTarget = targetGraph.targets.find(target =>
      target.type === 'worker' && target.attached);
    assert(workerTarget, 'dedicated worker missing from attached-target graph');
    assert(targetGraph.targets.some(target => target.type === 'shared_worker'),
      'shared worker target missing from Chromium discovery');
    assert(targetGraph.targets.some(target => target.type === 'service_worker'),
      'service worker target missing from Chromium discovery');
    assert(targetGraph.contexts.some(context => context.targetId === workerTarget.targetId),
      'worker execution context missing from lifecycle graph');
    assert(targetGraph.targets.some(target => target.type === 'page' &&
      target.targetId !== workerTarget.targetId),
      'main page was not preserved in target graph');
    const rest = JSON.parse(fs.readFileSync(path.join(capture, 'rest/manifest.json'), 'utf8'));
    const workerEntry = rest.targets.find(target =>
      target.type === 'worker' && target.targetId === workerTarget.targetId);
    assert(workerEntry, 'worker target was not independently captured at rest');
    const workerData = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets', workerEntry.name, 'worker-environment.json'), 'utf8'));
    assert(JSON.stringify(workerData).includes('background-worker.js'),
      'worker global environment not captured by CDP');
    const frameTree = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/frame-tree.json'), 'utf8'));
    assert(JSON.stringify(frameTree).includes('child.html'),
      'cross-origin iframe missing from CDP frame tree');
    assert(!targetGraph.targets.some(target => target.type === 'worker' &&
      target.attached && !target.ready), 'attached worker was not instrumented');
    assert.equal(rest.phase, 'rest-before-automated-input');
    const accessibilityRoot = path.join(capture,
      'rest/targets/target-000/accessibility');
    const accessibilityIndex = JSON.parse(fs.readFileSync(
      path.join(accessibilityRoot, 'index.json'), 'utf8'));
    assert(['saved','partial'].includes(accessibilityIndex.status),
      'accessibility status must describe actual frame collection');
    assert(accessibilityIndex.frames.length >= 1,
      'the primary document must have an accessibility frame entry');
    const accessibilityFrame = accessibilityIndex.frames[0];
    assert.equal(accessibilityFrame.status, 'saved',
      'primary frame accessibility tree was not captured');
    const accessibilityFile = path.join(accessibilityRoot, accessibilityFrame.file);
    const accessibilityTree = JSON.parse(fs.readFileSync(accessibilityFile, 'utf8'));
    assert(accessibilityTree.nodes.some(node =>
      node.role?.value === 'heading' &&
      node.name?.value === 'private-heading-audit-marker'),
      'full accessibility tree omitted the page heading');
    assert(accessibilityTree.nodes.some(node =>
      Number.isInteger(node.backendDOMNodeId)),
      'accessibility nodes are missing DOM backend identity links');
    assert.equal(fs.statSync(accessibilityFile).mode & 0o777, 0o600,
      'full accessibility frame evidence must remain private');
    assert(rest.artifacts.some(item => item.name === 'accessibility' &&
      item.file === 'accessibility/index.json'),
      'accessibility collection outcome omitted from rest manifest');
    const cssRoot = path.join(capture, 'rest/targets/target-000/css-nodes');
    const cssIndex = JSON.parse(fs.readFileSync(path.join(cssRoot,'index.json'), 'utf8'));
    assert.equal(cssIndex.methods.computed, true,
      'browser-specific CSS computed-style method not discovered');
    assert.equal(cssIndex.methods.matched, true,
      'browser-specific CSS matched-style method not discovered');
    assert(cssIndex.observedElements >= cssIndex.selectedElements,
      'CSS enumeration counters are inconsistent');
    assert(cssIndex.pages.length > 0, 'per-node CSS results are missing');
    const cssPages = cssIndex.pages.flatMap(page => JSON.parse(
      fs.readFileSync(path.join(cssRoot,page.file), 'utf8')).nodes);
    const cssNode = cssPages.find(node => {
      const attributes = node.attributes || [];
      return attributes.some((value,index) =>
        value === 'id' && attributes[index+1] === 'list');
    });
    assert(cssNode, 'CSS node catalog omitted known nested scroller');
    assert.equal(cssNode.methods.computed.status, 'saved',
      'scroller full computed style was not captured');
    assert.equal(cssNode.methods.matched.status, 'saved',
      'scroller full CSS rule cascade was not captured');
    const computed = cssNode.methods.computed.result.computedStyle;
    assert(computed.some(item => item.name === 'color' &&
      item.value === 'rgb(12, 34, 56)'),
      'resolved CSS variable did not affect computed style');
    assert(computed.some(item => item.name === '--fixture-accent'),
      'CSS custom property was missing from computed style');
    assert(cssNode.methods.matched.result.matchedCSSRules.some(item =>
      item.rule?.selectorList?.text?.includes('#list')),
      'CSS selector/rule provenance was not saved');
    assert(cssPages.some(node => node.methods.fonts?.status === 'saved'),
      'platform font inventory was not attempted successfully');
    assert.equal(fs.statSync(path.join(cssRoot,cssIndex.pages[0].file)).mode & 0o777,
      0o600, 'private CSS node output must not be world readable');
    assert(rest.artifacts.some(item => item.name === 'css-node-details' &&
      item.file === 'css-nodes/index.json'),
      'CSS node coverage and limitations absent from rest manifest');
    assert(capabilities.protocol.domains.some(domain =>
      domain.name === 'CSS' && domain.commands.includes('startRuleUsageTracking') &&
      domain.commands.includes('stopRuleUsageTracking')),
      'native Chromium CSS rule-usage methods were not available');
    const coverageRoot = path.join(capture, 'rest/css-rule-usage');
    assert(fs.existsSync(path.join(coverageRoot, 'index.json')),
      'CSS rule-use index missing; private fixture error: ' +
      (fs.existsSync(path.join(capture, 'rest/css-rule-usage-error.json')) ?
        fs.readFileSync(path.join(capture,
          'rest/css-rule-usage-error.json'), 'utf8') : 'none recorded'));
    const coverageIndex = JSON.parse(fs.readFileSync(path.join(coverageRoot,
      'index.json'), 'utf8'));
    assert(['saved','partial'].includes(coverageIndex.status),
      'CSS rule-use target omissions must remain explicitly partial');
    assert.equal(coverageIndex.scope, 'initial-navigation-to-rest-entry');
    assert(coverageIndex.entries.length > 0, 'CSS coverage targets missing');
    const usedEntries = coverageIndex.entries.filter(item => item.status === 'saved');
    assert(usedEntries.length > 0,
      'CSS rule tracking did not start before navigation: ' +
      JSON.stringify(coverageIndex.entries.map(item => ({
        type:item.type, status:item.status, errorCode:item.errorCode || null
      }))));
    const mainCoverageTarget = rest.targets.find(item => item.main);
    assert(mainCoverageTarget && usedEntries.some(item =>
      item.targetId === mainCoverageTarget.targetId),
      'initial page selector usage was not obtained from its CDP target: ' +
      JSON.stringify(coverageIndex.entries.map(item => ({
        type:item.type, status:item.status, errorCode:item.errorCode || null
      }))));
    const coverage = usedEntries.flatMap(item =>
      JSON.parse(fs.readFileSync(path.join(coverageRoot, item.file), 'utf8')).ruleUsage);
    const availableStyleRows = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/stylesheets/index.json'), 'utf8'));
    const availableFixtureSheet = availableStyleRows.find(item =>
      item.status === 'saved' && item.sourceURL?.endsWith('/view.css'));
    assert(availableFixtureSheet, 'original fixture stylesheet not indexed');
    const authoredStyles = fs.readFileSync(path.join(capture, 'rest',
      availableFixtureSheet.file), 'utf8');
    assert(authoredStyles.includes('.unused-css-coverage-marker'),
      'available CSS source is expected to contain the deliberately unvisited rule');
    assert(coverage.some(item => item.used === true && item.styleSheetId),
      'used stylesheet rules missing from pre-scroll coverage');
    // CDP is permitted to return only observed rule-use ranges; absence
    // of a rule is not proof that the rule was unused at every instant.
    assert(coverage.every(item => typeof item.used === 'boolean'),
      'CDP rule-use entries must preserve the original used flag');
    assert(usedEntries.every(item => Number.isInteger(item.reportedUnused) &&
      item.reportedUnused >= 0 && item.used >= 0),
      'coverage counts must distinguish reported false flags from omissions');
    assert(usedEntries.every(item => Date.parse(item.stoppedAt) >=
      Date.parse(item.startedAt)), 'CSS rule-use capture timing is invalid');
    assert(usedEntries.every(item =>
      (fs.statSync(path.join(coverageRoot, item.file)).mode & 0o777) === 0o600),
      'CSS rule-use records must remain private');
    assert(rest.artifacts.some(item => item.name === 'css-rule-usage' &&
      item.file === 'css-rule-usage/index.json'),
      'rule usage coverage absent from rest manifest');
    assert(rest.artifacts.some(item => item.name === 'resources-at-rest' &&
      item.status === 'saved'), 'rest resource index missing');
    assert(rest.artifacts.some(item => item.name === 'scripts-at-rest' &&
      item.status === 'saved'), 'rest compiled-script index missing');
    assert(rest.artifacts.some(item => item.name === 'dom-tree' && item.status === 'saved'));
    assert(rest.artifacts.some(item => item.name === 'dom-snapshot' && item.status === 'saved'));
    assert(rest.artifacts.some(item => item.name === 'page' && item.status === 'saved'));
    const cookies = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/cookies.json'), 'utf8'));
    assert(cookies.some(item => item.name === 'fixture_cookie' &&
      item.value === 'fixture-only-secret' && item.httpOnly === true),
      'HTTP-only cookie unavailable from the private rest dump');
    const contextPath = path.join(capture,
      'rest/targets/target-000/frame-context.json');
    const frameContext = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
    assert(frameContext.frames.length >= 1,
      'frame-level storage/security inventory was not collected');
    assert.equal(frameContext.scope, 'observed-read-only-context-metadata');
    const primaryFrame = frameContext.frames[0];
    assert(primaryFrame.frameId, 'main frame identity was not retained');
    const hasMethod = (domain, method) => capabilities.protocol.domains.some(item =>
      item.name === domain && item.commands.includes(method));
    if (hasMethod('Storage', 'getStorageKey'))
    {
      assert.equal(primaryFrame.storageKey.status, 'saved',
        'supported storage-key lookup should succeed for the main frame');
      assert.equal(typeof primaryFrame.storageKey.result.storageKey, 'string');
      assert(primaryFrame.storageKey.result.storageKey.includes('127.0.0.1'),
        'main storage key should be derived from the actual local fixture frame');
    }
    for (const [field, domain, method] of [
      ['permissionsPolicy', 'Page', 'getPermissionsPolicyState'],
      ['originTrials', 'Page', 'getOriginTrials'],
      ['securityIsolation', 'Network', 'getSecurityIsolationStatus']
    ])
    {
      assert(primaryFrame[field], 'missing per-frame ' + method + ' outcome');
      if (hasMethod(domain, method))
        assert(['saved', 'partial'].includes(primaryFrame[field].status),
          'supported browser method outcome was lost: ' + method);
      else
        assert.equal(primaryFrame[field].status, 'unsupported',
          'absent browser method was incorrectly treated as available: ' + method);
    }
    assert(frameContext.bucketNames && frameContext.opfsSupport,
      'bucket and OPFS capability outcomes were not recorded');
    assert.equal(frameContext.opfsSupport.enumerated, false,
      'OPFS must not be entered implicitly during passive rest inspection');
    for (const field of ['resourceTree', 'appManifest'])
      assert(frameContext[field], 'missing read-only page inventory: ' + field);
    assert.equal(fs.statSync(contextPath).mode & 0o777, 0o600,
      'raw security and storage context metadata must remain private');
    assert(secondaryBucketReady > 0,
      'cross-origin child never populated its own named Storage Bucket');
    const observedSecondary = [];
    for (const capturedTarget of rest.targets.filter(target =>
      !['worker','shared_worker','service_worker'].includes(target.type)))
    {
      const prefix = path.join(capture,'rest/targets',capturedTarget.name);
      let childContext, tree, partition;
      try
      {
        childContext = JSON.parse(fs.readFileSync(
          path.join(prefix,'frame-context.json'),'utf8'));
        tree = JSON.parse(fs.readFileSync(path.join(prefix,'frame-tree.json'),'utf8'));
        partition = JSON.parse(fs.readFileSync(
          path.join(prefix,'storage-partitions/index.json'),'utf8'));
      }
      catch (_) {continue;}
      const queue = tree.frameTree ? [tree.frameTree] : [];
      const urls = new Map();
      while (queue.length)
      {
        const node = queue.shift();
        if (node.frame?.id) urls.set(node.frame.id,node.frame.url);
        queue.push(...(node.childFrames || []));
      }
      for (const frame of childContext.frames)
      {
        if (urls.get(frame.frameId) !== crossUrl) continue;
        observedSecondary.push({frame,partition,capturedTarget});
      }
    }
    assert(observedSecondary.length > 0,
      'real Chromium child frame was absent from captured frame trees');
    const secondary = observedSecondary.find(item =>
      item.frame.bucketNames?.status === 'saved' &&
      item.frame.bucketNames.names?.includes('secondary-frame-bucket'));
    assert(secondary,
      'cross-origin frame bucket names were not queried in the observed frame world: ' +
      JSON.stringify(observedSecondary.map(item => ({
        target:item.capturedTarget.name,
        status:item.frame.bucketNames?.status || 'missing',
        code:item.frame.bucketNames?.errorCode || null
      }))));
    const secondaryKey = secondary.frame.storageKey?.result?.storageKey;
    assert.equal(typeof secondaryKey,'string');
    const selectedSecondary = secondary.partition.selections.find(item =>
      item.name === 'secondary-frame-bucket' &&
      item.selector.storageBucket.storageKey === secondaryKey &&
      item.discovery.frameId === secondary.frame.frameId);
    assert(selectedSecondary,
      'child named bucket must be selected using its own observed storage key');
    if (secondaryCacheReady && selectedSecondary.sources.cacheStorage.status === 'saved')
    {
      const childRoot = path.join(capture,'rest/targets',
        secondary.capturedTarget.name);
      const index = JSON.parse(fs.readFileSync(path.join(childRoot,
        selectedSecondary.sources.cacheStorage.file),'utf8'));
      const entry = index.caches.flatMap(cache => cache.entries)
        .find(item => item.requestURL?.endsWith('/secondary-cache-entry'));
      assert(entry?.body?.status === 'saved',
        'child named bucket Cache Storage was reported saved without fixture data');
      assert.equal(fs.readFileSync(path.join(childRoot,
        'storage-partitions',selectedSecondary.id,'cache-storage',
        entry.body.file),'utf8'),'secondary-cache-body');
    }
    const childContextMode = secondary.frame.bucketNames.contextSelector;
    if (secondary.capturedTarget.main)
    {
      assert(['uniqueContextId','contextId'].includes(childContextMode),
        'same-target child must use an explicit observed execution context');
      assert(secondary.frame.bucketNames.executionTargetId,
        'secondary execution target provenance missing');
    }
    const optionalPath = path.join(capture,
      'rest/optional-domains/index.json');
    const optional = JSON.parse(fs.readFileSync(optionalPath,'utf8'));
    assert.equal(optional.scope,'installed-browser-passive-optional-CDP-domains');
    assert.equal(optional.policy,
      'selective-passive-animation-media-webaudio-preload-and-network-reporting-observers');
    assert.equal(optional.protocolStatus,'saved',
      'installed Chromium protocol should be the source of capability claims');
    assert.equal(optional.source.status,'saved');
    assert.equal(optional.source.invalidPackets,0);
    assert.equal(optional.domains.length,9);
    assert(!optional.domains.some(item => item.domain === 'ReportingAPI'),
      'Reporting API must not be represented as a separate CDP domain');
    for (const domain of optional.domains)
    {
      const declared = protocol.domains.find(item => item.domain === domain.domain);
      assert.equal(domain.passiveObserverRequested,
        ['Animation','Media','WebAudio','Preload'].includes(domain.domain),
        'only Animation, Media, WebAudio and Preload may subscribe to events');
      if (!declared)
        assert.equal(domain.status,'unsupported',
          'absent browser CDP domain was mislabeled available');
      else
      {
        assert.deepEqual(domain.commandsAvailable,
          (declared.commands || []).map(item => item.name));
        assert.deepEqual(domain.eventsAvailable,
          (declared.events || []).map(item => item.name));
        assert(['observed','not-enabled','enabled-no-event-observed']
          .includes(domain.status),
        'installed domain must distinguish actual event evidence from capability');
        const events = parsedWire.filter(item =>
          item.direction === 'inbound' &&
          item.packet.method?.startsWith(domain.domain + '.')).length;
        const commands = parsedWire.filter(item =>
          item.direction === 'outbound' &&
          item.packet.method?.startsWith(domain.domain + '.')).length;
        assert.equal(domain.inboundEvents,events,
          'optional domain event count is not reconciled to raw CDP wire');
        assert.equal(domain.outboundCommands,commands,
          'optional domain command count is not reconciled to raw CDP wire');
        if (!events && !domain.enabledTargets.length)
          assert.equal(domain.status,'not-enabled',
            'schema support alone was incorrectly counted as observed coverage');
        if (['Animation','Media','WebAudio','Preload'].includes(domain.domain) &&
          declared.commands?.some(item => item.name === 'enable'))
        {
          assert(domain.enabledTargets.includes(mainCoverageTarget.targetId),
            'selected passive observer was not enabled on the main page');
          assert(parsedWire.some(item => item.direction === 'outbound' &&
            item.packet.method === domain.domain + '.enable'),
            'selected passive observer was not negotiated over native CDP');
          const expectedEvent = domain.domain === 'Animation' ?
            'animationStarted' : domain.domain === 'Media' ?
              'playerCreated' : domain.domain === 'WebAudio' ?
                'contextCreated' : 'ruleSetUpdated';
          assert(domain.observedEvents[expectedEvent] > 0 &&
            domain.status === 'observed',
            'natural animation/audio fixture did not emit the expected event: ' +
            domain.domain + ' ' + JSON.stringify(domain.observedEvents));
          if (domain.domain === 'WebAudio')
            assert(domain.observedEvents.audioNodeCreated > 0,
              'real disconnected AudioContext gain node was not observed');
          if (domain.domain === 'Preload')
          {
            assert(parsedWire.some(item => item.direction === 'inbound' &&
              item.packet.method === 'Preload.ruleSetUpdated' &&
              item.packet.params?.ruleSet?.sourceText?.includes('/preload-candidate')),
            'browser did not observe the native speculation rule set');
          }
        }
      }
    }
    const networkProtocol = protocol.domains.find(item =>
      item.domain === 'Network');
    const feature = optional.features?.reportingApi;
    assert(feature, 'Network Reporting API feature coverage missing');
    assert.equal(feature.cdpDomain,'Network');
    assert.equal(feature.method,'enableReportingApi');
    assert.equal(feature.passiveObserverRequested,true);
    const reportingAvailable = !!networkProtocol?.commands?.some(item =>
      item.name === 'enableReportingApi');
    assert.equal(feature.methodAvailable,reportingAvailable,
      'Reporting API method support must be read from Network schema');
    assert.deepEqual(feature.eventsAvailable,
      ['reportingApiReportAdded','reportingApiReportUpdated',
        'reportingApiEndpointsChangedForOrigin'].filter(name =>
        networkProtocol?.events?.some(item => item.name === name)),
      'Reporting API event support must be read from Network schema');
    const reportingEvents = new Set(['Network.reportingApiReportAdded',
      'Network.reportingApiReportUpdated',
      'Network.reportingApiEndpointsChangedForOrigin']);
    const observedReporting = parsedWire.filter(item =>
      item.direction === 'inbound' &&
      reportingEvents.has(item.packet.method));
    const enabledReporting = parsedWire.filter(item =>
      item.direction === 'outbound' &&
      item.packet.method === 'Network.enableReportingApi');
    assert.equal(feature.inboundEvents,observedReporting.length,
      'Reporting API event totals differ from native CDP evidence');
    assert.equal(feature.outboundCommands,enabledReporting.length,
      'Reporting API subscription totals differ from native CDP evidence');
    for (const method of reportingEvents)
    {
      const name = method.slice('Network.'.length);
      const count = observedReporting.filter(item =>
        item.packet.method === method).length;
      assert.equal(feature.observedEvents[name] || 0,count,
        'Reporting API event provenance differs for ' + method);
    }
    assert(enabledReporting.every(item => item.packet.params?.enable === true),
      'Reporting API observer must only enable passive notifications');
    if (reportingAvailable)
    {
      assert(enabledReporting.length > 0,
        'supported Network.enableReportingApi was not requested');
      assert(feature.enabledTargets.includes(mainCoverageTarget.targetId),
        'main page Reporting API observer not enabled');
      assert(['observed','enabled-no-event-observed'].includes(feature.status),
        'missing report events must not be misclassified as unsupported');
      if (!observedReporting.length)
        assert.equal(feature.status,'enabled-no-event-observed',
          'Reporting API with no natural report events is not fully observed');
    }
    else
    {
      assert.equal(feature.status,'unsupported',
        'absent Network Reporting API command must remain unsupported');
      assert.equal(enabledReporting.length,0,
        'unsupported Reporting API command must not be attempted');
    }
    assert(!parsedWire.some(item => item.direction === 'outbound' &&
      /^Network\.reportingApi/.test(item.packet.method || '')),
      'observer must not issue synthetic Reporting API commands');
    assert(!parsedWire.some(item => item.direction === 'outbound' &&
      /^(?:Animation|Media|WebAudio|Preload)\.(?!enable$)/.test(item.packet.method || '')),
      'optional event observers must never control animation, media or audio graph');
    assert.equal(fs.statSync(optionalPath).mode & 0o777,0o600,
      'optional CDP domain provenance must be private');
    assert(rest.artifacts.some(item => item.name === 'optional-domains' &&
      item.file === 'optional-domains/index.json'),
      'optional CDP domain inventory absent from private rest manifest');
    const workerProvenancePath = path.join(capture,
      'rest/worker-provenance/index.json');
    const workerProvenance = JSON.parse(fs.readFileSync(workerProvenancePath,'utf8'));
    assert.equal(workerProvenance.scope,
      'observed-worker-frame-and-registration-provenance');
    assert.equal(workerProvenance.phase,'rest-before-automated-input');
    assert.equal(workerProvenance.source.status,'saved');
    assert(workerProvenance.source.records > 0);
    assert.equal(workerProvenance.targetGraphs.initial,'saved');
    assert.equal(workerProvenance.targetGraphs.final,'saved');
    assert(workerProvenance.workers.some(item =>
      item.type === 'worker' && item.targetId === workerTarget.targetId),
      'dedicated worker target was lost in provenance graph');
    assert(workerProvenance.targetTransitions.some(item =>
      item.method === 'Target.attachedToTarget' && item.targetId),
      'raw target attachment chronology was not preserved');
    assert(workerProvenance.targetTransitions.every(item =>
      item.method.startsWith('Target.') && item.observedAt),
      'target provenance chronology must identify its CDP events and timestamps');
    assert(workerProvenance.workers.some(item => item.type === 'service_worker'),
      'service worker target was omitted from provenance graph');
    assert(workerProvenance.frames.some(item =>
      item.url?.endsWith('/child.html') && item.frameId),
      'observed child frame navigation missing from CDP provenance index');
    if (hasMethod('ServiceWorker','enable'))
    {
      const observedPage = workerProvenance.subscriptions.find(item =>
        item.targetId === mainCoverageTarget.targetId);
      assert(observedPage && observedPage.status === 'enabled',
        'supported ServiceWorker observer did not enable on actual browser page');
      const registrations = workerProvenance.registrations.filter(item =>
        item.scopeURL?.includes('127.0.0.1'));
      assert(registrations.length,
        'real service worker registration update not observed in CDP ledger');
      assert(workerProvenance.versions.some(item =>
        item.scriptURL?.endsWith('/service-worker.js') &&
        item.registrationObserved && item.versionId),
        'real worker version was not correlated with its observed registration');
      const inactive = workerProvenance.browserRegistrations.find(item =>
        item.scopeURL?.endsWith('/inactive/'));
      assert(inactive, 'persistent inactive registration absent from browser snapshot');
      assert(inactive.activeScriptURL?.endsWith('/inactive-service-worker.js'),
        'browser registration lost its activated script after worker stopped');
      assert.equal(inactive.status, 'registered-worker-stopped',
        'stopped ServiceWorker version must be correlated to persisted browser state');
      assert.equal(inactive.workerTargetLiveAtRest,false,
        'stopped ServiceWorker must not require an attached worker target');
      assert(workerProvenance.browserRegistrationSources.some(item =>
        item.targetId === mainCoverageTarget.targetId && item.status === 'saved'),
        'main-frame browser registration snapshot must have provenance');
      assert(parsedWire.filter(item => item.direction === 'outbound' &&
        item.packet.method?.startsWith('ServiceWorker.')).every(item =>
        item.packet.method === 'ServiceWorker.enable'),
        'analyzer must not issue ServiceWorker lifecycle mutations');
      console.log('Inactive ServiceWorker registration, stopped version and browser snapshot verified');
    }
    else assert(workerProvenance.limitations.some(message =>
      message.includes('observer not enabled')),
    'unsupported observer should appear as a partial outcome');
    assert.equal(fs.statSync(workerProvenancePath).mode & 0o777,0o600,
      'private worker and frame provenance must be stored with mode 0600');
    assert(rest.artifacts.some(item => item.name === 'worker-provenance' &&
      item.file === 'worker-provenance/index.json'),
      'worker provenance must be registered in the rest manifest');
    const partitionPath = path.join(capture,
      'rest/targets/target-000/storage-partitions/index.json');
    const partitions = JSON.parse(fs.readFileSync(partitionPath, 'utf8'));
    assert.equal(partitions.scope, 'observed-storage-key-and-bucket-selections');
    assert.equal(fs.statSync(partitionPath).mode & 0o777, 0o600,
      'partition index must remain private');
    if (primaryFrame.storageKey.status === 'saved')
    {
      assert(partitions.selections.length >= 1,
        'an observed main-frame storage key must produce a scoped selection');
      const scoped = partitions.selections.find(row => row.name === null &&
        row.selector.storageBucket.storageKey === primaryFrame.storageKey.result.storageKey);
      assert(scoped, 'default bucket must use exact frame storage key');
      assert(scoped.sources.indexeddb && scoped.sources.cacheStorage && scoped.sources.opfs,
        'partition acquisition must report each data source independently');
      const selectionRoot = 'rest/targets/target-000/storage-partitions/' + scoped.id;
      if (scoped.sources.indexeddb.status === 'saved')
      {
        const idb = JSON.parse(fs.readFileSync(path.join(capture,
          selectionRoot, 'indexeddb/index.json'), 'utf8'));
        const db = idb.databases.find(row => row.name === 'rest-database');
        assert(db?.stores.some(row => row.entries >= 1),
          'key-scoped IndexedDB read omitted fixture rows');
      }
      if (scoped.sources.cacheStorage.status === 'saved')
      {
        const cache = JSON.parse(fs.readFileSync(path.join(capture,
          selectionRoot, 'cache-storage/index.json'), 'utf8'));
        const record = cache.caches.flatMap(row => row.entries)
          .find(row => row.requestURL?.endsWith('/cached-fixture'));
        assert(record?.body?.status === 'saved',
          'key-scoped Cache Storage did not preserve fixture response');
        assert.equal(fs.readFileSync(path.join(capture, selectionRoot,
          'cache-storage', record.body.file), 'utf8'), 'cached-payload');
      }
      const opfs = JSON.parse(fs.readFileSync(path.join(capture,
        selectionRoot, 'opfs.json'), 'utf8'));
      assert(opfs.scope === 'read-only-CDP-file-system-directory');
      assert(opfs.directories.every(row => row.pathComponents &&
        ['saved','partial'].includes(row.status)));
      if (hasMethod('FileSystem','getDirectory'))
        assert(['saved','partial'].includes(opfs.status),
          'read-only FileSystem.getDirectory availability was lost');
      else assert.equal(opfs.status, 'unsupported');
      const restDom = fs.readFileSync(path.join(capture,
        'states/dom-rest-initial.html'), 'utf8');
      if (hasMethod('FileSystem','getDirectory'))
      {
        assert(restDom.includes('data-default-opfs-ready="yes"'),
          'real Chromium default OPFS fixture did not finish before rest capture');
        const body = opfs.contents?.files?.find(row =>
          row.pathComponents.at(-1) === 'default-opfs-file');
        assert(body && body.status === 'saved',
          'default OPFS bytes missing despite observed file and supported CDP');
        const bodyPath = path.join(capture,selectionRoot,body.file);
        assert.deepEqual(fs.readFileSync(bodyPath),
          Buffer.from([0,7,255,42,0,128]),
          'OPFS byte archive differs from the browser-written binary file');
        assert.equal(fs.statSync(bodyPath).mode & 0o777,0o600,
          'private OPFS byte archive must have mode 0600');
        const {auditWebAnalyzeEvidence} = require(path.join(root,
          'lib/sys/js/web-analyze-rest.lib.js'));
        const original = fs.readFileSync(bodyPath);
        const corrupted = Buffer.from(original);
        corrupted[2] ^= 1;
        fs.writeFileSync(bodyPath,corrupted);
        const validation = auditWebAnalyzeEvidence(capture);
        assert.equal(validation.status,'failed',
          'same-size OPFS file corruption must invalidate the archive');
        assert(validation.artifacts.some(item =>
          item.file === path.relative(capture,bodyPath) &&
          item.errorCode === 'evidence-sha256-mismatch'),
          'OPFS byte audit did not attribute the tampered body');
        fs.writeFileSync(bodyPath,original);
        console.log('OPFS default binary bytes and tamper audit exercised');
      }
      if (restDom.includes('data-named-bucket-ready="yes"') &&
        frameContext.bucketNames.status === 'saved' &&
        frameContext.bucketNames.names.includes('analyze-fixture-bucket'))
      {
        const named = partitions.selections.find(row =>
          row.name === 'analyze-fixture-bucket');
        assert(named, 'observed named bucket was not selected separately');
        const namedOpfs = JSON.parse(fs.readFileSync(path.join(capture,
          'rest/targets/target-000/storage-partitions', named.id,
          'opfs.json'), 'utf8'));
        if (namedOpfs.status === 'saved')
          assert(namedOpfs.directories.some(row =>
            row.result?.directory?.nestedFiles?.some(file =>
              file.name === 'named-bucket-file')),
          'read-only CDP OPFS listing lost fixture-created file metadata');
      }
    }
    const securityPath = path.join(capture, 'rest/security/index.json');
    const security = JSON.parse(fs.readFileSync(securityPath, 'utf8'));
    assert.equal(security.scope, 'observed-frame-and-network-security');
    assert.equal(security.source.status, 'saved',
      'native CDP response events were not available for security correlation');
    assert(security.frames.some(item => item.frameId === primaryFrame.frameId &&
      item.securityOrigin?.includes('127.0.0.1')),
    'frame security origin must be derived from the real Chromium frame tree');
    assert(security.responses.some(item =>
      item.url?.includes('127.0.0.1') && item.tlsDetailsStatus === 'inapplicable'),
    'insecure local fixture transport must not be misrepresented as TLS');
    assert.equal(security.certificateDiscovery, 'inapplicable',
      'HTTP-only fixture has no HTTPS certificate chain to recover');
    assert.equal(security.certificates.length, 0);
    assert.equal(security.certificateMethod.support,
      hasMethod('Network', 'getCertificate') ? 'supported' : 'unsupported');
    assert.equal(fs.statSync(securityPath).mode & 0o777, 0o600,
      'transport security evidence is private');
    assert(rest.artifacts.some(item => item.name === 'security-trust' &&
      item.file === 'security/index.json'),
      'security evidence missing from the resting manifest');
    const pwaPath = path.join(capture, 'rest/pwa-resources/index.json');
    const pwa = JSON.parse(fs.readFileSync(pwaPath, 'utf8'));
    assert.equal(pwa.scope, 'observed-offline-pwa-resource-provenance');
    assert.equal(pwa.policy, 'no-navigation-no-refetch');
    assert.equal(pwa.correlation,
      'exact-resource-url-only; request identity not inferred');
    assert.equal(pwa.sources['resources-at-rest'].status, 'saved');
    assert.equal(pwa.sources['network-details-at-rest'].status, 'saved');
    assert.equal(fs.statSync(pwaPath).mode & 0o777, 0o600,
      'raw PWA provenance must remain private');
    const documentPwa = pwa.documents.find(item =>
      item.targetId === mainCoverageTarget.targetId);
    assert(documentPwa && documentPwa.manifest.url?.endsWith('/app.webmanifest'),
      'real Chromium did not report the page-declared PWA manifest');
    const manifestReference = documentPwa.references.find(item =>
      item.kind === 'manifest' && item.url.endsWith('/app.webmanifest'));
    assert(manifestReference, 'manifest source URL was not indexed');
    const iconReference = documentPwa.references.find(item =>
      item.kind === 'icon' && item.url.endsWith('/pwa-icon.png'));
    assert(iconReference && ['body-archived','network-observed',
      'frame-resource-observed'].includes(iconReference.status),
      'naturally consumed icon was not correlated with browser evidence');
    if (iconReference.status === 'body-archived')
      assert.deepEqual(fs.readFileSync(path.join(capture,
        iconReference.archived.file)),pwaIcon,
        'PWA resource provenance points to incorrect archived icon bytes');
    const missingReference = documentPwa.references.find(item =>
      item.kind === 'icon' && item.url.endsWith('/pwa-icon-not-observed.png'));
    assert(missingReference, 'manifest-declared but unobserved icon was omitted');
    if (missingReference.status === 'not-observed')
      assert(!missingReference.archived,
        'unobserved icon must not acquire invented payload provenance');
    assert(pwa.workers.some(item => item.type === 'service_worker' &&
      item.status === 'not-a-document'),
      'service worker must not be silently counted as a page manifest');
    assert(rest.artifacts.some(item =>
      item.name === 'pwa-resources' && item.file === 'pwa-resources/index.json'),
      'PWA provenance missing from rest manifest');
    const storage = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/storage.json'), 'utf8'));
    assert.equal(storage.localStorage.values.fixtureSession, 'fixture-only-access');
    assert.equal(storage.sessionStorage.values.fixtureView, 'test-123');
    const dbIndex = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/indexeddb/index.json'), 'utf8'));
    const indexedStore = dbIndex.databases.find(db =>
      db.name === 'rest-database')?.stores.find(store => store.name === 'records');
    assert(indexedStore?.entries >= 1, 'IndexedDB data was not enumerated');
    assert.equal(indexedStore.status, 'saved', 'IndexedDB value serialization incomplete');
    const indexedPage = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/indexeddb', indexedStore.pages[0].file), 'utf8'));
    assert(JSON.stringify(indexedPage.entries).includes('idb-payload'),
      'IndexedDB value bytes were not preserved in the deep serialized page');
    const cacheIndex = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/cache-storage/index.json'), 'utf8'));
    const cached = cacheIndex.caches.flatMap(cache => cache.entries)
      .find(item => item.requestURL?.endsWith('/cached-fixture'));
    assert(cached?.body?.status === 'saved', 'cached response body not preserved');
    const cachedBody = fs.readFileSync(path.join(capture,
      'rest/targets/target-000/cache-storage', cached.body.file), 'utf8');
    assert.equal(cachedBody, 'cached-payload');
    const details = fs.readFileSync(path.join(capture, 'network-details.jsonl'), 'utf8');
    assert(details.includes('request-body-marker'),
      'initial POST request contents were not preserved');
    assert(details.includes('Network.getRequestPostData'),
      'per-request body retrieval evidence was not recorded');
    assert(details.includes('X-Fixture-Request'),
      'full HTTP request metadata was not preserved');
    assert(details.includes('fixture_cookie=fixture-only-secret'),
      'response cookie provenance was not preserved');
    const atRest = fs.readFileSync(path.join(capture,
      'rest/network-details-at-rest.jsonl'), 'utf8');
    assert(atRest.includes('fixture_cookie=fixture-only-secret'),
      'phase-zero network boundary did not preserve cookie evidence');
    for (const file of ['rest/cookies.json', 'rest/targets/target-000/storage.json',
      'network-details.jsonl'])
      assert.equal(fs.statSync(path.join(capture, file)).mode & 0o777, 0o600,
        'private browser state file permissions must be restrictive: ' + file);
    const environment = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/environment.json'), 'utf8'));
    assert(environment.shadowRoots.some(item => item.html.includes('Shadow content')),
      'open shadow subtree not captured');
    const domTree = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/dom-tree.json'), 'utf8'));
    assert(JSON.stringify(domTree).includes('shadow-inner'),
      'pierced CDP DOM tree omitted shadow node');
    const styles = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/stylesheets/index.json'), 'utf8'));
    assert(styles.some(item => item.status === 'saved'),
      'CSS source was not preserved');
    const listeners = JSON.parse(fs.readFileSync(path.join(capture,
      'rest/targets/target-000/event-listeners.json'), 'utf8'));
    assert(listeners.some(group => group.listeners?.some(item => item.type === 'rest-probe')),
      'event listener metadata not captured');
    assert(['settled', 'dom-quiet-network-pending'].includes(states[0].settlement.status),
      'initial DOM must be saved after bounded network and mutation quiet');
    if (states[0].settlement.status === 'settled')
      assert.equal(states[0].settlement.inFlightRequests, 0);
    else
      assert(states[0].settlement.quietForMs >= 4500,
        'pending request degradation must require extended network quiet');
    assert(states[0].html.includes('Delayed hydrated content'),
      'initial snapshot was taken before delayed hydration');
    const initialDom = fs.readFileSync(path.join(capture, 'states/dom-rest-initial.html'), 'utf8');
    assert(initialDom.includes('Delayed hydrated content'),
      'full resting DOM did not capture delayed rendering');
    const initialMeta = JSON.parse(fs.readFileSync(path.join(capture,
      'states/dom-rest-initial.json'), 'utf8'));
    assert.equal(initialMeta.settlement.status, states[0].settlement.status);
    assert(initialMeta.htmlBytes > 100, 'full resting DOM was empty');
    const finalDom = fs.readFileSync(path.join(capture, 'states/dom-rest-final.html'), 'utf8');
    assert(finalDom.includes('Lazy control'), 'final resting DOM omitted lazy control');
    assert(states.some(state => state.controls.some(control => control.label === 'Lazy control')),
      'lazy DOM control not captured');
    const responseIndex = fs.readFileSync(path.join(capture, 'resources.jsonl'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    const large = responseIndex.find(item => item.status === 'saved' &&
      item.url?.endsWith('/large.bin'));
    assert(large, 'large response body was not archived');
    assert.equal(large.bytes, largePayload.length, 'large response was truncated');
    assert.equal(large.sha256,
      crypto.createHash('sha256').update(largePayload).digest('hex'),
      'large response digest mismatch');
    assert.deepEqual(fs.readFileSync(path.join(capture, large.file)), largePayload);
    assert(responseIndex.some(item => item.status === 'redirect-no-body' &&
      item.url?.endsWith('/redirect-start') &&
      item.redirectToUrl?.endsWith('/redirect-end')),
      'redirect chain missing explicit destination');
    assert(responseIndex.some(item => item.status === 'saved' &&
      item.url?.endsWith('/redirect-end') &&
      item.redirectedFrom?.endsWith('/redirect-start')),
      'redirect chain missing source provenance');
    const burstIds = parsedWire.filter(entry =>
      entry.direction === 'inbound' &&
      entry.packet.method === 'Network.requestWillBeSent' &&
      entry.packet.params.request?.url?.endsWith('/burst'))
      .map(entry => entry.packet.params.requestId);
    const burstEvents = parsedWire.filter(entry =>
      entry.direction === 'inbound' &&
      entry.packet.method?.startsWith('Network.') &&
      burstIds.includes(entry.packet.params?.requestId))
      .map(entry => entry.packet.method);
    assert(states[0].html.includes('burst-complete="yes"'),
      'fixture did not naturally consume the complete chunked response');
    assert(responseIndex.some(item => item.status === 'saved' &&
      item.url?.endsWith('/burst')), 'chunked HTTP response not saved: ' +
      JSON.stringify({
        server:burstStats, networkEvents:burstEvents,
        outcomes:responseIndex.filter(item => item.url?.endsWith('/burst'))
          .map(item => ({
            status:item.status, httpStatus:item.httpStatus,
            source:item.source, errorCode:item.errorCode,
            partialBytes:item.partialBody?.bytes
          }))
      }));
    assert(responseIndex.some(item => item.url?.endsWith('/cacheable')),
      'cacheable request missing from archive');
    const streaming = responseIndex.find(item =>
      item.url?.endsWith('/live-events'));
    assert(streaming, 'long-lived EventSource request must be indexed');
    assert(['unfinished-at-shutdown','request-failed','body-unavailable']
      .includes(streaming.status), 'live stream was mislabeled complete');
    if (streaming.partialBody)
    {
      const file = path.join(capture, streaming.partialBody.file);
      assert(fs.existsSync(file), 'partial stream body artifact is missing');
      assert(fs.readFileSync(file,'utf8').includes('data:'),
        'partial streamed EventSource bytes were not persisted');
      assert.equal(streaming.partialBody.status, 'partial');
    }
    const configuration = JSON.parse(fs.readFileSync(path.join(capture,
      'summary.json'),'utf8')).resourceCapture.networkConfiguration;
    assert(configuration.some(item => item.enabled === 'buffered'),
      'CDP response buffer settings were not negotiated');
    assert(configuration.some(item => ['enabled','unsupported','unavailable']
      .includes(item.durable)), 'durable configuration status was not recorded');
    for (const name of ['/app.js', '/view.css', '/data.json', '/lazy.json', '/hydrated.json'])
      assert(responseIndex.some(item => item.status === 'saved' && item.url?.endsWith(name)),
        'missing downloaded resource ' + name);
    assert(fs.readFileSync(path.join(capture, 'FLOWS.md'), 'utf8').includes('flowchart TD'));
    const scriptsReport = fs.readFileSync(path.join(capture, 'SCRIPTS.md'), 'utf8');
    assert(scriptsReport.includes('WebAssembly') &&
      scriptsReport.includes('Archive kind') &&
      scriptsReport.includes('rest/source-maps/index.json'),
      'human-readable script report omitted binary/text distinction or map index');
    const scriptIndex = fs.readFileSync(path.join(capture, 'scripts.jsonl'), 'utf8');
    assert(scriptIndex.includes('"status":"saved"'), 'compiled JS not recorded');
    const scriptRows = scriptIndex.trim().split('\n').map(JSON.parse);
    assert(scriptRows.some(item =>
      item.status === 'saved' && item.scriptLanguage === 'JavaScript' &&
      item.sourceMapURL?.startsWith('data:application/json;base64,')),
      'inline JavaScript source-map provenance missing from scriptParsed');
    const wasmRow = scriptRows.find(item =>
      item.scriptLanguage === 'WebAssembly' && item.status === 'saved' &&
      item.sourceKind === 'wasm-bytecode');
    assert(wasmRow, 'native Chromium WebAssembly bytecode was not archived: ' +
      JSON.stringify(scriptRows.filter(item => item.scriptLanguage === 'WebAssembly')
        .map(item => ({status:item.status,kind:item.sourceKind,error:item.errorCode}))));
    assert.deepEqual(fs.readFileSync(path.join(capture, wasmRow.file)), wasmPayload,
      'CDP WebAssembly bytecode differs from the naturally compiled module');
    assert.equal(wasmRow.bytecodeStatus, 'saved');
    assert.equal(wasmRow.sha256,
      crypto.createHash('sha256').update(wasmPayload).digest('hex'));
    assert(fs.readFileSync(path.join(capture, 'states/dom-rest-initial.html'), 'utf8')
      .includes('data-wasm-result="42"'),
      'the actual page did not instantiate the test WebAssembly module');
    const mapsRoot = path.join(capture, 'rest/source-maps');
    const mapsIndex = JSON.parse(fs.readFileSync(path.join(mapsRoot, 'index.json'),'utf8'));
    assert.equal(mapsIndex.policy, 'offline-existing-evidence-only');
    assert.equal(mapsIndex.noNetworkRequests, true);
    assert.equal(mapsIndex.scriptIndexStatus, 'saved');
    assert.equal(mapsIndex.resourceIndexStatus, 'saved');
    const inlineEntry = mapsIndex.entries.find(item =>
      item.kind === 'inline-data' && item.status === 'saved');
    assert(inlineEntry, 'inline data source map was not saved from the CDP script reference');
    assert.equal(inlineEntry.sourcesContent, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(capture, 'rest', inlineEntry.file),
      'utf8')), inlineMap, 'inlined original source content was modified');
    const externalEntry = mapsIndex.entries.find(item =>
      item.kind === 'external' && item.resolvedURL?.endsWith('/background-worker.js.map'));
    assert(externalEntry && externalEntry.status === 'saved',
      'naturally fetched external source map was not recovered: ' +
      JSON.stringify(mapsIndex.entries.map(item => ({
        kind:item.kind,status:item.status,code:item.errorCode || null,
        url:item.resolvedURL || null
      }))));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(capture, 'rest',
      externalEntry.file), 'utf8')), workerMap);
    assert(responseIndex.some(item => item.status === 'saved' &&
      item.url === externalEntry.resolvedURL && item.file === externalEntry.resource),
      'external map provenance was not linked to an actually archived response');
    assert.equal(fs.statSync(path.join(capture, 'rest', inlineEntry.file)).mode & 0o777,
      0o600, 'source-map bodies must remain private');
    assert(rest.artifacts.some(item => item.name === 'source-maps' &&
      item.file === 'source-maps/index.json'),
      'rest manifest omitted source-map resolution outcomes');
    const integrity = JSON.parse(fs.readFileSync(path.join(capture,
      'evidence-integrity.json'), 'utf8'));
    assert(['saved','partial','interrupted'].includes(integrity.status),
      'integrity ledger did not produce an explicit capture outcome');
    assert(integrity.artifacts.some(item => item.file === large.file &&
      item.status === 'saved' && item.sha256 === large.sha256),
      'root binary was not independently verified against its index');
    assert(integrity.artifacts.some(item =>
      item.file === wasmRow.file && item.status === 'saved' &&
      item.sha256 === wasmRow.sha256),
      'WebAssembly bytecode was not independently audited');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/' + inlineEntry.file && item.status === 'saved' &&
      item.sha256 === inlineEntry.sha256),
      'inline map payload was not byte- and SHA-256-audited');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/' + externalEntry.file && item.status === 'saved' &&
      item.sha256 === externalEntry.sha256),
      'archived external map payload was not byte- and SHA-256-audited');
    assert(integrity.artifacts.some(item =>
      item.file.endsWith('/indexeddb/' + indexedStore.pages[0].file) &&
      item.status === 'saved'), 'IndexedDB page digest was not verified');
    assert(integrity.artifacts.some(item =>
      item.file.endsWith('/cache-storage/' + cached.body.file) &&
      item.status === 'saved'), 'cached response digest was not verified');
    assert(integrity.artifacts.some(item => item.file.endsWith('.css') &&
      item.source === 'CSS.getStyleSheetText' && item.status === 'saved'),
      'stylesheet body was not verified from the CSS index');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/targets/target-000/css-nodes/' + cssIndex.pages[0].file &&
      item.status === 'saved' && item.sha256 === cssIndex.pages[0].sha256),
      'per-node CSS evidence was not verified against index SHA-256');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/css-rule-usage/' + usedEntries[0].file &&
      item.status === 'saved' && item.sha256 === usedEntries[0].sha256),
      'rule-usage evidence was not verified against its indexed digest');
    assert(integrity.domains.some(item => item.domain === 'dom'),
      'DOM verification domain missing');
    assert(integrity.domains.some(item => item.domain === 'storage'),
      'storage verification domain missing');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/targets/target-000/storage-partitions/index.json' &&
      item.status !== 'failed'),
      'partition index was not independently verified');
    if (primaryFrame.storageKey.status === 'saved')
    {
      const opfsReference = partitions.selections[0].sources.opfs;
      assert(integrity.artifacts.some(item =>
        item.file === 'rest/targets/target-000/' + opfsReference.file &&
        item.sha256 === opfsReference.sha256 && item.status !== 'failed'),
        'scoped OPFS metadata was not digest-audited');
    }
    const contextRecord = rest.artifacts.find(item =>
      item.name === 'frame-context' && item.target === mainCoverageTarget.targetId);
    assert(contextRecord && contextRecord.sha256 && contextRecord.bytes,
      'context evidence must be indexed in the private rest manifest');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/targets/target-000/frame-context.json' &&
      ['saved','partial'].includes(item.status) &&
      item.sha256 === contextRecord.sha256),
      'storage/security context evidence SHA-256 was not audited');
    assert(integrity.domains.some(item => item.domain === 'security'),
      'frame security policy and isolation must be represented in audit coverage');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/security/index.json' &&
      item.status !== 'failed'),
      'frame/transport security index must be independently audited');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/worker-provenance/index.json' &&
      item.status !== 'failed'),
      'worker and frame provenance index must be independently SHA-256 audited');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/optional-domains/index.json' &&
      item.status !== 'failed'),
      'optional CDP domain inventory must be independently SHA-256 audited');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/pwa-resources/index.json' &&
      item.status !== 'failed'),
      'PWA provenance index was not audited');
    if (iconReference.archived)
      assert(integrity.artifacts.some(item =>
        item.file === iconReference.archived.file &&
        item.sha256 === iconReference.archived.sha256 &&
        item.status === 'saved'),
        'archived PWA icon body was not independently SHA-256 checked');
    assert(integrity.domains.some(item => item.domain === 'listeners'),
      'event listener verification domain missing');
    assert(integrity.domains.some(item => item.domain === 'accessibility'),
      'accessibility integrity verification domain missing');
    assert(integrity.artifacts.some(item =>
      item.file === 'rest/targets/target-000/accessibility/' + accessibilityFrame.file &&
      item.sha256 === accessibilityFrame.sha256 && item.status === 'saved'),
      'accessibility tree was not byte- and SHA-256-audited');
    assert(integrity.streams.some(item => item.file === 'cdp-wire.jsonl' &&
      item.status === 'saved' && item.records === wire.length),
      'raw CDP ledger ordering and event count not reconciled');
    assert.equal(fs.statSync(path.join(capture, 'evidence-integrity.json')).mode & 0o777,
      0o600, 'integrity ledger includes private metadata and must be private');
    for (const file of ['README.md','DOM.md','NETWORK.md','SCRIPTS.md',
      'FLOWS.md','LIMITATIONS.md'])
    {
      const readable = fs.readFileSync(path.join(capture, file), 'utf8');
      assert(!readable.includes('private-query-audit-marker'),
        'human-readable report leaked a signed URL parameter: ' + file);
      assert(!readable.includes('private-heading-audit-marker'),
        'human-readable report leaked page contents: ' + file);
    }
    assert(fs.readFileSync(path.join(capture, 'cdp-wire.jsonl'),'utf8')
      .includes('private-query-audit-marker'),
      'raw evidence was incorrectly redacted or lost');

    const repeated = await run([uri, base]);
    assert.equal(repeated.code, 0, 'rerun must work without overwriting evidence: ' + repeated.stderr);
    assert.notEqual(repeated.stdout.trim(), result.stdout.trim());
    const restOnly = path.dirname(repeated.stdout.trim());
    const restOnlyStates = fs.readdirSync(path.join(restOnly, 'states'))
      .filter(file => /^state-\d+\.json$/.test(file));
    assert.equal(restOnlyStates.length, 1, 'default invocation must not scroll');
    const restOnlyState = JSON.parse(fs.readFileSync(path.join(restOnly,
      'states/state-000.json'), 'utf8'));
    assert(!restOnlyState.html.includes('Lazy control'),
      'default resting-page command unexpectedly triggered lazy scroll');
    assert(fs.existsSync(report), 'rerun overwrote original report');

    const continuous = await run([`http://127.0.0.1:${server.address().port}/churn`, base]);
    assert.equal(continuous.code, 0, 'continuous page should retain timeout evidence: ' + continuous.stderr);
    const continuousRun = path.dirname(continuous.stdout.trim());
    const continuousState = JSON.parse(fs.readFileSync(path.join(continuousRun,
      'states/state-000.json'), 'utf8'));
    assert.equal(continuousState.settlement.status, 'timeout',
      'continuous DOM changes must not be labelled settled');
    assert(fs.existsSync(path.join(continuousRun, 'states/dom-rest-initial.html')),
      'best-effort resting DOM must still be saved at timeout');
    assert(fs.readFileSync(path.join(continuousRun, 'LIMITATIONS.md'), 'utf8')
      .includes('States without confirmed settlement'), 'timeout not disclosed in report');
    const continuousHistory = fs.readFileSync(path.join(continuousRun,
      'dom-mutations.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert(continuousHistory.some(item => item.detail.type === 'mutation-batch' &&
      item.detail.records.some(record => record.type === 'childList' ||
        record.type === 'characterData')),
      'continuous DOM history must retain mutations even if settlement fails');

    // A page-driven navigation to a different site is observation, not a
    // simulated click: preserve the old request's outcome and new response.
    const moved = await run([
      `http://127.0.0.1:${server.address().port}/process-start`, base
    ]);
    assert.equal(moved.code, 0,
      'natural cross-origin navigation capture failed: ' + moved.stderr);
    const switched = path.dirname(moved.stdout.trim());
    const switchedState = JSON.parse(fs.readFileSync(path.join(switched,
      'states/state-000.json'), 'utf8'));
    assert(switchedState.url.includes('/process-done'),
      'final site-driven document navigation was not observed');
    assert(switchedState.html.includes('process-ready'),
      'final origin script did not consume its response');
    const changedRequests = fs.readFileSync(path.join(switched,
      'resources.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert(changedRequests.some(item => item.status === 'saved' &&
      item.url?.endsWith('/process-payload')),
      'post-navigation response was not saved from the new site');
    assert(changedRequests.some(item =>
      item.url?.endsWith('/before-process')),
      'pre-navigation request outcome was silently omitted');
    const changedWire = fs.readFileSync(path.join(switched,
      'cdp-wire.jsonl'), 'utf8');
    assert(changedWire.includes('/process-start') &&
      changedWire.includes('/process-done'),
      'site-driven cross-origin navigation was not recorded on CDP wire');

    const {auditWebAnalyzeEvidence} = require(path.join(root,
      'lib/sys/js/web-analyze-rest.lib.js'));
    const interruptedAudit = auditWebAnalyzeEvidence(capture,
      {interrupted:true});
    assert.equal(interruptedAudit.status, 'interrupted',
      'explicitly interrupted validation must not be reported as saved');
    assert(interruptedAudit.domains.some(item =>
      item.domain === 'capture' && item.status === 'interrupted'),
      'interruption reason missing from domain-level coverage');
    const originalPwa = fs.readFileSync(pwaPath);
    const brokenPwa = Buffer.from(originalPwa);
    brokenPwa[25] ^= 1;
    fs.writeFileSync(pwaPath, brokenPwa);
    const damagedPwaAudit = auditWebAnalyzeEvidence(capture);
    assert.equal(damagedPwaAudit.status, 'failed',
      'same-sized PWA provenance modification must invalidate audit');
    assert(damagedPwaAudit.artifacts.some(item =>
      item.file === 'rest/pwa-resources/index.json' &&
      item.errorCode === 'evidence-sha256-mismatch'),
      'PWA index tamper failure was not attributed');
    fs.writeFileSync(pwaPath, originalPwa);
    const originalSecurity = fs.readFileSync(securityPath);
    const alteredSecurity = Buffer.from(originalSecurity);
    alteredSecurity[18] ^= 1;
    fs.writeFileSync(securityPath, alteredSecurity);
    const tamperedSecurity = auditWebAnalyzeEvidence(capture);
    assert.equal(tamperedSecurity.status, 'failed',
      'same-length transport security index corruption must fail audit');
    assert(tamperedSecurity.artifacts.some(item =>
      item.file === 'rest/security/index.json' &&
      item.errorCode === 'evidence-sha256-mismatch'),
      'security index SHA-256 mismatch was not detected');
    fs.writeFileSync(securityPath, originalSecurity);
    const originalPartitions = fs.readFileSync(partitionPath);
    const brokenPartitions = Buffer.from(originalPartitions);
    brokenPartitions[15] ^= 1;
    fs.writeFileSync(partitionPath, brokenPartitions);
    const invalidPartition = auditWebAnalyzeEvidence(capture);
    assert.equal(invalidPartition.status, 'failed',
      'same-length bucket index tampering must fail audit');
    assert(invalidPartition.artifacts.some(item =>
      item.file === 'rest/targets/target-000/storage-partitions/index.json' &&
      item.errorCode === 'evidence-sha256-mismatch'),
      'tampered bucket index SHA mismatch was not reported');
    fs.writeFileSync(partitionPath, originalPartitions);
    const originalContext = fs.readFileSync(contextPath);
    const alteredContext = Buffer.from(originalContext);
    alteredContext[12] ^= 1;
    fs.writeFileSync(contextPath, alteredContext);
    const contextTamperAudit = auditWebAnalyzeEvidence(capture);
    assert.equal(contextTamperAudit.status, 'failed',
      'same-length security context tampering must fail audit');
    assert(contextTamperAudit.artifacts.some(item =>
      item.file === 'rest/targets/target-000/frame-context.json' &&
      item.errorCode === 'evidence-sha256-mismatch'),
      'security context SHA mismatch was not detected');
    fs.writeFileSync(contextPath, originalContext);
    const inlineMapFile = path.join(capture, 'rest', inlineEntry.file);
    const originalInlineMap = fs.readFileSync(inlineMapFile);
    const alteredInlineMap = Buffer.from(originalInlineMap);
    alteredInlineMap[10] ^= 0x01;
    fs.writeFileSync(inlineMapFile, alteredInlineMap);
    const mapTamperAudit = auditWebAnalyzeEvidence(capture);
    assert.equal(mapTamperAudit.status, 'failed',
      'same-length source-map tampering must invalidate the audit');
    assert(mapTamperAudit.artifacts.some(item =>
      item.file === 'rest/' + inlineEntry.file &&
      item.errorCode === 'evidence-sha256-mismatch'),
      'source-map SHA-256 mismatch was not detected');
    fs.writeFileSync(inlineMapFile, originalInlineMap);
    const usageFile = path.join(coverageRoot, usedEntries[0].file);
    const originalCoverage = fs.readFileSync(usageFile);
    const corruptedCoverage = Buffer.from(originalCoverage);
    corruptedCoverage[8] ^= 0x01;
    fs.writeFileSync(usageFile, corruptedCoverage);
    const corruptedAudit = auditWebAnalyzeEvidence(capture);
    assert.equal(corruptedAudit.status, 'failed',
      'same-length CSS rule coverage tampering must fail integrity verification');
    assert(corruptedAudit.artifacts.some(item =>
      item.file === 'rest/css-rule-usage/' + usedEntries[0].file &&
      item.errorCode === 'evidence-sha256-mismatch'),
      'CSS rule-usage digest mismatch was not identified');
    fs.writeFileSync(usageFile, originalCoverage);
    const binaryFile = path.join(capture, large.file);
    fs.writeFileSync(binaryFile, Buffer.from('modified artifact'));
    let tampered = auditWebAnalyzeEvidence(capture);
    assert.equal(tampered.status, 'failed',
      'corrupted response body was not reported as a failed capture');
    assert(tampered.artifacts.some(item => item.file === large.file &&
      item.errorCode === 'evidence-byte-count-mismatch'),
      'tampered response byte count was not identified');
    const sameSizeTamper = Buffer.from(largePayload);
    sameSizeTamper[0] ^= 0xff;
    fs.writeFileSync(binaryFile, sameSizeTamper);
    tampered = auditWebAnalyzeEvidence(capture);
    assert.equal(tampered.status, 'failed',
      'same-length corrupted response body did not fail hash validation');
    assert(tampered.artifacts.some(item => item.file === large.file &&
      item.errorCode === 'evidence-sha256-mismatch'),
      'same-length corruption was not identified by SHA-256');
    fs.writeFileSync(binaryFile, largePayload);
    const cachedFile = path.join(capture, 'rest/targets/target-000/cache-storage',
      cached.body.file);
    fs.unlinkSync(cachedFile);
    tampered = auditWebAnalyzeEvidence(capture);
    assert.equal(tampered.status, 'failed',
      'missing nested cache body was not reported as a failed capture');
    assert(tampered.artifacts.some(item =>
      item.file.endsWith('/cache-storage/' + cached.body.file) &&
      item.errorCode === 'evidence-file-missing'),
      'cache body path from nested index was not independently checked');
  }
  finally
  {
    server.close();
    server.closeAllConnections();
    crossServer.close();
    crossServer.closeAllConnections();
    fs.rmSync(work, {recursive: true, force: true,
      maxRetries:10, retryDelay:250});
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
