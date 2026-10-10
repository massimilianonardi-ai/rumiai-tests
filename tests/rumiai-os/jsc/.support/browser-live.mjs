// Exercise the original m JS/CSS dynamic source-list loader on a real browser.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(process.argv[2]);
const loader=await readFile(join(root,'lib/sys/js/dynamic-loader.lib.js'),'utf8');
const work=await mkdtemp(join(tmpdir(),'m-dynamic-browser-'));
const page="<!doctype html><meta charset=\"utf-8\">\n<script src=\"/loader.js\"></script>\n<div id=\"result\">WAIT</div><div id=\"target\">CSS</div>\n<script>\n(async function () {\n try {\n  const assembled=await loadModulesDynamically('/demo','modules-js.json',function(){});\n  const pair=await loadLibraryDynamically('/demo');\n  if(m.srv.data.MyClass()!==42) throw new Error('source namespace');\n  if(getComputedStyle(document.getElementById('target')).color!=='rgb(0, 128, 0)')\n    throw new Error('initial CSS');\n  const changedJS=await loadJSLibraryDynamically('/demo','patch.json',pair[0]);\n  if(!changedJS.isConnected || m.srv.data.MyClass()!==77)\n    throw new Error('JavaScript dynamic reload');\n  const changedCSS=await loadCSSLibraryDynamically('/demo','patch-css.json',pair[1]);\n  if(!changedCSS.isConnected ||\n     getComputedStyle(document.getElementById('target')).color!=='rgb(0, 0, 255)')\n    throw new Error('CSS dynamic reload');\n  document.getElementById('result').textContent='PASS ORIGINAL DYNAMIC LOADER';\n } catch (e) { document.getElementById('result').textContent='FAIL '+e.stack; }\n})();\n</script>";
const sources=new Map([
 ['/loader.js',['text/javascript',loader]],
 ['/index.html',['text/html',page]],
 ['/demo/modules-js.json',['application/json',JSON.stringify({modules:[
  {name:'m',modules:[{name:'srv',modules:[{name:'data',modules:[
   {file:'data/MyClass.js',symbols:'MyClass'}
  ]}]}]}
 ]})]],
 ['/demo/modules-css.json',['application/json',JSON.stringify({modules:[
  {file:'css/initial.css'}
 ]})]],
 ['/demo/patch.json',['application/json',JSON.stringify({modules:[
  {name:'m',modules:[{name:'srv',modules:[{name:'data',modules:[
   {file:'data/Patch.js',symbols:'MyClass'}
  ]}]}]}
 ]})]],
 ['/demo/patch-css.json',['application/json',JSON.stringify({modules:[
  {file:'css/patch.css'}
 ]})]],
 ['/demo/data/MyClass.js',['text/javascript','function MyClass(){return 42;}\n']],
 ['/demo/data/Patch.js',['text/javascript','function MyClass(){return 77;}\n']],
 ['/demo/css/initial.css',['text/css','#target{color:rgb(0,128,0);}\n']],
 ['/demo/css/patch.css',['text/css','#target{color:blue;}\n']]
]);
const requested=new Set();
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 requested.add(pathname);
 const found=sources.get(pathname);
 if(!found){res.writeHead(404);res.end('not found');return;}
 res.setHeader('Content-Type',found[0]);
 res.setHeader('Cache-Control','no-store');
 res.end(found[1]);
});
try {
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const uri='http://127.0.0.1:'+server.address().port+'/index.html';
 const result=await new Promise((ok,fail)=>{
  const child=spawn(process.env.CHROMIUM,[
   '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
   '--no-first-run','--virtual-time-budget=15000',
   '--user-data-dir='+join(work,'chrome-profile'),'--dump-dom',uri
  ],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  const timeout=setTimeout(()=>{child.kill('SIGKILL');fail(Error('Chromium timeout: '+stderr.slice(-500)));},35000);
  child.stdout.on('data',x=>stdout+=x.toString());
  child.stderr.on('data',x=>stderr+=x.toString());
  child.once('error',e=>{clearTimeout(timeout);fail(e);});
  child.once('close',code=>{clearTimeout(timeout);ok({code,stdout,stderr});});
 });
 assert.equal(result.code,0,result.stderr.slice(-1000));
 assert.match(result.stdout,/<div id="result">PASS ORIGINAL DYNAMIC LOADER<\/div>/,result.stdout.slice(-4000));
 for(const file of ['/demo/modules-js.json','/demo/modules-css.json',
    '/demo/patch.json','/demo/patch-css.json','/demo/data/MyClass.js',
    '/demo/data/Patch.js','/demo/css/initial.css','/demo/css/patch.css'])
   assert.ok(requested.has(file),'source not requested: '+file);
 console.log('PASS ORIGINAL DYNAMIC LOADER: Chromium loaded ordered nested JavaScript and CSS sources; both reloaded through original public functions');
}finally {
 server.closeAllConnections();
 await new Promise(ok=>server.close(ok));
 await rm(work,{recursive:true,force:true});
}
