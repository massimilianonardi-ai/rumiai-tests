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
  assert.deepEqual(Object.keys(extracted).sort(),['AnnotationDocument2D','CellDocument2D','Document','Document2D','FlatDocument','FoldDocument2D','PieceDocument','RawDocument2D']);
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
  assert.deepEqual(cells.getSelections(),[range(0,1,0,5,false),range(1,1,1,5,false)]);
  cells.setSelections([range(1,0,1,1)]);
  assert.deepEqual(cells.read(),['😀']);
  assert.deepEqual(raw.getSelections(),[range(1,0,1,2)]);

  // A physical writer can place a caret inside a surrogate pair. Copying
  // or editing through this logical view must refuse that invalid anchor.
  raw.setSelections([range(1,1,1,1)]);
  const invalidAnchorRevision=source.revision;
  assert.throws(()=>cells.getSelections(),/indivisible/);
  assert.throws(()=>cells.read(),/indivisible/);
  assert.throws(()=>cells.insert('!'),/indivisible/);
  assert.equal(source.revision,invalidAnchorRevision);
  cells.setSelections([range(1,0,1,1)]);

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


// Folded whole rows remain visible as protected synthetic regions. All
// selected text and commits stay in the underlying raw document.
const FoldDocument2D=extracted.FoldDocument2D;
assert.equal(typeof FoldDocument2D,'function');
assert.throws(()=>new FoldDocument2D({}),TypeError);

for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('head\r\nsecret1\nsecret2\n\tB\ntail');
  const raw=new RawDocument2D(source);
  const fold=new FoldDocument2D(raw);
  const cells=new CellDocument2D(fold);
  const events=[];
  fold.subscribe(event=>events.push(event));

  assert.equal(fold instanceof Document2D,true);
  assert.equal(fold.rowCount,5);
  assert.deepEqual(fold.getRect(0,0,6,20),
    ['head','secret1','secret2','\tB','tail']);
  assert.strictEqual(fold.setFolds([{startRow:1,endRow:3}]),fold);
  assert.deepEqual(fold.folds,[{startRow:1,endRow:3}]);
  assert.equal(fold.revision,1);
  assert.equal(fold.rowCount,4);
  assert.equal(fold.colCount,4);
  assert.equal(fold.getRowWidth(1),1);
  assert.equal(fold.getRowWidth(3),4);
  assert.equal(fold.getRowWidth(20),0);
  assert.deepEqual(fold.getRect(0,0,4,10),['head','…','\tB','tail']);
  assert.deepEqual(fold.getRect(1,1,2,2),['']);
  assert.deepEqual(fold.getRect(1,0,2,1),['…']);
  assert.deepEqual(fold.getRegions(1,0,2,1),
    [[{kind:'fold',text:'…',start:point(1,0),end:point(1,1)}]]);
  assert.deepEqual(fold.getRegions(1,1,2,2),[[]]);
  assert.deepEqual(cells.getRect(0,0,4,10),['head','…','    B','tail']);
  assert.equal(cells.getRegions(1,0,2,1)[0][0].kind,'fold');
  assert.throws(()=>fold.getRect(-1,0,1,2),RangeError);
  assert.throws(()=>fold.getRegions(1,2,0,3),RangeError);
  assert.throws(()=>fold.getRowWidth(-1),RangeError);
  assert.equal(events.filter(x=>x.type==='content').length,1);
  assert.deepEqual(events[0].invalidation,{all:true});

  const foldRecord=fold.folds[0];
  foldRecord.startRow=0;
  const region=fold.getRegions(1,0,2,1)[0][0];
  region.start.row=99;
  assert.deepEqual(fold.folds,[{startRow:1,endRow:3}]);
  assert.deepEqual(fold.getRegions(1,0,2,1),
    [[{kind:'fold',text:'…',start:point(1,0),end:point(1,1)}]]);

  const before=source.toString(), beforeRevision=source.revision;
  assert.throws(()=>fold.replace
  (
    [{start:point(1,0),end:point(1,1),text:'X'}],
    fold.revision
  ),/fold marker/);
  assert.throws(()=>fold.replace
  (
    [{start:point(0,4),end:point(2,0),text:'X'}],
    fold.revision
  ),/crosses folded/);
  assert.throws(()=>fold.replace
  (
    [
      {start:point(2,1),end:point(2,2),text:'C'},
      {start:point(1,0),end:point(1,1),text:'X'}
    ],
    fold.revision
  ),/fold marker/);
  assert.throws(()=>cells.replace
  (
    [{start:point(1,0),end:point(1,1),text:'X'}],
    cells.revision
  ),/fold marker/);
  assert.throws(()=>fold.setSelections([range(1,0,1,1)]),/fold marker/);
  assert.throws(()=>fold.setSelections([range(0,0,2,1)]),/crosses folded/);
  assert.equal(source.toString(),before);
  assert.equal(source.revision,beforeRevision);

  fold.setSelections([range(2,1,2,2)]);
  assert.deepEqual(fold.getSelections(),[range(2,1,2,2)]);
  assert.deepEqual(raw.getSelections(),[range(3,1,3,2)]);
  assert.deepEqual(fold.read(),['B']);
  assert.deepEqual(cells.read(),['B']);

  // Selecting hidden content from another view must not let read/insert
  // silently copy or mutate it through this folded view.
  raw.setSelections([range(1,0,1,2)]);
  assert.throws(()=>fold.getSelections(),/folded source/);
  assert.throws(()=>fold.read(),/folded source/);
  assert.throws(()=>fold.insert('!'),/folded source/);
  assert.equal(source.toString(),before);
  raw.setSelections([range(0,1,4,1)]);
  assert.throws(()=>fold.read(),/crosses folded/);
  assert.throws(()=>fold.insert('!'),/crosses folded/);
  assert.equal(source.toString(),before);

  // The whole batch is projected first, then committed exactly once.
  fold.setSelections([range(2,1,2,2)]);
  const oldViewRevision=fold.revision;
  fold.replace
  (
    [
      {start:point(0,0),end:point(0,1),text:'H'},
      {start:point(2,1),end:point(2,2),text:'X'}
    ],
    oldViewRevision
  );
  assert.equal(source.toString(),'Head\r\nsecret1\nsecret2\n\tX\ntail');
  assert.equal(source.revision,beforeRevision+1);
  assert.equal(fold.revision,oldViewRevision+1);
  assert.deepEqual(fold.folds,[],'source commit invalidates row-indexed folds');
  assert.equal(fold.rowCount,5);
  assert.equal(cells.rowCount,5);
  assert.equal(events.filter(x=>x.type==='content').length,2);
  assert.throws(()=>fold.replace
  (
    [{start:point(2,1),end:point(2,2),text:'!'}],oldViewRevision
  ),/stale/);

  fold.setFolds([{startRow:1,endRow:4}]);
  assert.equal(fold.rowCount,3);
  const revisionBeforeExternal=fold.revision;
  source.replace(0,0,'!');
  assert.equal(fold.revision,revisionBeforeExternal+1);
  assert.deepEqual(fold.folds,[]);
  assert.equal(fold.rowCount,5);

  assert.strictEqual(fold.setFolds([]),fold);
  assert.throws(()=>fold.setFolds([{startRow:2,endRow:2}]),RangeError);
  assert.throws(()=>fold.setFolds([{startRow:0,endRow:99}]),RangeError);
  assert.throws
  (
    ()=>fold.setFolds([{startRow:1,endRow:3},{startRow:2,endRow:4}]),
    /overlapping/
  );

  cells.destroy();
  fold.destroy();
  assert.doesNotThrow(()=>fold.destroy());
  assert.throws(()=>fold.getSelections(),/destroyed/);
  assert.doesNotThrow(()=>raw.getSelections());
  raw.destroy();
}

// Several disjoint folds must map visible rows without materializing hidden
// source data; a second cell projection can be placed below or above them.
{
  const source=new extracted.PieceDocument('one\nA\nB\ntwo\nC\nD\nthree');
  const raw=new RawDocument2D(source);
  const cells=new CellDocument2D(raw);
  const fold=new FoldDocument2D(cells);

  fold.setFolds
  (
    [{startRow:4,endRow:6},{startRow:1,endRow:3}]
  );
  assert.deepEqual(fold.folds,
    [{startRow:1,endRow:3},{startRow:4,endRow:6}]);
  assert.deepEqual(fold.getRect(0,0,5,10),
    ['one','…','two','…','three']);
  assert.equal(fold.rowCount,5);
  assert.equal(fold.colCount,5);
  assert.deepEqual(fold.getRegions(4,0,5,3),
    [[
      {kind:'text',text:'t',start:point(4,0),end:point(4,1)},
      {kind:'text',text:'h',start:point(4,1),end:point(4,2)},
      {kind:'text',text:'r',start:point(4,2),end:point(4,3)}
    ]]);
  assert.deepEqual(fold.getRegions(5,0,7,4),[]);
  assert.throws(()=>fold.setSelections([range(0,0,4,1)]),/crosses folded/);

  // A selection in an unaffected row maps through both view layers.
  fold.setSelections([range(4,0,4,5)]);
  assert.deepEqual(raw.getSelections(),[range(6,0,6,5)]);
  assert.deepEqual(fold.read(),['three']);

  fold.destroy();
  cells.destroy();
  raw.destroy();
}



// Additive annotations are zero-width structured regions, not text cells.
// The input retains exclusive ownership of selections and edit transactions.
const AnnotationDocument2D=extracted.AnnotationDocument2D;
assert.equal(typeof AnnotationDocument2D,'function');
assert.throws(()=>new AnnotationDocument2D({}),TypeError);

for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('A\tB\r\n😀e\u0301Q\n');
  const raw=new RawDocument2D(source);
  const cells=new CellDocument2D(raw);
  const notes=new AnnotationDocument2D(cells);
  const events=[];
  notes.subscribe(event=>events.push(event));

  assert.equal(notes instanceof Document2D,true);
  assert.equal(notes.rowCount,3);
  assert.equal(notes.getRowWidth(0),5);
  assert.equal(notes.colCount,5);
  assert.deepEqual(notes.getRect(0,0,3,20),
    ['A   B','😀e\u0301Q','']);

  const revision=notes.revision;
  const selected=[
    {id:'B',at:point(0,4),text:'tooltip B'},
    {id:'empty',at:point(2,0),text:'end-of-file'},
    {id:'tab',at:point(0,1),text:'before tab'}
  ];
  assert.strictEqual(notes.setAnnotations(selected),notes);
  assert.equal(notes.revision,revision+1);
  assert.equal(source.revision,0,'view-local notes do not edit text');
  assert.deepEqual(notes.annotations,
    [selected[2],selected[0],selected[1]]);
  assert.deepEqual(notes.getRect(0,0,3,20),
    ['A   B','😀e\u0301Q','']);
  assert.deepEqual
  (
    notes.getRegions(0,4,1,5),
    [[
      {kind:'annotation',id:'B',text:'tooltip B',
        start:point(0,4),end:point(0,4)},
      {kind:'text',text:'B',start:point(0,4),end:point(0,5)}
    ]]
  );
  assert.deepEqual
  (
    notes.getRegions(2,0,3,1),
    [[{kind:'annotation',id:'empty',text:'end-of-file',
      start:point(2,0),end:point(2,0)}]]
  );

  // Published regions and configuration entries must never be writable
  // references into either the mapping or the stored annotations.
  const exposed=notes.getRegions(0,4,1,5)[0][0];
  exposed.start.col=0;
  exposed.end.col=2;
  exposed.id='corrupt';
  const descriptor=notes.annotations[0];
  descriptor.at.col=99;
  selected[0].at.col=0;
  assert.equal(notes.annotations[1].at.col,4);
  assert.equal(notes.getRegions(0,4,1,5)[0][0].id,'B');

  const unchanged=notes.revision;
  notes.setAnnotations(notes.annotations);
  assert.equal(notes.revision,unchanged,'identical annotation set is a no-op');
  assert.throws(()=>notes.setAnnotations([{id:'X',text:'a',at:point(0,2)}]),
    /indivisible/);
  assert.throws(()=>notes.setAnnotations(
    [{id:'x',text:'a',at:point(0,1)},{id:'x',text:'b',at:point(0,4)}]),
    /duplicate/);
  assert.throws(()=>notes.setAnnotations(
    [{id:'bad',text:'hi',at:point(3,0)}]),RangeError);
  assert.equal(notes.revision,unchanged);
  assert.equal(source.revision,0);
  assert.deepEqual(notes.getRegions(0,0,1,1)[0]
    .filter(r=>r.kind==='annotation').map(r=>r.id),[]);

  // Source selected transfer cannot include annotation labels.
  notes.setSelections([range(0,4,0,5)]);
  assert.deepEqual(notes.read(),['B']);
  assert.deepEqual(raw.getSelections(),[range(0,2,0,3)]);

  const before=source.toString();
  assert.throws(()=>notes.replace(
    [{start:point(0,2),end:point(0,3),text:'?'}],notes.revision
  ),/indivisible/);
  assert.equal(source.toString(),before);
  assert.throws(()=>notes.replace(
    [{start:point(0,4),end:point(0,5),text:'!'}],revision
  ),/stale/);

  const textRevision=source.revision;
  notes.replace
  (
    [{start:point(0,4),end:point(0,5),text:'X'}],
    notes.revision
  );
  assert.equal(source.toString(),'A\tX\r\n😀e\u0301Q\n');
  assert.equal(source.revision,textRevision+1);
  assert.deepEqual(notes.annotations,[]);
  const contentEvents=events.filter(e=>e.type==='content');
  assert.equal(contentEvents.length,2);
  assert.deepEqual(contentEvents[0].invalidation,{all:true});
  assert.deepEqual(contentEvents[1].invalidation,{all:true});

  notes.setAnnotations([{id:'new',text:'new',at:point(0,4)}]);
  const oldVersion=notes.revision;
  source.replace(0,0,'z');
  assert.equal(notes.revision,oldVersion+1);
  assert.deepEqual(notes.annotations,[]);
  assert.throws(()=>notes.replace(
    [{start:point(0,4),end:point(0,5),text:'Z'}],oldVersion
  ),/stale/);

  notes.destroy();
  assert.doesNotThrow(()=>notes.destroy());
  assert.throws(()=>notes.getSelections(),/destroyed/);
  assert.doesNotThrow(()=>cells.getSelections());
  cells.destroy();
  raw.destroy();
}

// Annotations can also sit BELOW CellDocument2D: token/byte offsets
// are converted to displayed cell boundaries; the note remains zero-width.
{
  const source=new extracted.PieceDocument('A\tB\n😀x\n');
  const raw=new RawDocument2D(source);
  const annotations=new AnnotationDocument2D(raw);
  const cells=new CellDocument2D(annotations);
  const fold=new FoldDocument2D(cells);

  annotations.setAnnotations
  (
    [
      {id:'before',text:'start',at:point(0,1)},
      {id:'after',text:'end',at:point(0,2)},
      {id:'eol',text:'empty-row',at:point(2,0)}
    ]
  );

  assert.deepEqual(cells.getRect(0,0,3,20),['A   B','😀x','']);
  assert.deepEqual
  (
    cells.getRegions(0,0,1,10)[0]
      .filter(region=>region.kind==='annotation')
      .map(region=>[region.id,region.start.col,region.end.col]),
    [['before',1,1],['after',4,4]]
  );
  assert.deepEqual
  (
    cells.getRegions(2,0,3,1)[0]
      .filter(region=>region.kind==='annotation')
      .map(region=>[region.id,region.start.col]),
    [['eol',0]]
  );

  // Folding passes visible annotation IDs but does not read hidden rows.
  fold.setFolds([{startRow:1,endRow:2}]);
  assert.deepEqual(fold.getRegions(0,0,1,10)[0]
    .filter(r=>r.kind==='annotation').map(r=>r.id),
    ['before','after']);
  assert.deepEqual(fold.getRegions(1,0,2,2),
    [[{kind:'fold',text:'…',start:point(1,0),end:point(1,1)}]]);
  assert.deepEqual(fold.getRect(0,0,3,20),['A   B','…','']);

  // Multiple layers can be composed without copy/edit of metadata.
  fold.replace
  (
    [{start:point(0,4),end:point(0,5),text:'Q'}],
    fold.revision
  );
  assert.equal(source.toString(),'A\tQ\n😀x\n');
  assert.equal(source.revision,1);
  assert.deepEqual(annotations.annotations,[]);
  assert.deepEqual(fold.folds,[]);

  fold.destroy();
  cells.destroy();
  annotations.destroy();
  raw.destroy();
}

// Reject annotation endpoints on a source-less fold row; an input-owned
// selection or edit can never target a note as if it occupied source text.
{
  const source=new extracted.PieceDocument('one\ntwo\nthree');
  const raw=new RawDocument2D(source);
  const fold=new FoldDocument2D(raw);
  fold.setFolds([{startRow:1,endRow:2}]);
  const notes=new AnnotationDocument2D(fold);
  assert.throws(()=>notes.setAnnotations(
    [{id:'bad',text:'no',at:point(1,0)}]),/source-less/);
  notes.setAnnotations([{id:'good',text:'yes',at:point(0,1)}]);
  assert.deepEqual(notes.getRegions(0,0,1,4)[0]
    .filter(r=>r.kind==='annotation').map(r=>r.id),['good']);
  assert.equal(source.toString(),'one\ntwo\nthree');
  notes.destroy();
  fold.destroy();
  raw.destroy();
}

// A note at a raw UTF-16 boundary may lie inside a logical grapheme.
// CellDocument2D must fail rather than misrepresent its view coordinate.
{
  const source=new extracted.PieceDocument('😀X');
  const raw=new RawDocument2D(source);
  const notes=new AnnotationDocument2D(raw);
  const cells=new CellDocument2D(notes);
  notes.setAnnotations([{id:'split',text:'bad',at:point(0,1)}]);
  assert.throws(()=>cells.getRegions(0,0,1,4),
    /annotation anchor splits an indivisible grapheme/);
  assert.equal(source.toString(),'😀X');
  cells.destroy();
  notes.destroy();
  raw.destroy();
}

// Bounded reads of a long physical line must not expand the complete
// source text merely because a separate region carries an annotation.
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

  const source=new extracted.PieceDocument('a'.repeat(100000)+'Z');
  const raw=new ObservedRaw(source);
  const notes=new AnnotationDocument2D(raw);
  const cells=new CellDocument2D(notes);
  notes.setAnnotations([{id:'first',text:'tip',at:point(0,1)}]);
  assert.deepEqual(cells.getRect(0,0,1,5),['aaaaa']);
  assert.deepEqual(cells.getRegions(0,0,1,5)[0]
    .filter(r=>r.kind==='annotation').map(r=>r.id),['first']);
  assert.ok(raw.largestWindow<=2048);
  cells.destroy();
  notes.destroy();
  raw.destroy();
}


console.log('m.text.document extraction parity PASS '+verified+' committed edit comparisons');
