'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, spawnSync} = require('node:child_process');
const library = path.join(process.argv[2], 'lib/sys/js/web-analyze.lib.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function _display() {
  if (spawnSync('Xvfb', ['-help'], {stdio:'ignore'}).error?.code === 'ENOENT') return null;
  const xvfb = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1024x768x24', '-nolisten', 'tcp'],
    {stdio: ['ignore', 'ignore', 'ignore', 'pipe']});
  const displayNumber = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Xvfb display allocation timeout')), 4000);
    xvfb.stdio[3].once('data', bytes => {clearTimeout(timer);resolve(bytes.toString().trim());});
    xvfb.once('error', err => {clearTimeout(timer);reject(err);});
    xvfb.once('exit', code => {clearTimeout(timer);reject(new Error('Xvfb exited: '+code));});
  });
  return {xvfb, display: ':' + displayNumber};
}

async function main() {
  const usage = spawnSync(process.execPath, [library], {encoding: 'utf8'});
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /nodejs <path-to-lib> <url> <analisys-dir>/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-analyze-cli-test-'));
  let display, browser;
  try {
    const previous = path.join(root, 'previous');
    fs.mkdirSync(previous);
    fs.writeFileSync(path.join(previous, 'lifecycle.jsonl'), 'old-evidence\n');
    const collision = spawnSync(process.execPath, [library, 'https://example.org', previous], {encoding:'utf8'});
    assert.equal(collision.status, 1);
    assert.match(collision.stderr, /existing-evidence/);
    assert.equal(fs.readFileSync(path.join(previous, 'lifecycle.jsonl'), 'utf8'), 'old-evidence\n');

    const chromium = spawnSync('chromium', ['--version'], {encoding:'utf8'});
    if (chromium.error?.code === 'ENOENT') {console.error('SKIP: chromium unavailable');return 2;}
    assert.equal(chromium.status, 0);
    display = await _display();
    if (!display && !process.env.DISPLAY && process.platform !== 'darwin') {
      console.error('SKIP: graphical display and Xvfb unavailable');return 2;
    }
    const dest = path.join(root, 'nested', 'evidence');
    const env = {...process.env};
    if (display) env.DISPLAY = display.display;
    browser = spawn(process.execPath, [library, 'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835?token=secret', dest],
      {env, stdio: ['ignore','pipe','pipe']});
    let stdout = ''; let stderr = '';
    browser.stdout.on('data', bytes => {stdout += bytes.toString();});
    browser.stderr.on('data', bytes => {stderr += bytes.toString();});
    const deadline = Date.now() + 22000;
    while (!stdout.includes('Chromium opened') && browser.exitCode === null && Date.now() < deadline)
      await delay(100);
    assert.match(stdout, /Chromium opened/, 'start failed: ' + stderr);
    assert(fs.statSync(dest).isDirectory(), 'nested analysis directory must be created');
    const exiting = new Promise(resolve => browser.once('exit', resolve));
    browser.kill('SIGINT');
    const exitStatus = await Promise.race([exiting, delay(10000).then(() => {throw new Error('stop timeout');})]);
    assert.equal(exitStatus, 0, 'SIGINT should finalize the capture: ' + stderr);
    assert.match(stdout, /Analysis finished/);
    const summary = JSON.parse(fs.readFileSync(path.join(dest, 'summary.json'), 'utf8'));
    assert(summary.totalEvents > 0);
    assert(!fs.readFileSync(path.join(dest, 'lifecycle.jsonl'), 'utf8').includes('token=secret'));
    return 0;
  } finally {
    if (browser?.exitCode === null) browser.kill('SIGKILL');
    if (display) display.xvfb.kill('SIGTERM');
    fs.rmSync(root, {recursive: true, force: true});
  }
}
main().then(code => {process.exitCode = code;}, e => {console.error(e); process.exitCode = 1;});
