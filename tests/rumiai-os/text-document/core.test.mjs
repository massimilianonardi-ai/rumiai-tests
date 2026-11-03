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
  assert.deepEqual(Object.keys(extracted).sort(),['CellDocument2D','Document','Document2D','FlatDocument','PieceDocument','RawDocument2D']);
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

for(const name of ['rowCount','colCount','revision','selectionMode','insertMode'])
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
    'getRect','getRowWidth','getRegions','read','getSelections','setSelections','addSelection',
    'remSelection','insert','replace','subscribe','destroy'
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

// A caller knows only the 2D API and supplies a real physical Document.
// The adapter must keep one effective selection collection and preserve
// the original source's atomic-edit and external-rebase machinery.
const RawDocument2D=extracted.RawDocument2D;
assert.equal(typeof RawDocument2D,'function');
assert.throws(()=>new RawDocument2D({}),TypeError);
assert.throws(()=>new RawDocument2D('not a Document'),TypeError);

const point=(row,col)=>({row,col});
const range=(ar,ac,br,bc,forward=true)=>(
  {start:point(ar,ac),end:point(br,bc),forward}
);

for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('alpha\r\nbeta\ngamma');
  const view=new RawDocument2D(source);
  assert.equal(view instanceof Document2D,true);
  assert.equal(view instanceof extracted.Document,false);
  assert.equal(view.rowCount,3);
  assert.equal(view.colCount,5);
  assert.deepEqual(view.getRect(0,1,3,4),['lph','eta','amm']);
  assert.deepEqual(view.getRect(1,2,3,99),['ta','mma']);
  assert.deepEqual(view.getRect(3,0,100,100),[]);
  assert.deepEqual(view.getRect(0,8,2,12),['','']);
  assert.throws(()=>view.getRect(-1,0,2,3),RangeError);
  assert.throws(()=>view.getRect(1,4,0,5),RangeError);
  assert.deepEqual(view.read(),[]);

  const events=[];
  const unsubscribe=view.subscribe(event=>events.push(event.type));
  assert.equal(view.selectionMode,'line');
  assert.equal(view.insertMode,'raw');
  view.selectionMode='rectangle';
  view.addSelection(point(0,1));
  view.addSelection(point(1,2));
  assert.deepEqual(view.getSelections(),[range(0,1,0,3),range(1,1,1,3)]);
  assert.deepEqual(view.read(),['lp','et']);

  // Switch without clearing the rectangle and draw two free-form carets.
  view.selectionMode='free-form';
  view.addSelection(point(2,1));
  view.addSelection(point(2,3));
  assert.deepEqual
  (
    view.getSelections(),
    [range(0,1,0,3),range(1,1,1,3),range(2,1,2,1),range(2,3,2,3)]
  );
  assert.deepEqual(view.read(),['lp','et','','']);
  view.remSelection(point(2,3));
  assert.equal(view.getSelections().length,3);

  view.setSelections([range(0,5,0,5)]);
  view.insert('!');
  assert.equal(source.toString(),'alpha!\r\nbeta\ngamma');
  assert.equal(view.colCount,6);
  assert.equal(view.getSelections()[0].start.col,6);
  assert.equal(view.getSelections()[0].end.col,6);
  assert.equal(events.filter(x=>x==='content').length,1);

  view.setSelections([range(0,0,0,0),range(1,0,1,0)]);
  view.insertMode='lines';
  view.insert('X\nY');
  assert.equal(source.toString(),'Xalpha!\r\nYbeta\ngamma');
  assert.equal(view.getSelections().length,2);
  assert.deepEqual(view.getRect(0,0,2,2),['Xa','Yb']);

  view.setSelections([range(2,0,2,0),range(2,1,2,1)]);
  view.insertMode='csv';
  const beforeCSV=source.toString();
  assert.throws(()=>view.insert('"missing end,c'),SyntaxError);
  assert.equal(source.toString(),beforeCSV,'failed CSV parsing cannot commit');
  view.insert('"a,b",c');
  assert.equal(source.toString(),'Xalpha!\r\nYbeta\na,bgcamma');
  view.insertMode='tsv';
  view.setSelections([range(0,0,0,0),range(1,0,1,0)]);
  view.insert('first\tsecond');
  assert.equal(source.toString(),'firstXalpha!\r\nsecondYbeta\na,bgcamma');
  assert.throws(()=>{view.insertMode='unknown';},RangeError);

  // Source edits through another consumer still publish and rebase.
  view.setSelections([range(1,1,1,1)]);
  const rev=source.revision;
  source.replace(0,0,'Z');
  assert.equal(source.revision,rev+1);
  assert.ok(events.filter(x=>x==='content').length>=5);
  assert.deepEqual(view.getSelections(),[range(1,1,1,1)]);

  unsubscribe();
  const count=events.length;
  view.setSelections([]);
  assert.equal(events.length,count);
  view.destroy();
  assert.doesNotThrow(()=>view.destroy());
  assert.throws(()=>view.getSelections(),Error);
  assert.doesNotThrow(()=>source.replace(0,0,'T'));
  assert.ok(source.toString().startsWith('TZ'));
}

// Virtual columns and rows are not materialized merely by selecting them.
{
  const source=new extracted.PieceDocument('ab');
  const view=new RawDocument2D(source);
  view.setSelections([range(0,5,0,5)]);
  const rev=source.revision;
  assert.deepEqual(view.read(),['']);
  assert.equal(source.revision,rev);
  view.insert('Q');
  assert.equal(source.toString(),'ab   Q');
  assert.equal(source.revision,rev+1);
  view.setSelections([range(2,2,2,2)]);
  view.insert('Z');
  assert.equal(source.toString(),'ab   Q\n\n  Z');
  assert.equal(view.rowCount,3);
  view.destroy();
}



// A versioned 2D batch is translated to physical offsets before a SINGLE
// Document commit. Its targets are independent of effective selections.
for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source = new Backend('a\r\nb\tc\nlast');
  const view = new RawDocument2D(source);
  const notifications = [];

  view.subscribe(event => notifications.push(event));
  assert.equal(view.revision, 0);

  const edits =
  [
    {start: point(0, 1), end: point(0, 1), text: '!'},
    {start: point(1, 1), end: point(1, 2), text: 'X'}
  ];

  assert.strictEqual(view.replace(edits, view.revision), view);
  assert.equal(source.toString(), 'a!\r\nbXc\nlast');
  assert.equal(source.revision, 1);
  assert.equal(view.revision, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'content');
  assert.deepEqual(notifications[0].invalidation, {all: true});

  const unchanged = source.toString();
  const revision = view.revision;

  assert.throws(() => view.replace(edits, 0), /stale/);
  assert.throws(() => view.replace(edits), TypeError);
  assert.throws(() => view.replace([], revision), RangeError);
  assert.throws
  (
    () => view.replace
    (
      [{start: point(0, 0), end: point(0, 1), text: 'Q'},
       {start: point(0, 0), end: point(0, 1), text: 'R'}],
      revision
    ),
    RangeError
  );
  assert.throws
  (
    () => view.replace
    (
      [{start: point(0, 8), end: point(0, 8), text: '?'}],
      revision
    ),
    RangeError
  );
  assert.throws
  (
    () => view.replace
    (
      [{start: point(9, 0), end: point(9, 0), text: '?'}],
      revision
    ),
    RangeError
  );

  assert.equal(source.toString(), unchanged, 'rejected 2D edits do not commit');
  assert.equal(source.revision, revision);
  assert.equal(notifications.length, 1);

  // A separate writer invalidates an old 2D coordinate snapshot.
  source.replace(0, 0, 'z');
  assert.equal(notifications.length, 2);
  assert.equal(view.revision, revision + 1);
  assert.throws(() => view.replace(edits, revision), /stale/);

  view.destroy();
}


// A raw region window exposes the true source-coordinate geometry and clips
// bounded UTF-16 reads without widening to whole Unicode graphemes.
for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('ab\r\n😀\tQ\n');
  const raw=new RawDocument2D(source);
  assert.equal(raw.getRowWidth(0),2);
  assert.equal(raw.getRowWidth(1),4);
  assert.equal(raw.getRowWidth(99),0);
  assert.deepEqual
  (
    raw.getRegions(0,1,3,3),
    [
      [{kind:'text',start:point(0,1),end:point(0,2),text:'b'}],
      [{kind:'text',start:point(1,1),end:point(1,3),text:'\uDE00\t'}],
      []
    ]
  );
  assert.throws(()=>raw.getRegions(0,-1,2,3),RangeError);
  assert.throws(()=>raw.getRowWidth(-1),RangeError);
  raw.destroy();
}

// Cell geometry is a composable Document2D, never an alternate selection owner.
// Ordinary text, a grapheme spanning multiple UTF-16 units, and a multi-cell
// TAB preserve their individual view/parent correspondences.
const CellDocument2D=extracted.CellDocument2D;
assert.equal(typeof CellDocument2D,'function');
assert.throws(()=>new CellDocument2D({}),TypeError);
{
  const source=new extracted.FlatDocument('x');
  const raw=new RawDocument2D(source);
  assert.throws(()=>new CellDocument2D(raw,0),RangeError);
  raw.destroy();
}

for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('A\tB\r\n😀e\u0301Q\nZ');
  const raw=new RawDocument2D(source);
  const cells=new CellDocument2D(raw);
  const nested=new CellDocument2D(cells);
  const events=[];

  cells.subscribe(event=>events.push(event));
  assert.equal(cells instanceof Document2D,true);
  assert.equal(cells.rowCount,3);
  assert.equal(cells.getRowWidth(0),5);
  assert.equal(cells.getRowWidth(1),3);
  assert.equal(cells.getRowWidth(2),1);
  assert.equal(cells.colCount,5);
  assert.equal(nested.getRowWidth(0),5);
  assert.deepEqual(cells.getRect(0,0,3,20),['A   B','😀e\u0301Q','Z']);
  assert.deepEqual(cells.getRect(0,2,1,3),[' ']);
  assert.deepEqual
  (
    cells.getRegions(0,2,1,3),
    [[{kind:'tab',text:'\t',start:point(0,1),end:point(0,4)}]]
  );
  assert.deepEqual
  (
    cells.getRegions(1,0,2,1),
    [[{kind:'text',text:'😀',start:point(1,0),end:point(1,1)}]]
  );

  // The returned regions are independent snapshots; mutating one must not
  // retarget a subsequent edit (the vulnerability observed in PoC 074).
  const published=cells.getRegions(0,4,1,5)[0][0];
  published.start.col=0;
  published.end.col=1;

  const initial=source.revision;
  assert.throws
  (
    ()=>cells.replace
    (
      [{start:point(0,2),end:point(0,3),text:'?'}],
      cells.revision
    ),
    /indivisible/
  );
  assert.equal(source.revision,initial);
  assert.equal(source.toString(),'A\tB\r\n😀e\u0301Q\nZ');

  cells.replace
  (
    [
      {start:point(0,4),end:point(0,5),text:'X'},
      {start:point(1,1),end:point(1,2),text:'é'}
    ],
    cells.revision
  );
  assert.equal(source.toString(),'A\tX\r\n😀éQ\nZ');
  assert.equal(source.revision,initial+1);
  assert.equal(cells.revision,1);
  assert.equal(nested.revision,1);
  assert.equal(events.filter(e=>e.type==='content').length,1);
  assert.deepEqual(events.find(e=>e.type==='content').invalidation,{all:true});
  assert.throws(()=>cells.replace
  (
    [{start:point(0,4),end:point(0,5),text:'Y'}],0
  ),/stale/);

  // Selection strategies operate in view cells, while Raw owns the single
  // effective physical collection and selected text transfers unchanged.
  cells.selectionMode='rectangle';
  cells.addSelection(point(0,4));
  cells.addSelection(point(1,1));
  assert.deepEqual(cells.getSelections(),[range(0,1,0,5),range(1,1,1,5)]);
  cells.setSelections([range(1,0,1,1)]);
  assert.deepEqual(cells.read(),['😀']);
  assert.deepEqual(raw.getSelections(),[range(1,0,1,2)]);

  // A second layer routes versioned edits through the first layer into one
  // physical transaction, including a zero-width insertion at a cell edge.
  const beforeNested=source.revision;
  nested.replace
  (
    [{start:point(0,4),end:point(0,4),text:'!'}],
    nested.revision
  );
  assert.equal(source.revision,beforeNested+1);
  assert.equal(source.toString(),'A\t!X\r\n😀éQ\nZ');

  // A direct physical edit also invalidates this view's old coordinates.
  const stale=cells.revision;
  source.replace(0,0,'z');
  assert.throws(()=>cells.replace
  (
    [{start:point(0,4),end:point(0,5),text:'Q'}],stale
  ),/stale/);

  nested.destroy();
  cells.destroy();
  raw.destroy();
  assert.doesNotThrow(()=>source.replace(0,0,'!'));
}

// A bounded viewport near the beginning of a very long row must not read
// or materialize the entire input row merely to form grapheme cells.
{
  class ObservedRaw extends RawDocument2D
  {
    largestWindow=0;
    getRegions(...args)
    {
      this.largestWindow=Math.max(this.largestWindow,args[3]-args[1]);
      return super.getRegions(...args);
    }
  }

  const source=new extracted.PieceDocument('a'.repeat(100000)+'X');
  const raw=new ObservedRaw(source);
  const cells=new CellDocument2D(raw);
  assert.deepEqual(cells.getRect(0,0,1,5),['aaaaa']);
  assert.ok(raw.largestWindow<=2048);
  cells.destroy();
  raw.destroy();
}

// The scanner must preserve a combining cluster spanning a 2048-unit
// boundary, not cut or invent an editable grapheme boundary.
{
  const source=new extracted.PieceDocument('a'.repeat(2047)+'e\u0301B');
  const raw=new RawDocument2D(source);
  const cells=new CellDocument2D(raw);
  assert.deepEqual
  (
    cells.getRegions(0,2047,1,2048),
    [[{kind:'text',text:'e\u0301',start:point(0,2047),end:point(0,2048)}]]
  );
  assert.throws(()=>cells.replace
  (
    [{start:point(0,2047),end:point(0,2048),text:'E'}],
    cells.revision+1
  ),/stale/);
  cells.destroy();
  raw.destroy();
}

console.log('m.text.document extraction parity PASS '+verified+' committed edit comparisons');
