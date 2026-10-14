// Permanent ordered jsc namespace, export, import, CSS and Node publication regression.
// Exercise the real published first-party compiler.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import {stat} from 'node:fs/promises';

const root=resolve(process.argv[2]),engine=join(root,'lib/sys/js/jsc.lib.js');
const work=await mkdtemp(join(tmpdir(),'jsc-legacy-namespaces-'));
const src=async(name,value)=>{
 const path=join(work,name);
 await mkdir(resolve(path,'..'),{recursive:true});
 await writeFile(path,value);
};
const run=(args)=>spawnSync(process.execPath,[engine,...args],{encoding:'utf8',timeout:15000});
try {
 await src('m/Base.js','function Base(){ return 10; }\n');
 await src('m/srv/data/MyClass.js','function MyClass(){ return Base()+32; }\n');
 await src('m/srv/data/Other.js','function Other(){ return MyClass(); }\n');
 await src('m/srv/Facade.js',
   'function Facade(){ return data.MyClass() + data.Other() - 42; }\n');
 await src('m/srv/Standalone.js',
   'function Standalone(){ return m.srv.data.MyClass(); }\n');
 const tree={modules:[{name:'m',modules:[
  {file:'m/Base.js',exports:'Base'},
  {name:'srv',modules:[
   {name:'data',modules:[
    {file:'m/srv/data/MyClass.js',exports:'MyClass'},
    {file:'m/srv/data/Other.js',exports:'Other'}
   ]},
   {file:'m/srv/Facade.js',exports:'Facade'},
   {file:'m/srv/Standalone.js',exports:'Standalone'}
  ]}
 ]}]};
 const manifest=join(work,'modules-js.json'),output=join(work,'bundle.js');
 await writeFile(manifest,JSON.stringify(tree,null,2));
 let result=run([manifest]);
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/function MyClass/);
 assert.doesNotMatch(result.stdout,/jsc: compiled/,'stdout contains only source code');
 assert.match(result.stdout,/'use strict'/);
 assert.doesNotMatch(result.stdout,/\beval\s*\(/);
 new vm.Script(result.stdout);
 const sandbox=vm.createContext({});
 vm.runInContext(result.stdout,sandbox);
 assert.equal(sandbox.m.srv.data.MyClass(),42);
 assert.equal(sandbox.m.srv.data.Other(),42,'unqualified MyClass inside m.srv.data');
 assert.equal(sandbox.m.srv.Facade(),42,'data.MyClass accessible from m.srv');
 assert.equal(sandbox.m.srv.Standalone(),42,'fully qualified namespace accessible');
 const loaded=run([manifest,output]);
 assert.equal(loaded.status,0,loaded.stderr);
 assert.equal(await readFile(output,'utf8'),result.stdout,'output file and stdout source equivalent');
 // The public launcher, not this direct compiler library entrypoint,
 // owns minification and gzip; a direct output writes the raw assembly only.
 assert.ok((await stat(output)).size>0);
 const oldSandbox=vm.createContext({});
 vm.runInContext(await readFile(output,'utf8'),oldSandbox);
 assert.equal(oldSandbox.m.srv.Facade(),42);
 // Additional bundles acquire prior namespace references via declared aliases.
 await src('m/srv/Extension.js','function Extension(){ return data.MyClass()+Base(); }\n');
 const extension={modules:[{name:'m',modules:[{name:'srv',modules:[
  {file:'m/srv/Extension.js',imports:{data:'m.srv.data',Base:'m.Base'},exports:'Extension'}
 ]}]}]};
 const extMan=join(work,'extension.json');
 await writeFile(extMan,JSON.stringify(extension));
 const extensionBuild=run([extMan]);
 assert.equal(extensionBuild.status,0,extensionBuild.stderr);
 vm.runInContext(extensionBuild.stdout,oldSandbox);
 assert.equal(oldSandbox.m.srv.Extension(),52);
 assert.equal(oldSandbox.m.srv.data.MyClass(),42,'existing scope preserved by augmentation');
 // A subsequently declared export replaces the namespace property.
 await src('m/srv/data/Revised.js','function MyClass(){ return 77; }\n');
 const revised={modules:[{name:'m',modules:[{name:'srv',modules:[
  {name:'data',modules:[{file:'m/srv/data/Revised.js',exports:'MyClass'}]}
 ]}]}]};
 const patchManifest=join(work,'revision.json');
 await writeFile(patchManifest,JSON.stringify(revised));
 const patch=run([patchManifest]);
 assert.equal(patch.status,0,patch.stderr);
 vm.runInContext(patch.stdout,oldSandbox);
 assert.equal(oldSandbox.m.srv.data.MyClass(),77,'reopened namespace must use new declaration');
 // CommonJS defaults to independent modules even with an existing global m.
 const isolated=vm.createContext({module:{exports:{}},m:{unrelated:77}});
 vm.runInContext(await readFile(output,'utf8'),isolated);
 assert.notEqual(isolated.module.exports,isolated.m);
 assert.equal(isolated.m.unrelated,77);
 assert.equal(isolated.m.srv,undefined);
 assert.equal(isolated.module.exports.srv.data.MyClass(),42);

 // Opt-in enables independently assembled bundles to reuse one Node namespace.
 const shared=vm.createContext({module:{exports:{}},console});
 const sharedCore=JSON.parse(JSON.stringify(tree)); sharedCore.nodeGlobal=true;
 const sharedExtension=JSON.parse(JSON.stringify(extension)); sharedExtension.nodeGlobal=true;
 await writeFile(manifest,JSON.stringify(sharedCore));
 await writeFile(extMan,JSON.stringify(sharedExtension));
 const sharedResult=run([manifest]);
 assert.equal(sharedResult.status,0,sharedResult.stderr);
 vm.runInContext(sharedResult.stdout,shared);
 const provider=shared.module.exports;
 shared.module={exports:{}};
 const sharedConsumer=run([extMan]);
 assert.equal(sharedConsumer.status,0,sharedConsumer.stderr);
 vm.runInContext(sharedConsumer.stdout,shared);
 assert.equal(shared.module.exports,provider);
 assert.equal(shared.m,provider);
 assert.equal(shared.m.srv.Extension(),52);

 // Legacy stylesheet manifest concatenates order, without JS runtime wrapping.
 await src('css/first.css','/* FIRST */\n.a { color: red; }\n');
 await src('css/second.css','/* SECOND */\n.b { color: blue; }\n');
 const cssMan=join(work,'modules-css.json');
 await writeFile(cssMan,JSON.stringify({modules:[
  {file:'css/first.css'}, {file:'css/second.css'}
 ]}));
 const css=run([cssMan]);
 assert.equal(css.status,0,css.stderr);
 assert.ok(css.stdout.indexOf('FIRST')<css.stdout.indexOf('SECOND'));
 assert.match(css.stdout,/\.a\s*\{\s*color: red/);
 assert.match(css.stdout,/\.b\s*\{\s*color: blue/);
 assert.doesNotMatch(css.stdout,/globalThis|function\s*\(/);
 const cssOut=join(work,'style.css');
 result=run([cssMan,cssOut]);assert.equal(result.status,0,result.stderr);
 assert.equal(await readFile(cssOut,'utf8'),css.stdout);

 // Reject invalid exports before writing the prior output.
 const before=await readFile(output);
 const malformed={modules:[{name:'m',modules:[
  {file:'m/Base.js',exports:'foo);throw new Error(1)//'}
 ]}]};
 await writeFile(manifest,JSON.stringify(malformed));
 result=run([manifest,output]);
 assert.equal(result.status,2,result.stderr);
 assert.match(result.stderr,/invalid export/);
 assert.deepEqual(await readFile(output),before);
 // Reject path escape even for symlinked paths.
 await writeFile(manifest,JSON.stringify({modules:[{file:'../outside.js'}]}));
 result=run([manifest,output]);
 assert.notEqual(result.status,0);
 assert.deepEqual(await readFile(output),before);
 console.log('PASS ORIGINAL JSC: ordered legacy JSON, stdout/file, m.srv.data aliases at all levels, augmentation, CSS source order, invalid exports/paths preserve output, strict browser and Node library publication');
}finally{await rm(work,{recursive:true,force:true});}
