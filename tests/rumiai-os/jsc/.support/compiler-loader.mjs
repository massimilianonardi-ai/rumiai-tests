// Permanent test of the published m jsc library and independent loader.
// Actual target paths are supplied by the target discovery helper, not
// reconstructed from prior PoC snapshots or replaced with mocks.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const root=resolve(process.argv[2]);
const engine=join(root,'lib/sys/js/jsc.lib.js'), loader=join(root,'lib/sys/js/dynamic-loader.lib.js');
const work=await mkdtemp(join(tmpdir(),'jsc-product-test-'));
const require=createRequire(import.meta.url);
const api=require(engine);
assert.equal(typeof api.jscMain,'function');
const invoke=(manifest,out)=>spawnSync(process.execPath,[engine,manifest,out],{encoding:'utf8',timeout:15000});
try{
 const src=join(work,'counter.js'),app=join(work,'application.js');
 const manifest=join(work,'modules.json'),out=join(work,'compiled.js');
 const patchSrc=join(work,'counter-v2.js'),patchManifest=join(work,'patch.json'),patchOut=join(work,'patch.js');
 await writeFile(src,"module.exports.next=()=>1; module.onDispose(()=>globalThis.metrics.disposals++);\n");
 await writeFile(app,"const counter=require('counter'); module.exports.run=()=>counter.next();\n");
 await writeFile(manifest,JSON.stringify({version:1,modules:[
  {id:'counter',deps:[],file:'counter.js'},
  {id:'application',deps:['counter'],file:'application.js'}
 ]}));
 let result=invoke(manifest,out);
 assert.equal(result.status,0,result.stderr);
 const code=await readFile(out,'utf8');
 assert.match(code,/JscRuntime\.installBatch/);
 assert.doesNotMatch(code,/const definitions = new Map\(\)/);
 assert.equal(vm.Script!==undefined,true);
 const loaderSource=await readFile(loader,'utf8');
 const ctx=vm.createContext({metrics:{disposals:0}});
 vm.runInContext(loaderSource,ctx,{filename:'dynamic-loader.lib.js'});
 assert.equal(Object.isFrozen(ctx.JscRuntime),true);
 ctx.JscRuntime.install('handmade',[],(_r,m)=>{m.exports.value=17;});
 assert.equal(ctx.JscRuntime.require('handmade').value,17);
 vm.runInContext(code,ctx,{filename:'compiled.js'});
 assert.equal(ctx.JscRuntime.state().registered,3);
 assert.equal(ctx.JscRuntime.state().active,1,'compiled registrations must be lazy');
 const appV1=ctx.JscRuntime.require('application');
 assert.equal(appV1.run(),1);
 await writeFile(patchSrc,"module.exports.next=()=>2; module.onDispose(()=>globalThis.metrics.disposals++);\n");
 await writeFile(patchManifest,JSON.stringify({version:1,modules:[
  {id:'counter',deps:[],file:'counter-v2.js'}
 ]}));
 result=invoke(patchManifest,patchOut);
 assert.equal(result.status,0,result.stderr);
 vm.runInContext(await readFile(patchOut,'utf8'),ctx);
 assert.equal(ctx.metrics.disposals,1,'old counter cleanup once');
 assert.equal(ctx.JscRuntime.state().active,1,'only handmade instance remains after graph invalidation');
 assert.equal(ctx.JscRuntime.require('application').run(),2);
 assert.equal(appV1.run(),1,'externally retained exports are not live');
 // Bad source must not overwrite existing output.
 const previous=await readFile(out);
 await writeFile(src,"export const notClassic=1;\n");
 result=invoke(manifest,out);
 assert.equal(result.status,5,'invalid ESM source must have syntax branch status');
 assert.match(result.stderr,/module-syntax-invalid/);
 assert.deepEqual(await readFile(out),previous);
 // Bad manifest graph must preserve previously compiled output.
 await writeFile(src,"module.exports.next=()=>1;\n");
 await writeFile(manifest,JSON.stringify({version:1,modules:[{id:'cycle',deps:['cycle'],file:'counter.js'}]}));
 result=invoke(manifest,out);
 assert.equal(result.status,6);
 assert.deepEqual(await readFile(out),previous);
 await writeFile(manifest,JSON.stringify({version:1,modules:[]}));
 result=invoke(manifest,out);
 assert.equal(result.status,3);
 assert.deepEqual(await readFile(out),previous);
 // Registry does not keep stale versions merely as a side effect of churn.
 for(let i=0;i<1000;i++){
  ctx.JscRuntime.install('counter',[],(_r,m)=>{m.exports.next=()=>i;});
  assert.equal(ctx.JscRuntime.require('application').run(),i);
 }
 assert.equal(ctx.JscRuntime.state().registered,3);
 assert.equal(ctx.JscRuntime.state().active,3);
 ctx.JscRuntime.invalidate('counter');
 assert.equal(ctx.JscRuntime.state().active,1);
 console.log('PASS published jsc engine + independent loader: classic compile, lazy loading, manual install, replacement disposal, stale export, rejected ESM/invalid graph, bounded registry');
}finally{await rm(work,{recursive:true,force:true});}
