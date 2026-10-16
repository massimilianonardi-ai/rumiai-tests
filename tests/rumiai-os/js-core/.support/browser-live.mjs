// Real Chrome/Chromium regression for the generated classic core script.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import {join,resolve} from 'node:path';

const root = resolve(process.argv[2]);
const compiler = join(root, 'lib/sys/js/jsc.lib.js');
const descriptor = join(root, 'lib/sys/js/core/modules-js.json');
const built = spawnSync(process.execPath, [compiler, descriptor], {encoding: 'utf8', timeout: 30000});
assert.equal(built.status, 0, built.stderr);
const html = `<!doctype html>
<html><body><div id="result">PENDING</div>
<script src="/core.js"></script>
<script>
try
{
  const ok = typeof m.Class === 'function' &&
    m.util.environment() === 'browser' &&
    Number.isFinite(m.util.timestamp()) &&
    m.util.deviceMobility() === 'fixed' &&
    m.json.path('.group[0]["value"]', {group: [{value: 42}]}) === 42 &&
    typeof m.object.clone === 'function' &&
    typeof m.object.merge === 'function' &&
    typeof m.object.link === 'function' &&
    typeof m.object.linkProperty === 'function' &&
    m.object.link({x: 4}, {}).x === 4 &&
    typeof m.object.traverse === 'function' &&
    m.object.traverse === m.json.traverse &&
    m.object.traverse({x: 1}).paths.length === 2 &&
    m.object.merge({a: 1}, {b: 2}).b === 2 &&
    Array.isArray(m.object.clone([1, 2], true)) &&
    m.global === m.g &&
    m.root === '' &&
    m.path === '/core.js';
  document.getElementById('result').textContent = ok ? 'PASS' : 'FAIL';
}
catch(error)
{
  document.getElementById('result').textContent = 'ERROR: ' + error.message;
}
</script></body></html>`;
const server = http.createServer
(
  (req,res) =>
  {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if(pathname === '/core.js')
    {
      res.writeHead(200, {'Content-Type': 'text/javascript'});
      res.end(built.stdout);
    }
    else if(pathname === '/')
    {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(html);
    }
    else
    {
      res.writeHead(404);
      res.end('not found');
    }
  }
);
const profile = await mkdtemp(join(os.tmpdir(), 'js-core-chrome-'));

function browser(url)
{
  return new Promise
  (
    (resolveResult,reject) =>
    {
      const child = spawn
      (
        process.env.CHROMIUM,
        [
          '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
          '--no-first-run','--virtual-time-budget=12000',
          '--user-data-dir='+profile,'--dump-dom',url
        ],
        {stdio: ['ignore','pipe','pipe']}
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout
      (
        () =>
        {
          child.kill('SIGKILL');
          reject(new Error('Chrome timed out: ' + stderr.slice(-1000)));
        },
        40000
      );
      child.stdout.on('data', bytes => stdout += bytes.toString());
      child.stderr.on('data', bytes => stderr += bytes.toString());
      child.once('error', error =>
      {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', code =>
      {
        clearTimeout(timer);
        resolveResult({code,stdout,stderr});
      });
    }
  );
}
try
{
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const result = await browser(url);
  assert.equal(result.code, 0, result.stderr.slice(-1000));
  assert.match(result.stdout, /<div id="result">PASS<\/div>/,
    'core classic script failed in Chrome: ' + result.stdout.slice(-1400));
  console.log('PASS actual Chrome classic-script core startup');
}
finally
{
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await rm(profile, {recursive: true, force: true});
}
