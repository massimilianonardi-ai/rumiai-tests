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

async function interactWithChromium(fileUrl, profile, directFile=false)
{
  const localPath=decodeURIComponent(new URL(fileUrl).pathname);
  const exportDirectory=path.dirname(localPath);
  let originServer;
  let webOrigin=fileUrl;
  if (!directFile) originServer=http.createServer((request,response)=>{
    const requested=new URL(request.url,'http://127.0.0.1');
    const target=path.resolve(exportDirectory,'.'+requested.pathname);
    if(!target.startsWith(exportDirectory+path.sep)||!fs.existsSync(target))
    {response.writeHead(404);response.end();return;}
    if(target.endsWith('index.html')) {
      response.writeHead(200,{'content-type':'text/html'});
      fs.createReadStream(target).pipe(response);return;
    }
    response.writeHead(200,{'content-type':requested.pathname.endsWith('.css')?'text/css':'text/html'});
    fs.createReadStream(target).pipe(response);
  });
  if (originServer)
    webOrigin=await new Promise(resolve=>originServer.listen(0,'127.0.0.1',
      ()=>resolve(`http://127.0.0.1:${originServer.address().port}/index.html`)));
  const child = spawn('chromium',['--headless=new','--disable-gpu',
    '--disable-background-networking','--no-first-run','--no-default-browser-check',
    '--remote-debugging-port=0','--user-data-dir='+profile,webOrigin],
    {env,stdio:['ignore','ignore','pipe']});
  let stderr = '';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
  const activePort = path.join(profile,'DevToolsActivePort');
  const deadline = Date.now()+15000;
  while (!fs.existsSync(activePort) && Date.now()<deadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(fs.existsSync(activePort),'Chromium did not publish its CDP port: '+stderr);
  const port = Number(fs.readFileSync(activePort,'utf8').split(/\r?\n/,1)[0]);
  await new Promise(resolve=>setTimeout(resolve,250));
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(item=>item.type==='page');
  assert.ok(page,'Chromium CDP did not expose a page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  });
  let nextId=0;
  const pending=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const operation=pending.get(message.id);
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++nextId;
    pending.set(id,{resolve,reject});
    socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=expression=>send('Runtime.evaluate',{
    expression,awaitPromise:true,returnByValue:true,userGesture:true
  }).then(result=>{
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  });
  const click=async selector=>{
    const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('missing '+${JSON.stringify(selector)});const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,tag:node.tagName,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
    await new Promise(resolve=>setTimeout(resolve,150));
  };
  try
  {
    await send('Page.enable');
    try
    {
      await send('Browser.grantPermissions',{origin:new URL(webOrigin).origin,
        permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
    }
    catch (error)
    {
      if (!directFile) throw error;
    }
    await send('Runtime.enable');
    await new Promise(resolve=>setTimeout(resolve,500));
    await click('#copy-response');
    const responseCopy=directFile?null:await evaluate('navigator.clipboard.readText()');
    await click('#copy-code');
    const codeCopy=directFile?null:await evaluate('navigator.clipboard.readText()');
    await click('#copy-table');
    const tableCopy=directFile?null:await evaluate('navigator.clipboard.readText()');
    await click('#thought-toggle');
    const thoughtOpen=await evaluate('document.querySelector("#thought-toggle").getAttribute("aria-expanded")');
    await click('#consent-accept');
    const result=await evaluate(`({thoughtMissing:document.querySelector('#thought-toggle').getAttribute('data-web-export-content-unavailable'),
        bannerPresent:!!document.querySelector('#consent-banner'),
        disclosurePanelHidden:document.querySelector('#thought-panel').hidden,
        copyStates:[...document.querySelectorAll('#copy-response,#copy-code,#copy-table')].map(item=>item.dataset.webExportCopyState)})`);
    if (directFile)
    {
      assert.deepEqual(result,{thoughtMissing:'true',bannerPresent:false,
        disclosurePanelHidden:false,copyStates:['copied','copied','copied']});
    }
    else
    {
      Object.assign(result,{responseCopy,codeCopy,tableCopy,thoughtOpen});
      assert.deepEqual(result,{responseCopy:'answer text',codeCopy:'const answer = 42;',
        tableCopy:'key\tvalue\nmode\toffline',thoughtOpen:'true',thoughtMissing:'true',
        bannerPresent:false,disclosurePanelHidden:false,
        copyStates:['copied','copied','copied']});
    }
    const network = await evaluate('performance.getEntriesByType("resource").map(entry=>entry.name)');
    assert.deepEqual(network,[],'offline interaction helper requested a network resource');
  }
  finally
  {
    try {socket.close();} catch (_) {}
    child.kill('SIGTERM');
    await new Promise(resolve=>child.once('close',resolve));
    if (originServer) await new Promise(resolve=>originServer.close(resolve));
  }
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
      'only the exporter-owned offline interaction script may remain');
    assert.match(html,/<script>\(\(\) =>/,
      'the generated offline interaction helper is not embedded in the document');
    assert.match(html,/script-src 'sha256-[A-Za-z0-9+/=]+'/,
      'the inline helper is not restricted by its content hash');
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
    assert.deepEqual(manifest.generatedScripts,['offline-local-interactions','scroll-restoration']);
    assert.equal(manifest.coverage.offlineCopyControls,0);
    assert.equal(manifest.coverage.offlineDisclosureControls,0);
    assert.equal(manifest.coverage.consentDismissControls,0);
    assert.equal(manifest.coverage.offlineInteractionScript,true);
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
    assert.match(chromium.stdout,/<meta name="web-export-local-interactions" content="enabled">/,
      'the generated local-interaction helper did not execute');
    if (manifest.coverage.scrollPositionsCaptured > 0)
      assert.match(chromium.stdout,/meta name="web-export-local-interactions"/,
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

    const interactionFixture=path.join(work,'interactions.html');
    fs.writeFileSync(interactionFixture,`<!doctype html><html><head><meta charset="utf-8"></head><body>
      <section data-testid="conversation-turn-1"><p>answer text</p><button id="copy-response" aria-label="Copy response">Copy</button></section>
      <pre><code>const answer = 42;</code><button id="copy-code" aria-label="Copy code">Copy</button></pre>
      <div><table><tr><th>key</th><th>value</th></tr><tr><td>mode</td><td>offline</td></tr></table><button id="copy-table" aria-label="Copy table">Copy</button></div>
      <div id="thought-toggle" tabindex="0" aria-expanded="false" aria-controls="thought-panel">Elaborato per 3 minuti</div>
      <div id="thought-panel" hidden></div>
      <aside id="consent-banner"><p>We use cookies for privacy preferences</p><button id="consent-accept">Accept cookies</button></aside>
      <script>throw new Error('source scripts must not run')</script>
      </body></html>`);
    const interactionInput=path.join(work,'interaction-input');
    fs.mkdirSync(path.join(interactionInput,'run','states'),{recursive:true,mode:0o700});
    fs.mkdirSync(path.join(interactionInput,'run','resources'),{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(interactionInput,'run','states/dom-rest-final.html'),
      fs.readFileSync(interactionFixture));
    fs.writeFileSync(path.join(interactionInput,'run','README.md'),'synthetic interaction capture\n');
    fs.writeFileSync(path.join(interactionInput,'run','resources.jsonl'),'');
    const interactionDir=path.join(work,'interaction-export');
    const interactionAnalyzer=`const fs=require('node:fs'),path=require('node:path');const root=${JSON.stringify(interactionInput)};process.stdout.write(path.join(root,'run','README.md')+'\\n');`;
    fs.writeFileSync(path.join(fakeBin,'web-analyze'),interactionAnalyzer,{mode:0o700});
    const interaction=await run(process.execPath,[path.join(fakeBin,'web-export'),
      'https://fixture.invalid/interactions',interactionDir],
      {env:{...captureEnv,m_ROOT:fakeRoot,m_LIB_DIR:fakeLib}});
    assert.equal(interaction.status,0,`offline interaction export failed: ${interaction.stderr}`);
    const interactionManifest=JSON.parse(fs.readFileSync(path.join(interactionDir,'manifest.json'),'utf8'));
    assert.equal(interactionManifest.coverage.offlineCopyControls,3);
    assert.equal(interactionManifest.coverage.offlineDisclosureControls,1);
    assert.equal(interactionManifest.coverage.consentDismissControls,1);
    assert.equal(interactionManifest.coverage.disclosureContentUnavailable,1);
    assert.deepEqual(interactionManifest.generatedScripts,['offline-local-interactions']);
    const interactionProfile=path.join(work,'interaction-profile');
    await interactWithChromium(pathToFileURL(path.join(interactionDir,'index.html')).href,interactionProfile);
    const directFileProfile=path.join(work,'direct-file-interaction-profile');
    await interactWithChromium(pathToFileURL(path.join(interactionDir,'index.html')).href,
      directFileProfile,true);

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
      'synthetic captured scroll position was not restored in Chromium: ' +
        (fallbackChromium.stdout.match(/data-web-export-scroll-restored="[^"]*"/) || ['marker absent'])[0]);
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
