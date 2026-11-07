'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');

const root = process.argv[2];
const command = path.join(root, 'bin/sys/web-export');
const mCommand = path.join(root, 'm');
const env = {...process.env};
delete env.m_ROOT;
delete env.m_LIB_DIR;
const captureEnv = {...env,m_ROOT:root,m_LIB_DIR:path.join(root,'lib')};
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YuzpgAAAABJRU5ErkJggg==',
  'base64');
const font = Buffer.from('wOF2synthetic-font-resource');
const requests = new Map();
let server;
let work;

function count(pathname)
{
  requests.set(pathname, (requests.get(pathname) || 0) + 1);
}

function respond(response, status, type, body)
{
  response.writeHead(status, {'content-type':type,'cache-control':'no-store'});
  response.end(body);
}

function fixtureHtml(origin)
{
  const rows = Array.from({length:36},(_,index)=>`<p>fixture row ${index}</p>`).join('');
  const inlinePixel = pixel.toString('base64');
  const integrity = 'sha256-' + crypto.createHash('sha256')
    .update(fixtureCss(origin)).digest('base64');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>web-export chromium fixture</title>
    <link rel="stylesheet" crossorigin="anonymous" integrity="${integrity}" href="${origin}/fixture.css">
    <style>.inline-block{background-image:url("${origin}/background.png")}</style>
    <script defer src="${origin}/fixture.js"></script>
  </head><body><h1>web-export fixture heading</h1>
    <button id="inert" onclick="document.body.dataset.clicked='yes'">No action</button>
    <form action="${origin}/submit" method="post"><input name="query"></form>
    <img id="pixel" src="${origin}/pixel.png" srcset="${origin}/pixel.png 1x">
    <img id="inline-srcset" srcset="data:image/png;base64,${inlinePixel} 1x, ${origin}/pixel.png 2x">
    <div id="inline-style" style="background-image:url('${origin}/background.png')"></div>
    <div class="inline-block"></div>
    <iframe src="${origin}/frame.html"></iframe><main>${rows}</main>
    <a href="${origin}/destination" ping="${origin}/ping">normal link</a></body></html>`;
}

function fixtureCss(origin)
{
  return `@font-face{font-family:fixture-font;src:url("${origin}/fixture.woff2") format("woff2");font-display:swap}
    body{font-family:fixture-font,sans-serif;background-image:url("${origin}/background.png");background-repeat:no-repeat}
    #pixel{width:32px;height:32px}.missing{background-image:url("${origin}/missing.png")}
    .image-set{background-image:image-set("${origin}/background.png" 1x,"${origin}/missing.png" 2x)}`;
}

function startServer()
{
  server = http.createServer((request,response)=>{
    const url = new URL(request.url,'http://127.0.0.1');
    count(url.pathname);
    if (url.pathname === '/') return respond(response,200,'text/html; charset=utf-8',fixtureHtml(`http://${request.headers.host}`));
    if (url.pathname === '/fixture.css') return respond(response,200,'text/css; charset=utf-8',fixtureCss(`http://${request.headers.host}`));
    if (url.pathname === '/fixture.js')
      return respond(response,200,'application/javascript; charset=utf-8',
        "addEventListener('DOMContentLoaded',()=>{const e=document.createElement('p');e.id='client-rendered';e.textContent='client rendered content';document.body.append(e);for(const name of ['missing','image-set']){const item=document.createElement('div');item.className=name;document.body.append(item)}});");
    if (url.pathname === '/pixel.png' || url.pathname === '/background.png')
      return respond(response,200,'image/png',pixel);
    if (url.pathname === '/fixture.woff2') return respond(response,200,'font/woff2',font);
    if (url.pathname === '/frame.html')
      return respond(response,200,'text/html; charset=utf-8','<!doctype html><p>frame content</p>');
    if (url.pathname === '/missing.png') return respond(response,404,'text/plain','missing fixture asset');
    if (url.pathname === '/favicon.ico') return respond(response,404,'text/plain','');
    return respond(response,404,'text/plain','not found');
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      server.removeListener('error',reject);
      resolve(`http://127.0.0.1:${server.address().port}/`);
    });
  });
}

async function closeServer()
{
  if (!server?.listening) return;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

function run(commandName,args,options={})
{
  process.stderr.write(`web-export fixture: run ${path.basename(commandName)} ${path.basename(args[0] || '')}\n`);
  return new Promise((resolve,reject)=>{
    const child=spawn(commandName,args,{env,...options,stdio:['ignore','pipe','pipe'],
      detached:process.platform!=='win32'});
    let stdout='';
    let stderr='';
    let settled=false;
    const timer=setTimeout(()=>{
      if(process.platform==='win32') child.kill('SIGTERM');
      else try {process.kill(-child.pid,'SIGTERM');} catch (_) {}
      const error=new Error('child process exceeded the 240 second fixture timeout');
      error.code='ETIMEDOUT';
      finish(error);
    },240000);
    const finish=(error,result)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(error)reject(error);
      else resolve(result);
    };
    child.stdout.on('data',chunk=>{
      if(stdout.length<16*1024*1024)stdout+=chunk.toString('utf8');
    });
    child.stderr.on('data',chunk=>{
      if(stderr.length<16*1024*1024)stderr+=chunk.toString('utf8');
    });
    child.once('error',error=>finish(error));
    child.once('close',(status,signal)=>{
      process.stderr.write(`web-export fixture: exit ${status}\n`);
      finish(null,{status,signal,stdout,stderr});
    });
  });
}

async function main()
{
  work = fs.mkdtempSync(path.join(os.tmpdir(),'web-export-command-'));
  fs.chmodSync(work,0o700);
  try
  {
    const sourceUrl = await startServer();
    const exportDir = path.join(work,'offline');
    const capture = await run(mCommand,['web-export',sourceUrl,exportDir],{env});
    assert.equal(capture.status,0,
      `web-export failed (${capture.status}): ${capture.stderr}`);
    const indexPath = capture.stdout.trim();
    assert.equal(indexPath,path.join(exportDir,'index.html'));
    assert.equal(fs.statSync(exportDir).mode & 0o777,0o700);
    assert.equal(fs.statSync(indexPath).mode & 0o777,0o600);

    const html = fs.readFileSync(indexPath,'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(exportDir,'manifest.json'),'utf8'));
    assert.equal(manifest.format,'web-export/1');
    assert.equal(manifest.mode,'standalone-file');
    assert.match(html,/Content-Security-Policy/);
    assert.match(html,/connect-src 'none'/);
    assert.match(html,/client rendered content/);
    assert.equal((html.match(/<script\b/gi) || []).length,1,
      'only the exporter-owned scroll-restoration script may remain');
    assert.match(html,/<script\b[^>]*src="assets\/web-export-scroll-[a-f0-9]{64}\.js"/i);
    assert.doesNotMatch(html,/<iframe\b/i);
    assert.doesNotMatch(html,/\b(?:crossorigin|integrity|referrerpolicy)=/i,
      'source fetch metadata makes local-file assets fail origin or integrity checks');
    assert.doesNotMatch(html,/onclick=/i);
    assert.doesNotMatch(html,/<form\b[^>]*\saction=/i);
    assert.doesNotMatch(html,/\bping=/i);
    assert.doesNotMatch(html,/\bformaction=/i);
    assert.doesNotMatch(html,/style=["'][^"']*https?:/i,
      'a remote inline style reference remains');
    assert.doesNotMatch(html,/\b(?:src|poster|data|background|xlink:href)=["']https?:/i,
      'an active HTML resource reference remains remote');
    assert.doesNotMatch(html,/\bsrcset=["'][^"']*https?:/i,
      'an active srcset candidate remains remote');
    assert.doesNotMatch(html,/<link\b(?![^>]*\brel=["']canonical)[^>]*\bhref=["']https?:/i,
      'an active link resource remains remote');
    assert.doesNotMatch(html,/<style\b[^>]*>[\s\S]*?url\(\s*["']?https?:/i,
      'an inline stylesheet reference remains remote');
    assert.match(html,/href="https?:\/\/127\.0\.0\.1:[0-9]+\/destination"/);
    assert.equal(manifest.coverage.scriptsRemoved > 0,true);
    assert.equal(manifest.scripts,'site-scripts-removed');
    assert.deepEqual(manifest.generatedScripts,['scroll-restoration']);
    assert.equal(manifest.coverage.scrollRestorationScript,true);
    assert.ok(manifest.coverage.scrollPositionsCaptured>0,
      'the browser capture did not retain a non-zero scroll position');
    assert.equal(manifest.coverage.framesRemoved > 0,true);
    assert.equal(manifest.coverage.unavailableCssReferences > 0,true);
    assert.ok(manifest.assets.some(asset=>asset.kind==='stylesheet'));
    assert.ok(manifest.assets.some(asset=>asset.kind==='image'));
    assert.ok(manifest.assets.some(asset=>asset.kind==='font'));
    assert.ok(manifest.assets.every(asset=>asset.bytes>0),
      'an empty body from a failed visual request was exported');
    assert.ok(manifest.coverage.unverifiedBodies>0,
      'an unsuccessful source response was not recorded as rejected');

    const allAssets = new Set(manifest.assets.map(asset=>asset.file));
    for (const asset of manifest.assets)
    {
      const file = path.join(exportDir,asset.file);
      assert.ok(fs.existsSync(file),`missing local asset ${asset.file}`);
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.length,asset.bytes,`asset size mismatch ${asset.file}`);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256,
        `asset digest mismatch ${asset.file}`);
    }
    assert.equal(manifest.assets.length,allAssets.size,'manifest lists duplicate asset paths');
    assert.equal(crypto.createHash('sha256').update(html).digest('hex'),manifest.document.sha256);
    for (const asset of manifest.assets.filter(item=>item.kind==='stylesheet'))
    {
      const css = fs.readFileSync(path.join(exportDir,asset.file),'utf8');
      assert.doesNotMatch(css,/url\(\s*['"]?https?:/i,`remote URL remains in ${asset.file}`);
      assert.doesNotMatch(css,/@import\s+(?:url\()?\s*['"]?https?:/i,
        `remote CSS import remains in ${asset.file}`);
      assert.doesNotMatch(css,/https?:\/\//i,`remote CSS string URL remains in ${asset.file}`);
    }
    assert.match(html,/src="assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|svg)"/i);
    assert.match(html,/srcset="assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|svg) 1x"/i);
    assert.match(html,/srcset="data:image\/png;base64,[a-z0-9+/=]+ 1x, assets\/[a-f0-9]{64}\.png 2x"/i);

    const requestsAfterCapture = new Map(requests);
    const fileUrl = pathToFileURL(indexPath).href;
    const profile = path.join(work,'offline-profile');
    const chromium = await run('chromium',['--headless=new','--disable-gpu','--disable-background-networking',
      '--no-first-run','--no-default-browser-check','--virtual-time-budget=5000',
      '--user-data-dir=' + profile,'--dump-dom',fileUrl]);
    assert.equal(chromium.status,0,`Chromium could not open the file export: ${chromium.stderr}`);
    assert.match(chromium.stdout,/client rendered content/);
    assert.equal(chromium.stdout.includes('web-export fixture heading'),true);
    assert.match(chromium.stdout,/data-web-export-scroll-restored="[1-9][0-9]*"/,
      'the local scroll-restoration helper did not execute');
    assert.doesNotMatch(chromium.stderr,/Access to CSS stylesheet .*blocked by CORS policy/i,
      'Chromium rejected the local rewritten stylesheet');
    assert.deepEqual([...requests], [...requestsAfterCapture],
      'opening the file export requested a resource from the source server');

    const collision = await run(mCommand,['web-export',sourceUrl,exportDir],{env});
    assert.equal(collision.status,7,'existing export directory was not refused');
    assert.equal(fs.existsSync(indexPath),true,'destination collision modified the prior export');

    const fakeRoot=path.join(work,'synthetic-m-os');
    const fakeBin=path.join(fakeRoot,'bin/sys');
    const fakeLib=path.join(fakeRoot,'lib');
    fs.mkdirSync(fakeBin,{recursive:true,mode:0o700});
    fs.mkdirSync(fakeLib,{recursive:true,mode:0o700});
    fs.copyFileSync(command,path.join(fakeBin,'web-export'));
    fs.chmodSync(path.join(fakeBin,'web-export'),0o700);
    const fallbackCss=Buffer.from('@import url("https://fixture.invalid/not-archived.css") screen;\n' +
      'body{background-image:url("https://fixture.invalid/fallback.png")}\n' +
      '.missing{background-image:url("https://fixture.invalid/not-archived.png")}');
    const httpCss=Buffer.from('body{color:rebeccapurple}');
    const ambiguousCssA=Buffer.from('body{color:teal}');
    const ambiguousCssB=Buffer.from('body{color:maroon}');
    const expectedBody=Buffer.from('good bytes');
    const tamperedBody=Buffer.from('bad! bytes');
    const hash=body=>crypto.createHash('sha256').update(body).digest('hex');
    const fixture={
      html:'<!doctype html><html><head><title>fallback fixture</title>' +
        '<style>body{min-height:2200px}</style>' +
        '<link rel="stylesheet" href="https://fixture.invalid/recovered.css">' +
        '<link rel="stylesheet" href="https://fixture.invalid/ambiguous.css"></head>' +
        '<body><h1>CSSOM fallback</h1><img id="fallback" src="https://fixture.invalid/fallback.png">' +
        '<img id="tampered" src="https://fixture.invalid/tampered.png">' +
        '<img id="missing" src="https://fixture.invalid/not-archived.png">' +
        '<img id="local-file" src="file:///etc/passwd">' +
        '<img id="blob-url" src="blob:https://fixture.invalid/opaque"></body></html>',
      css:fallbackCss.toString('base64'),pixel:pixel.toString('base64'),
      httpCss:httpCss.toString('base64'),ambiguousCssA:ambiguousCssA.toString('base64'),
      ambiguousCssB:ambiguousCssB.toString('base64'),
      tampered:tamperedBody.toString('base64'),expectedSha:hash(expectedBody),
      expectedBytes:expectedBody.length,cssSha:hash(fallbackCss),cssBytes:fallbackCss.length,
      httpCssSha:hash(httpCss),httpCssBytes:httpCss.length,
      ambiguousCssASha:hash(ambiguousCssA),ambiguousCssABytes:ambiguousCssA.length,
      ambiguousCssBSha:hash(ambiguousCssB),ambiguousCssBBytes:ambiguousCssB.length,
      pixelSha:hash(pixel),pixelBytes:pixel.length
    };
    const analyzer=[
      "const fs=require('node:fs'),path=require('node:path');",
      `const fixture=${JSON.stringify(fixture)};`,
      "if(process.env.WEB_EXPORT_SYNTHETIC_FAILURE){process.stderr.write('web-analyze.document-not-observed: fixture failure\\n');process.exit(11)}",
      "const capture=process.argv[3],run=path.join(capture,'synthetic-run');",
      "fs.mkdirSync(path.join(run,'states'),{recursive:true});",
      "fs.mkdirSync(path.join(run,'resources'));",
      "fs.mkdirSync(path.join(run,'rest/stylesheets/cssom'),{recursive:true});",
      "fs.writeFileSync(path.join(run,'states/dom-rest-final.html'),fixture.html);",
      "fs.writeFileSync(path.join(run,'states/dom-rest-final.json'),JSON.stringify({scrollPositions:[{selector:'html:nth-of-type(1)',top:120,left:0}],scrollPositionsTruncated:false}));",
      "fs.writeFileSync(path.join(run,'resources/fallback.png'),Buffer.from(fixture.pixel,'base64'));",
      "fs.writeFileSync(path.join(run,'resources/tampered.png'),Buffer.from(fixture.tampered,'base64'));",
      "fs.writeFileSync(path.join(run,'resources/recovered-http.css'),Buffer.from(fixture.httpCss,'base64'));",
      "fs.writeFileSync(path.join(run,'resources/ambiguous-a.css'),Buffer.from(fixture.ambiguousCssA,'base64'));",
      "fs.writeFileSync(path.join(run,'resources/ambiguous-b.css'),Buffer.from(fixture.ambiguousCssB,'base64'));",
      "fs.writeFileSync(path.join(run,'rest/stylesheets/cssom/recovered.css'),Buffer.from(fixture.css,'base64'));",
      "const rows=[",
      "{url:'https://fixture.invalid/recovered.css',status:'body-unavailable',resourceType:'Stylesheet',mimeType:'text/css'},",
      "{url:'https://fixture.invalid/fallback.png',status:'saved',resourceType:'Image',mimeType:'image/png',file:'resources/fallback.png',sha256:fixture.pixelSha,bytes:fixture.pixelBytes,httpStatus:200},",
      "{url:'https://fixture.invalid/tampered.png',status:'saved',resourceType:'Image',mimeType:'image/png',file:'resources/tampered.png',sha256:fixture.expectedSha,bytes:fixture.expectedBytes,httpStatus:200}];",
      "rows.push({url:'https://fixture.invalid/recovered.css',status:'saved',resourceType:'Stylesheet',mimeType:'text/css',file:'resources/recovered-http.css',sha256:fixture.httpCssSha,bytes:fixture.httpCssBytes,httpStatus:200});",
      "rows.push({url:'https://fixture.invalid/ambiguous.css',status:'saved',resourceType:'Stylesheet',mimeType:'text/css',file:'resources/ambiguous-a.css',sha256:fixture.ambiguousCssASha,bytes:fixture.ambiguousCssABytes,httpStatus:200});",
      "rows.push({url:'https://fixture.invalid/ambiguous.css',status:'saved',resourceType:'Stylesheet',mimeType:'text/css',file:'resources/ambiguous-b.css',sha256:fixture.ambiguousCssBSha,bytes:fixture.ambiguousCssBBytes,httpStatus:200});",
      "fs.writeFileSync(path.join(run,'resources.jsonl'),rows.map(row=>JSON.stringify(row)).join('\\n')+'\\n');",
      "fs.writeFileSync(path.join(run,'rest/stylesheets/index.json'),JSON.stringify([{status:'saved',sourceURL:'https://fixture.invalid/recovered.css',file:'stylesheets/cssom/recovered.css',sha256:fixture.cssSha,bytes:fixture.cssBytes}]));",
      "fs.writeFileSync(path.join(run,'README.md'),'synthetic capture\\n');",
      "process.stdout.write(path.join(run,'README.md')+'\\n');"
    ].join('\n');
    fs.writeFileSync(path.join(fakeBin,'web-analyze'),analyzer,{mode:0o700});
    const fallbackDir=path.join(work,'cssom-fallback');
    const fallback=await run(process.execPath,[path.join(fakeBin,'web-export'),
      'https://fixture.invalid/page',fallbackDir],
      {env:{...captureEnv,m_ROOT:fakeRoot,m_LIB_DIR:fakeLib}});
    assert.equal(fallback.status,0,`CSSOM fallback export failed: ${fallback.stderr}`);
    const fallbackHtml=fs.readFileSync(path.join(fallbackDir,'index.html'),'utf8');
    const fallbackManifest=JSON.parse(fs.readFileSync(path.join(fallbackDir,'manifest.json'),'utf8'));
    assert.equal(fallbackManifest.coverage.stylesheetSourcesFromCssom,1);
    assert.equal(fallbackManifest.coverage.scrollRestorationScript,true);
    assert.equal(fallbackManifest.coverage.unverifiedBodies,1);
    assert.equal(fallbackManifest.coverage.ambiguousAssetUrls,1);
    assert.ok(fallbackManifest.coverage.unavailableHtmlReferences>=2);
    assert.ok(fallbackManifest.coverage.unavailableCssReferences>=2);
    assert.ok(fallbackManifest.assets.some(asset=>asset.kind==='stylesheet'&&asset.source==='cssom-source'));
    assert.match(fallbackHtml,/href="assets\/[a-f0-9]{64}-[a-f0-9]{12}\.css"/i);
    assert.doesNotMatch(fallbackHtml,/ambiguous\.css/i,'an ambiguous stylesheet URL was retained');
    assert.match(fallbackHtml,/<img id="fallback" src="assets\/[a-f0-9]{64}\.png">/i);
    assert.match(fallbackHtml,/<img id="tampered">/i);
    assert.match(fallbackHtml,/<img id="missing">/i);
    assert.match(fallbackHtml,/<img id="local-file">/i);
    assert.match(fallbackHtml,/<img id="blob-url">/i);
    assert.doesNotMatch(fallbackHtml,/https:\/\/fixture\.invalid\/(?:recovered\.css|fallback\.png|tampered\.png|not-archived\.png)/i);
    const fallbackSheet=fallbackManifest.assets.find(asset=>asset.kind==='stylesheet');
    assert.equal(fallbackSheet.sourceSha256,fixture.cssSha,
      'the CSSOM stylesheet provenance digest was not retained');
    const fallbackSheetText=fs.readFileSync(path.join(fallbackDir,fallbackSheet.file),'utf8');
    assert.doesNotMatch(fallbackSheetText,/https:\/\/fixture\.invalid/i);
    assert.match(fallbackSheetText,/url\("\.\/[a-f0-9]{64}\.png"\)/i);
    assert.equal(fallbackManifest.assets.some(asset=>asset.sha256===hash(tamperedBody)),false,
      'a digest-mismatched body was exported');
    for (const asset of fallbackManifest.assets)
    {
      const bytes=fs.readFileSync(path.join(fallbackDir,asset.file));
      assert.equal(bytes.length,asset.bytes,`CSSOM scenario asset size mismatch ${asset.file}`);
      assert.equal(hash(bytes),asset.sha256,`CSSOM scenario asset digest mismatch ${asset.file}`);
    }
    assert.equal(hash(fallbackHtml),fallbackManifest.document.sha256,
      'CSSOM scenario document digest mismatch');
    const fallbackChromium=await run('chromium',['--headless=new','--disable-gpu',
      '--disable-background-networking','--no-first-run','--no-default-browser-check',
      '--virtual-time-budget=3000','--user-data-dir='+path.join(work,'fallback-profile'),
      '--dump-dom',pathToFileURL(path.join(fallbackDir,'index.html')).href]);
    assert.equal(fallbackChromium.status,0,
      `Chromium could not open the CSSOM fallback export: ${fallbackChromium.stderr}`);
    assert.match(fallbackChromium.stdout,/CSSOM fallback/);
    assert.match(fallbackChromium.stdout,/data-web-export-scroll-restored="1"/,
      'synthetic captured scroll position was not restored in Chromium');
    const failedDir=path.join(work,'failed-capture');
    const failed=await run(process.execPath,[path.join(fakeBin,'web-export'),
      'https://fixture.invalid/page',failedDir],
      {env:{...captureEnv,m_ROOT:fakeRoot,m_LIB_DIR:fakeLib,WEB_EXPORT_SYNTHETIC_FAILURE:'1'}});
    assert.equal(failed.status,8,'capture failure did not retain the exporter status identity');
    assert.match(failed.stderr,/document-not-observed/,
      'the capture diagnostic discarded the safe web-analyze identity');
    assert.equal(fs.existsSync(failedDir),false,'failed capture left a partial export behind');
    await closeServer();
    process.stderr.write('web-export command fixture: all standalone and CSSOM fallback checks passed\n');
  }
  finally
  {
    await closeServer();
    fs.rmSync(work,{recursive:true,force:true});
  }
}

main().catch(error=>{
  process.stderr.write('web-export command fixture: ' + error.stack + '\n');
  process.exitCode=error instanceof assert.AssertionError?1:3;
});
