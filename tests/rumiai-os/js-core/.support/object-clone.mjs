// Exercise m.object.clone through the real jsc-assembled CommonJS core.
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
  {
    module: {exports: {}},
    require: createRequire(import.meta.url),
    process,
    console,
    assert,
    Blob,
    URL,
    URLSearchParams,
    foreign: {child: {value: 42}}
  }
);
vm.runInContext(built.stdout, context, {timeout: 15000});

function exercise(clone, legacy, assert, foreign)
{
  assert.equal(typeof clone, 'function');
  assert.notEqual(clone, legacy);
  assert.equal(Object.isFrozen(clone), true);
  assert.deepEqual
  (
    [clone.error, clone.value, clone.enum, clone.instance, clone.ideep, clone.iall],
    [1, 2, 4, 8, 16, 32]
  );
  assert.throws(() => clone(), SyntaxError);
  assert.throws(() => clone({}, -1), TypeError);
  assert.throws(() => clone({}, NaN), TypeError);
  assert.throws(() => clone({}, true, 64), TypeError);
  assert.equal(clone(null, true), null);
  const functionValue = () => 42;
  assert.equal(clone(functionValue, true), functionValue);

  const source = {nested: {deep: {value: 3}}};
  const shallow = clone(source);
  assert.notEqual(shallow, source);
  assert.equal(shallow.nested, source.nested);
  const one = clone(source, 1);
  assert.notEqual(one.nested, source.nested);
  assert.equal(one.nested.deep, source.nested.deep);
  assert.notEqual(clone(source, true).nested.deep, source.nested.deep);

  const shared = {answer: 42};
  const graph = {first: shared, second: shared};
  graph.self = graph;
  const result = clone(graph, true);
  assert.equal(result.self, result);
  assert.equal(result.first, result.second);
  assert.notEqual(result.first, shared);

  const array = [1, , {nested: 2}];
  array[3] = array;
  Object.defineProperty(array, 'hidden', {value: 42});
  const arrayClone = clone(array, true);
  assert.equal(Array.isArray(arrayClone), true);
  assert.equal(1 in arrayClone, false);
  assert.equal(arrayClone[3], arrayClone);
  assert.equal(arrayClone.hidden, 42);
  assert.notEqual(arrayClone[2], array[2]);
  assert.equal(Array.isArray(clone(array, 0, clone.value)), true);

  const symbol = Symbol('own-key');
  let getterCalls = 0;
  const described = {};
  Object.defineProperty(described, 'locked',
    {value: {x: 1}, writable: false, enumerable: false, configurable: false});
  Object.defineProperty(described, 'getter',
    {get() {getterCalls++; return {x: 2};}, enumerable: true});
  described[symbol] = {x: 3};
  const describedClone = clone(described, true);
  assert.equal(getterCalls, 0);
  assert.notEqual(describedClone.locked, described.locked);
  assert.equal(Object.getOwnPropertyDescriptor(describedClone, 'locked').writable, false);
  assert.notEqual(describedClone[symbol], described[symbol]);
  assert.equal(Object.getOwnPropertyDescriptor(describedClone, 'getter').get,
    Object.getOwnPropertyDescriptor(described, 'getter').get);
  const values = clone(described, true, clone.value | clone.enum);
  assert.equal(getterCalls, 1);
  assert.equal('locked' in values, false);
  assert.equal(Object.getOwnPropertyDescriptor(values, 'getter').writable, true);

  const proto = {inherited: 1};
  const inherited = Object.create(proto);
  inherited.own = 2;
  const inheritedClone = clone(inherited, true, clone.instance);
  assert.equal(Object.hasOwn(inheritedClone, 'inherited'), false);
  assert.equal(inheritedClone.inherited, 1);

  class Example
  {
    constructor()
    {
      this.child = {x: 1};
    }
    method()
    {
      return this.child.x;
    }
  }
  const instance = new Example();
  Object.defineProperty(instance, 'privateValue', {value: 4, enumerable: false});
  assert.equal(clone(instance, true), instance);
  const instanceClone = clone(instance, true, clone.instance | clone.value |
    clone.enum | clone.ideep | clone.iall);
  assert.ok(instanceClone instanceof Example);
  assert.notEqual(instanceClone.child, instance.child);
  assert.equal(instanceClone.method(), 1);
  assert.equal(instanceClone.privateValue, 4);
  assert.equal(Object.getOwnPropertyDescriptor(instanceClone, 'privateValue').writable, false);

  const root = {};
  root.map = new Map();
  root.set = new Set();
  root.map.set(root, root.set);
  root.set.add(root.map);
  const clonedRoot = clone(root, true);
  assert.equal(clonedRoot.map.get(clonedRoot), clonedRoot.set);
  assert.equal(clonedRoot.set.has(clonedRoot.map), true);

  const date = new Date(10123);
  const expression = /abc/gi;
  expression.lastIndex = 7;
  const natives = clone({date, expression, boxed: new Number(7), string: new String('abc')}, true);
  assert.equal(natives.date.getTime(), 10123);
  assert.equal(natives.expression.lastIndex, 7);
  assert.equal(natives.boxed.valueOf(), 7);
  assert.equal(natives.string.valueOf(), 'abc');

  const buffer = new ArrayBuffer(16);
  const bytes = new Uint8Array(buffer);
  bytes[4] = 91;
  const view = new DataView(buffer, 4, 4);
  const binary = clone({buffer, bytes, view}, true);
  assert.notEqual(binary.buffer, buffer);
  assert.equal(binary.bytes.buffer, binary.buffer);
  assert.equal(binary.view.buffer, binary.buffer);
  assert.equal(binary.bytes[4], 91);
  assert.equal(binary.view.getUint8(0), 91);

  const opaque = Promise.resolve(10);
  assert.equal(clone(opaque, true), opaque);
  assert.throws(() => clone(opaque, true, clone.error), TypeError);

  const foreignCopy = clone(foreign, true);
  assert.notEqual(foreignCopy, foreign);
  assert.notEqual(foreignCopy.child, foreign.child);
  assert.equal(foreignCopy.child.value, 42);

  const large = {};
  let cursor = large;
  for (let i = 0; i < 20000; i++)
  {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor = clone(large, true);
  assert.notEqual(cursor, large);
  for (let i = 0; i < 20000; i++)
  {
    cursor = cursor.next;
  }
  assert.equal(Object.keys(cursor).length, 0);
  assert.equal(legacy({x: 1}).x, 1);
}

vm.runInContext
(
  '(' + exercise.toString() + ')' +
    '(module.exports.object.clone, module.exports.util.clone, assert, foreign)',
  context,
  {timeout: 30000}
);
assert.equal(context.module.exports.json.clone, undefined);
console.log('PASS real jsc m.object.clone graph, descriptors, flags, native objects and legacy API');
