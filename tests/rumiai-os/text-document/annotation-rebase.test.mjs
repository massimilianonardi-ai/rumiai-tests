// Survivor anchors are permitted only where old/new text correspondence
// is proved by the real source geometry. This test runs the real compiled
// m.text.document core against both physical backends.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'real product checkout required');
const compilation=spawnSync
(
  process.execPath,
  [resolve(root,'lib/sys/js/jsc.lib.js'),resolve(root,'lib/sys/js/core/modules-js.json')],
  {encoding:'utf8',maxBuffer:16*1024*1024}
);
assert.equal(compilation.status,0,compilation.stderr);
const dir=mkdtempSync(join(tmpdir(),'annotation-rebase-'));
let classes;
try
{
  const output=join(dir,'core.cjs');
  writeFileSync(output,compilation.stdout);
  classes=createRequire(import.meta.url)(output).text.document;
}
finally
{
  rmSync(dir,{recursive:true,force:true});
}

const p=(row,col)=>({row,col});
const note=(id,row,col)=>({id,text:'label:'+id,at:p(row,col)});
const positions=notes=>notes.annotations.map
(
  value=>[value.id,value.at.row,value.at.col]
);
function open(Backend,text,cell=true)
{
  const source=new Backend(text);
  const raw=new classes.RawDocument2D(source);
  const view=cell ? new classes.CellDocument2D(raw) : raw;
  const notes=new classes.AnnotationDocument2D(view);
  const events=[];
  notes.subscribe(event=>events.push(event));
  const result =
  {
    source,raw,view,notes,events,
    close()
    {
      notes.destroy();
      if(view!==raw)
      {
        view.destroy();
      }
      raw.destroy();
    }
  };
  return result;
}

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  // A same-row suffix is not rebased by a tempting but unsafe cell delta.
  // Earlier rows, later rows and a genuinely untouched prefix survive.
  {
    const t=open(Backend,'TOP\nab\tcd\nkeep\nLAST');
    t.notes.setAnnotations
    (
      [
        note('top',0,1),
        note('prefix',1,1),
        note('at-edit',1,4),
        note('suffix',1,5),
        note('keep',2,2),
        note('last',3,2)
      ]
    );
    const before=t.notes.revision;
    const start=t.source.lineStart(1)+3;
    t.source.replace(start,start+1,'XY');
    assert.equal(t.source.toString(),'TOP\nab\tXYd\nkeep\nLAST');
    assert.deepEqual
    (
      positions(t.notes),
      [
        ['top',0,1],
        ['prefix',1,1],
        ['keep',2,2],
        ['last',3,2]
      ]
    );
    assert.equal(t.events.at(-1).geometry.previousRevision,before);
    assert.equal(t.events.at(-1).geometry.revision,t.notes.revision);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    const detached=t.notes.annotations;
    detached[0].at.col=99;
    assert.deepEqual(t.notes.annotations[0].at,p(0,1));
    assert.deepEqual
    (
      t.notes.getRegions(1,0,2,2)[0].filter(r=>r.kind==='annotation').map(r=>r.id),
      ['prefix']
    );
    t.close();
  }

  // A newline splits one touched row; later untouched rows move together.
  {
    const t=open(Backend,'TOP\nhello\nmiddle\nTAIL');
    t.notes.setAnnotations
    (
      [
        note('head',0,2),
        note('prefix',1,1),
        note('hit',1,3),
        note('middle',2,3),
        note('tail',3,2)
      ]
    );
    const offset=t.source.lineStart(1)+2;
    t.source.replace(offset,offset,'\nNEW');
    assert.equal(t.source.toString(),'TOP\nhe\nNEWllo\nmiddle\nTAIL');
    assert.deepEqual
    (
      positions(t.notes),
      [
        ['head',0,2],
        ['prefix',1,1],
        ['middle',3,3],
        ['tail',4,2]
      ]
    );
    t.close();
  }

  // Deleting whole rows must not attach notes to deleted or merged rows.
  {
    const t=open(Backend,'zero\none\ntwo\nthree\nfour');
    t.notes.setAnnotations
    (
      [note('zero',0,2),note('one',1,1),note('two',2,1),
       note('three',3,2),note('four',4,2)]
    );
    t.source.replace(t.source.lineStart(1),t.source.lineStart(3),'');
    assert.equal(t.source.toString(),'zero\nthree\nfour');
    assert.deepEqual
    (
      positions(t.notes),
      [['zero',0,2],['four',2,2]]
    );
    t.close();
  }

  // A TAB moves the following source boundaries by a nonlinear amount.
  // A same-row anchor after that edit must not accidentally land inside it.
  {
    const t=open(Backend,'X\tABC\nstable');
    t.notes.setAnnotations
    (
      [note('left',0,0),note('after-tab',0,4),note('stable',1,3)]
    );
    t.source.replace(1,1,'ZZZ');
    assert.equal(t.source.toString(),'XZZZ\tABC\nstable');
    assert.deepEqual
    (
      positions(t.notes),
      [['left',0,0],['stable',1,3]]
    );
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [{old:{start:p(0,1),end:p(0,1)},
        new:{start:p(0,1),end:p(0,4)}}]);
    t.close();
  }

  // Multiple unsorted source edits have one atomic commit. The deltas
  // must come from corresponding old/new row coordinates, not edit order.
  {
    const t=open(Backend,'a\nb\nc\nd\ne\nf');
    t.notes.setAnnotations
    (
      [
        note('a',0,0),
        note('b-prefix',1,0),
        note('b-eol',1,1),
        note('c',2,1),
        note('d-prefix',3,0),
        note('d-eol',3,1),
        note('e',4,1),
        note('f',5,1)
      ]
    );
    const later=t.source.lineStart(3)+1;
    const earlier=t.source.lineStart(1)+1;
    const revision=t.source.revision;
    t.source.replace
    (
      [
        {start:later,end:later,text:'\nY'},
        {start:earlier,end:earlier,text:'\nX'}
      ]
    );
    assert.equal(t.source.revision,revision+1);
    assert.equal(t.source.toString(),'a\nb\nX\nc\nd\nY\ne\nf');
    assert.deepEqual
    (
      positions(t.notes),
      [
        ['a',0,0],
        ['b-prefix',1,0],
        ['c',3,1],
        ['d-prefix',4,0],
        ['e',6,1],
        ['f',7,1]
      ]
    );
    assert.equal(t.events.at(-1).geometry.edits.length,2);
    t.close();
  }

  // A Unicode change that crosses a grapheme boundary has NO valid cell
  // post-edit geometry. No anchor may be retained from a partial batch.
  {
    const t=open(Backend,'aX\nother');
    t.notes.setAnnotations
    (
      [note('a',0,0),note('other',1,2)]
    );
    t.source.replace(1,1,'\u0301');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.notes.annotations,[]);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    t.close();
  }

  // Physical UTF-16 inside CRLF is not necessarily a cell caret; the
  // starting boundary itself shifts to a newly created row. Only rows
  // strictly AFTER the mutated terminator have a proven row mapping.
  {
    const t=open(Backend,'ab\r\ncd\r\nef',false);
    t.notes.setAnnotations
    (
      [note('old-prefix',0,1),note('cd',1,1),note('ef',2,1)]
    );
    t.source.replace(3,3,'Z');
    assert.equal(t.source.toString(),'ab\rZ\ncd\r\nef');
    assert.deepEqual
    (
      positions(t.notes),
      [['cd',2,1],['ef',3,1]]
    );
    assert.equal(t.events.at(-1).geometry.newRowCount,4);
    t.close();
  }

  // The same CRLF split is invalid in cell geometry and cannot preserve
  // even an apparently unrelated note by guessing from physical offsets.
  {
    const t=open(Backend,'ab\r\ncd');
    t.notes.setAnnotations([note('cd',1,1)]);
    t.source.replace(3,3,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.notes.annotations,[]);
    t.close();
  }

  // Two annotation layers retain independent source anchors through one
  // physical edit, but changing only the lower overlay configuration is
  // not itself a text mutation and invalidates the upper view.
  {
    const t=open(Backend,'aa\nbb\ncc');
    const outer=new classes.AnnotationDocument2D(t.notes);
    const upperEvents=[];
    outer.subscribe(event=>upperEvents.push(event));
    t.notes.setAnnotations([note('lower',1,1)]);
    outer.setAnnotations([note('upper',2,1)]);
    const previousRevision=outer.revision;
    t.source.replace(0,0,'Z');
    assert.deepEqual(positions(t.notes),[['lower',1,1]]);
    assert.deepEqual(positions(outer),[['upper',2,1]]);
    assert.equal(outer.revision,previousRevision+1);
    assert.deepEqual(upperEvents.at(-1).invalidation,{all:true});
    assert.equal(upperEvents.at(-1).geometry.previousRevision,previousRevision);

    t.notes.setAnnotations([note('new-lower',1,0)]);
    assert.deepEqual(outer.annotations,[]);
    assert.equal('geometry' in upperEvents.at(-1),false);
    outer.destroy();
    t.close();
  }

  // An old nonzero-column edit cannot be mapped by the current restricted
  // whole-row fold geometry projection; the fold still clears on commit.
  {
    const source=new Backend('one\ntwo\nthree');
    const raw=new classes.RawDocument2D(source);
    const cell=new classes.CellDocument2D(raw);
    const fold=new classes.FoldDocument2D(cell);
    fold.setFolds([{startRow:1,endRow:2}]);
    const notes=new classes.AnnotationDocument2D(fold);
    const events=[];
    notes.subscribe(event=>events.push(event));
    notes.setAnnotations([note('top',0,1),note('last',2,2)]);
    source.replace(source.lineStart(2)+1,source.lineStart(2)+2,'H');
    assert.deepEqual(fold.folds,[]);
    assert.deepEqual(notes.annotations,[]);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    notes.destroy();
    fold.destroy();
    cell.destroy();
    raw.destroy();
  }

  // A local overlay reconfiguration is not a physical mutation record.
  // A view above another cell view has no precommit physical geometry.
  {
    const source=new Backend('one\ntwo');
    const raw=new classes.RawDocument2D(source);
    const inner=new classes.CellDocument2D(raw);
    const outer=new classes.CellDocument2D(inner);
    const notes=new classes.AnnotationDocument2D(outer);
    const events=[];
    notes.subscribe(event=>events.push(event));
    notes.setAnnotations([note('two',1,1)]);
    assert.equal('geometry' in events.at(-1),false);
    source.replace(0,1,'O');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(notes.annotations,[]);
    notes.destroy();
    outer.destroy();
    inner.destroy();
    raw.destroy();
  }
}
console.log('annotation retained-anchor geometry PASS');
