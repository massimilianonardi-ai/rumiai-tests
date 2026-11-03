// Exact old non-boundary cuts in substituted views require the physical
// precommit observation. Exercise actual compiled core on both backends.
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
const dir=mkdtempSync(join(tmpdir(),'substitution-precommit-'));
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
  function open(text,cell=false)
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const input=cell ? new classes.CellDocument2D(raw) : raw;
    const view=new classes.SubstitutionDocument2D(input);
    const events=[];
    view.subscribe(event=>events.push(event));
    return {
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
  }

  // Physical edit before the occupied interval: the old cut is neither
  // a row start nor a saved synthetic boundary.
  {
    const t=open('abcdef\nother');
    t.view.setSubstitutions
    (
      [{id:'large',text:'LONG',start:p(0,2),end:p(0,4)}]
    );
    const revision=t.view.revision;
    assert.deepEqual(t.view.getRect(0,0,1,20),['abLONGef']);
    t.source.replace(1,2,'B');
    assert.equal(t.source.toString(),'aBcdef\nother');
    assert.deepEqual(t.view.substitutions,[]);
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:revision,revision:t.view.revision,
      oldRowCount:2,newRowCount:2,
      edits:[edit(p(0,1),p(0,2),p(0,1),p(0,2))]
    });
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    assert.ok(Object.isFrozen(t.events.at(-1).geometry));
    assert.ok(Object.isFrozen(t.events.at(-1).geometry.edits[0]));
    assert.ok(Object.isFrozen(t.events.at(-1).geometry.edits[0].old.start));
    assert.equal('offset' in t.events.at(-1).geometry.edits[0].old.start,false);
    t.close();
  }

  // A suffix cut is shifted by the removed old physical span versus the
  // occupied display width. The NEW point belongs to the unfolded input.
  {
    const t=open('abcdef\nother');
    t.view.setSubstitutions
    (
      [{id:'long',text:'LONG',start:p(0,1),end:p(0,3)}]
    );
    const revision=t.view.revision;
    const physical=t.source.revision;
    t.view.replace
    (
      [{start:p(0,6),end:p(0,7),text:'E'}],
      revision
    );
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'abcdEf\nother');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edit(p(0,6),p(0,7),p(0,4),p(0,5))]);
    assert.throws
    (
      ()=>t.view.replace
      (
        [{start:p(0,0),end:p(0,0),text:'!'}],revision
      ),
      /stale/
    );
    t.close();
  }

  // Two disjoint occupied intervals have independently accumulated
  // width deltas. Preserve physical invocation order of an unsorted batch.
  {
    const t=open('abcdefghij\nTAIL');
    t.view.setSubstitutions
    (
      [
        {id:'second',text:'!',start:p(0,6),end:p(0,8)},
        {id:'first',text:'XXXXX',start:p(0,1),end:p(0,3)}
      ]
    );
    assert.deepEqual(t.view.getRect(0,0,1,30),['aXXXXXdef!ij']);
    const physical=t.source.revision;
    t.source.replace
    (
      [
        {start:9,end:10,text:'J'},
        {start:4,end:5,text:'E'}
      ]
    );
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'abcdEfghiJ\nTAIL');
    assert.deepEqual(t.events.at(-1).geometry.edits,
    [
      edit(p(0,10),p(0,11),p(0,9),p(0,10)),
      edit(p(0,7),p(0,8),p(0,4),p(0,5))
    ]);
    t.close();
  }

  // Edits at a nonzero old column can insert newlines and alter row
  // geometry without turning a copied or hidden region into a target.
  {
    const t=open('abcdef\nsecond\nTAIL');
    t.view.setSubstitutions
    (
      [{id:'label',text:'X',start:p(0,1),end:p(0,3)}]
    );
    const old=t.view.revision;
    const at=t.source.lineStart(1)+3;
    t.source.replace(at,at,'\n');
    assert.equal(t.source.toString(),'abcdef\nsec\nond\nTAIL');
    assert.deepEqual(t.events.at(-1).geometry,
    {
      previousRevision:old,revision:t.view.revision,
      oldRowCount:3,newRowCount:4,
      edits:[edit(p(1,3),p(1,3),p(1,3),p(2,0))]
    });
    t.close();
  }

  // Source-derived labels are display dependencies. Editing the fragment
  // changes the physical source, not any read-only label destination.
  {
    const t=open('abcdef\nHELLO');
    t.view.setSubstitutions
    (
      [
        {
          id:'copy',
          start:p(0,1),end:p(0,3),
          sources:[{start:p(1,1),end:p(1,3)}]
        }
      ]
    );
    assert.deepEqual(t.view.getRect(0,0,2,25),['aELdef','HELLO']);
    assert.throws
    (
      ()=>t.view.replace
      (
        [{start:p(0,1),end:p(0,3),text:'Q'}],
        t.view.revision
      ),
      /substitut/
    );
    const revision=t.source.revision;
    t.source.replace(t.source.lineStart(1)+2,t.source.lineStart(1)+3,'X');
    assert.equal(t.source.revision,revision+1);
    assert.equal(t.source.toString(),'abcdef\nHEXLO');
    assert.deepEqual(t.events.at(-1).geometry.edits,
      [edit(p(1,2),p(1,3),p(1,2),p(1,3))]);
    assert.deepEqual(t.view.substitutions,[]);
    t.close();
  }

  // Even a complete raw precommit capture cannot authorize a cut inside
  // a substituted source interval or an edit that crosses it.
  {
    const t=open('abcdef');
    t.view.setSubstitutions
    (
      [{id:'occupied',text:'X',start:p(0,1),end:p(0,4)}]
    );
    t.source.replace(2,2,'Q');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.events.at(-1).invalidation,{all:true});
    t.close();
  }
  {
    const t=open('abcdef');
    t.view.setSubstitutions
    (
      [{id:'occupied',text:'X',start:p(0,1),end:p(0,4)}]
    );
    t.source.replace(0,5,'Q');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // The shared source cut of two adjacent occupied regions has two
  // exposed endpoints. Precommit capture must not choose one.
  {
    const t=open('abcdef');
    t.view.setSubstitutions
    (
      [
        {id:'left',text:'LONG',start:p(0,1),end:p(0,3)},
        {id:'right',text:'Q',start:p(0,3),end:p(0,5)}
      ]
    );
    t.source.replace(3,3,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // Raw source coordinates inside a CRLF terminator are not real
  // editable display columns, despite being valid physical offsets.
  {
    const t=open('a\r\nbc');
    t.view.setSubstitutions
    (
      [{id:'last',text:'X',start:p(1,0),end:p(1,1)}]
    );
    t.source.replace(2,2,'Z');
    assert.equal('geometry' in t.events.at(-1),false);
    t.close();
  }

  // Without the internal raw precommit hook, the previous restricted
  // mapping for row starts and recorded unique marker cuts still works.
  {
    class NoPreparation extends Backend
    {
      _subscribeBeforeGeometry(_)
      {
        return null;
      }
    }
    const source=new NoPreparation('abcdef');
    const raw=new classes.RawDocument2D(source);
    const view=new classes.SubstitutionDocument2D(raw);
    const events=[];
    view.subscribe(event=>events.push(event));
    view.setSubstitutions
    (
      [{id:'label',text:'X',start:p(0,1),end:p(0,3)}]
    );
    source.replace(5,5,'Z');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(view.substitutions,[]);
    view.setSubstitutions
    (
      [{id:'label',text:'X',start:p(0,1),end:p(0,3)}]
    );
    source.replace(3,3,'Q');
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,2),p(0,2),p(0,3),p(0,4))]);
    view.destroy();
    raw.destroy();
  }

  // Precommit and postcommit geometries must agree on the original raw
  // offsets. A hostile inconsistent backend suppresses precise geometry.
  {
    class MismatchedGeometry extends Backend
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
            item=>
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
    const source=new MismatchedGeometry('abcdef');
    const raw=new classes.RawDocument2D(source);
    const view=new classes.SubstitutionDocument2D(raw);
    const events=[];
    view.subscribe(event=>events.push(event));
    view.setSubstitutions
    (
      [{id:'label',text:'XXX',start:p(0,1),end:p(0,3)}]
    );
    source.replace(5,5,'Z');
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    assert.equal(source.toString(),'abcdeZf');
    view.destroy();
    raw.destroy();
  }

  // No direct observation of an intermediate CellDocument2D is provided.
  // Its own valid grapheme/TAB geometry does not certify an arbitrary
  // old substitution suffix point without an old input boundary map.
  {
    const t=open('A\tB😀C\nlast',true);
    t.view.setSubstitutions
    (
      [{id:'cell',text:'LONG',start:p(0,4),end:p(0,5)}]
    );
    t.source.replace(5,6,'D');
    assert.equal(t.source.toString(),'A\tB😀D\nlast');
    assert.equal('geometry' in t.events.at(-1),false);
    assert.deepEqual(t.view.substitutions,[]);
    t.close();
  }
}
console.log('substitution precommit old-boundary geometry PASS');
