// Permanent observable TextEditSelections contract and external-rebase checks.
// Source of truth: rumiai-dev/specifications/rumiai-os/TEXT-EDIT.md.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'real product target must be provided');
const require=createRequire(import.meta.url);
const {PieceDocument,FlatDocument,TextEditSelections}=require(
  resolve(root,'lib/sys/js/text-edit.lib.js'));
const R=(start,end,forward=true)=>({start,end,forward});
let assertions=0;
function equal(a,b,message){assert.deepEqual(a,b,message);assertions++;}
function scenario(Doc,old,selections,edits,expected,label){
  const doc=new Doc(old),view=new TextEditSelections(doc);
  view.setSelections(selections);
  const before=doc.revision;
  doc.replace(edits);
  equal(view.getSelections(),expected,label);
  assert.equal(doc.revision,before+1,label+' revision');
  view.dispose();
}
const scenarios=[
  ['before','abcdefgh',[R(5,8)],[{start:1,end:3,text:'X'}],[R(4,7)]],
  ['after','abcdefgh',[R(1,3)],[{start:5,end:6,text:'ABC'}],[R(1,3)]],
  ['at-start','abcdefgh',[R(2,6)],[{start:2,end:2,text:'XYZ'}],[R(5,9)]],
  ['inside','abcdefgh',[R(2,6)],[{start:4,end:4,text:'XYZ'}],[R(2,9)]],
  ['at-end','abcdefgh',[R(2,6)],[{start:6,end:6,text:'XYZ'}],[R(2,6)]],
  ['caret-insertion','abcdefgh',[R(2,2,false)],[{start:2,end:2,text:'XYZ'}],[R(5,5,false)]],
  ['inside-replace','abcdefgh',[R(2,7)],[{start:4,end:6,text:'XYZ'}],[R(2,8)]],
  ['cut-start','abcdefgh',[R(3,7)],[{start:1,end:5,text:'XYZ'}],[R(4,6)]],
  ['cut-end','abcdefgh',[R(2,5)],[{start:4,end:7,text:'XYZ'}],[R(2,4)]],
  ['cut-both','abcdefgh',[R(3,5,false)],[{start:2,end:7,text:'XYZ'}],[R(5,5,false)]],
  ['delete-caret','abcdefgh',[R(4,4)],[{start:2,end:6,text:''}],[R(2,2)]],
  ['shared-boundary','abcdef',[R(2,2)],[{start:2,end:4,text:'Q'},{start:2,end:2,text:'!'}],[R(3,3)]],
  ['mixed-batch','0123456789',[R(2,7)],[{start:8,end:10,text:'!'},{start:0,end:1,text:'ABC'}],[R(4,9)]],
  ['source-noop','abcdef',[R(1,3)],[{start:0,end:0,text:''}],[R(1,3)]],
  ['equal-length-replace','abcdef',[R(2,2)],[{start:1,end:4,text:'XYZ'}],[R(4,4)]],
  ['end-of-document','abcdef',[R(6,6)],[{start:6,end:6,text:'!'}],[R(7,7)]],
  ['utf16-unit','a😀b',[R(2,2,false)],[{start:2,end:2,text:'\ud800'}],[R(3,3,false)]]
];
for(const Doc of [FlatDocument,PieceDocument]){
  for(const [name,old,selections,edits,expected] of scenarios)
    scenario(Doc,old,selections,edits,expected,Doc.name+' '+name);
  {
    const doc=new Doc('abcdefghij');
    const primary=new TextEditSelections(doc),other=new TextEditSelections(doc);
    const input=[R(6,8,false),R(1,3),R(1,1)];
    equal(primary.setSelections(input),primary,'setSelections returns instance');
    input[0].start=0;
    equal(primary.getSelections(),[R(6,8,false),R(1,3),R(1,1)],'input is copied');
    other.setSelections([R(4,4,false)]);
    let callbacks=0,args;
    doc.subscribe((...original)=>{callbacks++;args=original;});
    const result=primary.replace(['Z','Q','!']);
    equal(doc.toString(),'a!QdefZij','atomic unsorted mixed targets');
    equal(result.before,[R(6,8,false),R(1,3),R(1,1)],'old selection order');
    equal(result.after,[R(7,7,false),R(3,3),R(2,2)],'own new carets');
    equal(primary.getSelections(),result.after,'own event applied only once');
    equal(other.getSelections(),[R(4,4,false)],'foreign view rebased');
    assert.equal(callbacks,1,'exactly one committed event');
    equal(args,[[{start:6,end:8,text:'Z'},{start:1,end:3,text:'Q'},
      {start:1,end:1,text:'!'}]],'original argument order');
    assert.equal(Object.keys(result).join(','),'before,after',
      'no history/change payload on selection layer');
    result.after[0].start=999;
    equal(primary.getSelections()[0],R(7,7,false),'returned state is copied');
    primary.dispose();other.dispose();
  }
  {
    const doc=new Doc('abcdef'),view=new TextEditSelections(doc);
    const source=[R(1,4,false),R(2,3),R(2,3),R(3,3)];
    equal(view.addSelections(source),view,'addSelections returns instance');
    equal(view.getSelections(),source,'overlapping and duplicate selections retained');
    const saved=view.getSelections(),old=doc.toString(),rev=doc.revision;
    assert.throws(()=>view.replace('X'),RangeError);
    equal(view.getSelections(),saved,'failed overlap leaves selection state');
    assert.equal(doc.toString(),old);assert.equal(doc.revision,rev);
    assert.throws(()=>view.addSelections([R(0,0),R(100,100)]),RangeError);
    equal(view.getSelections(),saved,'invalid append atomic');
    assert.throws(()=>view.setSelections([{start:0,end:1,forward:1}]),TypeError);
    equal(view.getSelections(),saved,'invalid set atomic');
    view.setSelections([]);
    equal(view.getSelections(),[],'empty selection collection valid');
    assert.throws(()=>view.replace('X'),RangeError);
    view.addSelections([]);
    equal(view.getSelections(),[],'add empty array no-op');
    view.dispose();view.dispose();
    for(const use of [()=>view.getSelections(),()=>view.setSelections([]),
      ()=>view.addSelections([]),()=>view.replace('X')])
      assert.throws(use,/disposed/);
  }
  {
    const doc=new Doc('ABCDE');
    const left=new TextEditSelections(doc),right=new TextEditSelections(doc);
    left.setSelections([R(1,2)]);right.setSelections([R(1,2)]);
    doc.replace(0,0,'');
    equal(left.getSelections(),[R(1,2)],'external no-effect notification');
    const rev=doc.revision;
    left.replace('');
    assert.equal(doc.revision,rev+1);
    equal(left.getSelections(),[R(1,1)],'local no-effect replacement caret');
    equal(right.getSelections(),[R(1,2)],'external no-effect replacement geometry');
    left.dispose();right.dispose();
  }
  {
    const doc=new Doc('abcdef');
    const view=new TextEditSelections(doc);
    view.setSelections([R(1,4,false),R(5,5)]);
    const before=view.getSelections(),string=doc.toString(),rev=doc.revision;
    assert.throws(()=>view.replace(['X','X','X']),TypeError);
    assert.throws(()=>view.replace(['X',10]),TypeError);
    equal(view.getSelections(),before,'invalid payload leaves selections');
    assert.equal(doc.toString(),string);assert.equal(doc.revision,rev);
    view.dispose();
  }
  {
    const doc=new Doc('abcd');
    doc._revision=Number.MAX_SAFE_INTEGER-1;
    const view=new TextEditSelections(doc);
    view.setSelections([R(2,2,false)]);
    doc.replace(0,0,'');
    equal(view.getSelections(),[R(2,2,false)],'last ordinary revision');
    doc.replace(0,0,'');
    equal(view.getSelections(),[],'wrap invalidates stale selection state');
    view.dispose();
  }
}
// An intentionally lossy but otherwise valid notification adapter verifies
// recovery from an actual skipped edit, without altering the base engines.
{
  const underlying=new PieceDocument('abcdef');
  let drop=false;
  const doc={
    get length(){return underlying.length;},
    get revision(){return underlying.revision;},
    slice:(a,b)=>underlying.slice(a,b),
    replace:(...args)=>underlying.replace(...args),
    subscribe:(callback)=>underlying.subscribe((...args)=>{if(!drop)callback(...args);})
  };
  const view=new TextEditSelections(doc);
  view.setSelections([R(3,3)]);
  drop=true;underlying.replace(0,0,'X');
  drop=false;underlying.replace(0,0,'Y');
  equal(view.getSelections(),[],'missed notification invalidates selections');
  view.setSelections([R(1,1)]);
  equal(view.getSelections(),[R(1,1)],'fresh caller state after gap');
  view.dispose();
}
// The selection layer must not need to read old source text or materialize a
// huge document merely to commit a multicaret edit or track external edits.
{
  class NoReadDocument extends PieceDocument {
    slice(){throw Error('selection layer performed a forbidden source read');}
    toString(){throw Error('selection layer materialized source');}
  }
  const doc=new NoReadDocument('x'.repeat(2*1024*1024));
  const view=new TextEditSelections(doc);
  const many=Array.from({length:1600},(_,i)=>R(100+i*100,100+i*100));
  view.setSelections(many);
  const start=performance.now();
  const result=view.replace('!');
  const ownMs=performance.now()-start;
  assert.equal(doc.revision,1);
  assert.equal(result.after.length,1600);
  const edits=Array.from({length:400},(_,i)=>({
    start:500000+i*20,end:500000+i*20,text:'Q'
  }));
  const externalStart=performance.now();
  doc.replace(edits);
  const externalMs=performance.now()-externalStart;
  assert.equal(doc.revision,2);
  assert.equal(view.getSelections().length,1600);
  view.dispose();
  console.log(JSON.stringify({stress:true,selections:1600,externalEdits:400,
    documentUTF16:doc.length,ownMs:Math.round(ownMs),
    externalMs:Math.round(externalMs)}));
}
console.log(JSON.stringify({pass:true,test:'TextEditSelections',
  backends:['FlatDocument','PieceDocument'],scenarioCases:scenarios.length,
  checked:assertions}));
