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
  assert.deepEqual(Object.keys(extracted).sort(),['AnnotationDocument2D','CellDocument2D','Document','Document2D','FlatDocument','FoldDocument2D','PieceDocument','RawDocument2D','SubstitutionDocument2D']);
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



// Dense overlays may share one zero-width anchor without altering layout.
// An overlay at the 2048-unit chunk boundary must map to the same cell
// even when the grapheme scanner carries trailing input across chunks.
{
  const source=new extracted.PieceDocument('a'.repeat(2048)+'B');
  const raw=new RawDocument2D(source);
  const notes=new AnnotationDocument2D(raw);
  const cells=new CellDocument2D(notes);
  const entries=Array.from({length:128},(_,i)=>
    ({id:'n'+String(i).padStart(3,'0'),text:'tip',at:point(0,0)}));
  entries.push({id:'boundary',text:'chunk',at:point(0,2048)});
  notes.setAnnotations(entries);
  const start=cells.getRegions(0,0,1,1)[0];
  assert.equal(start.filter(x=>x.kind==='annotation').length,128);
  assert.equal(start[0].id,'n000');
  assert.equal(start[127].id,'n127');
  assert.deepEqual(cells.getRegions(0,2048,1,2049)[0]
    .filter(x=>x.kind==='annotation').map(x=>[x.id,x.start.col]),
    [['boundary',2048]]);
  assert.deepEqual(cells.getRect(0,2047,1,2049),['aB']);
  assert.equal(cells.getRowWidth(0),2049);
  assert.equal(source.revision,0);
  cells.destroy();
  notes.destroy();
  raw.destroy();
}



// An inline fold joins a visible prefix and suffix from different input
// rows without materializing the hidden rows or changing their contents.
// A protected marker separates two independently editable source fragments.
for(const Backend of [extracted.FlatDocument, extracted.PieceDocument])
{
  const source = new Backend('AAxx\r\nsecret\nzzBB\nlast');
  const raw = new RawDocument2D(source);
  const view = new FoldDocument2D(raw);
  const cells = new CellDocument2D(view);
  const pointA = point(0, 2), pointB = point(2, 2);
  const config = {start:pointA, end:pointB};
  const notices = [];

  view.subscribe(event => notices.push(event));
  assert.strictEqual(view.setInlineFold(config), view);
  assert.deepEqual(view.inlineFold,config);
  assert.deepEqual(view.folds,[]);
  assert.equal(view.rowCount,2);
  assert.equal(view.getRowWidth(0),5);
  assert.equal(view.colCount,5);
  assert.deepEqual(view.getRect(0,0,2,10),['AA…BB','last']);
  assert.deepEqual(view.getRect(0,1,1,2),['A']);
  assert.deepEqual(view.getRect(0,2,1,3),['…']);
  assert.deepEqual(view.getRect(0,3,1,5),['BB']);
  assert.deepEqual(view.getRect(0,5,1,10),['']);
  assert.deepEqual(view.getRegions(0,2,1,4),
    [[
      {kind:'fold',text:'…',start:point(0,2),end:point(0,3)},
      {kind:'text',text:'B',start:point(0,3),end:point(0,4)}
    ]]);
  assert.deepEqual(cells.getRect(0,0,2,10),['AA…BB','last']);
  assert.deepEqual(cells.getRegions(0,2,1,3),
    [[{kind:'fold',text:'…',start:point(0,2),end:point(0,3)}]]);
  assert.equal(notices.filter(e=>e.type==='content').length,1);
  assert.deepEqual(notices[0].invalidation,{all:true});

  // Published configuration, regions and original input must be isolated.
  config.start.col=0;
  const exposed=view.inlineFold;
  exposed.end.row=0;
  const shown=view.getRegions(0,2,1,3)[0][0];
  shown.start.col=0;
  assert.deepEqual(view.inlineFold,
    {start:point(0,2),end:point(2,2)});
  assert.equal(view.getRegions(0,2,1,3)[0][0].start.col,2);
  const sameVersion=view.revision;
  view.setInlineFold(view.inlineFold);
  assert.equal(view.revision,sameVersion);

  const unchanged=source.toString();
  const changes=[
    [{start:point(0,2),end:point(0,3),text:'X'}],
    [{start:point(0,1),end:point(0,4),text:'X'}],
    [{start:point(0,0),end:point(1,0),text:'X'}]
  ];
  for(const edits of changes)
  {
    assert.throws(()=>view.replace(edits,view.revision),
      /crosses inline folded/);
    assert.throws(()=>cells.replace(edits,cells.revision),
      /crosses inline folded/);
  }
  assert.equal(source.toString(),unchanged);
  assert.equal(source.revision,0);

  assert.throws(()=>view.setSelections([range(0,1,0,4)]),
    /crosses inline folded/);
  assert.throws(()=>view.setSelections([range(0,0,1,1)]),
    /crosses inline folded/);
  raw.setSelections([range(1,0,1,1)]);
  assert.throws(()=>view.getSelections(),/crosses inline folded source/);
  assert.throws(()=>view.read(),/crosses inline folded source/);
  assert.throws(()=>view.insert('X'),/crosses inline folded source/);
  assert.equal(source.toString(),unchanged);

  // Both editable segments round-trip through the single physical
  // selection owner, including a caret immediately next to the fold.
  view.setSelections([range(0,3,0,5)]);
  assert.deepEqual(raw.getSelections(),[range(2,2,2,4)]);
  assert.deepEqual(view.read(),['BB']);
  assert.deepEqual(view.getSelections(),[range(0,3,0,5)]);
  view.setSelections([range(0,0,0,2)]);
  assert.deepEqual(raw.getSelections(),[range(0,0,0,2)]);
  assert.deepEqual(view.read(),['AA']);
  view.setSelections([range(0,2,0,2)]);
  assert.deepEqual(raw.getSelections(),[range(0,2,0,2)]);

  // All accepted changes are mapped before exactly one physical commit.
  view.replace
  (
    [
      {start:point(0,0),end:point(0,1),text:'a'},
      {start:point(0,3),end:point(0,4),text:'b'}
    ],
    view.revision
  );
  assert.equal(source.toString(),'aAxx\r\nsecret\nzzbB\nlast');
  assert.equal(source.revision,1);
  assert.equal(view.inlineFold,null);
  assert.equal(view.rowCount,4);
  assert.equal(cells.rowCount,4);
  assert.throws(()=>view.replace
  (
    [{start:point(0,3),end:point(0,4),text:'C'}],
    sameVersion
  ),/stale/);

  view.setInlineFold({start:point(0,1),end:point(2,2)});
  const staleAfterExternal=view.revision;
  source.replace(0,0,'!');
  assert.equal(view.inlineFold,null);
  assert.equal(view.revision,staleAfterExternal+1);
  assert.throws(()=>view.replace
  (
    [{start:point(0,0),end:point(0,1),text:'?'}],
    staleAfterExternal
  ),/stale/);
  assert.equal(notices.filter(e=>e.type==='content').length,4);

  // Inline and whole-row modes are mutually exclusive in one view.
  view.setInlineFold({start:point(0,1),end:point(2,2)});
  view.setFolds([{startRow:1,endRow:3}]);
  assert.equal(view.inlineFold,null);
  assert.deepEqual(view.folds,[{startRow:1,endRow:3}]);
  view.setInlineFold({start:point(0,1),end:point(2,2)});
  assert.deepEqual(view.folds,[]);
  view.setInlineFold(null);
  assert.equal(view.inlineFold,null);

  assert.throws(()=>view.setInlineFold(
    {start:point(2,1),end:point(2,2)}),RangeError);
  assert.throws(()=>view.setInlineFold(
    {start:point(0,100),end:point(2,2)}),RangeError);
  assert.throws(()=>view.setInlineFold(
    {start:point(0,1),end:point(99,1)}),RangeError);
  assert.equal(view.inlineFold,null);

  cells.destroy();
  view.destroy();
  raw.destroy();
}

// The suffix's TAB geometry depends on which layer owns cell expansion.
// Both orders must remain coherent without editing the folded token.
{
  const source=new extracted.PieceDocument('Axxx\nhidden\n\tB\nend');
  const raw=new RawDocument2D(source);
  const inline=new FoldDocument2D(raw);
  const cellAbove=new CellDocument2D(inline);
  inline.setInlineFold({start:point(0,1),end:point(2,0)});
  assert.deepEqual(inline.getRect(0,0,2,20),['A…\tB','end']);
  assert.deepEqual(cellAbove.getRect(0,0,2,20),['A…  B','end']);

  const cellBelow=new CellDocument2D(raw);
  const foldedCell=new FoldDocument2D(cellBelow);
  foldedCell.setInlineFold({start:point(0,1),end:point(2,0)});
  assert.deepEqual(foldedCell.getRect(0,0,2,20),['A…    B','end']);
  assert.equal(foldedCell.getRowWidth(0),7);
  assert.throws(()=>foldedCell.setInlineFold(
    {start:point(0,1),end:point(2,2)}),/indivisible/);
  assert.equal(source.revision,0);

  cellAbove.destroy();
  inline.destroy();
  foldedCell.destroy();
  cellBelow.destroy();
  raw.destroy();
}

// Zero-width annotations on visible prefix/suffix fragments survive the
// row splice; annotations inside the hidden rows are absent.
{
  const source=new extracted.PieceDocument('abcd\nhidden\nxyzQ');
  const raw=new RawDocument2D(source);
  const notes=new AnnotationDocument2D(raw);
  const view=new FoldDocument2D(notes);
  notes.setAnnotations
  (
    [
      {id:'prefix',text:'P',at:point(0,1)},
      {id:'prefixCut',text:'C',at:point(0,2)},
      {id:'hidden',text:'H',at:point(1,1)},
      {id:'suffixCut',text:'C',at:point(2,2)},
      {id:'suffix',text:'S',at:point(2,3)}
    ]
  );
  view.setInlineFold({start:point(0,2),end:point(2,2)});
  const visible=view.getRegions(0,0,1,10);
  assert.deepEqual(visible[0].filter(x=>x.kind==='annotation')
    .map(x=>[x.id,x.start.col]),
    [['prefix',1],['prefixCut',2],['suffixCut',3],['suffix',4]]);
  assert.equal(view.getRect(0,0,1,10)[0],'ab…zQ');
  view.destroy();
  notes.destroy();
  raw.destroy();
}

// A joined view requests just the two visible fragments, never the
// hidden source rows, even when they contain very long text.
{
  class ObservedRaw extends RawDocument2D
  {
    rowsRead=[];
    getRegions(...args)
    {
      this.rowsRead.push(args[0]);
      return super.getRegions(...args);
    }
  }

  const source=new extracted.PieceDocument(
    'prefix\n'+'x'.repeat(100000)+'\nsuffix');
  const raw=new ObservedRaw(source);
  const view=new FoldDocument2D(raw);
  view.setInlineFold({start:point(0,3),end:point(2,3)});
  raw.rowsRead=[];
  assert.deepEqual(view.getRect(0,0,1,12),['pre…fix']);
  view.getRegions(0,0,1,12);
  assert.ok(raw.rowsRead.every(row=>row===0||row===2));
  view.destroy();
  raw.destroy();
}



// Multiple region correspondences can be composed without exposing source
// coordinates to a consumer or allocating a second effective selection set.
// The two inline folds conceal separate input intervals and reproject
// four annotations through two independent row/column transforms.
for(const Backend of [extracted.FlatDocument, extracted.PieceDocument])
{
  const source = new Backend('aaXX\nH1\nzzbb\nM\nccYY\nH2\nwwdd\nlast');
  const raw = new RawDocument2D(source);
  const notes = new AnnotationDocument2D(raw);
  notes.setAnnotations
  (
    [
      {id:'prefix1',text:'P1',at:point(0,1)},
      {id:'hidden1',text:'H1',at:point(1,0)},
      {id:'suffix1',text:'S1',at:point(2,3)},
      {id:'prefix2',text:'P2',at:point(4,1)},
      {id:'hidden2',text:'H2',at:point(5,0)},
      {id:'suffix2',text:'S2',at:point(6,3)}
    ]
  );

  const first = new FoldDocument2D(notes);
  first.setInlineFold({start:point(0,2),end:point(2,2)});
  const second = new FoldDocument2D(first);
  second.setInlineFold({start:point(2,2),end:point(4,2)});
  const cells = new CellDocument2D(second);
  const before = source.toString();
  const events = [];
  cells.subscribe(event => events.push(event));

  assert.equal(first.rowCount,6);
  assert.equal(second.rowCount,4);
  assert.deepEqual
  (
    cells.getRect(0,0,4,20),
    ['aa…bb','M','cc…dd','last']
  );
  assert.deepEqual
  (
    cells.getRegions(0,0,4,20)
      .map(regions => regions
        .filter(region => region.kind === 'annotation')
        .map(region => [region.id,region.start.row,region.start.col])),
    [
      [['prefix1',0,1],['suffix1',0,4]],
      [],
      [['prefix2',2,1],['suffix2',2,4]],
      []
    ]
  );
  assert.deepEqual
  (
    cells.getRegions(0,2,1,3),
    [[{kind:'fold',text:'…',start:point(0,2),end:point(0,3)}]]
  );
  assert.deepEqual
  (
    cells.getRegions(2,2,3,3),
    [[{kind:'fold',text:'…',start:point(2,2),end:point(2,3)}]]
  );

  // A disjoint visible selection maps all the way back to physical row 6.
  cells.setSelections([range(2,3,2,5)]);
  assert.deepEqual(raw.getSelections(),[range(6,2,6,4)]);
  assert.deepEqual(cells.getSelections(),[range(2,3,2,5)]);
  assert.deepEqual(cells.read(),['dd']);

  // The left and right marker boundaries are intentionally NOT the same
  // physical point; no whole source interval can be collapsed by equality.
  cells.setSelections([range(0,2,0,2)]);
  assert.deepEqual(raw.getSelections(),[range(0,2,0,2)]);
  cells.setSelections([range(0,3,0,3)]);
  assert.deepEqual(raw.getSelections(),[range(2,2,2,2)]);

  for(const rangeEdit of [
    {start:point(0,2),end:point(0,3),text:'X'},
    {start:point(2,1),end:point(2,4),text:'X'},
    {start:point(0,1),end:point(2,1),text:'X'}
  ])
  {
    assert.throws
    (
      () => cells.replace([rangeEdit],cells.revision),
      /folded/
    );
  }
  assert.equal(source.toString(),before);
  assert.equal(source.revision,0);

  // Every layer translates the complete batch before the input's one
  // physical commit, while all virtual configurations become invalid.
  const stale=cells.revision;
  cells.replace
  (
    [
      {start:point(0,0),end:point(0,1),text:'A'},
      {start:point(2,3),end:point(2,4),text:'D'}
    ],
    stale
  );
  assert.equal(source.revision,1);
  assert.equal(source.toString(),
    'AaXX\nH1\nzzbb\nM\nccYY\nH2\nwwDd\nlast');
  assert.equal(first.inlineFold,null);
  assert.equal(second.inlineFold,null);
  assert.deepEqual(notes.annotations,[]);
  assert.equal(cells.rowCount,8);
  assert.equal(events.filter(event => event.type === 'content').length,1);
  assert.deepEqual(events.find(event => event.type === 'content')
    .invalidation,{all:true});
  assert.throws
  (
    () => cells.replace
    (
      [{start:point(0,0),end:point(0,1),text:'Q'}],
      stale
    ),
    /stale/
  );

  cells.destroy();
  second.destroy();
  first.destroy();
  notes.destroy();
  raw.destroy();
}

// The mapping must not silently choose one of two source-side insertion
// anchors around an inline-fold marker. Both explicit points remain
// independently addressable, although the marker itself is protected.
{
  const source=new extracted.PieceDocument('ab\nhidden\ncd');
  const raw=new RawDocument2D(source);
  const view=new FoldDocument2D(raw);
  view.setInlineFold({start:point(0,1),end:point(2,1)});
  assert.deepEqual(view.getRect(0,0,1,10),['a…d']);
  assert.throws
  (
    () => view.replace
    (
      [{start:point(0,1),end:point(0,3),text:'bad'}],
      view.revision
    ),
    /folded/
  );
  view.replace
  (
    [
      {start:point(0,1),end:point(0,1),text:'L'},
      {start:point(0,2),end:point(0,2),text:'R'}
    ],
    view.revision
  );
  assert.equal(source.toString(),'aLb\nhidden\ncRd');
  assert.equal(source.revision,1);
  assert.equal(view.inlineFold,null);
  view.destroy();
  raw.destroy();
}



// All composed views share the same revision-checked one-commit mapping
// boundary. A user-provided edit getter can mutate the source while the
// batch is being constructed: that must invalidate the whole batch.
for(const Backend of [extracted.FlatDocument, extracted.PieceDocument])
{
  const source=new Backend('abc\nxyz');
  const raw=new RawDocument2D(source);
  const cell=new CellDocument2D(raw);
  const fold=new FoldDocument2D(cell);
  const notes=new AnnotationDocument2D(fold);

  for(const view of [cell,fold,notes])
  {
    const priorRevision=view.revision;
    const physicalRevision=source.revision;
    const edit=
    {
      start:point(0,0),
      end:point(0,1),
      get text()
      {
        source.replace(0,0,'Z');
        return 'Q';
      }
    };

    assert.throws(()=>view.replace([edit],priorRevision),/stale/);
    assert.equal(source.revision,physicalRevision+1);
    assert.equal(source.toString().includes('Q'),false);
    assert.notEqual(view.revision,priorRevision);
  }

  const unchanged=source.toString();
  const stableRevision=source.revision;

  for(const view of [cell,fold,notes])
  {
    assert.throws
    (
      () => view.replace
      (
        [
          {start:point(0,0),end:point(0,1),text:'X'},
          {start:point(0,1),end:point(0,2),text:3}
        ],
        view.revision
      ),
      TypeError
    );
    assert.equal(source.toString(),unchanged);
    assert.equal(source.revision,stableRevision);
  }

  const beforeCommit=source.revision;
  notes.replace
  (
    [
      {start:point(0,0),end:point(0,1),text:'A'},
      {start:point(1,0),end:point(1,1),text:'Y'}
    ],
    notes.revision
  );
  assert.equal(source.revision,beforeCommit+1);
  assert.ok(source.toString().endsWith('Yyz'));

  notes.destroy();
  fold.destroy();
  cell.destroy();
  raw.destroy();
}



// Occupied synthetic substitutions must not accidentally grant access to
// hidden input intervals. The same row may contain multiple disjoint
// substitution runs, each with an independently mapped source interval.
const SubstitutionDocument2D=extracted.SubstitutionDocument2D;
assert.equal(typeof SubstitutionDocument2D,'function');
assert.throws(()=>new SubstitutionDocument2D({}),TypeError);

for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('abcde\nhello');
  const raw=new RawDocument2D(source);
  const view=new SubstitutionDocument2D(raw);
  const events=[];
  view.subscribe(event=>events.push(event));

  const configuration=
  [
    {id:'second',text:'🧩!',start:point(0,4),end:point(0,5)},
    {id:'first',text:'XYZ',start:point(0,1),end:point(0,3)}
  ];

  assert.strictEqual(view.setSubstitutions(configuration),view);
  assert.equal(view.revision,1);
  assert.equal(view.rowCount,2);
  assert.equal(view.getRowWidth(0),7);
  assert.equal(view.colCount,7);
  assert.deepEqual(view.getRect(0,0,2,20),['aXYZd🧩!','hello']);
  assert.deepEqual(view.getRect(0,1,1,2),['X']);
  assert.deepEqual(view.getRect(0,5,1,6),['🧩']);
  assert.deepEqual(view.getRect(0,6,1,7),['!']);
  assert.deepEqual(view.getRegions(0,2,1,3),
    [[{kind:'substitution',id:'first',text:'XYZ',
      start:point(0,1),end:point(0,4)}]]);
  assert.deepEqual(view.getRegions(0,5,1,6),
    [[{kind:'substitution',id:'second',text:'🧩!',
      start:point(0,5),end:point(0,7)}]]);

  // All published metadata and configuration are detached snapshots.
  const exposed=view.getRegions(0,5,1,6)[0][0];
  exposed.start.col=0;
  exposed.end.col=1;
  exposed.id='corrupted';
  configuration[0].start.col=0;
  const displayed=view.substitutions;
  displayed[0].start.col=0;
  assert.deepEqual(view.getRegions(0,5,1,6)[0][0],
    {kind:'substitution',id:'second',text:'🧩!',
      start:point(0,5),end:point(0,7)});
  assert.equal(view.substitutions[0].start.col,1);
  const revision=view.revision;
  view.setSubstitutions(view.substitutions);
  assert.equal(view.revision,revision);
  assert.equal(source.revision,0);

  // A range covering an occupied virtual region is not editable even
  // when its two endpoints can each be mapped unambiguously.
  const oldText=source.toString();
  for(const edit of
  [
    {start:point(0,1),end:point(0,4),text:'Q'},
    {start:point(0,0),end:point(0,5),text:'Q'},
    {start:point(0,5),end:point(0,7),text:'Q'},
    {start:point(0,2),end:point(0,3),text:'Q'}
  ])
  {
    assert.throws(()=>view.replace([edit],view.revision),
      /substitut/);
  }
  assert.throws(()=>view.replace(
    [
      {start:point(0,0),end:point(0,1),text:'A'},
      {start:point(0,1),end:point(0,4),text:'Q'}
    ],view.revision),/substitut/);
  assert.throws(()=>view.setSelections([range(0,1,0,4)]),
    /substitut/);
  assert.equal(source.toString(),oldText);
  assert.equal(source.revision,0);

  view.setSelections([range(0,4,0,5)]);
  assert.deepEqual(raw.getSelections(),[range(0,3,0,4)]);
  assert.deepEqual(view.getSelections(),[range(0,4,0,5)]);
  assert.deepEqual(view.read(),['d']);
  raw.setSelections([range(0,1,0,2)]);
  assert.throws(()=>view.getSelections(),/substitut/);
  assert.throws(()=>view.read(),/substitut/);
  assert.throws(()=>view.insert('!'),/substitut/);
  assert.equal(source.revision,0);

  view.setSelections([range(0,4,0,5)]);
  const initial=view.revision;
  view.replace
  (
    [
      {start:point(0,0),end:point(0,1),text:'A'},
      {start:point(0,4),end:point(0,5),text:'D'}
    ],
    initial
  );
  assert.equal(source.toString(),'AbcDe\nhello');
  assert.equal(source.revision,1);
  assert.deepEqual(view.substitutions,[]);
  assert.equal(view.getRowWidth(0),5);
  assert.equal(view.revision,initial+1);
  assert.equal(events.filter(e=>e.type==='content').length,2);
  assert.throws(()=>view.replace(
    [{start:point(0,0),end:point(0,1),text:'Z'}],initial
  ),/stale/);

  view.setSubstitutions
  (
    [{id:'next',text:'!!',start:point(0,1),end:point(0,2)}]
  );
  const previous=view.revision;
  source.replace(0,0,'z');
  assert.deepEqual(view.substitutions,[]);
  assert.equal(view.revision,previous+1);

  for(const invalid of
  [
    [{id:'same',text:'X',start:point(0,1),end:point(0,2)},
     {id:'same',text:'Y',start:point(0,3),end:point(0,4)}],
    [{id:'one',text:'X',start:point(0,1),end:point(0,4)},
     {id:'two',text:'Y',start:point(0,3),end:point(0,5)}],
    [{id:'wrong',text:'X\nY',start:point(0,1),end:point(0,2)}],
    [{id:'cross-row',text:'X',start:point(0,1),end:point(1,1)}]
  ])
  {
    const beforeConfig=view.revision;
    assert.throws(()=>view.setSubstitutions(invalid),/substitut/);
    assert.equal(view.revision,beforeConfig);
    assert.deepEqual(view.substitutions,[]);
  }

  view.destroy();
  assert.doesNotThrow(()=>view.destroy());
  assert.throws(()=>view.getSelections(),/destroyed/);
  assert.doesNotThrow(()=>raw.getSelections());
  raw.destroy();
}

// Substitution is composable above an annotated cell representation and
// below a folded view: metadata remains source-less and the source text
// still has exactly one selection owner and exactly one physical commit.
{
  const source=new extracted.PieceDocument('A\tBQQ\nhidden\nZZ');
  const raw=new RawDocument2D(source);
  const cells=new CellDocument2D(raw);
  const notes=new AnnotationDocument2D(cells);
  notes.setAnnotations([{id:'note',text:'tip',at:point(0,4)}]);
  const substitute=new SubstitutionDocument2D(notes);
  substitute.setSubstitutions
  (
    [{id:'virtual',text:'🧩OK',start:point(0,5),end:point(0,7)}]
  );

  const fold=new FoldDocument2D(substitute);
  fold.setFolds([{startRow:1,endRow:2}]);
  const top=new CellDocument2D(fold);
  assert.deepEqual(top.getRect(0,0,3,20),['A   B🧩OK','…','ZZ']);
  assert.deepEqual(top.getRegions(0,0,1,20)[0]
    .filter(r=>r.kind==='annotation').map(r=>[r.id,r.start.col]),
    [['note',4]]);
  assert.deepEqual(top.getRegions(0,5,1,6),
    [[{kind:'substitution',id:'virtual',text:'🧩OK',
      start:point(0,5),end:point(0,8)}]]);
  assert.throws(()=>top.replace(
    [{start:point(0,4),end:point(0,8),text:'delete'}],
    top.revision
  ),/substitut/);
  assert.throws(()=>top.replace(
    [{start:point(1,0),end:point(1,1),text:'delete'}],
    top.revision
  ),/fold/);
  assert.equal(source.revision,0);

  top.setSelections([range(0,4,0,5)]);
  assert.deepEqual(raw.getSelections(),[range(0,2,0,3)]);
  assert.deepEqual(top.read(),['B']);
  const prior=source.revision;
  top.replace
  (
    [
      {start:point(0,4),end:point(0,5),text:'X'},
      {start:point(2,0),end:point(2,1),text:'Y'}
    ],
    top.revision
  );
  assert.equal(source.revision,prior+1);
  assert.equal(source.toString(),'A\tXQQ\nhidden\nYZ');
  assert.deepEqual(substitute.substitutions,[]);
  assert.deepEqual(notes.annotations,[]);
  assert.deepEqual(fold.folds,[]);
  assert.deepEqual(top.getRect(0,0,3,20),['A   XQQ','hidden','YZ']);

  top.destroy();
  fold.destroy();
  substitute.destroy();
  notes.destroy();
  cells.destroy();
  raw.destroy();
}

// A substituted input must not hide part of a grapheme/TAB or a protected
// fold: the source interval is validated in the immediate input space.
{
  const source=new extracted.PieceDocument('A\tB\nhidden\nCD');
  const raw=new RawDocument2D(source);
  const cells=new CellDocument2D(raw);
  const substitute=new SubstitutionDocument2D(cells);
  assert.throws(()=>substitute.setSubstitutions(
    [{id:'half-tab',text:'X',start:point(0,2),end:point(0,4)}]),
    /indivisible/);
  assert.equal(source.revision,0);

  const fold=new FoldDocument2D(cells);
  fold.setFolds([{startRow:1,endRow:2}]);
  const aboveFold=new SubstitutionDocument2D(fold);
  assert.throws(()=>aboveFold.setSubstitutions(
    [{id:'fold',text:'X',start:point(1,0),end:point(1,1)}]),
    /indivisible/);
  assert.equal(source.revision,0);

  aboveFold.destroy();
  fold.destroy();
  substitute.destroy();
  cells.destroy();
  raw.destroy();
}

// Bounded reads of a substituted long line retrieve only visible source
// fragments. A whole hidden interval is not materialized by a viewport.
{
  class ObservedRaw extends RawDocument2D
  {
    windows=[];
    getRegions(...args)
    {
      this.windows.push([args[0],args[1],args[3]]);
      return super.getRegions(...args);
    }
  }

  const source=new extracted.PieceDocument(
    'prefix'+'x'.repeat(100000)+'suffix');
  const raw=new ObservedRaw(source);
  const view=new SubstitutionDocument2D(raw);
  view.setSubstitutions
  (
    [{id:'hidden',text:'[..]',start:point(0,6),end:point(0,100006)}]
  );
  raw.windows=[];
  assert.deepEqual(view.getRect(0,0,1,30),['prefix[..]suffix']);
  assert.deepEqual(view.getRegions(0,0,1,30)[0]
    .filter(r=>r.kind==='substitution').map(r=>r.id),['hidden']);
  assert.ok(raw.windows.every(([row,left,right])=>
    row===0 && right-left<=30));
  assert.equal(source.revision,0);
  view.destroy();
  raw.destroy();
}



// Derived occupied regions form a protected many-to-many read-only
// relation: one display region joins disjoint input spans; one input span
// can also appear in several distinct display regions. No such copy
// becomes an additional source selection owner.
for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('abcdef\nUVWXYZ\nTAIL');
  const raw=new RawDocument2D(source);
  const view=new SubstitutionDocument2D(raw);
  const events=[];
  view.subscribe(event=>events.push(event));

  const configuration=
  [
    {
      id:'first',
      start:point(0,1),end:point(0,3),
      sources:
      [
        {start:point(1,0),end:point(1,2)},
        {start:point(0,4),end:point(0,6)}
      ]
    },
    {
      id:'second',
      start:point(0,3),end:point(0,4),
      sources:[{start:point(1,0),end:point(1,2)}]
    }
  ];

  assert.strictEqual(view.setSubstitutions(configuration),view);
  assert.equal(view.rowCount,3);
  assert.equal(view.getRowWidth(0),9);
  assert.equal(view.colCount,9);
  assert.deepEqual(view.getRect(0,0,3,20),
    ['aUVefUVef','UVWXYZ','TAIL']);
  assert.deepEqual(view.getRect(0,2,1,8),['VefUVe']);
  assert.deepEqual(view.getRegions(0,3,1,4),
    [[{kind:'substitution',id:'first',text:'UVef',
      start:point(0,1),end:point(0,5)}]]);
  assert.deepEqual(view.getRegions(0,6,1,7),
    [[{kind:'substitution',id:'second',text:'UV',
      start:point(0,5),end:point(0,7)}]]);
  assert.deepEqual(view.substitutions,configuration);
  assert.equal(source.revision,0);
  assert.deepEqual(events[0].invalidation,{all:true});

  // Public configuration is detached; a user can neither overwrite
  // private source relations nor inject source provenance into getRegions.
  const readback=view.substitutions;
  readback[0].sources[0].start.col=5;
  configuration[1].sources[0].end.col=5;
  assert.equal(view.substitutions[0].sources[0].start.col,0);
  assert.equal(view.substitutions[1].sources[0].end.col,2);
  const a=view.getRegions(0,3,1,4)[0][0];
  assert.equal(Object.hasOwn(a,'sources'),false);
  a.start.col=99;
  assert.equal(view.getRegions(0,3,1,4)[0][0].start.col,1);
  const revision=view.revision;
  view.setSubstitutions(view.substitutions);
  assert.equal(view.revision,revision);

  const physicalBefore=source.toString();
  for(const edit of
  [
    {start:point(0,1),end:point(0,5),text:'Q'},
    {start:point(0,2),end:point(0,3),text:'Q'},
    {start:point(0,0),end:point(0,8),text:'Q'}
  ])
  {
    assert.throws(()=>view.replace([edit],view.revision),
      /substitut/);
    assert.throws(()=>view.setSelections([
      range(edit.start.row,edit.start.col,edit.end.row,edit.end.col)
    ]),/substitut/);
  }
  assert.throws(()=>view.replace([
    {start:point(2,0),end:point(2,1),text:'Z'},
    {start:point(0,1),end:point(0,5),text:'Q'}
  ],view.revision),/substitut/);
  assert.equal(source.toString(),physicalBefore);
  assert.equal(source.revision,0);

  // The referenced source text can still be selected at its original
  // position. The copies do not create new editable source positions.
  view.setSelections([range(1,0,1,2)]);
  assert.deepEqual(view.read(),['UV']);
  assert.deepEqual(raw.getSelections(),[range(1,0,1,2)]);
  raw.setSelections([range(0,1,0,2)]);
  assert.throws(()=>view.read(),/substitut/);
  assert.throws(()=>view.insert('x'),/substitut/);
  assert.equal(source.revision,0);

  view.setSelections([range(2,0,2,1)]);
  const prior=view.revision;
  view.replace([
    {start:point(0,0),end:point(0,1),text:'A'},
    {start:point(2,0),end:point(2,1),text:'Z'}
  ],prior);
  assert.equal(source.toString(),'Abcdef\nUVWXYZ\nZAIL');
  assert.equal(source.revision,1);
  assert.deepEqual(view.substitutions,[]);
  assert.equal(view.rowCount,3);
  assert.equal(view.revision,prior+1);
  assert.throws(()=>view.replace([
    {start:point(0,0),end:point(0,1),text:'Q'}
  ],prior),/stale/);

  view.destroy();
  raw.destroy();
}

// The derived-label input contract is strict. Reject source intervals
// that are empty, cross rows, cut through tabs, or refer to protected
// virtual content. Invalid configurations must preserve view revision.
{
  const source=new extracted.PieceDocument('A\tBC\nother\nend');
  const raw=new RawDocument2D(source);
  const cell=new CellDocument2D(raw);
  const view=new SubstitutionDocument2D(cell);
  const base={id:'derived',start:point(1,0),end:point(1,1)};
  const bad=
  [
    {...base,sources:[]},
    {...base,sources:[{start:point(0,2),end:point(0,4)}]},
    {...base,sources:[{start:point(0,1),end:point(0,4)}]},
    {...base,sources:[{start:point(0,4),end:point(1,1)}]},
    {...base,sources:[{start:point(2,0),end:point(2,0)}]},
    {...base,sources:[{start:point(99,0),end:point(99,1)}]},
    {...base,text:'literal',sources:[{start:point(1,1),end:point(1,2)}]},
    {...base},
    {...base,sources:'invalid'}
  ];

  for(const item of bad)
  {
    const revision=view.revision;
    assert.throws(()=>view.setSubstitutions([item]));
    assert.equal(view.revision,revision);
    assert.deepEqual(view.substitutions,[]);
    assert.equal(source.revision,0);
  }

  // Descriptor getters are evaluated once when the derived relation is
  // captured, even when they are stateful JavaScript accessors.
  let sourceGetterReads=0;
  view.setSubstitutions([
    {
      id:'once',
      start:point(2,0),
      end:point(2,1),
      get sources()
      {
        sourceGetterReads++;
        return [{start:point(1,0),end:point(1,2)}];
      }
    }
  ]);
  assert.equal(sourceGetterReads,1);
  assert.deepEqual(view.getRect(2,0,3,4),['otnd']);
  view.setSubstitutions([]);
  assert.deepEqual(view.substitutions,[]);

  const inner=new SubstitutionDocument2D(cell);
  inner.setSubstitutions([
    {id:'protected',text:'!',start:point(1,1),end:point(1,3)}
  ]);
  const outer=new SubstitutionDocument2D(inner);
  assert.throws(()=>outer.setSubstitutions([
    {id:'mirror',start:point(2,0),end:point(2,1),
      sources:[{start:point(1,1),end:point(1,2)}]}
  ]),/indivisible/);
  assert.equal(source.revision,0);

  outer.destroy();
  inner.destroy();
  view.destroy();
  cell.destroy();
  raw.destroy();
}

// A cell layer above a derived substitution retains synthetic identity,
// width and protection. Annotations and folding remain separately
// composable, and copied Unicode fragments are measured in grapheme cells.
{
  const source=new extracted.PieceDocument('xabc\n😀e\u0301Q\ntail');
  const raw=new RawDocument2D(source);
  const notes=new AnnotationDocument2D(raw);
  notes.setAnnotations([{id:'n',text:'tip',at:point(0,0)}]);
  const sub=new SubstitutionDocument2D(notes);
  sub.setSubstitutions([
    {id:'copied',start:point(0,1),end:point(0,3),
      sources:[
        {start:point(1,0),end:point(1,2)},
        {start:point(1,2),end:point(1,4)}
      ]}
  ]);
  const cell=new CellDocument2D(sub);
  assert.deepEqual(sub.getRect(0,0,1,20),['x😀e\u0301c']);
  assert.deepEqual(cell.getRect(0,0,1,20),['x😀e\u0301c']);
  assert.deepEqual(cell.getRegions(0,1,1,2),
    [[{kind:'substitution',id:'copied',text:'😀e\u0301',
      start:point(0,1),end:point(0,3)}]]);
  assert.deepEqual(cell.getRegions(0,0,1,1)[0]
    .filter(r=>r.kind==='annotation').map(r=>r.id),['n']);
  assert.throws(()=>cell.replace([
    {start:point(0,1),end:point(0,3),text:'!'}
  ],cell.revision),/substitut/);

  const fold=new FoldDocument2D(cell);
  fold.setFolds([{startRow:2,endRow:3}]);
  assert.deepEqual(fold.getRect(0,0,3,20),['x😀e\u0301c','😀e\u0301Q','…']);
  fold.destroy();
  cell.destroy();
  sub.destroy();
  notes.destroy();
  raw.destroy();
}

// A huge copied region is resolved during configuration, not on each
// viewport read. Viewport calls never re-read distant source fragments.
{
  class ObservedRaw extends RawDocument2D
  {
    calls=[];
    getRect(...args)
    {
      this.calls.push([args[0],args[1],args[3]]);
      return super.getRect(...args);
    }
  }

  const source=new extracted.PieceDocument(
    'one\n'+'z'.repeat(100000)+'\nlast');
  const raw=new ObservedRaw(source);
  const view=new SubstitutionDocument2D(raw);
  view.setSubstitutions([
    {id:'big',start:point(0,0),end:point(0,3),
      sources:[{start:point(1,0),end:point(1,100000)}]}
  ]);
  const readsAtSetup=raw.calls.length;
  assert.ok(readsAtSetup>0);
  assert.deepEqual(view.getRect(0,0,1,5),['zzzzz']);
  assert.equal(raw.calls.length,readsAtSetup);
  assert.equal(source.revision,0);
  view.destroy();
  raw.destroy();
}



// Source-level replace notifications must retain their exact legacy
// argument shape, while RawDocument2D receives detached old/new UTF-16
// geometry captured around the same committed physical transaction.
for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('ab\r\ncd\nef');
  const raw=new RawDocument2D(source);
  const rawEvents=[];
  const physical=[];
  raw.subscribe(event=>rawEvents.push(event));
  source.subscribe((...args)=>physical.push(args));

  const edits=
  [
    {start:7,end:9,text:'Z\nQ'},
    {start:2,end:4,text:'\n'}
  ];
  const original=edits.map(e=>({...e}));
  source.replace(edits);

  assert.equal(source.toString(),'ab\ncd\nZ\nQ');
  assert.equal(source.revision,1);
  assert.deepEqual(physical,[[original]]);
  assert.equal(rawEvents.length,1);
  assert.equal(rawEvents[0].type,'content');
  assert.equal(rawEvents[0].revision,1);
  assert.deepEqual(rawEvents[0].invalidation,{all:true});

  const geometry=rawEvents[0].geometry;
  assert.ok(geometry);
  assert.equal(geometry.previousRevision,0);
  assert.equal(geometry.revision,1);
  assert.equal(geometry.oldRowCount,3);
  assert.equal(geometry.newRowCount,4);
  assert.deepEqual(geometry.edits,
  [
    {
      old:
      {
        start:{row:2,col:0,offset:7},
        end:{row:2,col:2,offset:9}
      },
      new:
      {
        start:{row:2,col:0,offset:6},
        end:{row:3,col:1,offset:9}
      }
    },
    {
      old:
      {
        start:{row:0,col:2,offset:2},
        end:{row:1,col:0,offset:4}
      },
      new:
      {
        start:{row:0,col:2,offset:2},
        end:{row:1,col:0,offset:3}
      }
    }
  ]);
  assert.ok(Object.isFrozen(geometry));
  assert.ok(Object.isFrozen(geometry.edits));
  assert.ok(Object.isFrozen(geometry.edits[0].old.start));
  assert.ok(Object.isFrozen(geometry.edits[0].new.end));
  assert.throws(()=>{geometry.edits[0].old.start.col=99;},TypeError);

  // A three-argument source edit and a successful no-effect commit both
  // produce exactly one new geometry event without changing public args.
  source.replace(0,0,'!');
  assert.deepEqual(physical[1],[0,0,'!']);
  assert.equal(rawEvents[1].geometry.previousRevision,1);
  assert.equal(rawEvents[1].geometry.revision,2);
  assert.deepEqual(rawEvents[1].geometry.edits[0].new,
    {start:{row:0,col:0,offset:0},end:{row:0,col:1,offset:1}});
  source.replace(0,0,'');
  assert.deepEqual(physical[2],[0,0,'']);
  assert.equal(source.revision,3);
  assert.equal(rawEvents[2].geometry.previousRevision,2);
  assert.equal(rawEvents[2].geometry.revision,3);
  assert.deepEqual(rawEvents[2].geometry.edits[0].old,
    rawEvents[2].geometry.edits[0].new);

  // Rejected commands are not commits and publish no geometry.
  const count=rawEvents.length;
  assert.throws(()=>source.replace
    ([{start:0,end:2,text:'a'},{start:1,end:3,text:'b'}]),RangeError);
  assert.equal(rawEvents.length,count);
  assert.equal(source.revision,3);

  raw.destroy();
}

// Source locations inside a CRLF terminator carry the exact UTF-16
// boundary, even though that column is beyond the editable row width.
for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('a\r\nb');
  const raw=new RawDocument2D(source);
  const events=[];
  raw.subscribe(event=>events.push(event));
  source.replace(2,2,'X');
  assert.equal(source.toString(),'a\rX\nb');
  assert.equal(source.lineCount,3);
  assert.deepEqual(events[0].geometry.edits[0],
  {
    old:
    {
      start:{row:0,col:2,offset:2},
      end:{row:0,col:2,offset:2}
    },
    new:
    {
      start:{row:1,col:0,offset:2},
      end:{row:1,col:1,offset:3}
    }
  });
  assert.equal(events[0].geometry.oldRowCount,2);
  assert.equal(events[0].geometry.newRowCount,3);
  assert.deepEqual(events[0].invalidation,{all:true});
  raw.destroy();
}

// Explicit raw editing, selected insertion and arbitrary external source
// changes must all converge on the same atomic physical geometry capture.
for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  const source=new Backend('ab\ncd');
  const raw=new RawDocument2D(source);
  const events=[];
  raw.subscribe(e=>events.push(e));

  raw.replace
  (
    [{start:point(1,0),end:point(1,1),text:'Z'}],
    raw.revision
  );
  assert.equal(source.toString(),'ab\nZd');
  assert.deepEqual(events[0].geometry.edits[0].old,
    {start:{row:1,col:0,offset:3},end:{row:1,col:1,offset:4}});
  raw.setSelections([range(0,2,0,2)]);
  const count=events.length;
  raw.insert('!');
  assert.equal(source.toString(),'ab!\nZd');
  assert.equal(source.revision,2);
  assert.equal(events.length,count+1);
  assert.equal(events.at(-1).type,'content');
  assert.deepEqual(events.at(-1).geometry.edits[0].new,
    {start:{row:0,col:2,offset:2},end:{row:0,col:3,offset:3}});
  source.replace(0,0,'Q');
  assert.equal(events.at(-1).geometry.revision,3);
  assert.equal(events.at(-1).geometry.edits[0].old.start.offset,0);
  assert.deepEqual(events.at(-1).invalidation,{all:true});

  raw.destroy();
}

// The internal geometry channel is optional: unsupported Document
// subclasses continue publishing conservative raw content invalidation.
for(const Backend of [extracted.FlatDocument,extracted.PieceDocument])
{
  class NoGeometry extends Backend
  {
    _getLastGeometry()
    {
      return null;
    }
  }

  const source=new NoGeometry('abc');
  const raw=new RawDocument2D(source);
  const events=[];
  raw.subscribe(e=>events.push(e));
  source.replace(1,2,'X');
  assert.equal(source.toString(),'aXc');
  assert.deepEqual(events[0].invalidation,{all:true});
  assert.equal(Object.hasOwn(events[0],'geometry'),false);
  raw.destroy();
}


console.log('m.text.document extraction parity PASS '+verified+' committed edit comparisons');
