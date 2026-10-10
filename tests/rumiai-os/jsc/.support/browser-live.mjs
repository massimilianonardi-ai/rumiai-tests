import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';

const root=resolve(process.argv[2]),engine=join(root,'lib/sys/js/jsc.lib.js');
const loader=await readFile(join(root,'lib/sys/js/dynamic-loader.lib.js'),'utf8');
const work=await mkdtemp(join(tmpdir(),'jsc-product-chrome-'));
let server;
const gets=new Map();
const page="<!doctype html><meta charset=\"utf-8\"><script src=\"/loader.js\"></script>\n<script src=\"/initial.js\"></script><pre id=\"result\">WAIT</pre><button id=\"tap\">Tap</button>\n<script>\n(async()=>{\n try{\n  const runtime=JscRuntime;\n  if(runtime.state().registered!==1||runtime.state().active!==0)throw Error('initial lazy registration');\n  window.taps=0;window.disposals=0;\n  await runtime.loadScript('/optional.js',{expect:'optional'});\n  if(runtime.state().registered!==2||runtime.state().active!==0)throw Error('optional not lazy');\n  if(runtime.require('optional').version!=='v1')throw Error('v1 module missing');\n  document.getElementById('tap').click();\n  if(window.taps!==1)throw Error('v1 click missing');\n  await runtime.loadScript('/patch.js',{expect:'optional'});\n  if(window.disposals!==1)throw Error('v1 cleanup missing');\n  if(runtime.require('optional').version!=='v2')throw Error('v2 module missing');\n  document.getElementById('tap').click();\n  if(window.taps!==2||window.last!=='v2')throw Error('duplicated stale click listener');\n  if(runtime.state().registered!==2||runtime.state().active!==1)throw Error('registry state drift');\n  document.getElementById('result').textContent='PASS JSC PRODUCT CHROME';\n }catch(e){document.getElementById('result').textContent='FAIL '+e.stack;}\n})();\n</script>";
const sources={
  'base.js':"module.exports={type:'base'};",
  'optional-v1.js':"const node=document.getElementById('tap'); const fn=()=>{window.taps++;window.last='v1';}; node.addEventListener('click',fn); module.onDispose(()=>{node.removeEventListener('click',fn);window.disposals++;}); module.exports={version:'v1'};",
  'optional-v2.js':"const node=document.getElementById('tap'); const fn=()=>{window.taps++;window.last='v2';}; node.addEventListener('click',fn); module.onDispose(()=>{node.removeEventListener('click',fn);window.disposals++;}); module.exports={version:'v2'};"
};
async function compile(file,id,source,dest){
 await writeFile(join(work,file+'.json'),JSON.stringify({version:1,modules:[{id,deps:[],file:source}]}));
 const result=spawnSync(process.execPath,[engine,join(work,file+'.json'),join(work,dest)],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
}
try{
 for(const [name,body] of Object.entries(sources))await writeFile(join(work,name),body);
 await compile('first','base','base.js','initial.js');
 await compile('optional','optional','optional-v1.js','optional.js');
 await compile('patch','optional','optional-v2.js','patch.js');
 server=http.createServer(async(req,res)=>{
  const filename=new URL(req.url,'http://localhost').pathname.slice(1);
  gets.set(filename,(gets.get(filename)||0)+1);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'");
  if(filename===''||filename==='index.html'){res.setHeader('Content-Type','text/html');res.end(page);return;}
  if(filename==='loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);return;}
  if(['initial.js','optional.js','patch.js'].includes(filename)){
   res.setHeader('Content-Type','text/javascript');
   res.end(await readFile(join(work,filename)));
   return;
  }
  res.writeHead(404);res.end('Not found');
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const url='http://127.0.0.1:'+server.address().port+'/';
 const result=await new Promise((done,reject)=>{
  const child=spawn(process.env.CHROMIUM,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-dev-shm-usage',
   '--virtual-time-budget=15000','--user-data-dir='+join(work,'chrome-profile'),'--dump-dom',url],
   {stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Chrome timeout '+stderr.slice(-700)));},35000);
  child.stdout.on('data',x=>stdout+=x.toString());child.stderr.on('data',x=>stderr+=x.toString());
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',code=>{clearTimeout(timer);done({code,stdout,stderr});});
 });
 assert.equal(result.code,0,result.stderr.slice(-900));
 assert.match(result.stdout,/PASS JSC PRODUCT CHROME/,result.stdout.slice(-1200));
 assert.equal(gets.get('loader.js'),1);
 assert.equal(gets.get('initial.js'),1);
 assert.equal(gets.get('optional.js'),1);
 assert.equal(gets.get('patch.js'),1);
 console.log('PASS published jsc and dynamic-loader browser path: actual classic script, optional network load, module replacement, real DOM listener disposal, no duplicated handler');
}finally{
 if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 await rm(work,{recursive:true,force:true});
}
