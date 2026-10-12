// Permanent public TextEditBase contract checks against the actual target library.
// Covers TEXT-EDIT.md: literal UTF-16 source, CR/LF/CRLF line index,
// atomic multi-range replace, committed notifications and cyclic revisions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'set RUMIAI_OS_ROOT through the target-discovering test wrapper');
const require=createRequire(import.meta.url);
const {PieceDocument,FlatDocument}=require(resolve(root,'lib/sys/js/text-edit.lib.js'));

function oracle(text) {
  const lines=[],length=text.length;
  let start=0;
  for(let i=0;i<length;i++){
    if(text[i]==='\r'||text[i]==='\n'){
      const end=i;
      if(text[i]==='\r'&&text[i+1]==='\n')i++;
      lines.push({start,end,nextStart:i+1});
      start=i+1;
    }
  }
  lines.push({start,end:length,nextStart:length});
  return lines;
}
function verify(doc,text,label,full=false) {
  assert.equal(doc.length,text.length,label+' length');
  assert.equal(doc.toString(),text,label+' source');
  assert.equal(doc.lineCount,oracle(text).length,label+' line count');
  const ls=oracle(text);
  for(let i=0;i<ls.length;i++){
    assert.equal(doc.lineStart(i),ls[i].start,label+' lineStart '+i);
    assert.deepEqual(doc.lineInfo(i),ls[i],label+' lineInfo '+i);
  }
  for(let pos=0;pos<=text.length;pos+=(full?1:Math.max(1,Math.floor(text.length/43)))){
    let expected=ls.findIndex(x=>pos<x.nextStart);
    if(expected===-1)expected=ls.length-1;
    assert.equal(doc.lineAt(pos),expected,label+' lineAt '+pos);
  }
  assert.equal(doc.lineAt(text.length),ls.length-1,label+' lineAt EOF');
}
function expectBad(doc,fn,ErrorType) {
  const old=doc.toString(),rev=doc.revision,lines=doc.lineCount;
  assert.throws(fn,ErrorType);
  assert.equal(doc.toString(),old,'failed call must preserve source');
  assert.equal(doc.revision,rev,'failed call must preserve revision');
  assert.equal(doc.lineCount,lines,'failed call must preserve line index');
}
for(const Doc of [FlatDocument,PieceDocument]){
  for(const text of ['','\r','\n','\r\n','\r\r\n','\n\r','A\r\nB\rC\n',
     '😀\r\n\uD800Z\udfff\n','\r\n\r\n','abc']){
    verify(new Doc(text),text,Doc.name+' initial '+JSON.stringify(text),true);
  }
  assert.throws(()=>new Doc(19),TypeError);
  const d=new Doc('abcdefgh');
  assert.equal(d.revision,0);
  assert.throws(()=>d.subscribe(null),TypeError);
  expectBad(d,()=>d.replace(4,2,'x'),RangeError);
  expectBad(d,()=>d.replace(-1,2,'x'),RangeError);
  expectBad(d,()=>d.replace(0,9,'x'),RangeError);
  expectBad(d,()=>d.replace(0,1,4),TypeError);
  expectBad(d,()=>d.replace([]),RangeError);
  expectBad(d,()=>d.replace([{start:1,end:3,text:'X'},{start:2,end:5,text:'Y'}]),RangeError);
  expectBad(d,()=>d.replace([{start:1,end:5,text:'X'},{start:2,end:2,text:'Y'}]),RangeError);
  expectBad(d,()=>d.replace([{start:2,end:2,text:'X'},{start:2,end:2,text:'Y'}]),RangeError);
  expectBad(d,()=>d.replace([{start:0,end:1,text:'X'},{start:3,end:3,text:0}]),TypeError);
  expectBad(d,()=>d.replace([{start:0,end:1,text:'X'},{start:3,end:8,get text(){throw Error('getter failed')}}]),Error);
  assert.throws(()=>d.slice(-1,1),RangeError);
  assert.throws(()=>d.slice(0,9),RangeError);
  assert.throws(()=>d.lineAt(-1),RangeError);
  assert.throws(()=>d.lineInfo(d.lineCount),RangeError);
  let notifications=0,gotArgs,blocked=false,late=0;
  const originalError=console.error,failures=[];
  console.error=(...args)=>failures.push(args);
  try {
    const cancel=d.subscribe((...args)=>{
      notifications++;gotArgs=args;
      try{d.replace(0,0,'!');}catch(e){blocked=/reentrant/.test(e.message);}
      d.subscribe(()=>late++);
    });
    d.subscribe(()=>{throw Error('intentional listener failure');});
    d.subscribe(()=>{notifications++;});
    const edits=[{start:5,end:5,text:'+'},{start:1,end:4,text:'Q'},
      {start:1,end:1,text:'<'},{start:8,end:8,text:'!'}];
    d.replace(edits);
    assert.equal(d.toString(),'a<Qe+fgh!');
    assert.equal(d.revision,1);
    assert.equal(notifications,2);
    assert.equal(late,0,'subscriptions during delivery affect next commit only');
    assert.equal(failures.length,1,'listener error must be diagnosed but isolated');
    assert.equal(blocked,true);
    assert.deepEqual(gotArgs,[edits]);
    assert.ok(Object.isFrozen(gotArgs[0]));
    assert.ok(Object.isFrozen(gotArgs[0][0]));
    edits[0].text='MUTATED';
    assert.equal(gotArgs[0][0].text,'+','callback observes value snapshots');
    cancel();cancel();
    d.replace(0,0,'');
    assert.equal(d.revision,2,'no-effect commit counts');
    assert.equal(notifications,3,'remaining subscriber receives the second event');
    assert.equal(late,1);
  } finally {console.error=originalError;}
  // Contrived near-limit setup exercises the *real* product's wrap path,
  // without performing 9e15 writes. Underscore field is non-public.
  d._revision=Number.MAX_SAFE_INTEGER-1;
  d.replace(0,0,'');
  assert.equal(d.revision,Number.MAX_SAFE_INTEGER);
  d.replace(0,0,'');
  assert.equal(d.revision,0);
  d.replace(0,0,'');
  assert.equal(d.revision,1);
  verify(d,d.toString(),Doc.name+' post-wrap',true);
  const boundary=new Doc('AB');
  boundary.replace(1,1,'\r');
  boundary.replace(2,2,'\n');
  verify(boundary,'A\r\nB',Doc.name+' cross-edit CRLF',true);
  boundary.replace(2,2,'Z');
  verify(boundary,'A\rZ\nB',Doc.name+' split CRLF',true);
  const edge=new Doc('xyz');
  edge.replace([{start:1,end:2,text:'Q'},{start:2,end:2,text:'!'}]);
  assert.equal(edge.toString(),'xQ!z','insertion at replacement end follows new text');
  const sameStart=new Doc('xyz');
  sameStart.replace([{start:1,end:1,text:'<'},{start:1,end:2,text:'Q'}]);
  assert.equal(sameStart.toString(),'x<Qz','insertion at replacement start precedes new text');
  const adjacent=new Doc('xyz');
  adjacent.replace([{start:0,end:1,text:'A'},{start:1,end:2,text:'B'},
    {start:1,end:1,text:'!'}]);
  assert.equal(adjacent.toString(),'A!Bz','insertion at shared boundary');
}
{
  const d=new PieceDocument('ABCDEFG'),before=d.toString(),revision=d.revision;
  let seen=0;d.subscribe(()=>seen++);
  const oldFrom=Uint32Array.from;
  let count=0;
  try{
    Uint32Array.from=function(...args){
      if(++count===2)throw Error('injected staging failure');
      return Reflect.apply(oldFrom,this,args);
    };
    assert.throws(()=>d.replace([{start:0,end:1,text:'Q'},
      {start:5,end:6,text:'R'}]),/injected staging failure/);
  }finally{Uint32Array.from=oldFrom;}
  assert.equal(d.toString(),before,'treap untouched after partial staging failure');
  assert.equal(d.revision,revision);
  assert.equal(seen,0);
}
// Seeded, independent line oracle and differential reference under thousands
// of changes, including internal cuts of surrogate pairs and CRLF boundaries.
let seed=0x9f3129ab;
function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const pool=['','X','\r','\n','\r\n','😀','\ud800','abc','\r\r\n','🐟\nY'];
const flat=new FlatDocument('A\r\nB\rC\nD'),piece=new PieceDocument(flat.toString());
let expected=flat.toString();
const started=performance.now();
for(let step=0;step<3800;step++){
  if(step%4===0){
    const inserts=[];
    // Distinct insertion points create a valid unsorted atomic batch.
    const positions=new Set();
    for(let j=0;j<3;j++)positions.add(rand()%(expected.length+1));
    for(const pos of positions)inserts.push({start:pos,end:pos,text:pool[rand()%pool.length]});
    inserts.reverse();
    flat.replace(inserts);piece.replace(inserts);
    const sorted=inserts.slice().sort((a,b)=>b.start-a.start);
    for(const x of sorted)expected=expected.slice(0,x.start)+x.text+expected.slice(x.end);
  } else {
    const a=rand()%(expected.length+1),b=a+rand()%(expected.length-a+1);
    const t=pool[rand()%pool.length];
    flat.replace(a,b,t);piece.replace(a,b,t);
    expected=expected.slice(0,a)+t+expected.slice(b);
  }
  assert.equal(piece.toString(),expected,'piece source after step '+step);
  assert.equal(flat.toString(),expected,'flat source after step '+step);
  if(step%29===0)verify(piece,expected,'piece random '+step,true);
  if(step%43===0)verify(flat,expected,'flat random '+step,true);
}
assert.equal(piece.revision,3800);
assert.equal(flat.revision,3800);
const randomElapsed=performance.now()-started;
{
  const huge='A'.repeat(8*1024*1024)+'\r\n'+'B'.repeat(8*1024*1024)+'\rC';
  const d=new PieceDocument(huge);
  assert.equal(d.lineCount,3);
  assert.equal(d.lineStart(1),8*1024*1024+2);
  const start=performance.now();
  for(let i=0;i<2000;i++)d.replace(d.length,d.length,'!');
  const elapsed=performance.now()-start;
  assert.equal(d.lineCount,3);
  assert.equal(d.slice(0,1),'A');
  assert.equal(d.slice(d.length-2,d.length),'!!');
  assert.equal(d.revision,2000);
  assert.ok(d.stats().maxDepth<110,'treap depth must remain balanced');
  console.log(JSON.stringify({hugeUTF16:huge.length,appendEdits:2000,
    elapsedMs:Math.round(elapsed),stats:d.stats()}));
}
// A subscription is owned by each subscribe() call, even for the same function.
for(const Doc of [FlatDocument,PieceDocument]){
  const d=new Doc('x');let hits=0;const callback=()=>hits++;
  const u1=d.subscribe(callback),u2=d.subscribe(callback);
  d.replace(0,0,'');assert.equal(hits,2);
  u1();u1();d.replace(0,0,'');assert.equal(hits,3);
  u2();d.replace(0,0,'');assert.equal(hits,3);
}
// Nonempty and empty multi-range edits, not just insertion-only batches.
let mixedText='x\r\ny\nz\r';
const mixed=new PieceDocument(mixedText);
for(let step=0;step<3000;step++){
  const batch=[],len=mixedText.length;
  let at=0;
  for(let j=0;j<5&&at<=len;j++){
    at+=rand()%Math.min(4,len-at+1);
    if(at>len)break;
    const width=rand()%Math.min(4,len-at+1);
    batch.push({start:at,end:at+width,text:pool[rand()%pool.length]});
    at+=width+1;
  }
  if(!batch.length)batch.push({start:0,end:0,text:''});
  if(rand()%2)batch.reverse();
  mixed.replace(batch);
  for(const e of batch.slice().sort((a,b)=>b.start-a.start||
     Number(a.start===a.end)-Number(b.start===b.end))){
    mixedText=mixedText.slice(0,e.start)+e.text+mixedText.slice(e.end);
  }
  assert.equal(mixed.toString(),mixedText,'mixed atomic batch '+step);
  if(step%37===0)verify(mixed,mixedText,'multi-range index '+step);
}
assert.equal(mixed.revision,3000);
console.log(JSON.stringify({pass:true,test:'TextEditBase',backends:['FlatDocument','PieceDocument'],
  differentialEdits:3800,randomElapsedMs:Math.round(randomElapsed)}));
