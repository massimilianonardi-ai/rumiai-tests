'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawnSync} = require('node:child_process');
const root = process.argv[2];
const {startWebAnalyze} = require(path.join(root, 'lib/sys/js/web-analyze.lib.js'));
function pause(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
function _cdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map(); let nextId = 0;
    socket.addEventListener('error', reject, {once: true});
    socket.addEventListener('open', () => resolve({
      send(method, params, sessionId) {
        const id = ++nextId;
        return new Promise((resolve, reject) => {
          pending.set(id, {resolve, reject});
          socket.send(JSON.stringify({id, method, params, sessionId}));
        });
      },
      close() {socket.close();}
    }), {once: true});
    socket.addEventListener('message', e => {
      const m = JSON.parse(String(e.data));
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    });
  });
}
(async () => {
  await assert.rejects(startWebAnalyze({url: 'file:///etc/passwd', outputDir: '/tmp/unreachable'}),
    e => e.code === 'web-analyze.invalid-scheme');
  const probe = spawnSync('chromium', ['--version'], {encoding: 'utf8'});
  if (probe.error?.code === 'ENOENT') {console.log('SKIP: chromium not installed');process.exit(2);}
  assert.equal(probe.status, 0, 'chromium must be runnable');
  const server = http.createServer((req, res) => {res.setHeader('Content-Type', 'text/html');res.end('<html><body>probe</body></html>');});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'web-analyze-test-'));
  const outputDir = path.join(directory, 'evidence');
  let session, external;
  try {
    session = await startWebAnalyze({url: `http://127.0.0.1:${server.address().port}/?password=secret`,
      outputDir, headless: true, timeoutMs: 20000});
    const [port, endpoint] = fs.readFileSync(path.join(session.profileDir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    external = await _cdp(`ws://127.0.0.1:${port}${endpoint}`);
    const lifecycle = fs.readFileSync(path.join(outputDir,'lifecycle.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    const targetId = lifecycle.find(e => e.type === 'capture.ready').targetId;
    const {sessionId} = await external.send('Target.attachToTarget', {targetId, flatten:true});
    await external.send('Runtime.enable', {}, sessionId);
    // Let the initial navigation settle before testing this document's observer.
    await pause(600);
    const result = await external.send('Runtime.evaluate', {expression:
      "document.body.innerHTML='<button>click</button>'; document.querySelector('button').click(); console.log('secret'); document.body.setAttribute('data-probe','x'); ({ok:true})",
      returnByValue:true}, sessionId);
    assert.equal(result.result?.value?.ok, true);
    await pause(600);
    const summary = await session.stop();
    assert(fs.readFileSync(path.join(outputDir,'interaction.jsonl'),'utf8').includes('dom.click'),
      'DOM click observation expected');
    assert(summary.counts.dom > 0, 'DOM mutation events expected');
    assert(summary.counts.console > 0, 'console events expected');
    assert.equal(summary.dropped.interaction, 0);
    const all = ['lifecycle','interaction','dom','network','console','performance','error'].map(topic =>
      fs.readFileSync(path.join(outputDir,`${topic}.jsonl`),'utf8')).join('');
    assert(!all.includes('password=secret'), 'sensitive URL query leaked');
    assert(!all.includes("console.log('secret')"), 'raw script contents leaked');
    assert(fs.existsSync(path.join(outputDir,'summary.json')));
  } finally {
    external?.close();
    if(session) await session.stop();
    server.close();
    fs.rmSync(directory, {force:true, recursive:true});
  }
})().catch(error => {console.error(error); process.exitCode=1;});
