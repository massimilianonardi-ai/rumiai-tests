'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const {writeCapturedExport} = require(process.argv[2]);
const root = process.argv[3];
const mCommand = path.join(root, 'm');
const env = {...process.env};
delete env.m_ROOT;
delete env.m_LIB_DIR;
const captureEnv = {...env,m_ROOT:root,m_LIB_DIR:path.join(root,'lib')};
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YuzpgAAAABJRU5ErkJggg==',
  'base64');
const font = Buffer.from('wOF2synthetic-font-resource');
const requests = [];
let server;
let work;

const sourceScript = [
  "document.addEventListener('click',event=>{",
  "const copy=event.target.closest('#copy-response');",
  "if(copy){window.__copiedText=document.querySelector('#answer').textContent;",
  "const old=copy.innerHTML;copy.innerHTML='<svg data-icon=\"check\"><path d=\"check\"></path></svg>';",
  "if(navigator.clipboard)navigator.clipboard.writeText(window.__copiedText).catch(()=>{});",
  "setTimeout(()=>copy.innerHTML=old,300);}",
  "const disclosure=event.target.closest('#thought-toggle');",
  "if(disclosure){const open=disclosure.getAttribute('aria-expanded')!=='true';",
  "disclosure.setAttribute('aria-expanded',String(open));",
  "document.querySelector('#thought-panel').hidden=!open;}",
    "if(event.target.closest('#consent-dismiss'))document.querySelector('#consent-banner').remove();",
  "});",
  "const remoteApi='https://api.example.invalid/v1';"
].join('\n');

function count(pathname)
{
  requests.push(pathname);
}

function respond(response,status,type,body)
{
  response.writeHead(status,{'content-type':type,'cache-control':'no-store'});
  response.end(body);
}

function fixtureCss(origin)
{
  return '@import url("' + origin + '/nested.css");' +
    '@font-face{font-family:fixture-font;src:url("' + origin +
    '/fixture.woff2") format("woff2");font-display:swap}' +
    'body{font-family:fixture-font,sans-serif;background-image:url("' +
    origin + '/background.png")}' +
    '.set{background-image:image-set("' + origin + '/background.png" 1x)}' +
    '.literal::after{content:"url(' + origin + '/background.png)"}' +
    '/* url("' + origin + '/background.png") */' +
    '.missing{background-image:url("' + origin + '/not-captured.png")}';
}

function fixtureHtml(origin)
{
  const integrity='sha256-'+crypto.createHash('sha256').update(fixtureCss(origin)).digest('base64');
  const inlineScript="window.inlineScriptValue='<img src=\""+origin+
    "/pixel.png\">';window.inlineScriptPreserved=true;";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>web-export fidelity fixture</title>' +
    '<link rel="stylesheet" crossorigin="anonymous" integrity="' + integrity +
      '" href="' + origin + '/fixture.css">' +
    '<link rel="canonical" href="' + origin + '/background.png">' +
    '<link rel="icon" href="' + origin + '/icon.svg">' +
    '<style>.inline-block{background-image:url("' + origin + '/background.png")}</style>' +
    '<script>' + inlineScript + '</script>' +
    '<script defer src="' + origin + '/fixture.js"></script></head><body>' +
    '<main><section data-testid="conversation-turn-1"><span>You said: a question</span>' +
    '<p id="answer">answer text</p><button id="copy-response" aria-label="Copy response">' +
    '<svg data-icon="copy"><path d="copy"></path></svg></button></section>' +
    '<div id="thought-toggle" tabindex="0" aria-expanded="false" aria-controls="thought-panel">' +
    'Elaborato per 3 minuti</div><div id="thought-panel" hidden>captured thought</div>' +
    '<button id="send" style="background:#0b6">Send <svg data-icon="send"><path d="arrow"></path></svg></button>' +
    '<textarea id="prompt" placeholder="Message ChatGPT"></textarea>' +
    '<form id="search" action="' + origin + '/submit" method="post"><input name="query" value="kept"></form>' +
    '<iframe id="frame" src="' + origin + '/frame.html"></iframe>' +
    '<img id="entity-url" src="' + origin + '/pixel.png?x=1&#38;y=2">' +
    '<img id="pixel" src="' + origin + '/pixel.png" srcset="' + origin +
      '/pixel.png 1x, ' + origin + '/not-captured.png 2x">' +
    '<div id="inline-style" style="background-image:url(&quot;' + origin + '/background.png&quot;)"></div>' +
    '<div class="inline-block"></div><a id="source-link" href="' + origin +
      '/destination" ping="' + origin + '/ping">source</a>' +
    '<aside id="consent-banner"><p>Cookie privacy preferences</p>' +
    '<button id="consent-dismiss" onclick="this.closest(&#39;aside&#39;).remove()">Dismiss</button></aside>' +
    '<button id="inline-handler" onclick="this.dataset.clicked=&#39;yes&#39;">Inline</button>' +
    '</main></body></html>';
}

function startServer()
{
  server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    count(url.pathname);
    const origin='http://' + request.headers.host;
    if(url.pathname==='/')return respond(response,200,'text/html; charset=utf-8',fixtureHtml(origin));
    if(url.pathname==='/fixture.css')return respond(response,200,'text/css; charset=utf-8',fixtureCss(origin));
    if(url.pathname==='/nested.css')return respond(response,200,'text/css; charset=utf-8',
      '.nested{background-image:url("'+origin+'/icon.svg")}');
    if(url.pathname==='/fixture.js')return respond(response,200,'application/javascript; charset=utf-8',sourceScript);
    if(url.pathname==='/pixel.png'||url.pathname==='/background.png')return respond(response,200,'image/png',pixel);
    if(url.pathname==='/fixture.woff2')return respond(response,200,'font/woff2',font);
    if(url.pathname==='/icon.svg')return respond(response,200,'image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg"><path d="icon"></path></svg>');
    if(url.pathname==='/not-captured.png')return respond(response,404,'text/plain','not archived');
    if(url.pathname==='/frame.html')return respond(response,200,'text/html','<!doctype html><p>frame</p>');
    return respond(response,404,'text/plain','not found');
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      server.removeListener('error',reject);
      resolve('http://127.0.0.1:' + server.address().port + '/');
    });
  });
}

async function closeServer()
{
  if(server?.listening)await new Promise((resolve,reject)=>
    server.close(error=>error?reject(error):resolve()));
}

function run(command,args,options={})
{
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env,...options,stdio:['ignore','pipe','pipe']});
    let stdout='';
    let stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
    child.once('error',reject);
    child.once('close',(status,signal)=>resolve({status,signal,stdout,stderr}));
  });
}

async function withChromium(fileUrl,profile,inspect)
{
  const child=spawn('chromium',['--headless=new','--disable-gpu','--no-first-run',
    '--no-default-browser-check','--remote-debugging-port=0',
    '--user-data-dir='+profile,fileUrl],{env,stdio:['ignore','ignore','pipe']});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
  const activePort=path.join(profile,'DevToolsActivePort');
  const deadline=Date.now()+15000;
  while(!fs.existsSync(activePort)&&Date.now()<deadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(fs.existsSync(activePort),'Chromium did not start: '+stderr);
  const port=Number(fs.readFileSync(activePort,'utf8').split(/\r?\n/,1)[0]);
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=pages.find(item=>item.type==='page');
  assert.ok(page,'Chromium did not expose the export page');
  const socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  });
  let nextId=0;
  const pending=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(!message.id||!pending.has(message.id))return;
    const operation=pending.get(message.id);
    pending.delete(message.id);
    if(message.error)operation.reject(new Error(message.error.message));
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
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  });
  const documentDeadline=Date.now()+10000;
  let fixtureReady=false;
  while(Date.now()<documentDeadline)
  {
    fixtureReady=await evaluate('document.readyState!=="loading"&&!!document.querySelector("#prompt")');
    if(fixtureReady)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(fixtureReady,'Chromium did not finish loading the exported fixture: '+
    await evaluate('JSON.stringify({url:location.href,readyState:document.readyState})'));
  const click=async selector=>{
    const point=await evaluate('(()=>{const node=document.querySelector('+
      JSON.stringify(selector)+');if(!node)throw new Error("missing control");'+
      'const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,'+
      'y:rect.y+rect.height/2}})()');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
    await new Promise(resolve=>setTimeout(resolve,50));
  };
  try {await inspect({send,evaluate,click});}
  finally
  {
    try{socket.close();}catch(_){}
    child.kill('SIGTERM');
    await new Promise(resolve=>child.once('close',resolve));
  }
}

function writeRecord(directory,row)
{
  fs.appendFileSync(path.join(directory,'resources.jsonl'),JSON.stringify(row)+'\n');
}

function digest(bytes)
{
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function stylesheetHttpBodyRequirementScenario()
{
  const base=path.join(work,'stylesheet-body-input');
  const runRoot=path.join(base,'run');
  fs.mkdirSync(path.join(runRoot,'states'),{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(runRoot,'resources'),{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(runRoot,'rest/stylesheets/cssom'),{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(runRoot,'resources.jsonl'),'');
  const body=Buffer.from('body{background-image:url("https://fixture.invalid/pixel.png")}' +
    '.missing{background-image:url("https://fixture.invalid/not-captured.png")}');
  fs.writeFileSync(path.join(runRoot,'rest/stylesheets/cssom/recovered.css'),body);
  fs.writeFileSync(path.join(runRoot,'rest/stylesheets/index.json'),JSON.stringify([{
    status:'saved',sourceURL:'https://fixture.invalid/recovered.css',
    file:'stylesheets/cssom/recovered.css',sha256:digest(body),bytes:body.length
  }]));
  fs.writeFileSync(path.join(runRoot,'resources/pixel.png'),pixel);
  writeRecord(runRoot,{url:'https://fixture.invalid/pixel.png',status:'saved',
    resourceType:'Image',mimeType:'image/png',file:'resources/pixel.png',
    sha256:digest(pixel),bytes:pixel.length,httpStatus:200});
  const ambiguous=Buffer.concat([pixel,Buffer.from('different-body')]);
  fs.writeFileSync(path.join(runRoot,'resources/ambiguous.png'),ambiguous);
  writeRecord(runRoot,{url:'https://fixture.invalid/ambiguous.png',status:'saved',
    resourceType:'Image',mimeType:'image/png',file:'resources/pixel.png',
    sha256:digest(pixel),bytes:pixel.length,httpStatus:200});
  writeRecord(runRoot,{url:'https://fixture.invalid/ambiguous.png',status:'saved',
    resourceType:'Image',mimeType:'image/png',file:'resources/ambiguous.png',
    sha256:digest(ambiguous),bytes:ambiguous.length,httpStatus:200});
  const html='<!doctype html><link rel="stylesheet" href="https://fixture.invalid/recovered.css">' +
    '<img id="known" src="https://fixture.invalid/pixel.png">' +
    '<img id="ambiguous" src="https://fixture.invalid/ambiguous.png">' +
    '<img id="missing" src="https://fixture.invalid/not-captured.png">';
  const output=path.join(work,'stylesheet-body-result');
  fs.mkdirSync(output,{mode:0o700});
  const manifest=writeCapturedExport({runDirectory:runRoot,html},
    'https://fixture.invalid/page',output);
  const outputHtml=fs.readFileSync(path.join(output,'index.html'),'utf8');
  const sheet=manifest.assets.find(item=>item.kind==='stylesheet');
  assert.equal(sheet,undefined,'CSSOM-only source must not be treated as a verified HTTP body');
  assert.match(outputHtml,/href="https:\/\/fixture\.invalid\/recovered\.css"/);
  assert.match(outputHtml,/id="ambiguous" src="https:\/\/fixture\.invalid\/ambiguous\.png"/);
  assert.match(outputHtml,/id="missing" src="https:\/\/fixture\.invalid\/not-captured\.png"/);
  assert.match(outputHtml,/id="known" src="file:\/\/[^"]+\.png"/);
  assert.equal(manifest.coverage.ambiguousAssetUrls,1,'ambiguous body URL must stay remote');
  assert.equal(manifest.coverage.assets,1,'only the unambiguous verified image body should be archived');
}

async function main()
{
  work=fs.mkdtempSync(path.join(os.tmpdir(),'web-export-fidelity-'));
  fs.chmodSync(work,0o700);
  try
  {
    const sourceUrl=await startServer();
    const output=path.join(work,'export');
    const exported=await run(mCommand,['web-export',sourceUrl,output],{env});
    assert.equal(exported.status,0,'web-export failed: '+exported.stderr);
    const index=path.join(output,'index.html');
    assert.equal(exported.stdout.trim(),index);
    const html=fs.readFileSync(index,'utf8');
    const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
    assert.equal(manifest.format,'web-export/2');
    assert.equal(manifest.scripts,'preserved');
    assert.deepEqual(manifest.generatedScripts,[]);
    assert.ok(html.includes("window.inlineScriptValue='<img src=\"http://127.0.0.1:"),
      'inline script containing a markup-like string was changed');
    assert.match(html,/<script defer(?:="")? src="file:\/\/[^"]+\.js"><\/script>/);
    assert.ok(fs.readFileSync(path.join(output,manifest.assets.find(item=>item.kind==='script').file),'utf8')===sourceScript,
      'captured script body was changed or removed');
    assert.match(html,/onclick="this\.dataset\.clicked=/);
    assert.match(html,/<iframe id="frame" src="http:\/\/127\.0\.0\.1:/);
    assert.match(html,/<form id="search" action="http:\/\/127\.0\.0\.1:[^"]+\/submit"/);
    assert.match(html,/<textarea id="prompt" placeholder="Message ChatGPT"><\/textarea>/);
    assert.match(html,/<svg data-icon="send"><path d="arrow"><\/path><\/svg>/);
    assert.match(html,/<a id="source-link" href="http:\/\/127\.0\.0\.1:[^"]+\/destination" ping=/);
    assert.match(html,/You said: a question/);
    assert.doesNotMatch(html,/data-web-export-|web-export-local-interactions/);
    assert.ok(!html.includes('You said: answer text'));
    assert.ok(manifest.assets.some(item=>item.kind==='script'),'captured JavaScript body not archived');
    assert.ok(manifest.assets.some(item=>item.kind==='stylesheet'));
    assert.ok(manifest.assets.some(item=>item.kind==='image'));
    assert.ok(manifest.assets.some(item=>item.kind==='font'));
    assert.ok(manifest.coverage.scriptElementsPreserved>=1);
    assert.ok(manifest.coverage.inlineHandlersPreserved>=1);
    assert.ok(manifest.coverage.htmlReferencesRelinked>=4);
    assert.ok(manifest.coverage.cssReferencesRelinked>=2);
    assert.ok(manifest.coverage.htmlReferencesUnmapped>=1);
    assert.ok(manifest.coverage.cssReferencesUnmapped>=1);
    assert.match(html,/srcset="file:\/\/[^"]+\.png 1x, http:\/\/127\.0\.0\.1:[^ ]+\/not-captured\.png 2x"/);
    assert.match(html,/<style>\.inline-block\{background-image:url\("file:\/\/[^"]+\.png"\)\}<\/style>/);
    assert.match(html,/style="background-image:url\(&quot;file:\/\/[^&]+\.png&quot;\)"/);
    assert.match(html,/crossorigin="anonymous"/);
    assert.match(html,/integrity="sha256-[A-Za-z0-9+/=]+"/);
    assert.match(html,/rel="icon" href="file:\/\/[^"]+\.svg"/);
    assert.match(html,/rel="canonical" href="http:\/\/127\.0\.0\.1:[^"]+\/background\.png"/);
    assert.match(html,/id="entity-url" src="file:\/\/[^\"]+\.png"/);

    for(const asset of manifest.assets)
    {
      const file=path.join(output,asset.file);
      const bytes=fs.readFileSync(file);
      assert.equal(bytes.length,asset.bytes,'asset size mismatch: '+asset.file);
      assert.equal(digest(bytes),asset.sha256,'asset digest mismatch: '+asset.file);
    }
    const scriptAsset=manifest.assets.find(item=>item.kind==='script');
    assert.ok(fs.readFileSync(path.join(output,scriptAsset.file),'utf8')===sourceScript,
      'an archived site script body changed');
    const stylesheet=manifest.assets.find(item=>item.kind==='stylesheet');
    const stylesheetBytes=fs.readFileSync(path.join(output,stylesheet.file));
    const stylesheetText=stylesheetBytes.toString('utf8');
    assert.equal(stylesheet.sha256,digest(stylesheetBytes),'rewritten CSS digest mismatch');
    assert.equal(stylesheet.sourceSha256!==undefined,true,'rewritten CSS source digest missing');
    assert.match(stylesheetText,/@import url\("file:\/\/[^\"]+\.css"\)/);
    assert.match(stylesheetText,/image-set\("file:\/\/[^\"]+\.png" 1x\)/);
    assert.match(stylesheetText,/content:"url\(http:\/\/127\.0\.0\.1:[^)]+\)"/,
      'a string that only resembles a CSS URL was rewritten');
    assert.ok(stylesheetText.includes('/* url("http://127.0.0.1:'),
      'a comment that only resembles a CSS URL was rewritten');
    assert.equal('sha256-'+crypto.createHash('sha256').update(stylesheetBytes).digest('base64'),
      html.match(/integrity="([^"]+)"/)[1],'stylesheet SRI does not match emitted CSS');

    const profile=path.join(work,'browser-profile');
    await withChromium(pathToFileURL(index).href,profile,async({evaluate,click})=>{
      const before=await evaluate('({placeholder:document.querySelector("#prompt").getAttribute("placeholder"),'+
        'value:document.querySelector("#prompt").value,send:document.querySelector("#send svg path").getAttribute("d"),'+
        'copyIcon:document.querySelector("#copy-response svg").dataset.icon,'+
        'inlineScript:window.inlineScriptPreserved,inlineLiteral:window.inlineScriptValue,'+
        'scripts:document.scripts.length,handler:document.querySelector("#inline-handler").getAttribute("onclick")})');
      assert.deepEqual(before,{placeholder:'Message ChatGPT',value:'',send:'arrow',
        copyIcon:'copy',inlineScript:true,inlineLiteral:'<img src="'+sourceUrl+'pixel.png">',scripts:2,
        handler:"this.dataset.clicked='yes'"});
      await click('#copy-response');
      const copied=await evaluate('({value:window.__copiedText,icon:document.querySelector("#copy-response svg").dataset.icon})');
      assert.deepEqual(copied,{value:'answer text',icon:'check'});
      await new Promise(resolve=>setTimeout(resolve,400));
      assert.equal(await evaluate('document.querySelector("#copy-response svg").dataset.icon'),'copy',
        'source copy icon did not return to its original state');
      await click('#thought-toggle');
      assert.equal(await evaluate('document.querySelector("#thought-toggle").getAttribute("aria-expanded")'),'true');
      assert.equal(await evaluate('document.querySelector("#thought-panel").hidden'),false);
      await click('#thought-toggle');
      assert.equal(await evaluate('document.querySelector("#thought-toggle").getAttribute("aria-expanded")'),'false');
      assert.equal(await evaluate('document.querySelector("#thought-panel").hidden'),true);
      await click('#inline-handler');
      assert.equal(await evaluate('(()=>{const element=document.querySelector("#inline-handler");element.click();return element.dataset.clicked})()'),'yes');
      assert.equal(await evaluate('document.querySelector("#prompt").getAttribute("placeholder")'),'Message ChatGPT');
      assert.equal(await evaluate('document.querySelector("#prompt").value'),'');
      assert.equal(await evaluate('document.querySelector("#send svg path").getAttribute("d")'),'arrow');
      await evaluate('document.querySelector("#consent-dismiss").click()');
      assert.equal(await evaluate('!!document.querySelector("#consent-banner")'),false);
      assert.equal(await evaluate('document.querySelector("#inline-handler").getAttribute("onclick")'),
        "this.dataset.clicked='yes'");
      assert.equal(await evaluate('document.querySelector("iframe#frame")!==null'),true);
      assert.equal(await evaluate('document.querySelector("form#search").getAttribute("action").endsWith("/submit")'),true);
      assert.equal(await evaluate('document.querySelector("#source-link").getAttribute("ping").endsWith("/ping")'),true);
    });

    await stylesheetHttpBodyRequirementScenario();
    const beforeCollision=fs.readFileSync(index);
    const collision=await run(mCommand,['web-export',sourceUrl,output],{env});
    assert.equal(collision.status,7,'existing export directory was not refused');
    assert.deepEqual(fs.readFileSync(index),beforeCollision,'destination collision changed output');

    await closeServer();
    process.stderr.write('web-export fidelity fixture: source behavior and relinking passed\n');
  }
  finally
  {
    await closeServer();
    fs.rmSync(work,{recursive:true,force:true});
  }
}

main().catch(error=>{
  process.stderr.write('web-export fidelity fixture: '+error.stack+'\n');
  process.exitCode=error instanceof assert.AssertionError?1:3;
});
