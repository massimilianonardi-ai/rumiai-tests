// Physical row/UTF-16-column selectors, logical selection policy, and
// deferred source materialization. Test the real TextEdit public library.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {TextEdit,TextEditRepresentation,TextEditSelections,
  PieceDocument,FlatDocument}=require(
  resolve(process.env.RUMIAI_OS_ROOT,'lib/sys/js/text-edit.lib.js'));

const C=(row,col)=>({row,col});
const S=(start,end,forward=true)=>({start,end,forward});
let assertions=0;
function equal(actual,expected,message){
  assert.deepEqual(actual,expected,message);
  assertions++;
}

for(const Doc of [FlatDocument,PieceDocument]){
  const prefix=Doc.name;
  {
    const document=new Doc('abc\rdef\r\nGHI\n');
    const editor=new TextEdit('',{document}),advanced=editor.advancedSelections;
    advanced.lineSelection(C(0,2),C(2,1));
    equal(editor.selections.getSelections(),
      [S(C(0,0),C(3,0))],prefix+' full line range includes CR, CRLF, LF');
    advanced.lineSelection(C(2,1),C(0,2));
    equal(editor.selections.getSelections(),
      [S(C(0,0),C(3,0),false)],prefix+' reverse orientation');
    advanced.rectangularSelection(C(0,0),C(2,1));
    equal(editor.selections.getSelections(),
      [S(C(0,0),C(0,2)),S(C(1,0),C(1,2)),S(C(2,0),C(2,2))],
      prefix+' logical rectangle in source rows');
    const revision=document.revision,old=document.toString();
    advanced.rectangularSelection(C(0,2),C(4,4));
    equal(editor.selections.getSelections(),
      [S(C(0,2),C(0,5)),S(C(1,2),C(1,5)),
       S(C(2,2),C(2,5)),S(C(3,2),C(3,5)),S(C(4,2),C(4,5))],
      prefix+' virtual logical rectangle survives EOL and EOF');
    equal({revision:document.revision,text:document.toString()},
      {revision,text:old},prefix+' selecting virtual space does not edit source');
    advanced.setPolicy('clipped');
    advanced.rectangularSelection(C(0,2),C(4,4));
    equal(editor.selections.getSelections(),
      [S(C(0,2),C(0,3)),S(C(1,2),C(1,3)),S(C(2,2),C(2,3))],
      prefix+' logical clipping per existing source row');
    advanced.rectangularSelection(C(10,2),C(12,4));
    equal(editor.selections.getSelections(),[],prefix+' fully outside clips to empty');
    assert.throws(()=>advanced.setPolicy('unexpected'),RangeError);
    assert.equal(advanced.policy,'clipped');
    editor.representation.dispose();editor.selections.dispose();
  }
  {
    const document=new Doc('a\t😀b\rX\r\nY\n');
    const editor=new TextEdit('',{document});
    const representation=editor.representation;
    representation.setColumnMetrics({tabSize:4,widthOf:g=>g==='😀'?2:1});
    assert.equal(representation.logicalRowWidth(0),7);
    assert.equal(representation.logicalRowWidth(100),0);
    assert.equal(representation.columnToSource(0,2).kind,'inside-grapheme');
    assert.equal(representation.columnToSource(0,5).kind,'inside-grapheme');
    editor.advancedSelections.rectangularSelection(C(0,6),C(0,6));
    equal(editor.selections.getSelections(),
      [S(C(0,4),C(0,5))],prefix+' logical cells map to physical UTF-16 units');
    equal(representation.getSelections(),
      [S(C(0,6),C(0,7))],prefix+' representation reads logical coordinates');
    assert.throws(()=>editor.advancedSelections.rectangularSelection(
      C(0,1),C(0,2)),/grapheme/);
    equal(editor.selections.getSelections(),
      [S(C(0,4),C(0,5))],prefix+' failed translation is atomic');
    representation.setReplacements([{start:0,end:1,text:'{fold}'}]);
    assert.throws(()=>editor.advancedSelections.rectangularSelection(
      C(0,0),C(0,3)),/overlay/);
    editor.representation.dispose();editor.selections.dispose();
  }
  {
    const document=new Doc('abc\nxy'),selections=new TextEditSelections(document);
    selections.setSelections([
      S(C(0,6),C(0,6)),
      S(C(0,9),C(0,9))
    ]);
    const before=document.revision;
    selections.replace(['X','Y']);
    assert.equal(document.toString(),'abc   X  Y\nxy');
    assert.equal(document.revision,before+1,'one atomic materialization commit');
    equal(selections.getSelections(),
      [S(C(0,7),C(0,7)),S(C(0,10),C(0,10))],
      prefix+' cursors return to their own inserted text');
    selections.dispose();
  }
  {
    const document=new Doc('abc'),selections=new TextEditSelections(document);
    selections.setSelections([
      S(C(3,3),C(3,3)),
      S(C(1,5),C(1,5)),
      S(C(3,7),C(3,7))
    ]);
    const before=document.revision;
    selections.replace(['X','Y','Z']);
    assert.equal(document.toString(),'abc\n     Y\n\n   X   Z');
    assert.equal(document.revision,before+1,
      prefix+' one commit for multiple future rows sharing old EOF');
    equal(selections.getSelections(),
      [S(C(3,4),C(3,4)),S(C(1,6),C(1,6)),S(C(3,8),C(3,8))],
      prefix+' distinct caret destinations remain distinct');
    selections.dispose();
  }
  {
    const document=new Doc('abc'),selections=new TextEditSelections(document);
    selections.setSelections([S(C(2,4),C(2,8))]);
    const before=document.revision;
    selections.replace('');
    assert.equal(document.toString(),'abc');
    assert.equal(document.revision,before,
      prefix+' deleting only virtual cells does not write');
    selections.setSelections([S(C(0,5),C(0,5)),S(C(0,5),C(0,5))]);
    assert.throws(()=>selections.replace(['X','Y']),RangeError);
    assert.equal(document.toString(),'abc',prefix+' conflict leaves source intact');
    selections.dispose();
  }
  {
    const document=new Doc('abc\r'),selections=new TextEditSelections(document);
    selections.setSelections([S(C(3,2),C(3,2))]);
    selections.replace('Z');
    assert.equal(document.lineCount,4,
      prefix+' an appended LF must not merge with the original trailing CR');
    equal(selections.getSelections(),[S(C(3,3),C(3,3))],
      prefix+' far-future row remains exact after CR-terminated growth');
    selections.dispose();
  }
  {
    const document=new Doc('abc\nx'),selections=new TextEditSelections(document);
    selections.setSelections([S(C(0,3),C(0,3))]);
    selections.replace('\r');
    assert.equal(document.toString(),'abc\r\nx',
      prefix+' inserted CR joins existing LF without source normalization');
    equal(selections.getSelections(),[S(C(1,0),C(1,0))],
      prefix+' caret cannot remain inside newly formed CRLF');
    selections.dispose();
  }
  {
    const document=new Doc('abc'),selections=new TextEditSelections(document);
    selections.setSelections([S(C(0,0),C(0,1))]);
    selections.addSelections([]);
    equal(selections.getSelections(),[S(C(0,0),C(0,1))],
      prefix+' empty physical append remains a no-op');
    selections.dispose();
  }
  {
    const document=new Doc('abc\ndef'),selections=new TextEditSelections(document);
    selections.setSelections([S(C(1,2),C(1,2)),S(C(1,8),C(1,8))]);
    document.replace(0,0,'P\n');
    equal(selections.getSelections(),
      [S(C(2,2),C(2,2)),S(C(2,8),C(2,8))],
      prefix+' real and virtual anchors follow external inserted row');
    selections.dispose();
  }
  {
    const document=new Doc('abc'),selections=new TextEditSelections(document);
    selections.setSelections([S(C(0,2),C(0,2)),S(C(2,4),C(2,8))]);
    selections.replace(['Q','']);
    equal(selections.getSelections(),
      [S(C(0,3),C(0,3)),S(C(2,4),C(2,8))],
      prefix+' unedited virtual selection survives another edited caret');
    selections.dispose();
  }
}
// Content lookup near the beginning of a huge line must remain bounded.
{
  const inner=new PieceDocument('x'.repeat(4*1024*1024)+'\rnext');
  let maxRead=0;
  const document={
    get length(){return inner.length;},
    get lineCount(){return inner.lineCount;},
    get revision(){return inner.revision;},
    lineAt:n=>inner.lineAt(n),
    lineStart:n=>inner.lineStart(n),
    lineInfo:n=>inner.lineInfo(n),
    slice(a,b){maxRead=Math.max(maxRead,b-a);return inner.slice(a,b);},
    subscribe:fn=>inner.subscribe(fn)
  };
  const representation=new TextEditRepresentation(document);
  assert.equal(representation.columnToSource(0,10).offset,10);
  assert.ok(maxRead<=2048,'ordinary early-column lookup must stay bounded');
  representation.dispose();
}
console.log(JSON.stringify({pass:true,test:'TextEdit logical and physical selections',
  assertions,backends:['FlatDocument','PieceDocument']}));
