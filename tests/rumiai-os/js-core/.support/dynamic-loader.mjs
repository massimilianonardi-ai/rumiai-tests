// Verify the real jsc-generated m.mod DynamicLoader in an actual browser.
// HTTP fixture responses deliberately finish out of manifest order.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const root = resolve(process.argv[2]);
const compiler = join(root, 'lib/sys/js/jsc.lib.js');
const manifest = join(root, 'lib/sys/js/core/modules-dynamic-loader.json');
const built = spawnSync
(
  process.execPath,
  [compiler, manifest],
  {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024}
);
assert.equal(built.status, 0, 'real jsc failed: ' + built.stderr);
new vm.Script(built.stdout);

const dom = vm.createContext
(
  {
    window: {},
    document: {baseURI: 'http://localhost/'},
    location: {origin: 'http://localhost'},
    console
  }
);
vm.runInContext(built.stdout, dom);
assert.equal(typeof dom.m.mod.Queue, 'function');
assert.equal(typeof dom.m.mod.DynamicLoader, 'function');
console.log('PASS actual jsc specialized descriptor compilation and namespace exports');

if(!process.env.CHROMIUM)
{
  console.log('SKIP Chrome integration: CHROMIUM is unset');
  process.exit(0);
}

const json = value => JSON.stringify(value);
const jsTree = files =>
(
  {
    modules:
    [
      {
        name: 'm',
        modules:
        [
          {
            name: 'demo',
            modules: files
          }
        ]
      }
    ]
  }
);
const fixtures = new Map
(
  [
    ['/demo/js.json', ['application/json', json(jsTree([
      {file: 'A.js', exports: 'A'},
      {file: 'B.js', exports: 'B'},
      {file: 'C.js', exports: 'C'}
    ]))]],
    ['/demo/js-patch.json', ['application/json', json(jsTree([
      {file: 'patch.js', exports: 'C'}
    ]))]],
    ['/demo/css.json', ['application/json', json({modules: [
      {file: 'base.css'},
      {file: 'extra.css'}
    ]})]],
    ['/demo/css-patch.json', ['application/json', json({modules: [
      {file: 'patch.css'}
    ]})]],
    ['/demo/missing-source.json', ['application/json', json(jsTree([
      {file: 'absent.js', exports: 'Absent'}
    ]))]],
    ['/demo/bad.json', ['application/json', '{invalid JSON']],
    ['/demo/A.js', ['text/javascript', 'function A(){return 20;}\n']],
    ['/demo/B.js', ['text/javascript', 'function B(){return A()+20;}\n']],
    ['/demo/C.js', ['text/javascript', 'function C(){return B()+2;}\n']],
    ['/demo/patch.js', ['text/javascript', 'function C(){return m.demo.B()+33;}\n']],
    ['/demo/base.css', ['text/css', '#target{color:rgb(0,128,0);}\n']],
    ['/demo/extra.css', ['text/css', '#target{font-weight:bold;}\n']],
    ['/demo/patch.css', ['text/css', '#target{color:blue;}\n']]
  ]
);
const page = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<script src="/loader.js"></script></head>',
  '<body><div id="target">CSS</div><div id="result">PENDING</div>',
  '<script nonce="test-nonce">',
  '(async function ()',
  '{',
  '  const result = document.getElementById("result");',
  '  const assert = (value, message) => { if(!value) throw Error(message); };',
  '  try',
  '  {',
  '    assert(typeof m.mod.Queue === "function", "Queue export");',
  '    assert(typeof m.mod.DynamicLoader === "function", "DynamicLoader export");',
  '    const loader = new m.mod.DynamicLoader();',
  '    const assembled = await loader.compose("/demo/js.json");',
  '    assert(assembled.kind === "js" && assembled.code.includes("function C"), "JS compose");',
  '    const js = await loader.load("/demo/js.json", {nonce: "test-nonce"});',
  '    assert(js.isConnected && js.nonce === "test-nonce", "JS insertion and nonce");',
  '    assert(m.demo.C() === 42, "ordered nested JS execution");',
  '    const css = await loader.load("/demo/css.json");',
  '    assert(css.isConnected && css.tagName === "STYLE", "CSS insertion");',
  '    assert(getComputedStyle(document.getElementById("target")).color === "rgb(0, 128, 0)", "ordered CSS");',
  '    const replacement = await loader.load("/demo/css-patch.json", {replace: css});',
  '    assert(replacement.isConnected && !css.isConnected, "CSS replacement");',
  '    assert(getComputedStyle(document.getElementById("target")).color === "rgb(0, 0, 255)", "updated CSS");',
  '    const patch = await loader.load("/demo/js-patch.json", {replace: js, nonce: "test-nonce"});',
  '    assert(patch.isConnected && !js.isConnected && m.demo.C() === 73, "JS replacement");',
  '    let failures = 0;',
  '    for(const source of ["/demo/bad.json", "/demo/missing-source.json",',
  '                         "/demo/missing.json", "https://example.test/x"])',
  '    {',
  '      try { await loader.compose(source); }',
  '      catch(error) { if(error instanceof Error) failures++; }',
  '    }',
  '    assert(failures === 4, "expected invalid JSON, source HTTP, manifest HTTP and cross-origin failures");',
  '    let mismatch = false;',
  '    try { await loader.load("/demo/js.json", {replace: replacement}); }',
  '    catch(error) { mismatch = error instanceof TypeError; }',
  '    assert(mismatch, "invalid replacement type");',
  '    result.textContent = "PASS NEW DYNAMIC LOADER";',
  '  }',
  '  catch(error)',
  '  {',
  '    result.textContent = "FAIL " + String(error.stack || error);',
  '  }',
  '})();',
  '</script></body></html>'
].join('\n');

const sent = [];
const requested = new Set();
const server = http.createServer
(
  (req, res) =>
  {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requested.add(pathname);

    if(pathname === '/' || pathname === '/index.html' || pathname === '/csp.html')
    {
      const headers = {'Content-Type': 'text/html'};
      if(pathname === '/csp.html')
      {
        headers['Content-Security-Policy'] =
          "default-src 'self'; script-src 'self' 'nonce-test-nonce'; " +
          "style-src 'unsafe-inline'; connect-src 'self'";
      }
      res.writeHead(200, headers);
      res.end(page);
      return;
    }
    if(pathname === '/loader.js')
    {
      res.writeHead(200, {'Content-Type': 'text/javascript'});
      res.end(built.stdout);
      return;
    }

    const fixture = fixtures.get(pathname);
    if(!fixture)
    {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const delay = pathname === '/demo/A.js' ? 110 :
      pathname === '/demo/B.js' ? 60 : 0;
    const send = () =>
    {
      sent.push(pathname);
      res.writeHead(200, {'Content-Type': fixture[0], 'Cache-Control': 'no-store'});
      res.end(fixture[1]);
    };
    if(delay)
    {
      setTimeout(send, delay);
    }
    else
    {
      send();
    }
  }
);
const profile = await mkdtemp(join(os.tmpdir(), 'm-mod-dynamic-loader-'));

function browser(url)
{
  return new Promise
  (
    (done, fail) =>
    {
      const child = spawn
      (
        process.env.CHROMIUM,
        [
          '--headless', '--no-sandbox', '--disable-gpu',
          '--disable-dev-shm-usage', '--no-first-run',
          '--virtual-time-budget=20000',
          '--user-data-dir=' + profile, '--dump-dom', url
        ],
        {stdio: ['ignore', 'pipe', 'pipe']}
      );
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout
      (
        () =>
        {
          child.kill('SIGKILL');
          fail(new Error('Chrome timeout: ' + stderr.slice(-1600)));
        },
        45000
      );
      child.stdout.on('data', chunk => stdout += chunk.toString());
      child.stderr.on('data', chunk => stderr += chunk.toString());
      child.once('error', error =>
      {
        clearTimeout(timeout);
        fail(error);
      });
      child.once('close', code =>
      {
        clearTimeout(timeout);
        done({code, stdout, stderr});
      });
    }
  );
}

try
{
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const result = await browser(url);
  assert.equal(result.code, 0, result.stderr.slice(-1000));
  assert.match
  (
    result.stdout,
    /<div id="result">PASS NEW DYNAMIC LOADER<\/div>/,
    result.stdout.slice(-3500)
  );

  const first = sent.indexOf('/demo/C.js');
  const second = sent.indexOf('/demo/B.js');
  const third = sent.indexOf('/demo/A.js');
  assert.ok(first >= 0 && second > first && third > second,
    'fixture HTTP completions did not occur out of manifest order: ' + sent.join(', '));
  for(const pathname of
  [
    '/loader.js', '/demo/js.json', '/demo/js-patch.json',
    '/demo/css.json', '/demo/css-patch.json',
    '/demo/A.js', '/demo/B.js', '/demo/C.js',
    '/demo/base.css', '/demo/extra.css', '/demo/patch.css',
    '/demo/missing-source.json', '/demo/absent.js'
  ])
  {
    assert.ok(requested.has(pathname), 'HTTP source not requested: ' + pathname);
  }
  const csp = await browser
  (
    'http://127.0.0.1:' + server.address().port + '/csp.html'
  );
  assert.equal(csp.code, 0, csp.stderr.slice(-1000));
  assert.match
  (
    csp.stdout,
    /<div id="result">PASS NEW DYNAMIC LOADER<\/div>/,
    'nonce/CSP scenario: ' + csp.stdout.slice(-3500)
  );
  console.log('PASS real Chromium JS/CSS assemble/load/replace and failure behavior');
  console.log('PASS real Chromium nonce + restrictive script CSP');
}
finally
{
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await rm(profile, {recursive: true, force: true});
}
