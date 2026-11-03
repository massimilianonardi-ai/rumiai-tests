// Pre/post edit geometry through protected occupied substitutions.
// Compile and exercise the real core against both physical backends.
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
const dir=mkdtempSync(join(tmpdir(),'substitution-geometry-'));
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
const edit=(os,oe,ns,ne)=>
(
  {old:{start:os,end:oe},new:{start:ns,end:ne}}
);
const note=(id,row,col)=>({id,text:'label:'+id,at:p(row,col)});

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  function make(text,cell=false)
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const input=cell ? new classes.CellDocument2D(raw) : raw;
    const view=new classes.SubstitutionDocument2D(input);
    const events=[];
    view.subscribe(event=>events.push(event));
    const fixture=
    {
      source,raw,input,view,events,
      close()
      {
        view.destroy();
        if(input!==raw)
        {
          input.destroy();
        }
        raw.destroy();
      }
    };
    return fixture;
  }

  // Nonidentity OLD columns, identity NEW columns. A raw offset never
  // escapes into the view's geometry, even when an edit comes from below.
  {
    const t=make('abcdef\nother');
    t.view.setSubstitutions
    (
      [{id:'wide',text:'XY',start:p(0,1),end:p(0,4)}]
    );
    assert.deepEqual(t.view.getRect(0,0,1,20),['aXYef']);
    const revision=t.view.revision;
    t.source.replace(4,4,'Q');
    assert.equal(t.source.toString(),'abcdQef\nother');
    assert.deepEqual(t.view.substitutions,[]);
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:revision,revision:t.view.revision,
      oldRowCount:2,newRowCount:2,
      edits:[edit(p(0,3),p(0,3),p(0,4),p(0,5))]
    });
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    assert.ok(Object.isFrozen(t.events.at(-1).geometry));
    assert.ok(Object.isFrozen(t.events.at(-1).geometry.edits));
    assert.ok(Object.isFrozen(t.events.at(-1).geometry.edits[0].old.start));
    assert.equal('offset' in t.events.at(-1).geometry.edits[0].old.start,false);
    t.close();
  }

  // Editing exactly at the input start boundary of a substituted region
  // remains an ordinary edit, never an edit of the read-only label.
  {
    const t=make('abcdef');
    t.view.setSubstitutions
    (
      [{id:'hidden',text:'LONG',start:p(0,1),end:p(0,4)}]
    );
    const before=t.source.revision;
    const revision=t.view.revision;
    t.view.replace([{start:p(0,1),end:p(0,1),text:'Z'}],revision);
    assert.equal(t.source.revision,before+1);
    assert.equal(t.source.toString(),'aZbcdef');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edit(p(0,1),p(0,1),p(0,1),p(0,2))]);
    assert.throws
    (
      ()=>t.view.replace([{start:p(0,0),end:p(0,0),text:'!'}],revision),
      /stale/
    );
    t.close();
  }

  // A physically unsorted two-edit batch retains its invocation order.
  // A width-changing substitution ahead of another shifts each old cut.
  {
    const t=make('abcdefg\nHI');
    t.view.setSubstitutions
    (
      [
        {id:'second',text:'!',start:p(0,5),end:p(0,6)},
        {id:'first',text:'XXXX',start:p(0,1),end:p(0,3)}
      ]
    );
    assert.deepEqual(t.view.getRect(0,0,1,20),['aXXXXde!g']);
    const before=t.source.revision;
    t.source.replace
    (
      [
        {start:5,end:5,text:'Q'},
        {start:1,end:1,text:'Z'}
      ]
    );
    assert.equal(t.source.revision,before+1);
    assert.equal(t.source.toString(),'aZbcdeQfg\nHI');
    assert.deepEqual(t.events.at(-1).geometry.edits,
    [
      edit(p(0,7),p(0,7),p(0,6),p(0,7)),
      edit(p(0,1),p(0,1),p(0,1),p(0,2))
    ]);
    t.close();
  }

  // Row-start cuts remain exact even when labels occupy another row.
  // A newline moves subsequent input rows after clearing substitutions.
  {
    const t=make('abcdef\nhello\nlast');
    t.view.setSubstitutions
    (
      [{id:'label',text:'WIDE',start:p(0,1),end:p(0,3)}]
    );
    const at=t.source.lineStart(1);
    t.source.replace(at,at,'\n');
    assert.equal(t.source.toString(),'abcdef\n\nhello\nlast');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edit(p(1,0),p(1,0),p(1,0),p(2,0))]);
    assert.equal(t.events.at(-1).geometry.oldRowCount,3);
    assert.equal(t.events.at(-1).geometry.newRowCount,4);
    t.close();
  }

  // A whole-row deletion is still one source edit even though
  // an unrelated row contains occupied substitutions.
  {
    const t=make('abcdef\nremove\nlast');
    t.view.setSubstitutions
    (
      [{id:'label',text:'LONG',start:p(0,1),end:p(0,4)}]
    );
    const from=t.source.lineStart(1);
    const to=t.source.lineStart(2);
    const before=t.source.revision;
    t.source.replace(from,to,'');
    assert.equal(t.source.revision,before+1);
    assert.equal(t.source.toString(),'abcdef\nlast');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edit(p(1,0),p(2,0),p(1,0),p(1,0))]);
    assert.equal(t.events.at(-1).geometry.oldRowCount,3);
    assert.equal(t.events.at(-1).geometry.newRowCount,2);
    t.close();
  }

  // Label-copy dependencies are display-only: a source edit at a
  // copied location does not turn a label into an edit destination.
  {
    const t=make('abcdef\nHELLO');
    t.view.setSubstitutions
    (
      [
        {
          id:'copy',
          start:p(0,1),end:p(0,3),
          sources:[{start:p(1,0),end:p(1,2)}]
        }
      ]
    );
    assert.deepEqual(t.view.getRect(0,0,2,20),['aHEdef','HELLO']);
    const old=t.source.revision;
    t.source.replace(t.source.lineStart(1),t.source.lineStart(1),'Z');
    assert.equal(t.source.revision,old+1);
    assert.equal(t.source.toString(),'abcdef\nZHELLO');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edit(p(1,0),p(1,0),p(1,0),p(1,1))]);
    assert.deepEqual(t.view.substitutions,[]);
    t.close();
  }

  // Cell input projects only exact grapheme/TAB boundaries. One source
  // commit at the recorded start of a substitution remains mappable.
  {
    const t=make('A\tB😀C\nlast',true);
    t.view.setSubstitutions
    (
      [{id:'cell',text:'ZZ',start:p(0,4),end:p(0,5)}]
    );
    const revision=t.view.revision;
    t.view.replace([{start:p(0,4),end:p(0,4),text:'Q'}],revision);
    assert.equal(t.source.toString(),'A\tQB😀C\nlast');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edit(p(0,4),p(0,4),p(0,4),p(0,5))]);
    assert.deepEqual(t.view.substitutions,[]);
    t.close();
  }

  // An old interior point is hidden, and a span traversing a synthetic
  // interval cannot be projected even when the physical source changed.
  {
    const t=make('abcdef');
    t.view.setSubstitutions
    (
      [{id:'hidden',text:'X',start:p(0,1),end:p(0,4)}]
    );
    t.source.replace(2,2,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    t.close();
  }
  {
    const t=make('abcdef');
    t.view.setSubstitutions
    (
      [{id:'hidden',text:'X',start:p(0,1),end:p(0,4)}]
    );
    t.source.replace(0,4,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // A plausible old suffix column without a saved precommit boundary
  // cannot be verified from the new row's EOL after a source mutation.
  {
    const t=make('abcdef');
    t.view.setSubstitutions
    (
      [{id:'hidden',text:'X',start:p(0,1),end:p(0,3)}]
    );
    t.source.replace(5,5,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // Adjacent synthetic regions assign two exposed representations to
  // their shared physical cut. Do not choose one by scanning order.
  {
    const t=make('abcdef');
    t.view.setSubstitutions
    (
      [
        {id:'first',text:'XXX',start:p(0,1),end:p(0,3)},
        {id:'second',text:'Y',start:p(0,3),end:p(0,5)}
      ]
    );
    t.source.replace(3,3,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // CRLF split within the physical terminator is not an old caret.
  {
    const t=make('a\r\nbc');
    t.view.setSubstitutions
    (
      [{id:'last',text:'ZZ',start:p(1,0),end:p(1,1)}]
    );
    t.source.replace(2,2,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    t.close();
  }

  // Missing direct geometry is a conservative invalidation, not an edit
  // failure or a partial replacement of the synthetic configuration.
  {
    class NoGeometry extends Backend
    {
      _getLastGeometry()
      {
        return null;
      }
    }
    const source=new NoGeometry('abc\ndef');
    const raw=new classes.RawDocument2D(source);
    const view=new classes.SubstitutionDocument2D(raw);
    view.setSubstitutions
    (
      [{id:'label',text:'x',start:p(0,1),end:p(0,2)}]
    );
    const events=[];
    view.subscribe(e=>events.push(e));
    source.replace(0,0,'Z');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.deepEqual(view.substitutions,[]);
    view.destroy();
    raw.destroy();
  }

  // Neither same-row suffix anchors nor notes on untouched substituted
  // rows are safe once the old display widths disappear. Nested note
  // views must not accidentally resurrect those obsolete positions.
  {
    const t=make('top\nabcdefg\nlast');
    t.view.setSubstitutions
    (
      [{id:'hidden',text:'XXXXX',start:p(1,1),end:p(1,4)}]
    );
    const inner=new classes.AnnotationDocument2D(t.view);
    const outer=new classes.AnnotationDocument2D(inner);
    inner.setAnnotations([note('old-suffix',1,7)]);
    outer.setAnnotations([note('old-later',2,1)]);
    const events=[];
    outer.subscribe(e=>events.push(e));
    t.source.replace(0,0,'Z');
    assert.ok(t.events.at(-1).geometry);
    assert.ok(events.at(-1).geometry);
    assert.deepEqual(inner.annotations,[]);
    assert.deepEqual(outer.annotations,[]);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    outer.destroy();
    inner.destroy();
    t.close();
  }

  // A folding source also loses old nonidentity row coordinates after
  // its own clear; the new substitution layer cannot infer all anchors.
  {
    const t=make('abc\nrow\nlast');
    t.view.setSubstitutions
    (
      [{id:'label',text:'Q',start:p(0,1),end:p(0,2)}]
    );
    const seen=[];
    t.view.subscribe(e=>seen.push(e));
    t.view.setSubstitutions([]);
    assert.equal('geometry' in seen.at(-1),false);
    t.close();
  }
}
console.log('substitution old/new geometry PASS');
