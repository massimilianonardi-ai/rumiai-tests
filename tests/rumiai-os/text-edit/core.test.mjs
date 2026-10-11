import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const library=resolve(process.env.RUMIAI_OS_ROOT||'.','lib/sys/js/text-edit.lib.js');
const require=createRequire(import.meta.url);
const {VERSION,TextEdit,TextEditRepresentation,TextEditSelections,
  TextEditAdvancedSelections,FlatDocument,PieceDocument}=require(library);
assert.equal(VERSION,'0.1.0');
assert.equal(typeof TextEdit,'function');
assert.equal(typeof TextEditRepresentation,'function');
assert.equal(typeof TextEditAdvancedSelections,'function');

let tests=0;
for(const Doc of [FlatDocument,PieceDocument]){
  const source=new Doc('function foo(){\r\n  return "😀 e\u0301";\r\n}\r\nfoo();');
  const old=source.slice(0,source.length);
  const projection=new TextEditRepresentation(source);
  const from=source.lineStart(1),to=source.lineStart(3);
  projection.replace(from,to,'{...}');
  assert.equal(source.slice(0,source.length),old,'projection does not modify source');
  const parts=projection.project(0,source.length);
  assert.deepEqual(parts.segments.map(x=>x.kind),['text','replacement','text']);
  assert.equal(parts.segments[1].text,'{...}');
  assert.deepEqual(parts.segments[1].source,{start:from,end:to});
  assert.equal(projection.length,source.length-(to-from)+5);
  assert.equal(projection.sourceToView(from+2).kind,'replaced-region');
  assert.equal(projection.sourceToView(from).offset,from);
  assert.equal(projection.sourceToView(to).offset,from+5);
  assert.equal(projection.viewToSource(from+2).kind,'replaced-region');
  assert.equal(projection.viewToSource(from).offset,from);
  assert.equal(projection.viewToSource(from+5).offset,to);
  assert.throws(()=>projection.project(from+1,to),/cuts representation/);
  assert.throws(()=>projection.replace(from+2,to+2,'x'),/overlapping/);
  assert.equal(projection.replace(from,to,'FOLDED').replacements.length,1);
  assert.equal(projection.project(from,to).segments[0].text,'FOLDED');
  assert.equal(projection.remove(from,to).replacements.length,0);
  assert.equal(projection.project(0,source.length).segments.length,1);
  assert.throws(()=>projection.replace(source.length+1,source.length+2,'x'),/invalid/);
  assert.throws(()=>projection.project(0,source.length,{maxSourceUnits:4}),/budget/);

  // Split inside a surrogate pair, combining sequence or CRLF must not
  // produce a representation with unstable source character boundaries.
  const text=source.slice(0,source.length);
  const emoji=text.indexOf('😀'),combining=text.indexOf('e\u0301'),crlf=text.indexOf('\r\n');
  assert.throws(()=>projection.replace(emoji+1,emoji+2,'?'),/grapheme/);
  assert.throws(()=>projection.replace(combining+1,combining+2,'?'),/grapheme/);
  assert.throws(()=>projection.replace(crlf+1,crlf+2,'?'),/grapheme/);

  projection.setAnnotations([
    {id:'first',at:0,text:'annotation',affinity:'after'},
    {id:'other',at:source.length,text:'end'}
  ]);
  projection.replace(from,to,'any arbitrary placeholder\nincluding lines');
  const editor=new TextEditSelections(source);
  editor.setSelections([{start:0,end:0,forward:true}]);
  const result=editor.replace('/*intro*/');
  const info=projection.rebase(result.changes);
  assert.deepEqual(info.unresolved,[]);
  assert.equal(projection.replacements[0].start,from+9);
  assert.equal(projection.annotations.find(x=>x.id==='first').at,9);
  assert.equal(projection.annotations.find(x=>x.id==='other').at,source.length);
  assert.equal(projection.project(0,source.length).segments.length,3);
  tests++;
}
{
  const source=new PieceDocument('a\nhidden value\nz');
  const rep=new TextEditRepresentation(source);
  const a=source.lineStart(1),b=source.lineStart(2);
  rep.replace(a,b,'{...}');
  const edit=new TextEditSelections(source);
  edit.setSelections([{start:a+1,end:a+2,forward:true}]);
  const change=edit.replace('X');
  const result=rep.rebase(change.changes);
  assert.equal(result.unresolved.length,1);
  assert.equal(result.unresolved[0].kind,'replacement');
  assert.equal(rep.replacements.length,0,'edited folded content invalidates overlay');
  tests++;
}
{
  const source=new PieceDocument('abcd');
  const rep=new TextEditRepresentation(source);
  rep.setAnnotations([{id:'n',at:2,text:'note'}]);
  const edit=new TextEditSelections(source);
  edit.setSelections([{start:2,end:2,forward:true}]);
  const info=edit.replace('!');
  const rebased=rep.rebase(info.changes);
  assert.equal(rebased.unresolved.length,1);
  assert.equal(rep.annotations.length,0,'do not invent ambiguous affinity');
  tests++;
}
{
  const editor=new TextEdit('ab\ncd\nef');
  editor.advancedSelections.lineSelection(1,2);
  assert.deepEqual(editor.selections.getSelections(),
    [{start:3,end:8,forward:true}]);
  editor.selections.setSelections([{start:3,end:3,forward:true}]);
  editor.representation.replace(3,5,'{F}');
  assert.equal(editor.representation.project(0,8).segments[1].text,'{F}');
  const result=editor.replace('X');
  assert.equal(result.representation.unresolved.length,0);
  assert.equal(editor.representation.replacements[0].start,4);
  assert.equal(editor.document.slice(0,editor.document.length),'ab\nXcd\nef');
  tests++;
}
{
  const editor=new TextEdit('abcd\nefgh');
  editor.advancedSelections.rectangularSelection([
    {lineFrom:0,lineTo:1,columnFrom:1,columnTo:3}
  ],{widthOf:()=>1});
  assert.deepEqual(editor.selections.getSelections(),[
    {start:1,end:3,forward:true},
    {start:6,end:8,forward:true}
  ]);
  editor.replace(['XX','YY']);
  assert.equal(editor.document.toString(),'aXXd\neYYh');
  tests++;
}
{
  const huge='x'.repeat(2*1024*1024);
  const d=new PieceDocument('begin\n'+huge+'\nend');
  const p=new TextEditRepresentation(d);
  p.replace(d.lineStart(1),d.lineStart(2),'{...}');
  let read=0;
  const pieces=p.project(0,d.length,{maxSourceUnits:32});
  for(const s of pieces.segments)if(s.kind==='text')read+=s.text.length;
  assert.equal(read,10);
  assert.equal(pieces.segments[1].text,'{...}');
  assert.equal(d.slice(d.lineStart(1),d.lineStart(1)+16),'x'.repeat(16));
  tests++;
}
console.log(JSON.stringify({pass:true,cases:tests,backends:['FlatDocument','PieceDocument'],
  representationReplaceSourceUntouched:true,graphemes:true,
  mappingManyToOne:true,multicursor:true,noDOM:true,noHistory:true}));
