// Exercise the JSON-only directive resolver through a genuinely jsc-compiled core.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const root = resolve(process.argv[2]);
const built = spawnSync
(
  process.execPath,
  [join(root, 'lib/sys/js/jsc.lib.js'), join(root, 'lib/sys/js/core/modules-js.json')],
  {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024}
);
assert.equal(built.status, 0, built.stderr);

const context = vm.createContext
(
  {module: {exports: {}}, require: createRequire(import.meta.url), process, console, assert}
);
vm.runInContext(built.stdout, context, {timeout: 15000});

function exercise(m, assert)
{
  const resolve = m.json.resolve;
  assert.equal(typeof resolve, 'function');
  class Service
  {
    constructor(id)
    {
      this.id = id;
      this.details = {name: 'built'};
    }
  }

  const source = JSON.parse
  (
    '{"services":{"main":["@new","Service",[42]]},"alias":["@ref","$.services.main"],' +
    '"nested":{"color":"blue","button":{"color":["@ref","^^.color"]}},' +
    '"self":["@ref","$"],"name":"example"}'
  );
  const snapshot = JSON.stringify(source);
  const first = resolve(source, {Service});
  const second = resolve(source, {Service});
  assert.equal(JSON.stringify(source), snapshot, 'input must not be modified');
  assert.notEqual(first, source);
  assert.notEqual(first, second);
  assert.notEqual(first.services, source.services);
  assert.equal(first.services.main instanceof Service, true);
  assert.equal(first.services.main.id, 42);
  assert.equal(first.alias, first.services.main);
  assert.equal(first.nested.button.color, 'blue');
  assert.equal(first.self, first);
  assert.notEqual(first.services.main, second.services.main);
  assert.equal(second.alias, second.services.main);
  assert.equal(second.self, second);

  const external = {nested: {value: 17}, directive: ['@new', 'Service']};
  const supplied = {external, Service};
  const refs = resolve
  (
    JSON.parse('{"direct":["@ref","external"],"value":["@ref","external.nested.value"]}'),
    supplied
  );
  assert.equal(refs.direct, external);
  assert.equal(refs.value, 17);
  assert.deepEqual(external.directive, ['@new', 'Service'], 'external graphs are opaque');
  supplied.resolveExternal = value => resolve(value, {Service});
  const nested = resolve
  (
    JSON.parse('["@call","resolveExternal",[["@ref","external"]]]'),
    supplied
  );
  assert.notEqual(nested, external);
  assert.equal(nested.directive instanceof Service, true);
  assert.deepEqual(external.directive, ['@new', 'Service']);

  let count = 0;
  const registry =
  {
    prefix: 'R',
    join(suffix)
    {
      count++;
      return this.prefix + suffix;
    },
    functions:
    {
      factor: 3,
      mul(value)
      {
        return this.factor * value;
      }
    }
  };
  assert.equal(resolve(JSON.parse('["@call","join",["1"]]'), registry), 'R1');
  assert.equal(resolve(JSON.parse('["@call","functions.mul",[7]]'), registry), 21);
  assert.equal(count, 1);
  assert.deepEqual(resolve(JSON.parse('[1,true,false,null,"x",{"a":2}]')), [1,true,false,null,'x',{a:2}]);
  assert.equal(resolve(JSON.parse('4')), 4);
  assert.equal(resolve(JSON.parse('null')), null);
  assert.equal(resolve(JSON.parse('"@ref:$.notAReference"')), '@ref:$.notAReference');

  const strange = resolve(JSON.parse('{"__proto__":{"answer":42},"copy":["@ref","$[\\"__proto__\\"].answer"]}'));
  assert.equal(strange.copy, 42);
  assert.equal(Object.getPrototypeOf(strange), Object.prototype);
  assert.equal(Object.hasOwn(strange, '__proto__'), true);
  assert.equal(strange.__proto__.answer, 42);
  assert.equal(Object.prototype.answer, undefined);

  globalThis.JsonResolveTestGlobal = {value: 91};
  assert.throws
  (
    () => resolve(JSON.parse('["@ref","JsonResolveTestGlobal.value"]')),
    /unknown external/
  );
  assert.equal(resolve(JSON.parse('["@ref","JsonResolveTestGlobal.value"]'), {}, true), 91);
  assert.equal
  (
    resolve(JSON.parse('["@ref","JsonResolveTestGlobal.value"]'), {JsonResolveTestGlobal:{value:14}}, true),
    14,
    'registered references precede global fallback'
  );
  delete globalThis.JsonResolveTestGlobal;

  assert.throws(() => resolve(JSON.parse('{"child":["@ref","$.missing"]}')), /local path missing/);
  assert.throws(() => resolve(JSON.parse('["@ref","missing"]')), /unknown external/);
  assert.throws(() => resolve(JSON.parse('["@ref","$.items[index]"]')), /dynamic property/);
  assert.throws(() => resolve(JSON.parse('["@ref","$.items[0+1]"]')), /dynamic property/);
  assert.throws(() => resolve(JSON.parse('["@ref","$.items[9007199254740993]"]')), /unsafe array index/);
  assert.throws(() => resolve(JSON.parse('["@new","$.Service"]'), {Service}), /must be external/);
  assert.throws(() => resolve(JSON.parse('["@ref","$["]')), /dynamic property|malformed/);
  assert.throws(() => resolve(JSON.parse('["@ref"]')), /exactly one path/);
  assert.throws(() => resolve(JSON.parse('["@call","join",{}]'), registry), /argument array/);
  assert.throws(() => resolve(JSON.parse('["@eval","1+1"]')), /unsupported/);
  assert.throws(() => resolve(JSON.parse('["@call","none"]'), {none: 3}), /not callable/);
  assert.throws(() => resolve(JSON.parse('["@ref","Math.PI"]'), {}, 'true'), /allowGlobals/);
  assert.throws(() => resolve(JSON.parse('{"a":["@ref","$.b"],"b":["@ref","$.a"]}')), /circular directive/);
  assert.throws(() => resolve(JSON.parse('{"a":["@ref","^^.x"]}')), /escapes the root/);

  let failures = 0;
  const failed = new Error('one-shot');
  assert.throws
  (
    () => resolve(JSON.parse('["@call","fail"]'), {fail(){failures++;throw failed;}}),
    error => error === failed
  );
  assert.equal(failures, 1, 'a failing callback must not be retried');
  let constructed = 0;
  assert.throws
  (
    () => resolve(JSON.parse('{"first":["@new","Service",[1]],"bad":["@ref","unknown"]}'),
      {Service: class {constructor(){constructed++;}}}),
    /unknown external/
  );
  assert.equal(constructed, 1, 'no transactional rollback after an execution failure');

  const alias = {};
  const invalid =
  [
    undefined,
    {missing:undefined},
    {fn() {}},
    {nan:NaN},
    {infinite:Infinity},
    {big:2n},
    new Date(),
    new Service(1),
    Object.create({inherited:'value'}),
    Object.create(null),
    [1,,3],
    {a:alias, b:alias},
    (() => {const a={};a.self=a;return a;})(),
    (() => {const a={};Object.defineProperty(a,'computed',{get(){return 1;},enumerable:true});return a;})(),
    (() => {const a={};a[Symbol('hidden')]=3;return a;})()
  ];
  for(const item of invalid)
  {
    assert.throws(() => resolve(item), /resolve:/, 'non-JSON input must be rejected');
  }
  let getterCalls = 0;
  const getterArray = ['@ref', '$.value'];
  Object.defineProperty(getterArray, '0',
  {
    configurable: true,
    enumerable: true,
    get()
    {
      getterCalls++;
      return '@ref';
    }
  });
  assert.throws(() => resolve(getterArray), /non-JSON property/);
  assert.equal(getterCalls, 0, 'invalid array accessors must not execute during validation');

  // A sibling dependency can be resolved before its textual order.
  const forward = resolve(JSON.parse('{"a":["@ref","$.b"],"b":["@call","join",["3"]]}'), registry);
  assert.equal(forward.a, 'R3');
  assert.equal(forward.a, forward.b);
  assert.equal(count, 2);

}

vm.runInContext
(
  '(' + exercise.toString() + ')(module.exports, assert)',
  context,
  {timeout: 30000}
);
console.log('PASS real jsc m.json.resolve JSON-only contract');
