// Permanent advanced selection geometry contract. All coordinates are source
// logical {row,col} with inclusive row/cell endpoints. Visualization and
// width policy are owned by TextEditRepresentation, not this layer.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {TextEdit,TextEditRepresentation,PieceDocument,FlatDocument}=
  require(resolve(process.env.RUMIAI_OS_ROOT,'lib/sys/js/text-edit.lib.js'));
const C=(row,col)=>({row,col});
const S=(start,end,forward=true)=>({start,end,forward});
let assertions=0;
function same(actual,expected,message){
  assert.deepEqual(actual,expected,message);assertions++;
}

for(const Doc of [FlatDocument,PieceDocument]){
  // Explicit mixed line endings, including a lone CR, and trailing empty row.
  const doc=new Doc('abc\rdef\r\nGHI\n');
  const e=new TextEdit('',{document:doc}),adv=e.advancedSelections;
  adv.lineSelection(C(0,2),C(2,1));
  same(e.selections.getSelections(),[S(0,13)],'line selection spans full logical rows');
  adv.lineSelection(C(2,1),C(0,2));
  same(e.selections.getSelections(),[S(0,13,false)],'line orientation follows endpoints');
  adv.lineSelection(C(1,2),C(1,1));
  same(e.selections.getSelections(),[S(4,9,false)],'same-row line orientation');
  adv.rectangularSelection(C(0,0),C(2,1));
  same(e.selections.getSelections(),
    [S(0,2),S(4,6),S(9,11)],'inclusive columns over mixed terminators');
  adv.rectangularSelection(C(2,1),C(0,0));
  same(e.selections.getSelections(),
    [S(9,11,false),S(4,6,false),S(0,2,false)],
    'reverse endpoints preserve row order and column orientation');
  const previous=e.selections.getSelections();
  assert.throws(()=>adv.lineSelection(C(0,0),C(8,0)),RangeError);
  assert.throws(()=>adv.rectangularSelection(C(0,0),C(8,0)),RangeError);
  same(e.selections.getSelections(),previous,'failed request preserves selections');
  assert.throws(()=>adv.rectangularSelection(C(0,0),C(0,Number.MAX_SAFE_INTEGER)),RangeError);
  const virtual=adv.resolveRectangles(C(0,2),C(3,4));
  assert.equal(virtual.targets.length,4);
  assert.equal(virtual.unresolved.length,4);
  assert.ok(virtual.unresolved.every(x=>x.reason==='virtual-columns'));
  assert.throws(()=>adv.rectangularSelection(C(0,2),C(3,4)),/virtual/);
  same(e.selections.getSelections(),previous,'virtual rejection cannot flatten geometry');
  // Annotation metadata does not affect logical row geometry.
  e.representation.setAnnotations([{id:'note',at:1,text:'!'}]);
  adv.rectangularSelection(C(0,0),C(1,0));
  same(e.selections.getSelections(),[S(0,1),S(4,5)],'annotation is not source text');
  e.representation.replace(1,2,'{fold}');
  assert.equal(adv.resolveRectangles(C(0,0),C(1,1)).unresolved[0].reason,
    'representation-replacement');
  assert.throws(()=>adv.rectangularSelection(C(0,0),C(1,1)),/replaced/);
  e.representation.dispose();e.selections.dispose();
}
for(const Doc of [FlatDocument,PieceDocument]){
  const d=new Doc('a\t😀b\rX\r\nY\n'),p=new TextEditRepresentation(d);
  assert.equal(p.setColumnMetrics({tabSize:4,widthOf:g=>g==='😀'?2:1}),p);
  same(p.columnToSource(0,0),{kind:'offset',offset:0},'start of line');
  assert.equal(p.columnToSource(0,1).offset,1);
  same(p.columnToSource(0,2).kind,'inside-grapheme','inside tab is unresolved');
  same(p.columnToSource(0,4),{kind:'offset',offset:2},'after tab stop');
  same(p.columnToSource(0,5).kind,'inside-grapheme','inside wide emoji');
  same(p.columnToSource(0,6),{kind:'offset',offset:4},'after emoji');
  same(p.columnToSource(0,9),{kind:'virtual',offset:5,virtualSpaces:2},
    'EOL virtual column offset plus intent');
  same(p.sourceToColumn(0),{kind:'column',row:0,col:0},'offset to column');
  same(p.sourceToColumn(2),{kind:'column',row:0,col:4},'source after tab');
  assert.equal(p.sourceToColumn(3).kind,'inside-grapheme');
  assert.throws(()=>p.sourceToColumn(5),/separator/);
  same(p.columnToSource(1,1),{kind:'offset',offset:7},'lone CR not display content');
  same(p.columnToSource(2,1),{kind:'offset',offset:10},'CRLF not display content');
  same(p.columnToSource(3,0),{kind:'offset',offset:11},'final empty row');
  assert.throws(()=>p.setColumnMetrics({tabSize:0}),RangeError);
  assert.throws(()=>p.setColumnMetrics({widthOf:5}),TypeError);
  assert.throws(()=>p.columnToSource(200,0),RangeError);
  assert.throws(()=>p.columnToSource(0,-1),RangeError);
  assert.throws(()=>p.sourceToColumn(-1),RangeError);
  p.setColumnMetrics({tabSize:8,widthOf:()=>0});
  assert.throws(()=>p.columnToSource(0,1),/width/);
  p.setColumnMetrics({tabSize:4,widthOf:g=>g==='😀'?2:1});
  const adv=new TextEdit('',{document:d});
  adv.representation.setColumnMetrics({tabSize:4,widthOf:g=>g==='😀'?2:1});
  assert.equal(adv.advancedSelections.resolveRectangles(C(0,1),C(0,2)).unresolved[0].reason,
    'inside-grapheme');
  assert.throws(()=>adv.advancedSelections.rectangularSelection(C(0,1),C(0,2)),RangeError);
  adv.representation.dispose();adv.selections.dispose();p.dispose();
}
// Bounded source reads: a huge plain-text line must not be materialized to
// convert a column near its beginning, even when other views share the store.
{
  const inner=new PieceDocument('x'.repeat(4*1024*1024)+'\rnext');
  let maxRead=0;
  const doc={
    get length(){return inner.length;},
    get lineCount(){return inner.lineCount;},
    get revision(){return inner.revision;},
    lineAt:n=>inner.lineAt(n),
    lineStart:n=>inner.lineStart(n),
    lineInfo:n=>inner.lineInfo(n),
    slice(a,b){maxRead=Math.max(maxRead,b-a);return inner.slice(a,b);},
    subscribe:fn=>inner.subscribe(fn),
  };
  const p=new TextEditRepresentation(doc);
  assert.equal(p.columnToSource(0,10).offset,10);
  assert.deepEqual(p.sourceToColumn(100),{kind:'column',row:0,col:100});
  assert.ok(maxRead<=2048,'column lookup must not copy a huge ASCII line');
  p.dispose();
}
// A custom width callback may modify the shared source, but must never
// produce a supposedly valid coordinate from the previous revision.
{
  const d=new PieceDocument('abcd'),p=new TextEditRepresentation(d);
  let once=true;
  p.setColumnMetrics({widthOf:()=>{
    if(once){once=false;d.replace(0,0,'!');}
    return 1;
  }});
  assert.throws(()=>p.columnToSource(0,2),/document changed/);
  p.dispose();
}
console.log(JSON.stringify({pass:true,test:'TextEditAdvancedSelections/column geometry',
  assertions}));
