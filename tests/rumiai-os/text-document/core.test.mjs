// The exported core document classes must behave like the actual unchanged
// TextEdit 0.8.2 document backends. Compile the target's real core descriptor.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'target checkout required');
const compiler=resolve(root,'lib/sys/js/jsc.lib.js');
const descriptor=resolve(root,'lib/sys/js/core/modules-js.json');
const original=resolve(root,'lib/sys/js/text-edit.lib.js');
const require=createRequire(import.meta.url);
const legacy=require(original);
assert.equal(legacy.VERSION,'0.8.2');

const compilation=spawnSync
(
  process.execPath,
  [compiler,descriptor],
  {encoding:'utf8',maxBuffer:16*1024*1024}
);
assert.equal(compilation.status,0,compilation.stderr||'jsc failed to compile the real core descriptor');
assert.ok(compilation.stdout.includes('FlatDocument'));
const temp=mkdtempSync(join(tmpdir(),'rumiai-text-document-'));
let extracted;
try
{
  const output=join(temp,'compiled-core.cjs');
  writeFileSync(output,compilation.stdout);
  extracted=require(output).text?.document;
  assert.ok(extracted,'real core descriptor must export m.text.document');
  assert.deepEqual(Object.keys(extracted).sort(),['Document','Document2D','FlatDocument','PieceDocument']);
}
finally
{
  rmSync(temp,{recursive:true,force:true});
}
assert.equal(typeof extracted.FlatDocument,'function');
assert.equal(typeof extracted.PieceDocument,'function');

assert.equal(typeof extracted.Document,'function');

// Document2D is a distinct nominal contract for a GUI-facing 2D text space.
// It does not reveal whether its backing source is physical or transformed.
const Document2D=extracted.Document2D;
assert.equal(typeof Document2D,'function');
assert.equal(Document2D.prototype instanceof extracted.Document,false);
assert.throws
(
  () => new Document2D(),
  {name:'TypeError',message:'Document2D is abstract'}
);
class IncompleteDocument2D extends Document2D
{
}
const view=new IncompleteDocument2D();
assert.equal(view instanceof Document2D,true);
assert.equal(view instanceof extracted.Document,false);

for(const name of ['rowCount','colCount','selectionMode','insertMode'])
{
  const descriptor=Object.getOwnPropertyDescriptor(Document2D.prototype,name);
  assert.equal(typeof descriptor.get,'function',name+' getter');
  assert.throws
  (
    () => view[name],
    {name:'Error',message:'Document2D.'+name+' must be implemented'}
  );

  if(name==='selectionMode' || name==='insertMode')
  {
    assert.equal(typeof descriptor.set,'function',name+' setter');
    assert.throws
    (
      () => {view[name]='any';},
      {name:'Error',message:'Document2D.'+name+' must be implemented'}
    );
  }
  else
  {
    assert.equal(descriptor.set,undefined,name+' read-only');
  }
}

for
(
  const name of
  [
    'getRect','read','getSelections','setSelections','addSelection',
    'remSelection','insert','subscribe','destroy'
  ]
)
{
  assert.equal(typeof Document2D.prototype[name],'function',name+' abstract slot');
  assert.throws
  (
    () => view[name](),
    {name:'Error',message:'Document2D.'+name+' must be implemented'}
  );
}

for(const name of ['FlatDocument','PieceDocument'])
{
  assert.equal(new extracted[name]('sample') instanceof Document2D,false);
}

// Document defines a nominal, abstract runtime identity in the NEW core.
// The unchanged standalone 0.8.2 constructors deliberately do not inherit it.
assert.throws
(
  () => new extracted.Document(),
  {name:'TypeError',message:'Document is abstract'}
);

class IncompleteDocument extends extracted.Document
{
}

const incomplete=new IncompleteDocument();
assert.equal(incomplete instanceof extracted.Document,true);

for(const property of ['length','revision','lineCount'])
{
  assert.throws
  (
    () => incomplete[property],
    /must be implemented/
  );
}

for(const method of ['slice','lineStart','lineAt','lineInfo','toString','replace','subscribe'])
{
  assert.equal
  (
    typeof extracted.Document.prototype[method],
    'function',
    'Document defines '+method
  );
  assert.throws
  (
    () => incomplete[method](),
    /must be implemented/
  );
}

for(const name of ['FlatDocument','PieceDocument'])
{
  const instance=new extracted[name]('check');
  assert.equal(instance instanceof extracted.Document,true,name+' is a Document');
  assert.equal(instance instanceof extracted[name],true,name+' concrete identity');
  assert.equal(new legacy[name]('check') instanceof extracted.Document,false,
    'standalone TextEdit 0.8.2 is deliberately independent');

  // Both concrete classes share the same intermediate private store.
  assert.strictEqual
  (
    Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(instance))),
    extracted.Document.prototype
  );
}


const fixtures=
[
  '',
  '\r\n',
  'a\r\nb\rc\nd',
  '😀\r\n\uD800x\uDC00',
  'alpha\nbeta\n'
];
const methods=['slice','toString','lineStart','lineAt','lineInfo','replace','subscribe'];
function equalDocument(a,b,tag)
{
  assert.equal(a.toString(),b.toString(),tag+' source');
  assert.equal(a.length,b.length,tag+' length');
  assert.equal(a.lineCount,b.lineCount,tag+' lineCount');
  assert.equal(a.revision,b.revision,tag+' revision');
  for(let row=0;row<a.lineCount;row++)
  {
    assert.deepEqual(a.lineInfo(row),b.lineInfo(row),tag+' lineInfo '+row);
    assert.equal(a.lineStart(row),b.lineStart(row),tag+' lineStart '+row);
  }
  for(let at=0;at<=a.length;at++)
  {
    assert.equal(a.lineAt(at),b.lineAt(at),tag+' lineAt '+at);
  }
  for(let start=0;start<a.length;start++)
  {
    const end=Math.min(start+3,a.length);
    assert.equal(a.slice(start,end),b.slice(start,end),tag+' slice '+start);
  }
}
let verified=0;
for(const name of ['FlatDocument','PieceDocument'])
{
  for(const method of methods)
  {
    assert.equal(typeof extracted[name].prototype[method],'function',
      name+' must expose '+method);
  }
  for(const text of fixtures)
  {
    const before=new legacy[name](text);
    const after=new extracted[name](text);
    const one=[],two=[];
    before.subscribe((...args)=>one.push(args));
    after.subscribe((...args)=>two.push(args));
    equalDocument(before,after,name+' fixture');

    // Every edit targets the same OLD coordinates, even with mixed line endings.
    const changes=
    [
      doc=>[{start:0,end:0,text:'X'}],
      doc=>[{start:doc.length,end:doc.length,text:'\r\n'}],
      doc=>[{start:0,end:Math.min(2,doc.length),text:'Q\r'}],
      doc=>
      [
        {start:0,end:0,text:'!'},
        {start:doc.length,end:doc.length,text:'?'}
      ]
    ];
    for(let i=0;i<changes.length;i++)
    {
      const edits=changes[i](before);
      before.replace(edits);
      after.replace(edits);
      equalDocument(before,after,name+' edit '+i);
      assert.deepEqual(one,two,name+' notifications '+i);
      verified++;
    }
    const snapshot=after.toString(),revision=after.revision;
    assert.throws(()=>after.replace([{start:0,end:2,text:'a'},{start:1,end:3,text:'b'}]),RangeError);
    assert.equal(after.toString(),snapshot);
    assert.equal(after.revision,revision);
    if(name==='PieceDocument')
    {
      const stats=after.stats();
      assert.ok(Number.isSafeInteger(stats.nodes)&&Number.isSafeInteger(stats.maxDepth));
    }
  }
}
console.log('m.text.document extraction parity PASS '+verified+' committed edit comparisons');
