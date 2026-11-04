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
<link rel="stylesheet" href="/view.css"><script defer src="/app.js"></script></head>
<body><h1>Interactive view</h1><div id="list" class="scroll">
${Array.from({length: 50}, (_,i)=>`<p>row ${i}</p>`).join('')}
</div><form action="/submit" method="post"><input name="search" aria-label="Search term"></form></body></html>`;
const largePayload = Buffer.alloc(3 * 1024 * 1024);
for (let index = 0; index < largePayload.length; index++)
  largePayload[index] = (index * 31 + 19) & 255;
const app = `document.addEventListener('DOMContentLoaded', () => {
  const host = document.createElement('section');
  host.id = 'shadow-probe';
  host.attachShadow({mode:'open'}).innerHTML = '<b id="shadow-inner">Shadow content</b>';
  document.body.append(host);
  const dynamicStyle = document.createElement('style');
  dynamicStyle.textContent = '.dynamic-probe { color: blue; }';
  document.head.append(dynamicStyle);
  document.addEventListener('rest-probe', () => {});
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
});`;

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
  const crossServer = http.createServer((req, res) => {
    const endpoint = new URL(req.url, 'http://localhost').pathname;
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
      '<body><p id="cross-origin-content">Independent origin</p></body>');
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
      '/view.css': ['.scroll {height: 160px; overflow-y: auto} p {height: 35px}', 'text/css'],
      '/app.js': [app, 'text/javascript'],
      '/background-worker.js': [
        'postMessage("worker-ready");setInterval(()=>{},5000);',
        'text/javascript'],
      '/shared-worker.js': [
        'onconnect=e=>{e.ports[0].postMessage("shared-ready");e.ports[0].start()};',
        'text/javascript'],
      '/service-worker.js': [
        'self.addEventListener("install",()=>{});self.addEventListener("activate",()=>{});',
        'text/javascript'],
      '/frame.html': [
        '<!doctype html><title>Frame child</title><body><p>Same-origin iframe</p></body>',
        'text/html'],
      '/data.json': ['{"initial":true}', 'application/json'],
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
    const uri = `http://127.0.0.1:${server.address().port}/`;
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
      'rest/manifest.json', 'rest/page.mhtml',
      'rest/targets/target-000/dom-tree.json',
      'rest/targets/target-000/dom-snapshot.json',
      'rest/resources-at-rest.jsonl', 'rest/scripts-at-rest.jsonl',
      'rest/cookies.json', 'rest/targets/target-000/storage.json',
      'network-details.jsonl', 'rest/network-details-at-rest.jsonl',
      'rest/targets/target-000/indexeddb/index.json',
      'rest/targets/target-000/cache-storage/index.json',
      'rest/targets/target-000/storage-usage.json',
      'rest/target-graph-initial.json', 'rest/target-graph-final.json'])
      assert(fs.existsSync(path.join(capture, file)), 'missing ' + file);
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
    const wire = fs.readFileSync(path.join(capture,'cdp-wire.jsonl'),'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    assert(wire.length > 20, 'CDP wire ledger is unexpectedly small');
    assert(wire.every((entry,i) => entry.sequence === i + 1),
      'wire ledger ordering or sequence has a gap');
    const parsedWire = wire.map(entry => ({
      direction:entry.direction, packet:JSON.parse(entry.raw)
    }));
    assert(parsedWire.some(entry => entry.direction === 'inbound' &&
      entry.packet.method === 'Runtime.executionContextCreated'),
      'unhandled-by-dispatcher CDP event was silently discarded');
    assert(parsedWire.some(entry => entry.direction === 'outbound' &&
      entry.packet.method === 'Browser.getVersion'),
      'browser-level CDP commands were not archived');
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
    const scriptIndex = fs.readFileSync(path.join(capture, 'scripts.jsonl'), 'utf8');
    assert(scriptIndex.includes('"status":"saved"'), 'compiled JS not recorded');
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
