'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn, spawnSync} = require('node:child_process');

const root = process.argv[2];
const command = path.join(root, 'bin/sys/web-analyze');
const env = {...process.env, m_ROOT: root, m_LIB_DIR: path.join(root, 'lib')};
const html = `<!DOCTYPE html><html><head><title>Dynamic evidence fixture</title>
<link rel="stylesheet" href="/view.css"><script defer src="/app.js"></script></head>
<body><h1>Interactive view</h1><div id="list" class="scroll">
${Array.from({length: 50}, (_,i)=>`<p>row ${i}</p>`).join('')}
</div><form action="/submit" method="post"><input name="search" aria-label="Search term"></form></body></html>`;
const app = `document.addEventListener('DOMContentLoaded', () => {
  fetch('/data.json');
  document.querySelector('#list').addEventListener('scroll', () => {
    if (document.querySelector('#list').scrollTop > 50 && !document.querySelector('#lazy')) {
      const button = document.createElement('button');
      button.id = 'lazy'; button.textContent = 'Lazy control'; document.body.append(button);
      fetch('/lazy.json');
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
    }, 70000);
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

  const server = http.createServer((req, res) => {
    const location = new URL(req.url, 'http://127.0.0.1').pathname;
    const data = {
      '/': [html, 'text/html'],
      '/view.css': ['.scroll {height: 160px; overflow-y: auto} p {height: 35px}', 'text/css'],
      '/app.js': [app, 'text/javascript'],
      '/data.json': ['{"initial":true}', 'application/json'],
      '/lazy.json': ['{"lazy":true}', 'application/json']
    }[location];
    if (!data) {res.statusCode=404;res.end('not found');return;}
    res.setHeader('Content-Type', data[1]);
    res.end(data[0]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'web-analyze-command-'));
  try
  {
    const uri = `http://127.0.0.1:${server.address().port}/`;
    const base = path.join(work, 'reports');
    const result = await run([uri, base]);
    assert.equal(result.code, 0, `analysis exit ${result.code}: ${result.stderr}`);
    const report = result.stdout.trim();
    assert(report.endsWith('/README.md'), 'command did not emit README path');
    assert(fs.existsSync(report), 'report path is not present');
    const capture = path.dirname(report);
    assert.equal(fs.statSync(capture).mode & 0o777, 0o700, 'recording directory is not private');
    for (const file of ['DOM.md', 'NETWORK.md', 'SCRIPTS.md', 'FLOWS.md',
      'LIMITATIONS.md', 'summary.json', 'resources.jsonl', 'scripts.jsonl',
      'states/state-000.json', 'states/screen-000.png'])
      assert(fs.existsSync(path.join(capture, file)), 'missing ' + file);
    const states = fs.readdirSync(path.join(capture, 'states'))
      .filter(name => /^state-\d+\.json$/.test(name))
      .map(name => JSON.parse(fs.readFileSync(path.join(capture, 'states', name), 'utf8')));
    assert(states.length >= 2, 'nested scroll was not explored');
    assert(states.some(state => state.controls.some(control => control.label === 'Lazy control')),
      'lazy DOM control not captured');
    const responseIndex = fs.readFileSync(path.join(capture, 'resources.jsonl'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    for (const name of ['/app.js', '/view.css', '/data.json', '/lazy.json'])
      assert(responseIndex.some(item => item.status === 'saved' && item.url?.endsWith(name)),
        'missing downloaded resource ' + name);
    assert(fs.readFileSync(path.join(capture, 'FLOWS.md'), 'utf8').includes('flowchart TD'));
    const scriptIndex = fs.readFileSync(path.join(capture, 'scripts.jsonl'), 'utf8');
    assert(scriptIndex.includes('"status":"saved"'), 'compiled JS not recorded');
    const repeated = await run([uri, base]);
    assert.equal(repeated.code, 0, 'rerun must work without overwriting evidence: ' + repeated.stderr);
    assert.notEqual(repeated.stdout.trim(), result.stdout.trim());
    assert(fs.existsSync(report), 'rerun overwrote original report');
  }
  finally
  {
    server.close();
    fs.rmSync(work, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
