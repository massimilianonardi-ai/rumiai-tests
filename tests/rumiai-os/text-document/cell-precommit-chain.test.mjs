// Private old-cell observation for immediate Fold/Substitution consumers.
// Exercise actual jsc-compiled core with independent physical backends.
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
const dir=mkdtempSync(join(tmpdir(),'cell-precommit-chain-'));
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
const edit=(os,oe,ns,ne)=>
(
  {
    old:{start:os,end:oe},
    new:{start:ns,end:ne}
  }
);

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  function open(text)
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const cell=new classes.CellDocument2D(raw);
    return {
      source,raw,cell,
      close()
      {
        cell.destroy();
        raw.destroy();
      }
    };
  }

  // The private observer receives old CELL points and a CELL revision,
  // not old source offsets. Postcommit points are published separately.
  {
    const t=open('A\tB😀C\nlast');
    const observations=[];
    const events=[];
    const unsubscribe=t.cell._subscribeBeforeGeometry
    (
      event=>observations.push(event)
    );
    t.cell.subscribe(event=>events.push(event));
    t.source.replace(5,6,'D');
    assert.equal(t.source.toString(),'A\tB😀D\nlast');
    assert.deepEqual(observations,
    [
      {
        previousRevision:0,
        oldRowCount:2,
        edits:[{old:{start:p(0,6),end:p(0,7)}}]
      }
    ]);
    assert.ok(Object.isFrozen(observations[0]));
    assert.ok(Object.isFrozen(observations[0].edits));
    assert.ok(Object.isFrozen(observations[0].edits[0].old.start));
    assert.equal('offset' in observations[0].edits[0].old.start,false);
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,6),p(0,7),p(0,6),p(0,7))]);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    unsubscribe();
    unsubscribe();
    t.source.replace(5,6,'E');
    assert.equal(observations.length,1);
    t.close();
  }

  // TAB reflow can affect surrounding cells. Exact old/new edit points
  // remain authoritative but the whole view is still invalidated.
  {
    const t=open('A\tB\nnext');
    const events=[];
    t.cell.subscribe(event=>events.push(event));
    const revision=t.cell.revision;
    t.source.replace(1,1,'Q');
    assert.equal(t.source.toString(),'AQ\tB\nnext');
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:t.cell.revision,
      oldRowCount:2,newRowCount:2,
      edits:[edit(p(0,1),p(0,1),p(0,1),p(0,2))]
    });
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    t.close();
  }

  // A TAB, grapheme or CRLF interior cannot become a precommit caret.
  {
    const t=open('A😀B');
    const seen=[];
    t.cell._subscribeBeforeGeometry(event=>seen.push(event));
    const events=[];
    t.cell.subscribe(event=>events.push(event));
    t.source.replace(2,2,'Q');
    assert.deepEqual(seen,[]);
    assert.equal('geometry' in events.at(-1),false);
    t.close();
  }
  {
    const t=open('A\r\nB');
    const seen=[];
    t.cell._subscribeBeforeGeometry(event=>seen.push(event));
    const events=[];
    t.cell.subscribe(event=>events.push(event));
    t.source.replace(2,2,'Q');
    assert.deepEqual(seen,[]);
    assert.equal('geometry' in events.at(-1),false);
    t.close();
  }

  // The upper Cell independently maps the immediate Cell's verified
  // old/new endpoints. Neither private observer exposes raw offsets.
  {
    const t=open('A\tB😀C');
    const outer=new classes.CellDocument2D(t.cell);
    const seen=[];
    outer._subscribeBeforeGeometry(event=>seen.push(event));
    const events=[];
    outer.subscribe(event=>events.push(event));
    const revision=outer.revision;
    t.source.replace(5,6,'D');
    assert.deepEqual(seen,
    [
      {
        previousRevision:revision,
        oldRowCount:1,
        edits:[{old:{start:p(0,6),end:p(0,7)}}]
      }
    ]);
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:outer.revision,
      oldRowCount:1,newRowCount:1,
      edits:[edit(p(0,6),p(0,7),p(0,6),p(0,7))]
    });
    assert.equal('offset' in seen[0].edits[0].old.start,false);
    assert.ok(Object.isFrozen(seen[0].edits[0].old.start));
    outer.destroy();
    t.close();
  }

  // Fold after Cell: precommit right marker boundary maps a *different*
  // immediate-input point from the left boundary; old suffix row collapses.
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL');
    const fold=new classes.FoldDocument2D(t.cell);
    const events=[];
    fold.subscribe(event=>events.push(event));
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    assert.deepEqual(fold.getRect(0,0,2,30),['A   …y😀z','TAIL']);
    const revision=fold.revision;
    const physical=t.source.revision;
    const at=t.source.lineStart(2)+1;
    t.source.replace(at,at+1,'Y');
    assert.equal(t.source.revision,physical+1);
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:fold.revision,
      oldRowCount:2,newRowCount:4,
      edits:[edit(p(0,5),p(0,6),p(2,1),p(2,2))]
    });
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    fold.destroy();
    t.close();
  }
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z');
    const fold=new classes.FoldDocument2D(t.cell);
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    const seen=[];
    fold.subscribe(event=>seen.push(event));
    const before=t.source.revision;
    const revision=fold.revision;
    fold.replace([{start:p(0,4),end:p(0,4),text:'Q'}],revision);
    assert.equal(t.source.revision,before+1);
    assert.deepEqual(seen.at(-1).geometry.edits,
      [edit(p(0,4),p(0,4),p(0,4),p(0,5))]);
    assert.throws
    (
      ()=>fold.replace([{start:p(0,0),end:p(0,0),text:'Z'}],revision),
      /stale/
    );
    fold.destroy();
    t.close();
  }

  // Substitution after Cell: old suffix coordinates include both
  // occupied widths and input TAB/grapheme widths.
  {
    const t=open('A\tBC😀DE\nTAIL');
    const view=new classes.SubstitutionDocument2D(t.cell);
    const seen=[];
    view.subscribe(event=>seen.push(event));
    view.setSubstitutions
    (
      [
        {id:'two',text:'LONG',start:p(0,7),end:p(0,8)},
        {id:'one',text:'Q',start:p(0,4),end:p(0,6)}
      ]
    );
    const revision=view.revision;
    const before=t.source.revision;
    t.source.replace
    (
      [
        {start:7,end:8,text:'Z'},
        {start:0,end:1,text:'X'}
      ]
    );
    assert.equal(t.source.revision,before+1);
    assert.equal(t.source.toString(),'X\tBC😀DZ\nTAIL');
    assert.deepEqual(seen.at(-1).geometry,
    {
      previousRevision:revision,revision:view.revision,
      oldRowCount:2,newRowCount:2,
      edits:
      [
        edit(p(0,10),p(0,11),p(0,8),p(0,9)),
        edit(p(0,0),p(0,1),p(0,0),p(0,1))
      ]
    });
    assert.deepEqual(view.substitutions,[]);
    view.destroy();
    t.close();
  }

  // Physical edits inside an occupied region remain invisible to the
  // substitution view even when Cell publishes exact old/new geometry.
  {
    const t=open('A\tBC😀DE');
    const view=new classes.SubstitutionDocument2D(t.cell);
    view.setSubstitutions
    (
      [{id:'hidden',text:'X',start:p(0,4),end:p(0,6)}]
    );
    const seen=[];
    view.subscribe(event=>seen.push(event));
    t.source.replace(2,3,'Y');
    assert.equal('geometry' in seen.at(-1),false);
    assert.deepEqual(seen.at(-1).invalidation,{all:true});
    view.destroy();
    t.close();
  }

  // A grapheme edit with a nonrepresentable old cut must not be
  // certified by either the intermediate Cell or the upper view.
  {
    const t=open('A😀B\nother');
    const fold=new classes.FoldDocument2D(t.cell);
    fold.setInlineFold({start:p(0,1),end:p(1,1)});
    const seen=[];
    fold.subscribe(event=>seen.push(event));
    t.source.replace(2,2,'Q');
    assert.equal('geometry' in seen.at(-1),false);
    assert.equal(fold.inlineFold,null);
    fold.destroy();
    t.close();
  }
}
console.log('cell immediate-view precommit geometry PASS');
