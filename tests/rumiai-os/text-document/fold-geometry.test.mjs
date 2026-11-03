// Old whole-row fold space and committed unfolded space are different.
// Exercise the real compiled core and both physical source backends.
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
const dir=mkdtempSync(join(tmpdir(),'fold-geometry-'));
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
const edited=(oldStart,oldEnd,newStart,newEnd)=>
(
  {
    old:{start:oldStart,end:oldEnd},
    new:{start:newStart,end:newEnd}
  }
);

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  const make=(text, withCell=false)=>
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const input=withCell ? new classes.CellDocument2D(raw) : raw;
    const fold=new classes.FoldDocument2D(input);
    const events=[];
    fold.subscribe(event=>events.push(event));
    return {
      source,raw,input,fold,events,
      close()
      {
        fold.destroy();
        if(input!==raw)
        {
          input.destroy();
        }
        raw.destroy();
      }
    };
  };

  // A change in source row 3 maps to folded row 2 BEFORE commit and to
  // source row 3 AFTER the fold invalidates. The old geometry cannot
  // be reconstructed from the now-unfolded post-commit view.
  {
    const t=make('top\nhidden-A\nhidden-B\nvisible\nlast');
    t.fold.setFolds([{startRow:1,endRow:3}]);
    assert.deepEqual(t.fold.getRect(0,0,4,20),['top','…','visible','last']);
    const revision=t.fold.revision;
    const offset=t.source.lineStart(3);
    t.source.replace(offset,offset,'X');
    assert.deepEqual(t.fold.folds,[]);
    assert.equal(t.fold.rowCount,5);
    assert.equal(t.source.toString(),'top\nhidden-A\nhidden-B\nXvisible\nlast');
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:revision,
      revision:t.fold.revision,
      oldRowCount:4,newRowCount:5,
      edits:[edited(p(2,0),p(2,0),p(3,0),p(3,1))]
    });
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    assert.ok(Object.isFrozen(t.events.at(-1).geometry));
    assert.ok(Object.isFrozen(t.events.at(-1).geometry.edits));
    assert.ok(Object.isFrozen(t.events.at(-1).geometry.edits[0].old.start));
    assert.equal('offset' in t.events.at(-1).geometry.edits[0].new.end,false);
    t.close();
  }

  // One downstream annotation can retain a row-shifted anchor after the
  // folded view is invalidated, while an ambiguous earlier anchor drops.
  {
    const t=make('top\nhidden-A\nhidden-B\nvisible\nlast',true);
    t.fold.setFolds([{startRow:1,endRow:3}]);
    const notes=new classes.AnnotationDocument2D(t.fold);
    notes.setAnnotations
    (
      [
        {id:'prior',text:'before',at:p(0,1)},
        {id:'last',text:'after',at:p(3,2)}
      ]
    );
    const seen=[];
    notes.subscribe(event=>seen.push(event));
    const offset=t.source.lineStart(3);
    t.fold.replace
    (
      [{start:p(2,0),end:p(2,0),text:'Q'}],
      t.fold.revision
    );
    assert.equal(t.source.toString(),'top\nhidden-A\nhidden-B\nQvisible\nlast');
    assert.deepEqual
    (
      notes.annotations,
      [{id:'last',text:'after',at:p(4,2)}]
    );
    assert.deepEqual(seen.at(-1).invalidation,{all:true});
    assert.equal(seen.at(-1).geometry.oldRowCount,4);
    assert.equal(seen.at(-1).geometry.newRowCount,5);
    assert.equal(t.events.at(-1).geometry.edits[0].old.start.row,2);
    notes.destroy();
    t.close();
  }

  // Tab stops and Unicode graphemes below a folded interval do not
  // change the fact that a row-start cut has an exact old/new mapping.
  {
    const t=make('top\nh1\nh2\n\t😀Z\nend',true);
    t.fold.setFolds([{startRow:1,endRow:3}]);
    assert.deepEqual(t.fold.getRect(0,0,4,20),['top','…','    😀Z','end']);
    const old=t.fold.revision;
    const at=t.source.lineStart(3);
    t.source.replace(at,at,'Q');
    assert.deepEqual(t.fold.folds,[]);
    assert.equal(t.source.toString(),'top\nh1\nh2\nQ\t😀Z\nend');
    assert.deepEqual(t.fold.getRect(3,0,4,20),['Q   😀Z']);
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:old,revision:t.fold.revision,
      oldRowCount:4,newRowCount:5,
      edits:[edited(p(2,0),p(2,0),p(3,0),p(3,1))]
    });
    assert.throws
    (
      ()=>t.fold.replace
      (
        [{start:p(2,0),end:p(2,0),text:'Z'}],old
      ),
      /stale/
    );
    t.close();
  }

  // A newline at a visible row start expands the physical row count.
  {
    const t=make('top\nh1\nh2\nbody\nend');
    t.fold.setFolds([{startRow:1,endRow:3}]);
    const old=t.fold.revision;
    const at=t.source.lineStart(3);
    t.source.replace(at,at,'\n');
    assert.equal(t.fold.rowCount,6);
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:old,revision:t.fold.revision,
      oldRowCount:4,newRowCount:6,
      edits:[edited(p(2,0),p(2,0),p(3,0),p(4,0))]
    });
    t.close();
  }

  // A multirow removal references two visible row starts and needs no
  // hidden row materialization.
  {
    const t=make('top\nh1\nh2\nbody\nend');
    t.fold.setFolds([{startRow:1,endRow:3}]);
    const start=t.source.lineStart(3);
    const end=t.source.lineStart(4);
    t.source.replace(start,end,'');
    assert.equal(t.source.toString(),'top\nh1\nh2\nend');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edited(p(2,0),p(3,0),p(3,0),p(3,0))]);
    assert.equal(t.events.at(-1).geometry.oldRowCount,4);
    assert.equal(t.events.at(-1).geometry.newRowCount,4);
    t.close();
  }

  // An unsorted physical batch is still one commit; output edit order
  // stays in caller order even though the old folded rows are remapped.
  {
    const t=make('top\nh1\nh2\na\nb\nend');
    t.fold.setFolds([{startRow:1,endRow:3}]);
    const later=t.source.lineStart(4);
    const earlier=t.source.lineStart(3);
    const before=t.source.revision;
    t.source.replace
    (
      [
        {start:later,end:later,text:'Z'},
        {start:earlier,end:earlier,text:'Q'}
      ]
    );
    assert.equal(t.source.revision,before+1);
    assert.equal(t.source.toString(),'top\nh1\nh2\nQa\nZb\nend');
    assert.deepEqual(t.events.at(-1).geometry.edits,
    [
      edited(p(3,0),p(3,0),p(4,0),p(4,1)),
      edited(p(2,0),p(2,0),p(3,0),p(3,1))
    ]);
    t.close();
  }

  // The old coordinate system includes synthetic fold rows. A source
  // edit inside those rows, or spanning over them, has no single
  // editable folded counterpart: publish no precise geometry.
  {
    const t=make('top\nh1\nh2\nend');
    t.fold.setFolds([{startRow:1,endRow:3}]);
    t.source.replace(t.source.lineStart(2),t.source.lineStart(2),'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.fold.folds,[]);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    t.close();
  }

  {
    const t=make('top\nh1\nh2\nend');
    t.fold.setFolds([{startRow:1,endRow:3}]);
    t.source.replace(0,t.source.lineStart(3),'Q');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    t.close();
  }

  // A nonzero old endpoint cannot be certified from post-commit raw
  // geometry. Even a valid ASCII edit falls back rather than guessing.
  {
    const t=make('top\nh1\nh2\nend');
    t.fold.setFolds([{startRow:1,endRow:3}]);
    const start=t.source.lineStart(3)+1;
    t.source.replace(start,start+1,'X');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // CRLF may yield physical mutation positions inside a terminator,
  // which are not old caret boundaries. A direct cell input suppresses
  // those invalid points before the fold attempts any projection.
  {
    const t=make('a\r\nb\nc',true);
    t.fold.setFolds([{startRow:1,endRow:2}]);
    t.source.replace(2,2,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // Inline folding joins two source rows and has different boundary
  // semantics. It is outside the proven whole-row projection subset.
  {
    const t=make('abcdef\nHI\nxyz\ntail');
    t.fold.setInlineFold({start:p(0,2),end:p(2,1)});
    t.source.replace(t.source.lineStart(3),t.source.lineStart(3),'X');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.equal(t.fold.inlineFold,null);
    t.close();
  }

  // If the immediate input omitted old/new geometry, a successful edit
  // is still observable as full-view invalidation.
  {
    class NoGeometry extends Backend
    {
      _getLastGeometry()
      {
        return null;
      }
    }
    const source=new NoGeometry('top\nfold\ntail');
    const raw=new classes.RawDocument2D(source);
    const fold=new classes.FoldDocument2D(raw);
    const seen=[];
    fold.subscribe(event=>seen.push(event));
    fold.setFolds([{startRow:1,endRow:2}]);
    source.replace(0,0,'Z');
    assert.equal('geometry' in seen.at(-1),false);
    assert.deepEqual(seen.at(-1).invalidation,{all:true});
    fold.destroy();
    raw.destroy();
  }
}
console.log('fold whole-row old/new geometry PASS');
