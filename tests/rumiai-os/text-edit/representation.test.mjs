// Permanent automatic source/representation synchronization contract.
// Oracle is independent of the implementation's source-offset search code.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {PieceDocument,FlatDocument,TextEditRepresentation,TextEdit,TextEditSelections}=
  require(resolve(process.env.RUMIAI_OS_ROOT,'lib/sys/js/text-edit.lib.js'));

let cases=0;
const replacement=(start,end,text)=>({start,end,text});
const annotation=(id,at,affinity)=>({id,at,text:id,...(affinity?{affinity}:{})});
function check(source,expected,message){
  assert.deepEqual(source,expected,message);cases++;
}
for(const Doc of [FlatDocument,PieceDocument]) {
  {
    const doc=new Doc('ab\ncd\r\nef');
    const first=new TextEditRepresentation(doc);
    const second=new TextEditRepresentation(doc);
    first.replace(3,5,'{hidden}');
    first.setAnnotations([annotation('right',2,'after'),annotation('left',2,'before')]);
    second.replace(0,2,'{AB}');
    const prior=doc.revision;
    doc.replace(2,2,'!');
    assert.equal(doc.revision,prior+1);
    check(first.replacements,[replacement(4,6,'{hidden}')],Doc.name+' rebase after insertion');
    check(first.annotations.map(x=>[x.id,x.at]),[['left',2],['right',3]],
      'annotation affinities at insertion');
    check(second.replacements,[replacement(0,2,'{AB}')],Doc.name+' independent view');
    check(first.unresolved,[],'ordinary edit no invalidations');
    first.dispose();second.dispose();
  }
  {
    const doc=new Doc('0123456789');
    const rep=new TextEditRepresentation(doc);
    rep.replace(2,7,'{fold}');
    rep.setAnnotations([annotation('prior',1,'before'),
      annotation('inside',4,'after'),annotation('following',9,'before')]);
    doc.replace(4,6,'X'); // source range inside overlay invalidates it
    check(rep.replacements,[],'edited hidden region invalidated');
    check(rep.unresolved.map(x=>x.kind+':'+(x.reason||'')),
      ['replacement:source-region-edited','annotation:source-anchor-replaced'],
      'invalidity reason retained');
    check(rep.annotations.map(x=>x.id),['prior','following'],
      'unaffected annotations survive');
    doc.replace(0,0,''); // each commit publishes only its own unresolved record
    check(rep.unresolved,[],'new commit resets unresolved snapshot');
    rep.dispose();
  }
  {
    const doc=new Doc('abcdef');
    const rep=new TextEditRepresentation(doc);
    rep.replace(2,4,''); // collapsed overlay has ambiguous view->source location
    check(rep.viewToSource(2),{kind:'replaced-region',
      source:{start:2,end:4},view:{start:2,end:2}},'collapsed overlay mapping');
    check(rep.sourceToView(3),{kind:'replaced-region',
      source:{start:2,end:4},view:{start:2,end:2}},'source inside collapsed region');
    rep.dispose();
  }
  {
    const doc=new Doc('abcdefgh');
    const rep=new TextEditRepresentation(doc);
    rep.replace(2,5,'XYZ');
    rep.setAnnotations([annotation('unaffiliated',6),
      annotation('before',6,'before'),annotation('after',6,'after')]);
    doc.replace([{start:6,end:6,text:'!'}, {start:2,end:3,text:'Q'}]);
    check(rep.replacements,[],'overlay edit detects even equal-length modification');
    check(rep.annotations.map(x=>[x.id,x.at]),[['after',7],['before',6]],
      'one batch maps surviving annotations and preserves order');
    check(rep.unresolved.map(x=>x.reason),
      ['source-region-edited','insertion-affinity-required'],
      'unknown insertion affinity becomes unresolved');
    rep.dispose();
  }
  {
    const doc=new Doc('abcdef');
    const rep=new TextEditRepresentation(doc);
    rep.replace(1,3,'X');
    rep.setAnnotations([annotation('near',5,'after')]);
    doc.replace(1,1,'!');
    check(rep.replacements,[replacement(2,4,'X')],'overlay start excludes insertion');
    doc.replace(4,4,'!');
    check(rep.replacements,[replacement(2,4,'X')],'overlay end excludes insertion');
    check(rep.annotations[0].at,7,'annotation follows both edits');
    const copy=rep.replacements;
    copy[0].start=0;
    check(rep.replacements[0].start,2,'returned snapshot cannot mutate representation');
    rep.dispose();rep.dispose();
    for(const operation of [
      ()=>rep.replacements,()=>rep.unresolved,()=>rep.length,
      ()=>rep.project(0,0),()=>rep.replace(0,1,'x')
    ])assert.throws(operation,/disposed/);
  }
  {
    const doc=new Doc('abcdef');
    const rep=new TextEditRepresentation(doc);
    rep.replace(1,3,'X');
    rep.setAnnotations([annotation('old',4,'after')]);
    doc._revision=Number.MAX_SAFE_INTEGER-1;
    // Create a fresh subscription at a controlled near-limit checkpoint.
    rep.dispose();
    const atLimit=new TextEditRepresentation(doc);
    atLimit.replace(1,3,'X');
    atLimit.setAnnotations([annotation('old',4,'after')]);
    doc.replace(0,0,'');
    check(atLimit.replacements,[replacement(1,3,'X')],'last normal revision');
    doc.replace(0,0,'');
    check(atLimit.replacements,[],'revision wrap clears overlays');
    check(atLimit.annotations,[],'revision wrap clears annotations');
    check(atLimit.unresolved.map(x=>x.reason),
      ['revision-discontinuity','revision-discontinuity'],'gap report');
    atLimit.dispose();
  }
  {
    const doc=new Doc('a😀b\r\nC');
    const rep=new TextEditRepresentation(doc);
    assert.throws(()=>rep.replace(2,3,'bad'),/grapheme/);
    const start=doc.toString().indexOf('\r\n');
    assert.throws(()=>rep.replace(start+1,start+2,'bad'),/grapheme/);
    rep.replace(1,3,'{emoji}');
    const projected=rep.project(0,doc.length,{maxSourceUnits:20});
    assert.equal(projected.segments[1].text,'{emoji}');
    assert.equal(projected.readUnits,doc.length-2);
    assert.throws(()=>rep.project(0,doc.length,{maxSourceUnits:2}),/budget/);
    assert.throws(()=>rep.project(2,doc.length),/grapheme|cuts/);
    rep.dispose();
  }
  {
    const doc=new Doc('0123456789');
    const rep=new TextEditRepresentation(doc);
    rep.setAnnotations([annotation('a',0,'after')]);
    const existing=rep.annotations;
    assert.throws(()=>rep.setAnnotations([annotation('duplicate',1),
      annotation('duplicate',2)]),/duplicate/);
    check(rep.annotations,existing,'invalid metadata update atomic');
    rep.replace(2,4,'{a}');
    assert.throws(()=>rep.setReplacements([replacement(1,5,'x'),
      replacement(3,6,'y')]),/overlapping/);
    check(rep.replacements,[replacement(2,4,'{a}')],
      'invalid overlay update atomic');
    const old=doc.toString();
    rep.clear();
    rep.remove(0,1);
    assert.equal(doc.toString(),old,'overlay never edits source');
    rep.dispose();
  }
}
// A lost notification must discard all dependent metadata even when text
// length and logical-line count happen to match.
{
  const inner=new PieceDocument('abcdefgh');
  let suppress=false;
  const doc={
    get length(){return inner.length;},
    get lineCount(){return inner.lineCount;},
    get revision(){return inner.revision;},
    lineStart:n=>inner.lineStart(n),
    lineAt:n=>inner.lineAt(n),
    lineInfo:n=>inner.lineInfo(n),
    slice:(a,b)=>inner.slice(a,b),
    subscribe:fn=>inner.subscribe((...args)=>{if(!suppress)fn(...args);})
  };
  const rep=new TextEditRepresentation(doc);
  rep.replace(2,4,'{x}');
  rep.setAnnotations([annotation('n',1,'after')]);
  suppress=true;
  inner.replace(0,1,'Q');
  suppress=false;
  inner.replace(6,7,'Z');
  check(rep.replacements,[],'discontinuity clears overlays');
  check(rep.annotations,[],'discontinuity clears annotations');
  assert.equal(rep.unresolved.length,2);
  rep.dispose();
}
// A change from another TextEditSelections instance must update the
// representation exactly once, not through a duplicate facade replay.
{
  const doc=new PieceDocument('abcd\nefgh');
  const one=new TextEdit('',{document:doc});
  const two=new TextEdit('',{document:doc});
  one.representation.replace(1,3,'{A}');
  two.representation.setAnnotations([annotation('shared',7,'after')]);
  two.selections.setSelections([{start:{row:0,col:0},end:{row:0,col:0},forward:true}]);
  two.replace('!');
  check(one.representation.replacements,[replacement(2,4,'{A}')],
    'other facade automatically rebases representation');
  check(two.representation.annotations[0].at,8,'origin view automatically rebases once');
  one.selections.setSelections([{start:{row:1,col:2},end:{row:1,col:2},forward:true}]);
  const result=one.replace('X');
  assert.equal('changes' in result,false,'no explicit old-text facade adapter');
  assert.equal(result.representation.unresolved.length,0);
  one.representation.dispose();two.representation.dispose();
  one.selections.dispose();two.selections.dispose();
}
// Keep the large-document viewport budget meaningful for ASCII text.
// Source boundary validation must not materialize a multi-megabyte line.
{
  const core=new PieceDocument('A'.repeat(4*1024*1024)+'\nend');
  let maxRead=0,totalRead=0;
  const source={
    get length(){return core.length;},
    get lineCount(){return core.lineCount;},
    get revision(){return core.revision;},
    lineStart:n=>core.lineStart(n),
    lineAt:n=>core.lineAt(n),
    lineInfo:n=>core.lineInfo(n),
    slice(a,b){
      maxRead=Math.max(maxRead,b-a);totalRead+=b-a;
      return core.slice(a,b);
    },
    subscribe:fn=>core.subscribe(fn)
  };
  const rep=new TextEditRepresentation(source);
  rep.replace(3000000,3000010,'{collapsed}');
  const part=rep.project(2999980,3000030,{maxSourceUnits:40});
  assert.equal(part.readUnits,40);
  assert.ok(maxRead<=40,'boundary test must not read the full ASCII line');
  assert.ok(totalRead<512,'bounded projection must not scan entire huge line');
  rep.dispose();
}
// A malicious user-supplied metadata getter may mutate the real source.
// Such an update must not overwrite the already-rebased representation.
{
  const doc=new PieceDocument('abcdef');
  const rep=new TextEditRepresentation(doc);
  rep.setAnnotations([annotation('prior',3,'after')]);
  const race={id:'new',at:2,affinity:'after',
    get text(){doc.replace(0,0,'!');return 'new';}};
  assert.throws(()=>rep.setAnnotations([race]),/document changed/);
  check(rep.annotations,[annotation('prior',4,'after')],
    'source notification survives hostile metadata getter');
  rep.dispose();
}
// Compare indexed source/view queries with a simple linear reference
// implementation under seeded non-overlapping and adjacent substitution
// arrangements, including empty virtual strings and shared view offsets.
function naiveSourceToView(offset,ranges) {
  let delta=0;
  for(const r of ranges){
    if(offset<=r.start)break;
    if(offset<r.end)return {kind:'replaced-region',
      source:{start:r.start,end:r.end},
      view:{start:r.start+delta,end:r.start+delta+r.text.length}};
    delta+=r.text.length-(r.end-r.start);
  }
  return {kind:'offset',offset:offset+delta};
}
function naiveViewToSource(offset,ranges){
  let source=0,view=0;
  for(const r of ranges){
    const original=r.start-source;
    if(r.text.length===0&&offset===view+original)
      return {kind:'replaced-region',
        source:{start:r.start,end:r.end},
        view:{start:view+original,end:view+original}};
    if(offset<=view+original)return {kind:'offset',offset:source+offset-view};
    view+=original;
    if(offset<view+r.text.length)return {kind:'replaced-region',
      source:{start:r.start,end:r.end},
      view:{start:view,end:view+r.text.length}};
    source=r.end;view+=r.text.length;
  }
  return {kind:'offset',offset:source+offset-view};
}
{
  let seed=0x5e1ec701;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  const base=new PieceDocument('a'.repeat(80)),rep=new TextEditRepresentation(base);
  const insertions=['','X','ABCDE','abc','🐟'];
  for(let step=0;step<300;step++){
    const ranges=[];
    let at=0;
    while(at<base.length){
      at+=random()%5;
      if(at>=base.length)break;
      const end=Math.min(base.length,at+1+random()%3);
      ranges.push(replacement(at,end,insertions[random()%insertions.length]));
      at=end;
    }
    rep.setReplacements(ranges);
    const current=rep.replacements;
    for(let pos=0;pos<=base.length;pos++){
      assert.deepEqual(rep.sourceToView(pos),naiveSourceToView(pos,current),
        'source map differential '+step+':'+pos);
    }
    for(let pos=0;pos<=rep.length;pos++){
      assert.deepEqual(rep.viewToSource(pos),naiveViewToSource(pos,current),
        'view map differential '+step+':'+pos);
    }
    cases++;
  }
  rep.dispose();
}
// Many dispersed overlays and annotations must support repeated small
// projections and mappings without any full-source materialization.
{
  const n=5000,doc=new PieceDocument('A'.repeat(n*20+20));
  const rep=new TextEditRepresentation(doc);
  rep.setReplacements(Array.from({length:n},(_,i)=>
    replacement(10+i*20,13+i*20,'X')));
  rep.setAnnotations(Array.from({length:n},(_,i)=>
    annotation('mark'+i,15+i*20,'after')));
  assert.equal(rep.length,doc.length-n*2);
  for(let i=0;i<n;i++){
    const source=15+i*20;
    assert.equal(rep.sourceToView(source).offset,source-(i+1)*2);
  }
  for(let i=0;i<1000;i++){
    const start=20+i*20;
    const win=rep.project(start,start+8,{maxSourceUnits:12});
    assert.equal(win.source.start,start);
    assert.ok(win.readUnits<=12);
  }
  rep.dispose();cases++;
}
console.log(JSON.stringify({pass:true,test:'TextEditRepresentation',
  backends:['FlatDocument','PieceDocument'],assertions:cases}));
