// Independently certified old/new endpoints through consecutive Cell views.
// Exercise the real jsc-compiled core and both physical storage backends.
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
const dir=mkdtempSync(join(tmpdir(),'cell-cell-precommit-'));
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
const edit=(start,end,newStart,newEnd)=>
(
  {
    old:{start,end},
    new:{start:newStart,end:newEnd}
  }
);

for(const Backend of [classes.FlatDocument,classes.PieceDocument])
{
  function open(text)
  {
    const source=new Backend(text);
    const raw=new classes.RawDocument2D(source);
    const first=new classes.CellDocument2D(raw,4);
    const second=new classes.CellDocument2D(first,8);
    return {
      source,raw,first,second,
      close()
      {
        second.destroy();
        first.destroy();
        raw.destroy();
      }
    };
  }

  // All edits retain physical invocation order. Each view certifies its
  // own old points and its own postcommit coordinates, not raw offsets.
  {
    const t=open('A\tBC😀DE\nTAIL');
    const lowerOld=[];
    const upperOld=[];
    const lowerEvents=[];
    const upperEvents=[];
    t.first._subscribeBeforeGeometry(g=>lowerOld.push(g));
    const unsubscribe=t.second._subscribeBeforeGeometry(g=>upperOld.push(g));
    t.first.subscribe(e=>lowerEvents.push(e));
    t.second.subscribe(e=>upperEvents.push(e));
    const firstRevision=t.first.revision;
    const secondRevision=t.second.revision;
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
    const expected=
    [
      edit(p(0,8),p(0,9),p(0,8),p(0,9)),
      edit(p(0,0),p(0,1),p(0,0),p(0,1))
    ];
    assert.deepEqual(lowerEvents.at(-1).geometry,
    {
      previousRevision:firstRevision,revision:t.first.revision,
      oldRowCount:2,newRowCount:2,edits:expected
    });
    assert.deepEqual(upperEvents.at(-1).geometry,
    {
      previousRevision:secondRevision,revision:t.second.revision,
      oldRowCount:2,newRowCount:2,edits:expected
    });
    for(const observation of [lowerOld[0],upperOld[0]])
    {
      assert.ok(Object.isFrozen(observation));
      assert.ok(Object.isFrozen(observation.edits));
      assert.equal(observation.oldRowCount,2);
      assert.deepEqual(observation.edits.map(e=>e.old),
        expected.map(e=>e.old));
      for(const e of observation.edits)
      {
        assert.ok(Object.isFrozen(e.old.start));
        assert.equal('offset' in e.old.start,false);
        assert.equal('offset' in e.old.end,false);
      }
    }
    assert.deepEqual(upperEvents.at(-1).invalidation,{all:true});
    unsubscribe();
    unsubscribe();
    t.source.replace(7,8,'Y');
    assert.equal(upperOld.length,1);
    t.close();
  }

  // The upper public edit delegates exactly one physical commit.
  // TAB widths remain input-owned and do not become 8-column re-tabs.
  {
    const t=open('A\tB\nlast');
    const events=[];
    t.second.subscribe(e=>events.push(e));
    assert.equal(t.first.getRowWidth(0),5);
    assert.equal(t.second.getRowWidth(0),5);
    const revision=t.second.revision;
    const physical=t.source.revision;
    t.second.replace
    (
      [{start:p(0,1),end:p(0,1),text:'Q'}],
      revision
    );
    assert.equal(t.source.revision,physical+1);
    assert.equal(t.source.toString(),'AQ\tB\nlast');
    assert.deepEqual(events.at(-1).geometry.edits,
      [edit(p(0,1),p(0,1),p(0,1),p(0,2))]);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
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

  // A physical cut inside a grapheme is not a caret in either Cell.
  {
    const t=open('A😀B');
    const old=[];
    const events=[];
    t.second._subscribeBeforeGeometry(g=>old.push(g));
    t.second.subscribe(e=>events.push(e));
    t.source.replace(2,2,'Q');
    assert.equal(t.source.slice(2,3),'Q');
    assert.deepEqual(old,[]);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    t.close();
  }

  // A formerly valid old insertion cut can become a grapheme interior.
  // The upper precommit observation alone never licenses geometry.
  {
    const t=open('aB');
    const old=[];
    const events=[];
    t.second._subscribeBeforeGeometry(g=>old.push(g));
    t.second.subscribe(e=>events.push(e));
    t.source.replace(1,1,'\u0301');
    assert.equal(old.length,1);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    t.close();
  }

  // CRLF terminator interior must remain conservative through both.
  {
    const t=open('A\r\nB');
    const events=[];
    t.second.subscribe(e=>events.push(e));
    t.source.replace(2,2,'X');
    assert.equal('geometry' in events.at(-1),false);
    t.close();
  }

  // A tampered immediate Cell commit cannot be justified by authentic
  // old precommit points. Keep fallback rather than invent upper cuts.
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
                index === 0 ?
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
    const first=new BrokenCell(raw);
    const second=new classes.CellDocument2D(first);
    const events=[];
    const observed=[];
    second._subscribeBeforeGeometry(g=>observed.push(g));
    second.subscribe(e=>events.push(e));
    source.replace(1,2,'Z');
    assert.equal(observed.length,1);
    assert.equal('geometry' in events.at(-1),false);
    assert.deepEqual(events.at(-1).invalidation,{all:true});
    second.destroy();
    first.destroy();
    raw.destroy();
  }
}
console.log('direct Cell over Cell precommit geometry PASS');
