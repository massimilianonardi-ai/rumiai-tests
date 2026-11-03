// Cell projection through zero-width Raw-coordinate annotations.
// Real core/jsc, with exact immediate-input precommit old/new points.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'product checkout required');
const compiled=spawnSync
(
  process.execPath,
  [resolve(root,'lib/sys/js/jsc.lib.js'),resolve(root,'lib/sys/js/core/modules-js.json')],
  {encoding:'utf8',maxBuffer:16*1024*1024}
);
assert.equal(compiled.status,0,compiled.stderr);
const dir=mkdtempSync(join(tmpdir(),'cell-annotated-input-'));
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
    const overlays=[];
    let input=raw;

    for(let i=0;i<depth;i++)
    {
      input=new classes.AnnotationDocument2D(input);
      overlays.push(input);
    }

    const cell=new classes.CellDocument2D(input);
    return {
      source,raw,overlays,cell,
      close()
      {
        cell.destroy();
        for(const layer of overlays.slice().reverse())
        {
          layer.destroy();
        }
        raw.destroy();
      }
    };
  }

  // An overlay-only change advances the INPUT revision without changing
  // any text cell; the next old geometry uses the new revision identity.
  {
    const t=open('A\tB😀C\nTAIL');
    t.overlays[0].setAnnotations([note('keep',1,1)]);
    const old=t.cell.revision;
    const inputRevision=t.overlays[0].revision;
    const prepared=[];
    const events=[];
    const unsubscribe=t.cell._subscribeBeforeGeometry(v=>prepared.push(v));
    t.cell.subscribe(e=>events.push(e));
    const sourceRevision=t.source.revision;
    t.source.replace(5,6,'D');
    assert.equal(t.source.revision,sourceRevision+1);
    assert.equal(t.source.toString(),'A\tB😀D\nTAIL');
    assert.equal(t.overlays[0].revision,inputRevision+1);
    assert.deepEqual(t.overlays[0].annotations,[note('keep',1,1)]);
    assert.deepEqual(prepared,
    [
      {
        previousRevision:old,
        oldRowCount:2,
        edits:[{old:{start:p(0,6),end:p(0,7)}}]
      }
    ]);
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:old,revision:t.cell.revision,
      oldRowCount:2,newRowCount:2,
      edits:[edit(p(0,6),p(0,7),p(0,6),p(0,7))]
    });
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.ok(Object.isFrozen(prepared[0]));
    assert.ok(Object.isFrozen(prepared[0].edits));
    assert.ok(Object.isFrozen(prepared[0].edits[0].old.start));
    assert.equal('offset' in prepared[0].edits[0].old.start,false);
    assert.equal('offset' in events.at(-1).geometry.edits[0].old.start,false);
    unsubscribe();
    unsubscribe();
    t.source.replace(5,6,'E');
    assert.equal(prepared.length,1);
    t.close();
  }

  // Two annotations preserve original raw UTF-16 identity while their
  // independent overlay revisions differ. Batch order stays unchanged.
  {
    const t=open('A\tBC😀DE\nTAIL',2);
    t.overlays[0].setAnnotations([note('first',1,0)]);
    t.overlays[1].setAnnotations([note('second',1,2)]);
    const events=[];
    t.cell.subscribe(e=>events.push(e));
    const revision=t.cell.revision;
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
      previousRevision:revision,revision:t.cell.revision,
      oldRowCount:2,newRowCount:2,
      edits:
      [
        edit(p(0,8),p(0,9),p(0,8),p(0,9)),
        edit(p(0,0),p(0,1),p(0,0),p(0,1))
      ]
    });
    assert.deepEqual(t.overlays[0].annotations,[note('first',1,0)]);
    assert.deepEqual(t.overlays[1].annotations,[note('second',1,2)]);
    t.close();
  }

  // Local public Cell replace has one physical commit, rejects stale
  // revisions, and shifts only the reported edit endpoints when a TAB
  // reflows other columns.
  {
    const t=open('A\tBC\nTAIL');
    t.overlays[0].setAnnotations([note('last',1,1)]);
    const events=[];
    t.cell.subscribe(e=>events.push(e));
    const revision=t.cell.revision;
    const physical=t.source.revision;
    t.cell.replace([{start:p(0,1),end:p(0,1),text:'Q'}],revision);
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'AQ\tBC\nTAIL');
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,1),p(0,1),p(0,1),p(0,2))]);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.throws
    (
      ()=>t.cell.replace
      (
        [{start:p(0,0),end:p(0,0),text:'Z'}],revision
      ),
      /stale/
    );
    t.close();
  }

  // Newline insertion changes row counts without accessing raw offsets
  // through Annotation or exposing them in Cell geometry.
  {
    const t=open('abc\nsecond\nTAIL');
    const events=[];
    t.cell.subscribe(e=>events.push(e));
    const revision=t.cell.revision;
    const at=t.source.lineStart(1)+3;
    t.source.replace(at,at,'\n');
    assert.equal(t.source.toString(),'abc\nsec\nond\nTAIL');
    assert.deepEqual(events.at(-1).geometry,
    {
      previousRevision:revision,revision:t.cell.revision,
      oldRowCount:3,newRowCount:4,
      edits:[edit(p(1,3),p(1,3),p(1,3),p(2,0))]
    });
    t.close();
  }

  // Raw→Annotation→Cell→Fold can project an old suffix cut across an
  // inline splice, and a single public edit reaches the physical source.
  {
    const t=open('A\tB😀C\nHIDDEN\nxy😀z\nTAIL');
    const fold=new classes.FoldDocument2D(t.cell);
    fold.setInlineFold({start:p(0,4),end:p(2,1)});
    const events=[];
    fold.subscribe(e=>events.push(e));
    const revision=fold.revision;
    const physical=t.source.revision;
    fold.replace
    (
      [{start:p(0,5),end:p(0,6),text:'Y'}],
      revision
    );
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'A\tB😀C\nHIDDEN\nxY😀z\nTAIL');
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,5),p(0,6),p(2,1),p(2,2))]);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    fold.destroy();
    t.close();
  }

  // Raw→Annotation→Cell→Substitution: non-boundary points are
  // projected in cell space, not mistaken for physical UTF-16 offsets.
  {
    const t=open('A\tBC😀DE\nTAIL');
    const view=new classes.SubstitutionDocument2D(t.cell);
    view.setSubstitutions
    (
      [
        {id:'right',text:'LONG',start:p(0,7),end:p(0,8)},
        {id:'left',text:'Q',start:p(0,4),end:p(0,6)}
      ]
    );
    const events=[];
    view.subscribe(e=>events.push(e));
    const before=t.source.revision;
    t.source.replace
    (
      [
        {start:7,end:8,text:'Z'},
        {start:0,end:1,text:'X'}
      ]
    );
    assert.equal(t.source.revision,before+1);
    assert.deepEqual(events.at(-1).geometry.edits,
    [
      edit(p(0,10),p(0,11),p(0,8),p(0,9)),
      edit(p(0,0),p(0,1),p(0,0),p(0,1))
    ]);
    assert.deepEqual(view.substitutions,[]);
    view.destroy();
    t.close();
  }

  // Old grapheme/CRLF interior points cannot be certified by a Cell,
  // even if Annotation has a valid old Raw-coordinate observation.
  {
    const t=open('A😀B\nTAIL');
    const events=[];
    const prepared=[];
    t.cell.subscribe(e=>events.push(e));
    t.cell._subscribeBeforeGeometry(v=>prepared.push(v));
    t.source.replace(2,2,'Q');
    assert.deepEqual(prepared,[]);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    t.close();
  }
  {
    const t=open('A\r\nTAIL');
    const events=[];
    t.cell.subscribe(e=>events.push(e));
    t.source.replace(2,2,'Q');
    assert.equal('geometry' in events.at(-1),false);
    t.close();
  }

  // Annotated Cell coordinates are NOT Raw coordinates. The new
  // restricted Cell-space identity admits a separately proven batch.
  {
    const t=open('A\tBC😀DE');
    const notes=new classes.AnnotationDocument2D(t.cell);
    const outer=new classes.CellDocument2D(notes);
    const prepared=[];
    const events=[];
    outer._subscribeBeforeGeometry(v=>prepared.push(v));
    outer.subscribe(e=>events.push(e));
    const revision=outer.revision;
    t.source.replace(7,8,'Z');
    assert.deepEqual(prepared,
      [{previousRevision:revision,oldRowCount:1,
        edits:[{old:{start:p(0,8),end:p(0,9)}}]}]);
    assert.deepEqual(events.at(-1).geometry,
      {previousRevision:revision,revision:outer.revision,
        oldRowCount:1,newRowCount:1,
        edits:[edit(p(0,8),p(0,9),p(0,8),p(0,9))]});
    assert.equal(notes._hasRawCoordinateIdentity(),false);
    assert.equal(notes._hasCellCoordinateIdentity(),true);
    assert.equal('offset' in prepared[0].edits[0].old.start,false);
    outer.destroy();
    notes.destroy();
    t.close();
  }

  // Broken postcommit original offsets are caught inside Annotation;
  // the Cell never turns a raw cut into unjustified fine geometry.
  {
    class BadSource extends Backend
    {
      _getLastGeometry()
      {
        const base=super._getLastGeometry();

        if(!base)
        {
          return base;
        }

        return {
          ...base,
          edits:base.edits.map
          (
            e =>
            (
              {
                ...e,
                old:
                {
                  ...e.old,
                  start:{...e.old.start,offset:e.old.start.offset+1}
                }
              }
            )
          )
        };
      }
    }
    const source=new BadSource('A\tBC😀DE');
    const raw=new classes.RawDocument2D(source);
    const notes=new classes.AnnotationDocument2D(raw);
    const cell=new classes.CellDocument2D(notes);
    const events=[];
    cell.subscribe(e=>events.push(e));
    source.replace(7,8,'Z');
    assert.equal(source.toString(),'A\tBC😀DZ');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    cell.destroy();
    notes.destroy();
    raw.destroy();
  }
}
console.log('cell over annotated raw precommit geometry PASS');
