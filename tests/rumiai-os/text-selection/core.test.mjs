// Differential permanent test: m.text.selection.TextEditSelections is a
// behavior-preserving extraction of the genuine TextEdit 0.8.2 selector.
// Exercise the real jsc descriptor and both actual document backends.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';

const root=process.env.RUMIAI_OS_ROOT;
assert.ok(root,'target checkout required');
const require=createRequire(import.meta.url);
const original=require(resolve(root,'lib/sys/js/text-edit.lib.js'));
assert.equal(original.VERSION,'0.8.2');

const compile=spawnSync
(
  process.execPath,
  [
    resolve(root,'lib/sys/js/jsc.lib.js'),
    resolve(root,'lib/sys/js/core/modules-js.json')
  ],
  {encoding:'utf8',maxBuffer:16*1024*1024}
);
assert.equal(compile.status,0,compile.stderr||'real jsc compilation failed');

const directory=mkdtempSync(join(tmpdir(),'rumiai-text-selection-'));
let m;
try
{
  const target=join(directory,'core.cjs');
  writeFileSync(target,compile.stdout);
  m=require(target);
}
finally
{
  rmSync(directory,{recursive:true,force:true});
}

assert.equal(typeof m.text.selection.TextEditSelections,'function');
assert.deepEqual(Object.keys(m.text.selection),['TextEditSelections']);

// The new core selector requires NOMINAL Document membership. An object with
// identical method names, or a store from standalone 0.8.2, is not that class.
const Document=m.text.document.Document;
const CoreSelections=m.text.selection.TextEditSelections;
const source=new m.text.document.FlatDocument('abc');
const duck=
{
  length:source.length,
  revision:source.revision,
  lineCount:source.lineCount,
  lineInfo:source.lineInfo.bind(source),
  lineAt:source.lineAt.bind(source),
  replace:source.replace.bind(source),
  subscribe:source.subscribe.bind(source)
};

assert.equal(source instanceof Document,true);
assert.equal(duck instanceof Document,false);
assert.throws
(
  () => new CoreSelections(duck),
  {name:'TypeError',message:'Document with source rows required'}
);
assert.throws
(
  () => new CoreSelections(new original.FlatDocument('abc')),
  {name:'TypeError',message:'Document with source rows required'}
);
const admitted=new CoreSelections(source);
admitted.destroy();

const point=(row,col)=>({row,col});
const select=(a,b,forward=true)=>({start:point(...a),end:point(...b),forward});

let successfulScenarios=0;
let successfulOperations=0;

// Compare every observable step against a fresh original selector. Both
// instances use their own real document; neither imitates or patches a method.
function scenario(name,initial,operations,backend)
{
  const oldDocument=new original[backend](initial);
  const newDocument=new m.text.document[backend](initial);
  const oldSelection=new original.TextEditSelections(oldDocument);
  const newSelection=new m.text.selection.TextEditSelections(newDocument);
  try
  {
    for(const [operation,argument] of operations)
    {
      function execute(document,selector)
      {
        try
        {
          let result;

          if(operation==='set')result=selector.setSelections(argument);
          else if(operation==='add')result=selector.addSelections(argument);
          else if(operation==='replace')result=selector.replace(argument);
          else if(operation==='external')result=document.replace(...argument);
          else if(operation==='get')result=selector.getSelections();
          else throw new Error('invalid test operation');

          return {ok:true,value:result===selector?'this':result};
        }
        catch(error)
        {
          return {ok:false,name:error.name,message:error.message};
        }
      }

      const expected=execute(oldDocument,oldSelection);
      const actual=execute(newDocument,newSelection);
      assert.deepEqual(actual,expected,name+' '+operation+' result');

      assert.equal(newDocument.toString(),oldDocument.toString(),
        name+' '+operation+' document bytes');
      assert.equal(newDocument.revision,oldDocument.revision,
        name+' '+operation+' revision');

      assert.deepEqual(newSelection.getSelections(),
        oldSelection.getSelections(),name+' '+operation+' physical state');
      successfulOperations++;
    }
  }
  finally
  {
    oldSelection.dispose();
    newSelection.destroy();
  }
  successfulScenarios++;
}

const scenarios=
[
  {
    name:'ordinary reverse / out-of-order array payload',
    initial:'0123456789\nabcdefghij',
    operations:
    [
      ['set',
        [
          select([1,1],[1,4],false),
          select([0,2],[0,5],true)
        ]
      ],
      ['replace',['X','YY']],
      ['replace',['Q',true]],
      ['get']
    ]
  },
  {
    name:'duplicate and overlapping selections retain identity',
    initial:'abcdefghij',
    operations:
    [
      ['set',[select([0,2],[0,4]),select([0,2],[0,4],false)]],
      ['get'],
      ['replace',['X','Y']],
      ['set',[select([0,1],[0,3]),select([0,5],[0,7])]],
      ['replace',[null]]
    ]
  },
  {
    name:'virtual columns and no-materialization deletion',
    initial:'ab\ncd',
    operations:
    [
      ['set',[select([0,6],[0,6],false)]],
      ['replace',null],
      ['replace','X'],
      ['set',[select([1,4],[1,4])]],
      ['replace',['Y']],
      ['get']
    ]
  },
  {
    name:'future rows, CR and mixed terminators',
    initial:'hello\r',
    operations:
    [
      ['set',[select([3,2],[3,2],false)]],
      ['replace',[42]],
      ['replace',['!']],
      ['get']
    ]
  },
  {
    name:'external edits and rebasing of physical positions',
    initial:'alpha\r\nbeta\ngamma',
    operations:
    [
      ['set',[select([1,1],[1,3]),select([2,2],[2,2],false)]],
      ['external',[0,0,'XX']],
      ['get'],
      ['external',[[{start:3,end:4,text:'?'},{start:1,end:1,text:'Z'}]]],
      ['get']
    ]
  },
  {
    name:'input normalization and rejection',
    initial:'abcdef',
    operations:
    [
      ['set',[select([0,1],[0,2]),select([0,3],[0,4])]],
      ['replace',[NaN,false]],
      ['replace',[{}]],
      ['replace',['x','y','z']],
      ['set',[]],
      ['replace','x'],
      ['set',[select([0,1],[0,1])]],
      ['replace',[undefined]],
      ['replace',[Infinity]],
      ['get']
    ]
  }
];

for(const backend of ['FlatDocument','PieceDocument'])
{
  for(const spec of scenarios)
  {
    scenario(backend+' '+spec.name,spec.initial,spec.operations,backend);
  }
}

// The core-only explicit destructor makes the selector unusable without
// repeated #alive checks, while leaving its shared document unmodified.
for(const backend of ['FlatDocument','PieceDocument'])
{
  const doc=new m.text.document[backend]('before');
  const selector=new CoreSelections(doc);
  const caret=select([0,3],[0,3]);
  selector.setSelections([caret]);
  const prior=selector.getSelections();
  const savedGet=selector.getSelections;
  const savedSet=selector.setSelections;
  const savedAdd=selector.addSelections;
  const savedReplace=selector.replace;

  const originalText=doc.toString();
  const originalRevision=doc.revision;

  selector.destroy();
  assert.equal(typeof selector.destroy,'function');
  assert.equal(selector instanceof CoreSelections,true);
  assert.equal(doc.toString(),originalText);
  assert.equal(doc.revision,originalRevision);
  assert.deepEqual(prior,[caret]);
  assert.equal(selector.destroy(),undefined,'destroy is idempotent');

  const afterDestroyActions =
  [
    () => selector.getSelections(),
    () => selector.setSelections([caret]),
    () => selector.addSelections([caret]),
    () => selector.replace('X'),
    () => savedGet.call(selector),
    () => savedSet.call(selector,[caret]),
    () => savedAdd.call(selector,[caret]),
    () => savedReplace.call(selector,'X')
  ];

  for(const action of afterDestroyActions)
  {
    assert.throws(action,Error,backend+' use after destroy fails');
  }

  // The abandoned selector is no longer subscribed. The source can mutate.
  doc.replace(0,0,'+');
  assert.equal(doc.toString(),'+before');
}

// A captured notification callback can still execute AFTER it was removed
// from the subscription set. It must return silently after destruction.
{
  const doc=new m.text.document.FlatDocument('abc');
  const subscribe=doc.subscribe.bind(doc);
  let callback;
  let unsubscribed=0;
  doc.subscribe=(listener)=>
  {
    callback=listener;
    const unsubscribe=subscribe(listener);
    return ()=>
    {
      unsubscribed++;
      unsubscribe();
    };
  };

  const selector=new CoreSelections(doc);
  selector.setSelections([select([0,1],[0,1])]);
  selector.destroy();
  assert.equal(unsubscribed,1);
  assert.doesNotThrow
  (
    () => callback(0,0,'Z'),
    'a captured callback must silently ignore late delivery'
  );
  assert.equal(unsubscribed,1);
}

// Source publication snapshots all listeners BEFORE calling the first.
// A prior listener may destroy this selector while its replace() is committing.
for(const backend of ['FlatDocument','PieceDocument'])
{
  const doc=new m.text.document[backend]('abc');
  let selector;
  doc.subscribe(() => selector.destroy());

  selector=new CoreSelections(doc);
  selector.setSelections([select([0,1],[0,1])]);
  const snapshot=selector.replace('X');

  assert.deepEqual(snapshot.before,[select([0,1],[0,1])]);
  assert.deepEqual(snapshot.after,[]);
  assert.equal(doc.toString(),'aXbc');
  assert.equal(doc.revision,1);
  assert.throws(() => selector.getSelections(),Error);
  assert.doesNotThrow(() => selector.destroy());
}

console.log(JSON.stringify({
  pass:true,
  reference:original.VERSION,
  scenarios:successfulScenarios,
  operations:successfulOperations,
  covers:[
    'source-ordered-physical-snapshots','reverse-oriented-cursors',
    'array-distribution','duplicate-conflict','virtual-eol',
    'future-rows','mixed-line-endings','external-rebase',
    'type-normalization','failure-preserves-source','destroy'
  ]
}));
