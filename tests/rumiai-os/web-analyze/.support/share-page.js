'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {startWebAnalyze} = require(path.join(process.argv[2], 'lib/sys/js/web-analyze.lib.js'));
const url = 'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readEvents = (dir, topic) => fs.readFileSync(path.join(dir, `${topic}.jsonl`), 'utf8')
  .split('\n').filter(Boolean).map(JSON.parse);
(async () => {
  const probe = spawnSync('chromium', ['--version'], {encoding: 'utf8'});
  if (probe.error?.code === 'ENOENT') {
    console.error('SKIP: chromium executable not on PATH');
    process.exitCode = 2;
    return;
  }
  assert.equal(probe.status, 0, 'chromium must be runnable');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-analyze-share-test-'));
  const outputDir = path.join(temp, 'evidence');
  let session;
  try {
    session = await startWebAnalyze({url, outputDir, headless: true, timeoutMs: 20000});
    await pause(7000);
    const summary = await session.stop();
    const errors = readEvents(outputDir, 'error');
    const blocked = errors.find(e => e.type === 'page.initial-navigation-failed' &&
      /ERR_BLOCKED_BY_ADMINISTRATOR/.test(e.errorText || ''));
    if (blocked) {
      console.error('SKIP: host administrator policy blocks ChatGPT share page');
      process.exitCode = 2;
      return;
    }
    const failure = errors.find(e => e.type === 'page.initial-navigation-failed');
    assert(!failure, `ChatGPT share navigation failed: ${failure?.errorText}`);
    const lifecycle = readEvents(outputDir, 'lifecycle');
    assert(lifecycle.some(e => e.type === 'page.frame-navigated' && e.url === url),
      'Chromium did not navigate to the requested ChatGPT share page');
    const network = readEvents(outputDir, 'network');
    assert(network.some(e => e.type === 'response' && e.url === url && e.status === 200),
      'ChatGPT share page did not return HTTP 200');
    assert(summary.counts.lifecycle > 0 && summary.counts.network > 0,
      'capture did not record page and network events');
    assert.equal(summary.dropped.lifecycle, 0);
    assert.equal(summary.dropped.network, 0);
    assert(fs.existsSync(path.join(outputDir, 'summary.json')));
  } finally {
    if (session) await session.stop();
    fs.rmSync(temp, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
