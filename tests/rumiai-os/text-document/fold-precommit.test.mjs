// Capture old raw boundaries before edit, then compare with committed
// geometry. Inline folded rows and their two marker cuts are distinct.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'real product checkout required');
const compiled=spawnSync
(
  process.execPath,
  [resolve(root,'lib/sys/js/jsc.lib.js'),resolve(root,'lib/sys/js/core/modules-js.json')],
  {encoding:'utf8',maxBuffer:16*1024*1024}
);
assert.equal(compiled.status,0,compiled.stderr);
const dir=mkdtempSync(join(tmpdir(),'fold-precommit-'));
let classes;
try
{
  const output=join(dir,'core.cjs');
  writeFileSync(output,compiled.stdout);
  classes=createRequire(import.meta.url)(output).text.document;
}
finally
{
  rmSync(dir,{recursive:true,force:true});
}

const p=(row,col)=>({row,col});
const geometry=(oldStart,oldEnd,newStart,newEnd)=>
(
  {
    old:{start:oldStart,end:oldEnd},
    new:{start:newStart,end:newEnd}
  }
);

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  const open=(text='abcd\nHIDDEN\nuvwxyz\nTAIL',usingCell=false)=>
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const input=usingCell ? new classes.CellDocument2D(raw) : raw;
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
  const inline=t=>t.fold.setInlineFold
  (
    {start:p(0,2),end:p(2,1)}
  );

  // Prefix edits at a nonzero column refer to the old folded view.
  {
    const t=open();
    inline(t);
    assert.deepEqual(t.fold.getRect(0,0,2,40),['ab…vwxyz','TAIL']);
    const revision=t.fold.revision;
    t.source.replace(1,2,'B');
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:revision,revision:t.fold.revision,
      oldRowCount:2,newRowCount:4,
      edits:[geometry(p(0,1),p(0,2),p(0,1),p(0,2))]
    });
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    assert.equal(t.fold.inlineFold,null);
    assert.equal(t.source.toString(),'aBcd\nHIDDEN\nuvwxyz\nTAIL');
    assert.ok(Object.isFrozen(t.events.at(-1).geometry));
    assert.ok(Object.isFrozen(t.events.at(-1).geometry.edits[0].old.start));
    assert.equal('offset' in t.events.at(-1).geometry.edits[0].old.start,false);
    t.close();
  }

  // The visible suffix came from source row 2 but was displayed on
  // folded row 0, shifted by the prefix length and synthetic marker.
  {
    const t=open();
    inline(t);
    const cut=t.source.lineStart(2)+2;
    const old=t.fold.revision;
    t.source.replace(cut,cut+1,'W');
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:old,revision:t.fold.revision,
      oldRowCount:2,newRowCount:4,
      edits:[geometry(p(0,4),p(0,5),p(2,2),p(2,3))]
    });
    assert.equal(t.source.toString(),'abcd\nHIDDEN\nuvWxyz\nTAIL');
    t.close();
  }

  // Marker LEFT and RIGHT boundaries are distinct old physical cuts.
  {
    const t=open();
    inline(t);
    t.source.replace(2,2,'Q');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [geometry(p(0,2),p(0,2),p(0,2),p(0,3))]);
    t.close();
  }
  {
    const t=open();
    inline(t);
    const cut=t.source.lineStart(2)+1;
    t.source.replace(cut,cut,'Q');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [geometry(p(0,3),p(0,3),p(2,1),p(2,2))]);
    t.close();
  }

  // The public edit entrypoint translates a visible suffix cut once,
  // does not edit through the marker and rejects the stale view revision.
  {
    const t=open();
    inline(t);
    const revision=t.fold.revision;
    const physical=t.source.revision;
    t.fold.replace
    (
      [{start:p(0,4),end:p(0,5),text:'W'}],
      revision
    );
    assert.equal(t.source.revision,physical+1);
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [geometry(p(0,4),p(0,5),p(2,2),p(2,3))]);
    assert.throws
    (
      ()=>t.fold.replace
      (
        [{start:p(0,0),end:p(0,0),text:'!'}],revision
      ),
      /stale/
    );
    t.close();
  }

  // An unsorted physical batch edits two visible pieces of the same
  // folded row. The old/new endpoints remain in caller order.
  {
    const t=open();
    inline(t);
    const suffix=t.source.lineStart(2)+2;
    const revision=t.fold.revision;
    const physical=t.source.revision;
    t.source.replace
    (
      [
        {start:suffix,end:suffix+1,text:'W'},
        {start:1,end:2,text:'B'}
      ]
    );
    assert.equal(t.source.revision,physical+1);
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:revision,revision:t.fold.revision,
      oldRowCount:2,newRowCount:4,
      edits:
      [
        geometry(p(0,4),p(0,5),p(2,2),p(2,3)),
        geometry(p(0,1),p(0,2),p(0,1),p(0,2))
      ]
    });
    t.close();
  }

  // A row inserted after an inline fold is visible as a later output row
  // in the OLD view; new rows are physical after the fold disappears.
  {
    const t=open();
    inline(t);
    const old=t.fold.revision;
    const cut=t.source.lineStart(3);
    t.source.replace(cut,cut,'\n');
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:old,revision:t.fold.revision,
      oldRowCount:2,newRowCount:5,
      edits:[geometry(p(1,0),p(1,0),p(3,0),p(4,0))]
    });
    t.close();
  }

  // A whole-row fold now accepts proven old nonzero positions through
  // the same raw precommit observation, without accessing hidden rows.
  {
    const t=open();
    t.fold.setFolds([{startRow:1,endRow:3}]);
    const cut=t.source.lineStart(3)+2;
    t.source.replace(cut,cut+1,'I');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [geometry(p(2,2),p(2,3),p(3,2),p(3,3))]);
    assert.equal(t.fold.rowCount,4);
    t.close();
  }

  // Hidden text edited externally, or a span traversing the folded
  // interval, never receives a falsely editable old position.
  {
    const t=open();
    inline(t);
    t.source.replace(t.source.lineStart(1)+2,t.source.lineStart(1)+3,'X');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.equal(t.fold.inlineFold,null);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    t.close();
  }
  {
    const t=open();
    inline(t);
    t.source.replace(1,t.source.lineStart(2)+2,'Q');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // A CRLF terminator interior reports a raw offset but is not an old
  // caret position. Precommit capture must fail before projection.
  {
    const t=open('ab\r\nHIDDEN\nuvwxyz\nTAIL');
    t.fold.setInlineFold({start:p(0,1),end:p(2,1)});
    t.source.replace(3,3,'Q');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // The input must provide *matching* post-commit geometry. Missing
  // metadata cannot be made up even after a valid old observation.
  {
    class NoGeometry extends Backend
    {
      _getLastGeometry()
      {
        return null;
      }
    }
    const source=new NoGeometry('abcd\nHIDDEN\nuvwxyz');
    const raw=new classes.RawDocument2D(source);
    const fold=new classes.FoldDocument2D(raw);
    const events=[];
    fold.subscribe(event=>events.push(event));
    fold.setInlineFold({start:p(0,2),end:p(2,1)});
    source.replace(1,2,'X');
    assert.equal('geometry' in events.at(-1),false);
    fold.destroy();
    raw.destroy();
  }

  // Nested cell input has no direct physical observation through its
  // public interface. Inline projection stays conservative there.
  {
    const t=open('abcd\nHIDDEN\nuvwxyz\nTAIL',true);
    inline(t);
    t.source.replace(1,2,'Q');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // Local fold reconfiguration is not a physical mutation record.
  {
    const t=open();
    inline(t);
    assert.equal('geometry' in t.events.at(-1),false);
    t.fold.setInlineFold(null);
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }
}
console.log('fold old-boundary precommit geometry PASS');
