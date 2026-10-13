// Current TextEditSelections physical row/UTF-16-column API contract.
// No offset-based selector compatibility: offsets belong to TextEditBase.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {FlatDocument,PieceDocument,TextEditSelections}=
  require(resolve(process.env.RUMIAI_OS_ROOT,'lib/sys/js/text-edit.lib.js'));

const C=(row,col)=>({row,col});
const S=(start,end,forward=true)=>({start,end,forward});
let checks=0;
function same(actual,expected,label){
  assert.deepEqual(actual,expected,label);
  checks++;
}
for(const Doc of [FlatDocument,PieceDocument]){
  {
    const doc=new Doc('abc\ndef'),view=new TextEditSelections(doc);
    same(view.getSelections(),[],'initial collection is empty');
    const items=[S(C(0,1),C(0,2),false),S(C(1,0),C(1,0))];
    assert.equal(view.setSelections(items),view);
    items[0].start.col=0;
    same(view.getSelections(),[S(C(0,1),C(0,2),false),S(C(1,0),C(1,0))],
      'setter copies input points');
    const snapshot=view.getSelections();
    snapshot[0].end.col=99;
    same(view.getSelections()[0],S(C(0,1),C(0,2),false),
      'getter copies output points');
    assert.equal(view.addSelections([S(C(2,6),C(2,6))]),view);
    same(view.getSelections().map(s=>s.start),
      [C(0,1),C(1,0),C(2,6)],'ordered independent physical collection');
    view.addSelections([]);
    same(view.getSelections().length,3,'empty append is a no-op');
    view.setSelections([]);
    same(view.getSelections(),[],'empty set clears');
    view.dispose();
    view.dispose();
    assert.throws(()=>view.getSelections(),/disposed/);
  }
  {
    const doc=new Doc('abcdef'),view=new TextEditSelections(doc);
    view.setSelections([S(C(0,2),C(0,4),false)]);
    const prior=view.getSelections(),revision=doc.revision,text=doc.toString();
    for(const invalid of [
      [{start:2,end:4,forward:true}],
      [S(C(0,4),C(0,2))],
      [S(C(-1,1),C(0,2))],
      [S(C(0,Number.MAX_SAFE_INTEGER+1),C(0,0))],
      [{start:C(0,1),end:C(0,2),forward:1}],
      [S(C(0,0),{row:0,col:-1})]
    ])assert.throws(()=>view.setSelections(invalid));
    same(view.getSelections(),prior,'bad physical inputs do not replace state');
    assert.equal(doc.revision,revision);
    assert.equal(doc.toString(),text);
    assert.throws(()=>view.replace(['A','B']),/more replacement values/);
    for(const invalid of [[{}],[[1]],[1n],[Symbol('bad')],[()=>{}]])
      assert.throws(()=>view.replace(invalid),TypeError);
    assert.throws(()=>view.replace({}),TypeError);
    same(view.getSelections(),prior,'invalid payload does not modify selections');
    view.dispose();
  }
  {
    // Nullish, absent, numeric and boolean values are normalized before one
    // atomic selected edit. Missing array entries mean deletion, not no-op.
    const examples=[
      {value:null,want:'b\nd\nf'},
      {value:undefined,want:'b\nd\nf'},
      {value:[],want:'b\nd\nf'},
      {value:['X'],want:'Xb\nd\nf'},
      {value:[true,null,false],want:'trueb\nd\\falsef'},
      {value:[42,undefined,3.14],want:'42b\nd\\3.14f'},
      {value:[,'Y'],want:'b\nYd\nf'},
      {value:0,want:'0b\n0d\n0f'},
      {value:-0,want:'0b\n0d\n0f'},
      {value:NaN,want:'NaNb\nNaNd\nNaNf'},
      {value:Infinity,want:'Infinityb\nInfinityd\nInfinityf'},
      {value:-Infinity,want:'-Infinityb\n-Infinityd\n-Infinityf'},
      {value:false,want:'falseb\nfalsed\nfalsef'}
    ];
    for(const {value,want} of examples){
      const doc=new Doc('ab\ncd\nef'),view=new TextEditSelections(doc);
      view.setSelections([
        S(C(0,0),C(0,1)),S(C(1,0),C(1,1),false),
        S(C(2,0),C(2,1))
      ]);
      const original=view.getSelections(),revision=doc.revision;
      let commits=0;const unsubscribe=doc.subscribe(()=>commits++);
      const result=view.replace(value);
      same(doc.toString(),want,Doc.name+' normalized input '+String(value));
      same(result.before,original,'one-action before snapshot');
      same(result.after,view.getSelections(),'one-action after snapshot');
      same(doc.revision,revision+1,'exactly one revision for selected action');
      same(commits,1,'exactly one source notification for selected action');
      unsubscribe();view.dispose();
    }
  }
  {
    // Removing exclusively virtual space never materializes document rows.
    const doc=new Doc('ab'),view=new TextEditSelections(doc);
    const points=[S(C(0,8),C(0,11)),S(C(3,1),C(3,3))];
    view.setSelections(points);
    const before=doc.revision;
    const result=view.replace([undefined]);
    same(doc.toString(),'ab','short nullish delete preserves virtual source');
    same(doc.revision,before,'virtual-only delete does not commit');
    same(result.after,points,'virtual-only deletion retains positions');
    view.dispose();
  }
  {
    const doc=new Doc('abcdef'),view=new TextEditSelections(doc);
    const dup=[S(C(0,1),C(0,1)),S(C(0,1),C(0,1),false)];
    view.setSelections(dup);
    same(view.getSelections(),dup,'identical carets are retained as state');
    const rev=doc.revision;
    assert.throws(()=>view.replace(['X','Y']),RangeError);
    assert.equal(doc.revision,rev,'duplicate write fails atomically');
    assert.equal(doc.toString(),'abcdef');
    view.setSelections([S(C(0,1),C(0,3)),S(C(0,2),C(0,4))]);
    assert.throws(()=>view.replace('X'),RangeError);
    assert.equal(doc.toString(),'abcdef','overlapping ranges reject without mutation');
    view.dispose();
  }
  {
    const doc=new Doc('abcdef'),left=new TextEditSelections(doc);
    const right=new TextEditSelections(doc);
    left.setSelections([S(C(0,1),C(0,4),false),S(C(0,5),C(0,5))]);
    right.setSelections([S(C(0,2),C(0,2))]);
    doc.replace(1,1,'!');
    same(left.getSelections(),
      [S(C(0,2),C(0,5),false),S(C(0,6),C(0,6))],
      'external insertion at selection start excluded');
    same(right.getSelections(),[S(C(0,3),C(0,3))],
      'independent second view rebases once');
    doc.replace(5,5,'?');
    same(left.getSelections()[0],S(C(0,2),C(0,5),false),
      'insertion at selection end excluded');
    doc.replace(0,doc.length,'Q');
    same(left.getSelections(),
      [S(C(0,1),C(0,1),false),S(C(0,1),C(0,1))],
      'consumed source endpoints collapse after replacement');
    left.dispose();right.dispose();
  }
  {
    const doc=new Doc('abc\ndef'),view=new TextEditSelections(doc);
    view.setSelections([S(C(1,2),C(1,2)),S(C(1,8),C(1,8))]);
    doc.replace(0,0,'P\n');
    same(view.getSelections(),
      [S(C(2,2),C(2,2)),S(C(2,8),C(2,8))],
      'existing and virtual positions follow their original source row');
    doc.replace(doc.lineInfo(2).start+1,doc.lineInfo(2).start+1,'!');
    same(view.getSelections(),
      [S(C(2,3),C(2,3)),S(C(2,9),C(2,9))],
      'external same-line insertion preserves virtual EOL displacement');
    view.dispose();
  }
  {
    const doc=new Doc('abc'),view=new TextEditSelections(doc);
    view.setSelections([S(C(3,4),C(3,4))]);
    doc.replace(doc.length,doc.length,'\nnew');
    same(view.getSelections(),[],
      'external edit at virtual EOF invalidates ambiguous future anchor');
    view.dispose();
  }
  {
    const doc=new Doc('abcdef'),view=new TextEditSelections(doc);
    view.setSelections([S(C(0,2),C(0,3))]);
    let didEdit=false;
    const hostile={
      get start(){
        if(!didEdit){didEdit=true;doc.replace(0,0,'!');}
        return C(0,1);
      },
      end:C(0,1),forward:true
    };
    assert.throws(()=>view.setSelections([hostile]),/document changed/);
    same(view.getSelections(),[S(C(0,3),C(0,4))],
      'external notification wins over stale caller properties');
    didEdit=false;
    assert.throws(()=>view.addSelections([hostile]),/document changed/);
    same(view.getSelections(),[S(C(0,4),C(0,5))],
      'stale add does not override newly rebased selection');
    view.dispose();
  }
  {
    const doc=new Doc('abc\nx'),view=new TextEditSelections(doc);
    view.setSelections([S(C(0,6),C(0,6)),S(C(2,4),C(2,4))]);
    const old=doc.revision,after=view.replace(['X','Y']);
    assert.equal(doc.toString(),'abc   X\nx\n    Y');
    assert.equal(doc.revision,old+1);
    same(after.after,[S(C(0,7),C(0,7)),S(C(2,5),C(2,5))],
      'materialization produces distinct caret destinations');
    view.dispose();
  }
  {
    const doc=new Doc('abc'),view=new TextEditSelections(doc);
    view.setSelections([S(C(3,6),C(3,9))]);
    const before=doc.revision;
    view.replace('');
    assert.equal(doc.revision,before,'empty-only virtual deletion does not commit');
    assert.equal(doc.toString(),'abc');
    view.dispose();
  }
  {
    const doc=new Doc('abcdef'),view=new TextEditSelections(doc);
    view.setSelections([S(C(0,3),C(0,3))]);
    const rev=doc.revision;
    const result=view.replace('');
    assert.equal(doc.revision,rev+1,
      'existing-source empty replacement retains atomic notification');
    same(result.after,[S(C(0,3),C(0,3))],'empty source edit caret');
    view.dispose();
  }
}
// Multi-caret hot path must remain bounded by edits, not entire source copies.
{
  class NoReadDocument extends PieceDocument{
    slice(){throw Error('selections unexpectedly read large source');}
    toString(){throw Error('selections unexpectedly materialized source');}
  }
  const doc=new NoReadDocument('x'.repeat(2*1024*1024));
  const view=new TextEditSelections(doc);
  const many=Array.from({length:1600},(_,i)=>S(C(0,100+i*100),C(0,100+i*100)));
  const start=performance.now();
  view.setSelections(many);
  const result=view.replace('!');
  const ownMs=performance.now()-start;
  assert.equal(doc.revision,1);
  same(result.after.length,1600,'1600 physical carets after writing');
  const edits=Array.from({length:400},(_,i)=>({
    start:500000+i*20,end:500000+i*20,text:'Q'
  }));
  const externalStart=performance.now();
  doc.replace(edits);
  const externalMs=performance.now()-externalStart;
  same(view.getSelections().length,1600,'1600 positions after 400 external edits');
  view.dispose();
  console.log(JSON.stringify({stress:true,selections:1600,externalEdits:400,
    documentUTF16:doc.length,ownMs:Math.round(ownMs),
    externalMs:Math.round(externalMs)}));
}
// Independent linear oracle for source edits on a single ASCII row.
function reference(position,right,start,end,text){
  if(position<start)return position;
  if(start===end)return position===start?
    position+(right?text.length:0):position+text.length;
  if(position===start)return position;
  if(position<end)return start+(right?text.length:0);
  return position+text.length-(end-start);
}
let seed=0xbad4cafe;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
for(const Doc of [FlatDocument,PieceDocument]){
  const doc=new Doc('x'.repeat(500)),view=new TextEditSelections(doc);
  for(let step=0;step<600;step++){
    if(step%5===0){
      const selections=Array.from({length:12},()=>{
        const a=random()%(doc.length+1),b=a+random()%(doc.length-a+1);
        return S(C(0,a),C(0,b),(random()%2)===0);
      });
      view.setSelections(selections);
    }
    const before=view.getSelections();
    const at=random()%(doc.length+1);
    const end=at+random()%Math.min(3,doc.length-at+1);
    const payload=['','Y','ZZ'][random()%3];
    const expected=before.map(s=>{
      const a=reference(s.start.col,true,at,end,payload);
      const b=reference(s.end.col,s.start.col===s.end.col,at,end,payload);
      return S(C(0,a),C(0,Math.max(a,b)),s.forward);
    });
    doc.replace(at,end,payload);
    same(view.getSelections(),expected,Doc.name+' physical rebase oracle '+step);
  }
  view.dispose();
}
console.log(JSON.stringify({pass:true,test:'TextEditSelections physical',
  backends:['FlatDocument','PieceDocument'],checks}));
