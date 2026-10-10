// Execute the actual code blocks from both product manual quickstarts.
// The docs are the fixture: an example that stops being runnable fails CI.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';

const root=resolve(process.argv[2]);
const engine=join(root,'lib/sys/js/jsc.lib.js');
const loader=await readFile(join(root,'lib/sys/js/dynamic-loader.lib.js'),'utf8');
const manualJsc=await readFile(join(root,'res/sys/manual/jsc'),'utf8');
const manualLoader=await readFile(join(root,'res/sys/manual/dynamic-loader.lib.js'),'utf8');
const scratch=await mkdtemp(join(tmpdir(),'jsc-manual-browser-'));

function exampleBlock(doc,heading) {
  const needle=heading+'\n\n';
  const index=doc.indexOf(needle);
  assert.ok(index>=0,'manual section not found: '+heading);
  const lines=doc.slice(index+needle.length).split('\n');
  const code=[];
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    if (line.startsWith('        ')) {
      code.push(line.slice(8));
    } else if (line === '' && lines[i+1]?.startsWith('        ')) {
      // An empty line INSIDE a code sample is not the end of the sample.
      code.push('');
    } else {
      break;
    }
  }
  assert.ok(code.length,'manual has no executable code after '+heading);
  return code.join('\n')+'\n';
}
async function browser(url,profile) {
  const cli=process.env.CHROMIUM;
  assert.ok(cli,'CHROMIUM must point to a real Chrome/Chromium executable');
  return new Promise((done,reject)=>{
    const child=spawn(cli,['--headless','--no-sandbox','--disable-gpu','--no-first-run',
      '--disable-dev-shm-usage','--virtual-time-budget=12000','--user-data-dir='+join(scratch,profile),
      '--dump-dom',url],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timeout=setTimeout(()=>{
      child.kill('SIGKILL');
      reject(new Error('manual example Chrome timeout: '+stderr.slice(-1000)));
    },40000);
    child.stdout.on('data',bytes=>stdout+=bytes.toString());
    child.stderr.on('data',bytes=>stderr+=bytes.toString());
    child.once('error',err=>{clearTimeout(timeout);reject(err);});
    child.once('close',code=>{clearTimeout(timeout);done({code,stdout,stderr});});
  });
}

async function runSample(label,doc,names) {
  const counter=exampleBlock(doc,names.counter);
  const application=exampleBlock(doc,names.application);
  const manifest=exampleBlock(doc,names.manifest);
  const html=exampleBlock(doc,names.html);
  const parsed=JSON.parse(manifest);
  assert.equal(parsed.version,1,label+': manifest version');
  assert.equal(parsed.modules.length,2,label+': manifest module count');
  assert.deepEqual(parsed.modules.map(x=>x.id),['counter','application'],
    label+': module IDs must match the presented source files');
  const dir=join(scratch,label);
  await (await import('node:fs/promises')).mkdir(dir);
  await writeFile(join(dir,'counter.js'),counter);
  await writeFile(join(dir,'application.js'),application);
  await writeFile(join(dir,'modules.json'),manifest);
  const compiled=join(dir,'compiled.js');
  const run=spawnSync(process.execPath,[engine,join(dir,'modules.json'),compiled],
    {encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,label+': documented source fails compiler:\n'+run.stderr);
  const output=await readFile(compiled,'utf8');
  assert.match(output,/JscRuntime\.installBatch/);
  const assets=new Map([
    ['/index.html',{type:'text/html; charset=utf-8',body:html}],
    ['/dynamic-loader.lib.js',{type:'text/javascript; charset=utf-8',body:loader}],
    ['/compiled.js',{type:'text/javascript; charset=utf-8',body:output}]
  ]);
  const visited=new Set();
  const server=http.createServer((req,res)=>{
    const asset=assets.get(new URL(req.url,'http://localhost').pathname);
    if(!asset){res.writeHead(404);res.end('not found');return;}
    visited.add(new URL(req.url,'http://localhost').pathname);
    res.setHeader('Content-Type',asset.type);
    res.setHeader('Cache-Control','no-store');
    res.end(asset.body);
  });
  try {
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
    const result=await browser('http://127.0.0.1:'+server.address().port+'/index.html',
      'chrome-'+label);
    assert.equal(result.code,0,label+': Chrome failed '+result.stderr.slice(-1200));
    assert.match(result.stdout,/<div id="result">42<\/div>/,
      label+': manual HTML failed to display 42; '+result.stdout.slice(-2000));
    for(const uri of ['/index.html','/dynamic-loader.lib.js','/compiled.js'])
      assert.ok(visited.has(uri),label+': real browser did not load '+uri);
  }finally{
    server.closeAllConnections();
    await new Promise(ok=>server.close(ok));
  }
}

async function runOriginalNamespaceManual() {
  const sourceNames=[
    ['m/srv/data/MyClass.js','    Contents of m/srv/data/MyClass.js:'],
    ['m/srv/data/Other.js','    Contents of m/srv/data/Other.js:'],
    ['m/srv/Facade.js','    Contents of m/srv/Facade.js:']
  ];
  const manifest=exampleBlock(manualJsc,'    Contents of modules-js.json (order matters):');
  const html=exampleBlock(manualJsc,'    In a browser, load bundle.js:');
  const parsed=JSON.parse(manifest);
  assert.ok(parsed.modules[0]?.name==='m','original manual must use namespace descriptor');
  const dir=join(scratch,'original');
  const {mkdir}=await import('node:fs/promises');
  await mkdir(dir,{recursive:true});
  for(const [name,heading] of sourceNames){
    const file=join(dir,name);
    await mkdir(resolve(file,'..'),{recursive:true});
    await writeFile(file,exampleBlock(manualJsc,heading));
  }
  const manifestPath=join(dir,'modules-js.json');
  await writeFile(manifestPath,manifest);
  const built=spawnSync(process.execPath,[engine,manifestPath],
    {encoding:'utf8',timeout:12000});
  assert.equal(built.status,0,'original manifest build failed '+built.stderr);
  assert.doesNotMatch(built.stdout,/JscRuntime|installBatch/,'original output must be independent of registry loader');
  const assets=new Map([
    ['/index.html',{type:'text/html',body:html}],
    ['/bundle.js',{type:'text/javascript',body:built.stdout}]
  ]);
  const visited=new Set();
  const server=http.createServer((req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    const asset=assets.get(path);
    if(!asset){res.writeHead(404);res.end('missing');return;}
    visited.add(path);
    res.setHeader('Content-Type',asset.type);
    res.end(asset.body);
  });
  try{
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
    const result=await browser('http://127.0.0.1:'+server.address().port+'/index.html','chrome-original');
    assert.equal(result.code,0,result.stderr.slice(-900));
    assert.match(result.stdout,/<div id="result">42<\/div>/,
      'original namespace manual example failed in browser: '+result.stdout.slice(-1800));
    assert.ok(visited.has('/bundle.js'),'original browser example did not fetch classic assembly');
    assert.equal(visited.size,2,'original namespace must not require separate loader');
  }finally{
    server.closeAllConnections();
    await new Promise(ok=>server.close(ok));
  }
}

try {
  await runOriginalNamespaceManual();
  await runSample('jsc',manualJsc,{
    counter:'    Create counter.js:',
    application:'    Create application.js:',
    manifest:'    Create modules.json in the SAME directory:',
    html:'    Then create public/index.html:'
  });
  await runSample('loader',manualLoader,{
    counter:'    First create counter.js:',
    application:'    Create application.js:',
    manifest:'    Create modules.json:',
    html:'    then create index.html in the same web-served directory:'
  });
  console.log('PASS original and optional jsc manuals: namespace JSON/source/HTML and two id/deps quickstarts compiled by real jsc and displayed 42 in real Chrome');
}finally{
  await rm(scratch,{recursive:true,force:true});
}
