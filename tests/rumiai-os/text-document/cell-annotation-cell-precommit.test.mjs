// Independently verified Cell -> zero-width Annotation -> Cell edit geometry.
// The compiled real document engine and both physical backends are exercised.
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
const dir=mkdtempSync(join(tmpdir(),'cell-annotation-cell-'));
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
const note=(id,row,col)=>({id,text:'note:'+id,at:p(row,col)});
const edit=(os,oe,ns,ne)=>
(
  {
    old:{start:os,end:oe},
    new:{start:ns,end:ne}
  }
);

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  function open(text,depth=1)
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const first=new classes.CellDocument2D(raw,4);
    const overlays=[];
    let input=first;
    for(let i=0;i<depth;i++)
    {
      input=new classes.AnnotationDocument2D(input);
      overlays.push(input);
    }
    const second=new classes.CellDocument2D(input,8);
    return {
      source,raw,first,overlays,second,
      close()
      {
        second.destroy();
        for(const overlay of overlays.slice().reverse())
        {
          overlay.destroy();
        }
        first.destroy();
        raw.destroy();
      }
    };
  }

  // Two distinct annotation revisions: an unsorted physical batch must
  // match the immediate annotated CELL coordinates at both endpoints.
  {
    const t=open('A\tBC😀DE\nTAIL',2);
    t.overlays[0].setAnnotations([note('first',1,1)]);
    t.overlays[1].setAnnotations([note('second',1,3)]);
    assert.equal(t.overlays[1]._hasRawCoordinateIdentity(),false);
    assert.equal(t.overlays[1]._hasCellCoordinateIdentity(),true);
    assert.equal(t.first.getRowWidth(0),9);
    assert.equal(t.second.getRowWidth(0),9);
    const observations=[],events=[];
    const unsubscribe=t.second._subscribeBeforeGeometry(g=>observations.push(g));
    t.second.subscribe(e=>events.push(e));
    const before=t.second.revision;
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
    assert.deepEqual(observations,
    [
      {
        previousRevision:before,
        oldRowCount:2,
        edits:
        [
          {old:{start:p(0,8),end:p(0,9)}},
          {old:{start:p(0,0),end:p(0,1)}}
        ]
      }
    ]);
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:before,revision:t.second.revision,
      oldRowCount:2,newRowCount:2,
      edits:
      [
        edit(p(0,8),p(0,9),p(0,8),p(0,9)),
        edit(p(0,0),p(0,1),p(0,0),p(0,1))
      ]
    });
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.deepEqual(t.overlays[0].annotations,[note('first',1,1)]);
    assert.deepEqual(t.overlays[1].annotations,[note('second',1,3)]);
    assert.ok(Object.isFrozen(observations[0]));
    assert.ok(Object.isFrozen(observations[0].edits));
    assert.ok(Object.isFrozen(observations[0].edits[0].old.start));
    assert.ok(Object.isFrozen(events.at(-1).geometry.edits[0].new.end));
    assert.equal('offset' in observations[0].edits[0].old.start,false);
    assert.equal('offset' in events.at(-1).geometry.edits[0].new.end,false);
    unsubscribe();
    unsubscribe();
    t.source.replace(7,8,'Y');
    assert.equal(observations.length,1);
    t.close();
  }

  // A local annotation-only revision changes the upper Cell revision,
  // but is not reported as a physical edit or a precommit observation.
  {
    const t=open('A\tBC\nTAIL');
    const prepared=[],events=[];
    t.second._subscribeBeforeGeometry(g=>prepared.push(g));
    t.second.subscribe(e=>events.push(e));
    const firstRevision=t.first.revision;
    const previous=t.second.revision;
    t.overlays[0].setAnnotations([note('unchanged',1,2)]);
    assert.equal(t.first.revision,firstRevision);
    assert.equal(t.second.revision,previous+1);
    assert.deepEqual(prepared,[]);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    t.close();
  }

  // Public outer edit: TAB is fixed-width from the lower Cell and a
  // zero-width annotation label is never an editable text destination.
  {
    const t=open('A\tBC\nTAIL');
    t.overlays[0].setAnnotations([note('visible',1,1)]);
    const events=[];
    t.second.subscribe(e=>events.push(e));
    const physical=t.source.revision;
    const revision=t.second.revision;
    assert.equal(t.second.getRowWidth(0),6);
    assert.throws
    (
      ()=>t.second.replace
      (
        [{start:p(0,2),end:p(0,2),text:'Q'}],revision
      ),
      /boundary|indivisible/
    );
    assert.equal(t.source.revision,physical);
    t.second.replace
    (
      [{start:p(0,1),end:p(0,1),text:'Q'}],revision
    );
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'AQ\tBC\nTAIL');
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,1),p(0,1),p(0,1),p(0,2))]);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.deepEqual(t.overlays[0].annotations,[note('visible',1,1)]);
    assert.equal
    (
      t.second.getRegions(1,0,2,4)[0]
        .some(r=>r.kind==='annotation'&&r.id==='visible'),
      true
    );
    assert.throws
    (
      ()=>t.second.replace
      (
        [{start:p(0,0),end:p(0,0),text:'Z'}],revision
      ),
      /stale/
    );
    t.close();
  }

  // A physical newline edit has independently verified old/new row counts
  // through every layer, not a guessed column delta.
  {
    const t=open('abc\nsecond\nTAIL');
    t.overlays[0].setAnnotations([note('prefix',0,1)]);
    const events=[];
    t.second.subscribe(e=>events.push(e));
    const revision=t.second.revision;
    const at=t.source.lineStart(1)+3;
    t.source.replace(at,at,'\n');
    assert.equal(t.source.toString(),'abc\nsec\nond\nTAIL');
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:t.second.revision,
      oldRowCount:3,newRowCount:4,
      edits:[edit(p(1,3),p(1,3),p(1,3),p(2,0))]
    });
    assert.equal(t.second.rowCount,4);
    t.close();
  }

  // A cut inside a source grapheme or CRLF terminator cannot acquire
  // a trustworthy outer observation by passing through annotations.
  for(const [sourceText,at] of [['A😀B',2],['A\r\nB',2]])
  {
    const t=open(sourceText);
    const observed=[],events=[];
    t.second._subscribeBeforeGeometry(g=>observed.push(g));
    t.second.subscribe(e=>events.push(e));
    t.source.replace(at,at,'Q');
    assert.deepEqual(observed,[]);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    t.close();
  }

  // An initially valid old cut becomes a new grapheme interior. Old
  // observation alone never proves the upper postcommit geometry.
  {
    const t=open('aB');
    const observed=[],events=[];
    t.second._subscribeBeforeGeometry(g=>observed.push(g));
    t.second.subscribe(e=>events.push(e));
    t.source.replace(1,1,'\u0301');
    assert.equal(observed.length,1);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    t.close();
  }

  // A corrupted lower Cell postcommit old endpoint must be rejected
  // by the annotation relay BEFORE the outer Cell can publish geometry.
  {
    class BrokenCell extends classes.CellDocument2D
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
            const edits=geometry.edits.map
            (
              (item,index) =>
              (
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
            );
            listener({...event,geometry:{...geometry,edits}});
          }
        );
      }
    }

    const source=new Backend('abc');
    const raw=new classes.RawDocument2D(source);
    const lower=new BrokenCell(raw);
    const notes=new classes.AnnotationDocument2D(lower);
    const upper=new classes.CellDocument2D(notes);
    const observed=[],events=[];
    upper._subscribeBeforeGeometry(g=>observed.push(g));
    upper.subscribe(e=>events.push(e));
    source.replace(1,2,'Z');
    assert.equal(source.toString(),'aZc');
    assert.equal(observed.length,1);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    upper.destroy();
    notes.destroy();
    lower.destroy();
    raw.destroy();
  }

  // The upper Cell also checks its immediate annotated event rather than
  // trusting the previously observed old annotation points.
  {
    class BrokenAnnotation extends classes.AnnotationDocument2D
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
            const edits=geometry.edits.map
            (
              (item,index) =>
              (
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
            );
            listener({...event,geometry:{...geometry,edits}});
          }
        );
      }
    }

    const source=new Backend('abc');
    const raw=new classes.RawDocument2D(source);
    const lower=new classes.CellDocument2D(raw);
    const notes=new BrokenAnnotation(lower);
    const upper=new classes.CellDocument2D(notes);
    const observed=[],events=[];
    upper._subscribeBeforeGeometry(g=>observed.push(g));
    upper.subscribe(e=>events.push(e));
    source.replace(1,2,'Z');
    assert.equal(observed.length,1);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    upper.destroy();
    notes.destroy();
    lower.destroy();
    raw.destroy();
  }

  // A committed event with a discontinuous immediate annotation
  // revision cannot justify old points captured at another revision.
  {
    class BrokenRevisionAnnotation extends classes.AnnotationDocument2D
    {
      subscribe(listener)
      {
        return super.subscribe
        (
          event =>
          {
            if(event.geometry)
            {
              listener
              (
                {
                  ...event,
                  geometry:
                  {
                    ...event.geometry,
                    previousRevision:event.geometry.previousRevision+1
                  }
                }
              );
            }
            else
            {
              listener(event);
            }
          }
        );
      }
    }

    const source=new Backend('abc');
    const raw=new classes.RawDocument2D(source);
    const lower=new classes.CellDocument2D(raw);
    const notes=new BrokenRevisionAnnotation(lower);
    const upper=new classes.CellDocument2D(notes);
    const observed=[],events=[];
    upper._subscribeBeforeGeometry(g=>observed.push(g));
    upper.subscribe(e=>events.push(e));
    source.replace(1,2,'Z');
    assert.equal(source.toString(),'aZc');
    assert.equal(observed.length,1);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    upper.destroy();
    notes.destroy();
    lower.destroy();
    raw.destroy();
  }

  // An annotation atop a folded nonidentity view is NOT Cell identity,
  // even if a later layer exposes an old/new event: no invented cut.
  {
    const source=new Backend('one\ntwo\nthree');
    const raw=new classes.RawDocument2D(source);
    const lower=new classes.CellDocument2D(raw);
    const fold=new classes.FoldDocument2D(lower);
    fold.setFolds([{startRow:1,endRow:2}]);
    const notes=new classes.AnnotationDocument2D(fold);
    const upper=new classes.CellDocument2D(notes);
    assert.equal(notes._hasRawCoordinateIdentity(),false);
    assert.equal(notes._hasCellCoordinateIdentity(),false);
    const observations=[],events=[];
    upper._subscribeBeforeGeometry(g=>observations.push(g));
    upper.subscribe(e=>events.push(e));
    source.replace(0,1,'O');
    assert.deepEqual(observations,[]);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    upper.destroy();
    notes.destroy();
    fold.destroy();
    lower.destroy();
    raw.destroy();
  }
}
console.log('Cell over annotated Cell precommit geometry PASS');
