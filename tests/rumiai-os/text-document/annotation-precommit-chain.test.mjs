// Private old edit cuts across zero-width AnnotationDocument2D layers.
// Run the real jsc-compiled core on both physical document backends.
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
const dir=mkdtempSync(join(tmpdir(),'annotation-precommit-'));
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
const note=(id,row,col)=>({id,text:'label:'+id,at:p(row,col)});
const edit=(os,oe,ns,ne)=>
(
  {
    old:{start:os,end:oe},
    new:{start:ns,end:ne}
  }
);

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  function open(text,withCell=false)
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const cell=withCell ? new classes.CellDocument2D(raw) : null;
    const notes=new classes.AnnotationDocument2D(cell||raw);
    return {
      source,raw,cell,notes,
      close()
      {
        notes.destroy();
        if(cell)
        {
          cell.destroy();
        }
        raw.destroy();
      }
    };
  }

  // The anonymous observer sees the ANNOTATION revision, not its Raw
  // input revision. A local overlay update is not a physical edit.
  {
    const t=open('abc\nTAIL');
    const seen=[];
    const events=[];
    t.notes.subscribe(event=>events.push(event));
    const unsubscribe=t.notes._subscribeBeforeGeometry
    (
      captured=>seen.push(captured)
    );
    t.notes.setAnnotations([note('marker',1,2)]);
    assert.deepEqual(seen,[]);
    const oldRevision=t.notes.revision;
    t.source.replace(1,2,'Q');
    assert.deepEqual(seen,
    [
      {
        previousRevision:oldRevision,
        oldRowCount:2,
        edits:[{old:{start:p(0,1),end:p(0,2)}}]
      }
    ]);
    assert.ok(Object.isFrozen(seen[0]));
    assert.ok(Object.isFrozen(seen[0].edits));
    assert.ok(Object.isFrozen(seen[0].edits[0]));
    assert.ok(Object.isFrozen(seen[0].edits[0].old.start));
    assert.equal('offset' in seen[0].edits[0].old.start,false);
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,1),p(0,2),p(0,1),p(0,2))]);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.deepEqual(t.notes.annotations,[note('marker',1,2)]);
    unsubscribe();
    unsubscribe();
    t.source.replace(1,2,'B');
    assert.equal(seen.length,1);
    t.notes.destroy();
    t.source.replace(1,2,'C');
    assert.equal(seen.length,1);
    t.cell=null;
    t.raw.destroy();
  }

  // A Raw→Annotation→Fold inline splice maps old suffix rows without
  // forwarding raw offsets and commits a public edit exactly once.
  {
    const t=open('abcd\nHIDDEN\nuvwxyz\nTAIL');
    t.notes.setAnnotations([note('tail',3,2)]);
    const fold=new classes.FoldDocument2D(t.notes);
    const events=[];
    fold.subscribe(event=>events.push(event));
    fold.setInlineFold({start:p(0,2),end:p(2,1)});
    const revision=fold.revision;
    const sourceRevision=t.source.revision;
    fold.replace
    (
      [{start:p(0,4),end:p(0,5),text:'W'}],revision
    );
    assert.equal(t.source.revision,sourceRevision+1);
    assert.equal(t.source.toString(),'abcd\nHIDDEN\nuvWxyz\nTAIL');
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:fold.revision,
      oldRowCount:2,newRowCount:4,
      edits:[edit(p(0,4),p(0,5),p(2,2),p(2,3))]
    });
    assert.deepEqual(t.notes.annotations,[note('tail',3,2)]);
    assert.throws
    (
      ()=>fold.replace([{start:p(0,0),end:p(0,0),text:'!'}],revision),
      /stale/
    );
    fold.destroy();
    t.close();
  }

  // Raw→Cell→Annotation→Annotation→Fold maps precommit cuts across
  // two independent zero-width revision spaces and a TAB-containing
  // cell row. The physical batch order must remain unchanged.
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL',true);
    t.notes.setAnnotations([note('left',0,0)]);
    const outer=new classes.AnnotationDocument2D(t.notes);
    outer.setAnnotations([note('right',3,1)]);
    const fold=new classes.FoldDocument2D(outer);
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    const events=[];
    fold.subscribe(event=>events.push(event));
    const revision=fold.revision;
    const physical=t.source.revision;
    t.source.replace
    (
      [
        {start:t.source.lineStart(2)+1,end:t.source.lineStart(2)+2,text:'Y'},
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
    assert.equal('offset' in events.at(-1).geometry.edits[0].old.start,false);
    assert.deepEqual(outer.annotations,[note('right',3,1)]);
    fold.destroy();
    outer.destroy();
    t.close();
  }

  // A single Cell→Annotation→Substitution layer preserves the source
  // batch order across two occupied intervals of different cell widths.
  {
    const t=open('A\tBC😀DE\nTAIL',true);
    t.notes.setAnnotations([note('last',1,2)]);
    const view=new classes.SubstitutionDocument2D(t.notes);
    view.setSubstitutions
    (
      [
        {id:'right',text:'LONG',start:p(0,7),end:p(0,8)},
        {id:'left',text:'Q',start:p(0,4),end:p(0,6)}
      ]
    );
    const revision=view.revision;
    const events=[];
    view.subscribe(event=>events.push(event));
    const sourceRevision=t.source.revision;
    t.source.replace
    (
      [
        {start:7,end:8,text:'Z'},
        {start:0,end:1,text:'X'}
      ]
    );
    assert.equal(t.source.revision,sourceRevision+1);
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
    assert.deepEqual(view.substitutions,[]);
    assert.deepEqual(t.notes.annotations,[note('last',1,2)]);
    view.destroy();
    t.close();
  }

  // An annotation above a collapsed synthetic view still clears local
  // notes, even though valid old/new edit endpoints are forwarded.
  {
    const t=open('top\nabcdefg\nlast',true);
    const synthetic=new classes.SubstitutionDocument2D(t.notes);
    synthetic.setSubstitutions
    (
      [{id:'occupied',text:'XXXXX',start:p(1,1),end:p(1,4)}]
    );
    const higher=new classes.AnnotationDocument2D(synthetic);
    higher.setAnnotations([note('suffix',1,7)]);
    const events=[];
    higher.subscribe(event=>events.push(event));
    t.source.replace(0,0,'Q');
    assert.ok(events.at(-1).geometry);
    assert.deepEqual(higher.annotations,[]);
    higher.destroy();
    synthetic.destroy();
    t.close();
  }

  // An edit inside an occupied input interval is not a visible edit
  // despite a perfectly valid intermediate cell edit geometry.
  {
    const t=open('A\tBC😀DE',true);
    const view=new classes.SubstitutionDocument2D(t.notes);
    view.setSubstitutions
    (
      [{id:'occupied',text:'X',start:p(0,4),end:p(0,6)}]
    );
    const events=[];
    view.subscribe(event=>events.push(event));
    t.source.replace(2,3,'Y');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    view.destroy();
    t.close();
  }

  // Grapheme interiors and CRLF terminators cannot become precommit
  // caret cuts. They must invalidate, not fabricate old geometry.
  {
    const t=open('A😀B\nsecond',true);
    const fold=new classes.FoldDocument2D(t.notes);
    fold.setInlineFold({start:p(0,1),end:p(1,1)});
    const events=[];
    fold.subscribe(event=>events.push(event));
    t.source.replace(2,2,'Z');
    assert.equal('geometry' in events.at(-1),false);
    assert.equal(fold.inlineFold,null);
    fold.destroy();
    t.close();
  }
  {
    const t=open('ab\r\nHIDDEN\nuvwxyz');
    const fold=new classes.FoldDocument2D(t.notes);
    fold.setInlineFold({start:p(0,1),end:p(2,1)});
    const events=[];
    fold.subscribe(event=>events.push(event));
    t.source.replace(3,3,'Z');
    assert.equal('geometry' in events.at(-1),false);
    fold.destroy();
    t.close();
  }

  // A missing physical observation or an incompatible postcommit batch
  // cannot be turned into precise geometry by the annotation bridge.
  {
    class NoPrecommit extends Backend
    {
      _subscribeBeforeGeometry(_)
      {
        return null;
      }
    }
    const source=new NoPrecommit('abcd\nHIDDEN\nuvwxyz');
    const raw=new classes.RawDocument2D(source);
    const notes=new classes.AnnotationDocument2D(raw);
    assert.equal(notes._subscribeBeforeGeometry(()=>{}),null);
    const fold=new classes.FoldDocument2D(notes);
    fold.setInlineFold({start:p(0,2),end:p(2,1)});
    const events=[];
    fold.subscribe(event=>events.push(event));
    source.replace(1,2,'Q');
    assert.equal('geometry' in events.at(-1),false);
    fold.destroy();
    notes.destroy();
    raw.destroy();
  }
  {
    class BadGeometry extends Backend
    {
      _getLastGeometry()
      {
        const original=super._getLastGeometry();

        if(!original)
        {
          return original;
        }

        return {
          ...original,
          edits:original.edits.map
          (
            change =>
            (
              {
                ...change,
                old:
                {
                  ...change.old,
                  start:{...change.old.start,offset:change.old.start.offset+1}
                }
              }
            )
          )
        };
      }
    }
    const source=new BadGeometry('A\tBC😀DE');
    const raw=new classes.RawDocument2D(source);
    const cell=new classes.CellDocument2D(raw);
    const notes=new classes.AnnotationDocument2D(cell);
    const view=new classes.SubstitutionDocument2D(notes);
    view.setSubstitutions
    (
      [{id:'occupied',text:'X',start:p(0,4),end:p(0,6)}]
    );
    const events=[];
    view.subscribe(event=>events.push(event));
    source.replace(7,8,'Z');
    assert.equal('geometry' in events.at(-1),false);
    assert.equal(source.toString(),'A\tBC😀DZ');
    view.destroy();
    notes.destroy();
    cell.destroy();
    raw.destroy();
  }

  // The Raw event may have plausible {row,col} but a corrupted
  // original physical offset. Annotation verifies offsets privately
  // and neither its own event nor a fold may certify that batch.
  {
    class MismatchedRaw extends Backend
    {
      _getLastGeometry()
      {
        const result=super._getLastGeometry();

        if(!result)
        {
          return result;
        }

        return {
          ...result,
          edits:result.edits.map
          (
            item =>
            (
              {
                ...item,
                old:
                {
                  ...item.old,
                  start:{...item.old.start,offset:item.old.start.offset+1}
                }
              }
            )
          )
        };
      }
    }

    const source=new MismatchedRaw('abcd\\nHIDDEN\\nuvwxyz');
    const raw=new classes.RawDocument2D(source);
    const notes=new classes.AnnotationDocument2D(raw);
    const fold=new classes.FoldDocument2D(notes);
    fold.setInlineFold({start:p(0,2),end:p(2,1)});
    const noteEvents=[];
    const foldEvents=[];
    notes.subscribe(event=>noteEvents.push(event));
    fold.subscribe(event=>foldEvents.push(event));
    source.replace(1,2,'Q');
    assert.equal(source.toString(),'aQcd\\nHIDDEN\\nuvwxyz');
    assert.equal('geometry' in noteEvents.at(-1),false);
    assert.equal('geometry' in foldEvents.at(-1),false);
    assert.deepEqual(foldEvents.at(-1).invalidation,{all:true});
    fold.destroy();
    notes.destroy();
    raw.destroy();
  }

  // A broken observer cannot cancel a valid physical source commit
  // or stop the remaining observers of the private notification.
  {
    const t=open('abc\\nTAIL');
    const errors=[];
    const seen=[];
    const originalConsoleError=console.error;
    const failed=t.notes._subscribeBeforeGeometry
    (
      () => {throw new Error('observer regression probe');}
    );
    t.notes._subscribeBeforeGeometry(captured=>seen.push(captured));
    let committed=false;

    try
    {
      console.error=(...args)=>errors.push(args);
      t.source.replace(1,2,'Q');
      committed=true;
    }
    finally
    {
      console.error=originalConsoleError;
    }

    assert.equal(committed,true);
    assert.equal(t.source.toString(),'aQc\\nTAIL');
    assert.equal(seen.length,1);
    assert.equal(errors.length,1);
    assert.match(errors[0][0],/annotation pre-commit geometry observer/);
    failed();
    t.close();
  }

  // A nonidentity Fold is NOT an old-coordinate identity relay. An
  // annotation directly above it has no private fold precommit hook.
  {
    const t=open('abcd\nHIDDEN\nuvwxyz\nTAIL');
    const folded=new classes.FoldDocument2D(t.raw);
    folded.setFolds([{startRow:1,endRow:3}]);
    const notes=new classes.AnnotationDocument2D(folded);
    assert.equal(notes._subscribeBeforeGeometry(()=>{}),null);
    const view=new classes.SubstitutionDocument2D(notes);
    view.setSubstitutions
    (
      [{id:'occupied',text:'X',start:p(0,1),end:p(0,3)}]
    );
    const events=[];
    view.subscribe(event=>events.push(event));
    t.source.replace(t.source.lineStart(3)+1,t.source.lineStart(3)+2,'Q');
    assert.equal('geometry' in events.at(-1),false);
    view.destroy();
    notes.destroy();
    folded.destroy();
    t.close();
  }
}
console.log('annotation identity precommit geometry PASS');
