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
  const host = document.createElement('section');
  host.id = 'shadow-probe';
  host.attachShadow({mode:'open'}).innerHTML = '<b id="shadow-inner">Shadow content</b>';
  document.body.append(host);
  const dynamicStyle = document.createElement('style');
  dynamicStyle.textContent = '.dynamic-probe { color: blue; }';
  document.head.append(dynamicStyle);
  document.addEventListener('rest-probe', () => {});
  fetch('/data.json');
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
    if (location === '/churn')
    {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Continuous mutations</title><body><div id="churn"></div><script>' +
        'setInterval(() => document.querySelector("#churn").textContent = String(Date.now()), 90)' +
        '</script></body>');
      return;
    }
    const data = {
      '/': [html, 'text/html'],
      '/view.css': ['.scroll {height: 160px; overflow-y: auto} p {height: 35px}', 'text/css'],
      '/app.js': [app, 'text/javascript'],
      '/data.json': ['{"initial":true}', 'application/json'],
      '/lazy.json': ['{"lazy":true}', 'application/json'],
      '/hydrated.json': ['{"hydrated":true}', 'application/json']
    }[location];
    if (!data) {res.statusCode=404;res.end('not found');return;}
    res.setHeader('Content-Type', data[1]);
    if (location === '/hydrated.json')
      setTimeout(() => res.end(data[0]), 600);
    else
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
      'states/state-000.json', 'states/screen-000.png',
      'states/dom-rest-initial.html', 'states/dom-rest-initial.json',
      'states/dom-rest-final.html', 'states/dom-rest-final.json',
      'rest/manifest.json', 'rest/page.mhtml',
      'rest/targets/target-000/dom-tree.json',
      'rest/targets/target-000/dom-snapshot.json',
      'rest/resources-at-rest.jsonl', 'rest/scripts-at-rest.jsonl'])
      assert(fs.existsSync(path.join(capture, file)), 'missing ' + file);
    const states = fs.readdirSync(path.join(capture, 'states'))
      .filter(name => /^state-\d+\.json$/.test(name))
      .map(name => JSON.parse(fs.readFileSync(path.join(capture, 'states', name), 'utf8')));
    assert(states.length >= 2, 'nested scroll was not explored');
    const rest = JSON.parse(fs.readFileSync(path.join(capture, 'rest/manifest.json'), 'utf8'));
    assert.equal(rest.phase, 'rest-before-automated-input');
    assert(rest.artifacts.some(item => item.name === 'resources-at-rest' &&
      item.status === 'saved'), 'rest resource index missing');
    assert(rest.artifacts.some(item => item.name === 'scripts-at-rest' &&
      item.status === 'saved'), 'rest compiled-script index missing');
    assert(rest.artifacts.some(item => item.name === 'dom-tree' && item.status === 'saved'));
    assert(rest.artifacts.some(item => item.name === 'dom-snapshot' && item.status === 'saved'));
    assert(rest.artifacts.some(item => item.name === 'page' && item.status === 'saved'));
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
    for (const name of ['/app.js', '/view.css', '/data.json', '/lazy.json', '/hydrated.json'])
      assert(responseIndex.some(item => item.status === 'saved' && item.url?.endsWith(name)),
        'missing downloaded resource ' + name);
    assert(fs.readFileSync(path.join(capture, 'FLOWS.md'), 'utf8').includes('flowchart TD'));
    const scriptIndex = fs.readFileSync(path.join(capture, 'scripts.jsonl'), 'utf8');
    assert(scriptIndex.includes('"status":"saved"'), 'compiled JS not recorded');
    const repeated = await run([uri, base]);
    assert.equal(repeated.code, 0, 'rerun must work without overwriting evidence: ' + repeated.stderr);
    assert.notEqual(repeated.stdout.trim(), result.stdout.trim());
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
  }
  finally
  {
    server.close();
    fs.rmSync(work, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
