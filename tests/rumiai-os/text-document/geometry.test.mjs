import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'real product checkout required');
const run=spawnSync
(
  process.execPath,
  [resolve(root,'lib/sys/js/jsc.lib.js'),resolve(root,'lib/sys/js/core/modules-js.json')],
  {encoding:'utf8',maxBuffer:16*1024*1024}
);
assert.equal(run.status,0,run.stderr);
const dir=mkdtempSync(join(tmpdir(),'cell-geometry-'));
let classes;
try
{
  const output=join(dir,'core.cjs');
  writeFileSync(output,run.stdout);
  classes=createRequire(import.meta.url)(output).text.document;
}
finally
{
  rmSync(dir,{recursive:true,force:true});
}

const p=(row,col)=>({row,col});
for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  const source=new Backend('A\tB\n😀e\u0301X');
  const raw=new classes.RawDocument2D(source);
  const cell=new classes.CellDocument2D(raw);
  const nested=new classes.CellDocument2D(cell);
  const events=[],nestedEvents=[];
  cell.subscribe(e=>events.push(e));
  nested.subscribe(e=>nestedEvents.push(e));
  source.replace([{start:6,end:8,text:'Q'},{start:2,end:3,text:'ZZ'}]);
  assert.equal(source.toString(),'A\tZZ\n😀QX');
  assert.deepEqual(events[0].invalidation,{all:true});
  assert.deepEqual(events[0].geometry,
  {
    previousRevision:0,revision:1,oldRowCount:2,newRowCount:2,
    edits:
    [
      {old:{start:p(1,1),end:p(1,2)},new:{start:p(1,1),end:p(1,2)}},
      {old:{start:p(0,4),end:p(0,5)},new:{start:p(0,4),end:p(0,6)}}
    ]
  });
  assert.ok(Object.isFrozen(events[0].geometry.edits[0].old.start));
  assert.equal('offset' in events[0].geometry.edits[0].new.end,false);
  assert.equal('geometry' in nestedEvents[0],false);
  source.replace(1,1,'X');
  assert.equal(source.toString(),'AX\tZZ\n😀QX');
  assert.deepEqual(events[1].geometry.edits,
    [{old:{start:p(0,1),end:p(0,1)},new:{start:p(0,1),end:p(0,2)}}]);
  cell.setSelections([{start:p(1,0),end:p(1,1),forward:true}]);
  cell.insert('K');
  assert.deepEqual(events.at(-1).geometry.edits,
    [{old:{start:p(1,0),end:p(1,1)},new:{start:p(1,0),end:p(1,1)}}]);
  source.replace(0,0,'');
  assert.deepEqual(events.at(-1).geometry.edits[0].old,
    events.at(-1).geometry.edits[0].new);
  nested.destroy();cell.destroy();raw.destroy();

  for(const [value,at,text] of
  [
    ['eX',1,'\u0301'],
    ['e\u0301X',1,'!'],
    ['a\r\nb',2,'Z']
  ])
  {
    const doc=new Backend(value);
    const parent=new classes.RawDocument2D(doc);
    const view=new classes.CellDocument2D(parent);
    const notifications=[];
    view.subscribe(e=>notifications.push(e));
    doc.replace(at,at,text);
    assert.equal(doc.revision,1);
    assert.equal(notifications.length,1);
    assert.deepEqual(notifications[0].invalidation,{all:true});
    assert.equal('geometry' in notifications[0],false);
    view.destroy();parent.destroy();
  }

  class NoGeometry extends Backend
  {
    _getLastGeometry(){return null;}
  }
  const no=new NoGeometry('A\tB');
  const noRaw=new classes.RawDocument2D(no);
  const noCells=new classes.CellDocument2D(noRaw);
  const seen=[];
  noCells.subscribe(e=>seen.push(e));
  no.replace(2,3,'Z');
  assert.equal('geometry' in seen[0],false);
  noCells.destroy();noRaw.destroy();

  const spanning=new Backend('A\tB\n😀X');
  const sr=new classes.RawDocument2D(spanning);
  const sc=new classes.CellDocument2D(sr);
  const history=[];
  sc.subscribe(e=>history.push(e));
  spanning.replace(2,6,'Z\nQ');
  assert.equal(spanning.toString(),'A\tZ\nQX');
  assert.deepEqual(history[0].geometry.edits,
    [{old:{start:p(0,4),end:p(1,1)},new:{start:p(0,4),end:p(1,1)}}]);
  sc.destroy();sr.destroy();
}
console.log('cell old/new geometry PASS');
