// Exercise real m/jsc file-output behavior, with or without installed minifiers.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';

const root=resolve(process.argv[2]);
const work=await mkdtemp(join(tmpdir(),'jsc-artifacts-'));
const command=join(root,'bin/sys/jsc');
const runtime=join(root,'m');
const run=(manifest,output)=>spawnSync(runtime,[command,manifest,output],
  {encoding:'utf8',timeout:30000});
async function exists(file){try{await access(file);return true;}catch{return false;}}
async function checkArchive(output,ext){
 const minified=output.slice(0,-ext.length)+'.min'+ext;
 const minArchive=minified+'.gz';
 const rawArchive=output+'.gz';
 if(await exists(minified)){
   assert.ok(await exists(minArchive),'minified archive missing');
   assert.deepEqual(gunzipSync(await readFile(minArchive)),await readFile(minified));
 } else {
   assert.ok(await exists(rawArchive),'raw archive missing');
   assert.deepEqual(gunzipSync(await readFile(rawArchive)),await readFile(output));
 }
}
try{
 await writeFile(join(work,'A.js'),'function A(){return 42;}\n');
 const jsMan=join(work,'js.json'),jsOut=join(work,'bundle.js');
 await writeFile(jsMan,JSON.stringify({modules:[
   {name:'Example',modules:[{file:'A.js',exports:'A'}]}
 ]}));
 let result=run(jsMan,jsOut);
 assert.equal(result.status,0,result.stderr);
 const source=await readFile(jsOut,'utf8');
 assert.match(source,/function A\(\)/);
 assert.match(source,/'use strict'/);
 await checkArchive(jsOut,'.js');

 await writeFile(join(work,'a.css'),'a { color: blue; }\n');
 await writeFile(join(work,'b.css'),'b { color: red; }\n');
 const cssMan=join(work,'css.json'),cssOut=join(work,'bundle.css');
 await writeFile(cssMan,JSON.stringify({modules:[
   {file:'a.css'},{file:'b.css'}
 ]}));
 result=run(cssMan,cssOut);
 assert.equal(result.status,0,result.stderr);
 assert.match(await readFile(cssOut,'utf8'),/color: blue;[\s\S]*color: red;/);
 await checkArchive(cssOut,'.css');
 console.log('PASS JSC artifacts: original JS/CSS, installed-minifier sibling if available, gzip');
}finally{await rm(work,{recursive:true,force:true});}
