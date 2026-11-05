'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = process.argv[2];
const command = path.join(root,'bin/sys/web-analyze');
const env = {...process.env, m_ROOT:root,m_LIB_DIR:path.join(root,'lib')};
const sites = [
  {label:'MDN',host:'developer.mozilla.org',
    url:'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide'},
  {label:'web.dev',host:'web.dev',url:'https://web.dev/javascript'}
];
const json = file => JSON.parse(fs.readFileSync(file,'utf8'));
function jsonl(file)
{
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

async function capture(site,base)
{
  const child=spawn(command,[site.url,base],{
    env,stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk.toString();});
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      child.kill('SIGKILL');
      reject(Error(site.label+' browser capture timeout'));
    },210000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',status=>{clearTimeout(timer);resolve(status);});
  });
  // Do not print possibly sensitive URLs, cookies, page HTML, script source,
  // browser transport packets or arbitrary exceptions from the live capture.
  assert.equal(code,0,site.label+' analyzer failed (exit '+code+')');
  const report=stdout.trim().split('\n').at(-1);
  assert(report && report.endsWith('/README.md') &&
    fs.existsSync(report) && report.startsWith(base+path.sep),
    site.label+' analysis report missing');
  return path.dirname(report);
}

function verify(site,dir)
{
  const dom=fs.readFileSync(path.join(dir,'states/dom-rest-initial.html'),'utf8');
  assert(/<title[^>]*>[^<]*JavaScript/i.test(dom),
    site.label+' did not render expected public JavaScript documentation');
  assert(/<body[\s>]/i.test(dom) && dom.length>2500,
    site.label+' rendered page is unexpectedly empty');

  const summary=json(path.join(dir,'summary.json'));
  const manifest=json(path.join(dir,'rest/manifest.json'));
  const audit=json(path.join(dir,'evidence-integrity.json'));
  const resources=jsonl(path.join(dir,'resources.jsonl'));
  const scripts=jsonl(path.join(dir,'scripts.jsonl'));
  const saved=resources.filter(item=>item.status==='saved');
  const own=saved.filter(item=>{
    try{return new URL(item.url).hostname===site.host;}
    catch(_){return false;}
  });
  assert(saved.length>=3,
    site.label+' failed to archive multiple real HTTPS response bodies');
  assert(own.length>=1,
    site.label+' did not archive an HTTPS response from the requested host');
  assert(scripts.some(item=>item.status==='saved'),
    site.label+' script-source capture unavailable');
  assert(manifest.targets?.some(target=>target.main===true),
    site.label+' main target missing from deep-rest manifest');
  assert(manifest.artifacts?.some(item=>item.name==='target-graph-final'),
    site.label+' final target graph missing from deep-rest manifest');
  assert(audit.status!=='failed' && audit.status!=='interrupted',
    site.label+' evidence integrity failed or capture was interrupted');
  assert(summary.resourceCapture?.saved>=saved.length,
    site.label+' archived response counter is inconsistent');
  assert(fs.existsSync(path.join(dir,'rest/worker-provenance/index.json')),
    site.label+' worker provenance missing');
  assert(fs.existsSync(path.join(dir,'rest/targets/target-000/environment.json')),
    site.label+' deep-rest browser environment missing');
  assert.equal(fs.statSync(dir).mode&0o777,0o700,
    site.label+' capture directory is not private');
  console.log(site.label+' real HTTPS PASS: savedResponses='+saved.length+
    ' ownHostResponses='+own.length+' savedScriptRecords='+
    scripts.filter(item=>item.status==='saved').length+
    ' audit='+audit.status+' limitations='+(manifest.limitations?.length||0));
}

async function main()
{
  assert(root,'supplied rumiai-os root required');
  for(const site of sites)
  {
    const base=fs.mkdtempSync(path.join(os.tmpdir(),'web-analyze-public-site-'));
    try
    {
      const dir=await capture(site,base);
      verify(site,dir);
    }
    finally
    {
      fs.rmSync(base,{recursive:true,force:true,maxRetries:20,retryDelay:250});
    }
  }
  console.log('Public HTTPS browser capture complete: 2 separate real websites; no evidence uploaded');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
