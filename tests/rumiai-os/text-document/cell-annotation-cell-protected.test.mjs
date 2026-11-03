// Proof of final Fold/Substitution geometry above Cell -> Annotation -> Cell.
// Exercise the real jsc core and both independent physical text stores.
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
const dir=mkdtempSync(join(tmpdir(),'cell-annotation-cell-protected-'));
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
  {old:{start:os,end:oe},new:{start:ns,end:ne}}
);
const note=(id,row,col)=>({id,text:'note:'+id,at:p(row,col)});

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  function open(text,depth=1,OuterCell=classes.CellDocument2D)
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const lower=new classes.CellDocument2D(raw,4);
    const overlays=[];
    let input=lower;
    for(let i=0;i<depth;i++)
    {
      input=new classes.AnnotationDocument2D(input);
      overlays.push(input);
    }
    const upper=new OuterCell(input,8);
    return {
      source,raw,lower,overlays,upper,
      close()
      {
        upper.destroy();
        for(const layer of overlays.slice().reverse())
        {
          layer.destroy();
        }
        lower.destroy();
        raw.destroy();
      }
    };
  }

  // Two distinct zero-width annotation revisions precede an inline fold.
  // The suffix belongs to source row 2 but old folded row 0; physical
  // invocation order, not sorted display order, remains authoritative.
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL',2);
    t.overlays[0].setAnnotations([note('first',3,0)]);
    t.overlays[1].setAnnotations([note('second',3,2)]);
    const fold=new classes.FoldDocument2D(t.upper);
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    assert.deepEqual(fold.getRect(0,0,2,30),['A   …y😀z','TAIL']);
    const events=[];
    fold.subscribe(e=>events.push(e));
    const revision=fold.revision;
    const physical=t.source.revision;
    const suffix=t.source.lineStart(2)+1;
    t.source.replace
    (
      [
        {start:suffix,end:suffix+1,text:'Y'},
        {start:0,end:1,text:'Q'}
      ]
    );
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'Q\tB😀C\nHIDDEN\nxY😀z\nTAIL');
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:fold.revision,
      oldRowCount:2,newRowCount:4,
      edits:
      [
        edit(p(0,5),p(0,6),p(2,1),p(2,2)),
        edit(p(0,0),p(0,1),p(0,0),p(0,1))
      ]
    });
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.equal(fold.inlineFold,null);
    assert.ok(Object.isFrozen(events.at(-1).geometry));
    assert.ok(Object.isFrozen(events.at(-1).geometry.edits[0].old.start));
    assert.equal('offset' in events.at(-1).geometry.edits[0].old.start,false);
    assert.deepEqual(t.overlays[1].annotations,[note('second',3,2)]);
    fold.destroy();
    t.close();
  }

  // Both sides of the inline marker are separate input coordinates.
  // A public edit via the visible suffix is one atomic physical commit.
  for(const side of ['left','right','suffix'])
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL');
    const fold=new classes.FoldDocument2D(t.upper);
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    const events=[];
    fold.subscribe(e=>events.push(e));
    const revision=fold.revision;
    const physical=t.source.revision;
    if(side==='left')
    {
      fold.replace([{start:p(0,4),end:p(0,4),text:'Q'}],revision);
      assert.deepEqual(events.at(-1).geometry.edits,
        [edit(p(0,4),p(0,4),p(0,4),p(0,5))]);
    }
    else if(side==='right')
    {
      fold.replace([{start:p(0,5),end:p(0,5),text:'Q'}],revision);
      assert.deepEqual(events.at(-1).geometry.edits,
        [edit(p(0,5),p(0,5),p(2,1),p(2,2))]);
    }
    else
    {
      fold.replace([{start:p(0,5),end:p(0,6),text:'Y'}],revision);
      assert.deepEqual(events.at(-1).geometry.edits,
        [edit(p(0,5),p(0,6),p(2,1),p(2,2))]);
    }
    assert.equal(t.source.revision,physical+1);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.throws
    (
      ()=>fold.replace([{start:p(0,0),end:p(0,0),text:'!'}],revision),
      /stale/
    );
    fold.destroy();
    t.close();
  }

  // Crossing an inline protected marker cannot become a text target.
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL');
    const fold=new classes.FoldDocument2D(t.upper);
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    const physical=t.source.revision;
    assert.throws
    (
      ()=>fold.replace
      (
        [{start:p(0,4),end:p(0,5),text:'Q'}],
        fold.revision
      ),
      /fold/
    );
    assert.equal(t.source.revision,physical);
    fold.destroy();
    t.close();
  }

  // A whole-row fold also maps nonzero input CELL cuts across row shifts.
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL');
    const fold=new classes.FoldDocument2D(t.upper);
    fold.setFolds([{startRow:1,endRow:3}]);
    const events=[];
    fold.subscribe(e=>events.push(e));
    const physical=t.source.revision;
    const at=t.source.lineStart(3)+1;
    t.source.replace(at,at+1,'A');
    assert.equal(t.source.revision,physical+1);
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(2,1),p(2,2),p(3,1),p(3,2))]);
    assert.deepEqual(fold.folds,[]);
    fold.destroy();
    t.close();
  }

  // Hidden external edits cannot be represented by old fold coordinates.
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL');
    const fold=new classes.FoldDocument2D(t.upper);
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    const events=[];
    fold.subscribe(e=>events.push(e));
    const at=t.source.lineStart(1)+2;
    t.source.replace(at,at+1,'Q');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.equal(fold.inlineFold,null);
    fold.destroy();
    t.close();
  }

  // Substitution protects two intervals with different display widths;
  // old suffix cuts must be measured in the old substituted CELL view.
  {
    const t=open('A\tBC😀DE\nTAIL',2);
    t.overlays[0].setAnnotations([note('left',1,1)]);
    t.overlays[1].setAnnotations([note('right',1,3)]);
    const view=new classes.SubstitutionDocument2D(t.upper);
    view.setSubstitutions
    (
      [
        {id:'right',text:'LONG',start:p(0,7),end:p(0,8)},
        {id:'left',text:'Q',start:p(0,4),end:p(0,6)}
      ]
    );
    const events=[];
    view.subscribe(e=>events.push(e));
    const revision=view.revision;
    const physical=t.source.revision;
    t.source.replace
    (
      [
        {start:7,end:8,text:'Z'},
        {start:0,end:1,text:'X'}
      ]
    );
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'X\tBC😀DZ\nTAIL');
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:view.revision,
      oldRowCount:2,newRowCount:2,
      edits:
      [
        edit(p(0,10),p(0,11),p(0,8),p(0,9)),
        edit(p(0,0),p(0,1),p(0,0),p(0,1))
      ]
    });
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.deepEqual(view.substitutions,[]);
    assert.deepEqual(t.overlays[1].annotations,[note('right',1,3)]);
    assert.ok(Object.isFrozen(events.at(-1).geometry.edits[0].new.end));
    assert.equal('offset' in events.at(-1).geometry.edits[0].new.end,false);
    view.destroy();
    t.close();
  }

  // Public replacement edits source suffix, not the occupied display
  // label, and rejects a stale view revision after its one source commit.
  {
    const t=open('A\tBC😀DE\nTAIL');
    const view=new classes.SubstitutionDocument2D(t.upper);
    view.setSubstitutions
    (
      [
        {id:'right',text:'LONG',start:p(0,7),end:p(0,8)},
        {id:'left',text:'Q',start:p(0,4),end:p(0,6)}
      ]
    );
    const events=[];
    view.subscribe(e=>events.push(e));
    const revision=view.revision;
    const physical=t.source.revision;
    assert.throws
    (
      ()=>view.replace
      (
        [{start:p(0,5),end:p(0,5),text:'Q'}],revision
      ),
      /substitut/
    );
    assert.equal(t.source.revision,physical);
    view.replace([{start:p(0,10),end:p(0,11),text:'Z'}],revision);
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'A\tBC😀DZ\nTAIL');
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,10),p(0,11),p(0,8),p(0,9))]);
    assert.deepEqual(view.substitutions,[]);
    assert.throws
    (
      ()=>view.replace
      (
        [{start:p(0,0),end:p(0,0),text:'!'}],revision
      ),
      /stale/
    );
    view.destroy();
    t.close();
  }

  // Edits inside protected occupied source and a shared adjacent
  // synthetic boundary cannot be given a unique previous view point.
  for(const kind of ['hidden','shared'])
  {
    const t=open('A\tBC😀DE');
    const view=new classes.SubstitutionDocument2D(t.upper);
    view.setSubstitutions
    (
      kind==='hidden' ?
      [{id:'one',text:'X',start:p(0,4),end:p(0,6)}] :
      [
        {id:'one',text:'LONG',start:p(0,4),end:p(0,6)},
        {id:'two',text:'Z',start:p(0,6),end:p(0,7)}
      ]
    );
    const events=[];
    view.subscribe(e=>events.push(e));
    if(kind==='hidden')
    {
      t.source.replace(2,3,'Y');
    }
    else
    {
      t.source.replace(4,4,'Q');
    }
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.deepEqual(view.substitutions,[]);
    view.destroy();
    t.close();
  }

  // Derived labels are display dependencies, never edit destinations.
  {
    const t=open('A\tBC😀DE\nTAIL');
    const view=new classes.SubstitutionDocument2D(t.upper);
    view.setSubstitutions
    (
      [{
        id:'copied',
        start:p(0,4),end:p(0,6),
        sources:[{start:p(1,1),end:p(1,3)}]
      }]
    );
    const events=[];
    view.subscribe(e=>events.push(e));
    assert.throws
    (
      ()=>view.replace
      (
        [{start:p(0,4),end:p(0,6),text:'Q'}],view.revision
      ),
      /substitut/
    );
    const at=t.source.lineStart(1)+2;
    t.source.replace(at,at+1,'X');
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(1,2),p(1,3),p(1,2),p(1,3))]);
    assert.deepEqual(view.substitutions,[]);
    view.destroy();
    t.close();
  }

  // Overlay-only changes trigger conservative clearing of Fold and
  // Substitution configurations but NEVER claim physical edit geometry.
  for(const Kind of [classes.FoldDocument2D,classes.SubstitutionDocument2D])
  {
    const t=open('A\tBC\nTAIL');
    const view=new Kind(t.upper);
    if(Kind===classes.FoldDocument2D)
    {
      view.setFolds([{startRow:1,endRow:2}]);
    }
    else
    {
      view.setSubstitutions
      (
        [{id:'occupied',text:'Q',start:p(0,4),end:p(0,6)}]
      );
    }
    const events=[];
    view.subscribe(e=>events.push(e));
    const physical=t.source.revision;
    t.overlays[0].setAnnotations([note('new',1,1)]);
    assert.equal(t.source.revision,physical);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    if(Kind===classes.FoldDocument2D)
    {
      assert.deepEqual(view.folds,[]);
    }
    else
    {
      assert.deepEqual(view.substitutions,[]);
    }
    view.destroy();
    t.close();
  }

  // A valid old upper Cell observation is not enough when its committed
  // event is altered: both consumers reject mismatching old input cuts.
  class BrokenUpperCell extends classes.CellDocument2D
  {
    subscribe(listener)
    {
      return super.subscribe
      (
        event =>
        {
          if(!event.geometry)
          {
            listener(event);
            return;
          }

          const geometry=event.geometry;
          listener
          (
            {
              ...event,
              geometry:
              {
                ...geometry,
                edits:geometry.edits.map
                (
                  (item,index) =>
                    index===0 ?
                      {
                        ...item,
                        old:
                        {
                          ...item.old,
                          start:{...item.old.start,col:item.old.start.col+1}
                        }
                      } :
                      item
                )
              }
            }
          );
        }
      );
    }
  }

  for(const Kind of [classes.FoldDocument2D,classes.SubstitutionDocument2D])
  {
    const t=open('abcdef\nHIDDEN\nuvwxyz\nTAIL',1,BrokenUpperCell);
    const view=new Kind(t.upper);
    if(Kind===classes.FoldDocument2D)
    {
      view.setInlineFold({start:p(0,2),end:p(2,1)});
    }
    else
    {
      view.setSubstitutions
      (
        [{id:'occupied',text:'LONG',start:p(0,2),end:p(0,4)}]
      );
    }
    const events=[];
    view.subscribe(e=>events.push(e));
    t.source.replace(0,1,'Q');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    view.destroy();
    t.close();
  }
}
console.log('Cell over annotated Cell to Fold/Substitution geometry PASS');
