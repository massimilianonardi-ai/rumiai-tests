// Real jsc-assembled m.object.merge behavior and legacy compatibility.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
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

function verify(merge, legacy, assert)
{
  assert.equal(typeof merge, 'function');
  assert.notEqual(merge, legacy);
  assert.throws(() => merge({}), SyntaxError);
  assert.throws(() => merge({}, {}, -1), TypeError);
  assert.throws(() => merge({}, {}, 0, -1), TypeError);
  assert.throws(() => merge({}, {}, 0, 0, 'append'), TypeError);
  assert.throws(() => merge({}, {}, 0, 0, false, 1), TypeError);
  assert.equal(merge({}, null), null);
  assert.equal(merge({}, 7), 7);

  const existing = {config: {old: 1, inner: {before: true}}, untouched: true};
  const source = {config: {new: 2, inner: {after: true}}};
  const merged = merge(existing, source, true, true);
  assert.equal(merged, existing);
  assert.equal(merged.config.old, 1);
  assert.equal(merged.config.new, 2);
  assert.equal(merged.config.inner.before, true);
  assert.equal(merged.config.inner.after, true);
  assert.equal(merged.untouched, true);

  const limited = {config: {old: 1}};
  merge(limited, {config: {new: 2}}, 0, 0);
  assert.equal('old' in limited.config, false);
  assert.equal(limited.config.new, 2);
  assert.notEqual(limited.config, source.config);
  const leaf = {child: {nested: {x: 1}}};
  const shallow = merge({}, leaf, 0, 0);
  assert.notEqual(shallow.child, leaf.child);
  assert.equal(shallow.child.nested, leaf.child.nested);
  const deep = merge({}, leaf, 0, true);
  assert.notEqual(deep.child.nested, leaf.child.nested);

  const shared = {count: 1};
  const cyclic = {left: shared, right: shared};
  cyclic.self = cyclic;
  const graph = merge({}, cyclic, true, true);
  assert.equal(graph.self, graph);
  assert.equal(graph.left, graph.right);
  assert.notEqual(graph.left, shared);
  const alias = merge({left: {old: 1}}, {left: shared, right: shared}, true, true);
  assert.equal(alias.left, alias.right);
  assert.equal(alias.left.old, 1);

  const nestedAlias = {value: 5};
  const nestedCopies = merge({}, {a: {v: nestedAlias}, b: {v: nestedAlias}}, 0, true);
  assert.equal(nestedCopies.a.v, nestedCopies.b.v);
  assert.notEqual(nestedCopies.a.v, nestedAlias);

  const ar = [1, , {old: true}];
  const arrSource = [2, {value: 3}];
  const appendResult = merge(ar, arrSource, true, true, true);
  assert.equal(appendResult, ar);
  assert.equal(ar.length, 5);
  assert.equal(1 in ar, false);
  assert.equal(ar[3], 2);
  assert.notEqual(ar[4], arrSource[1]);
  const indexed = merge([{a: 1}], [{b: 2}, 9], true, true, false);
  assert.equal(Array.isArray(indexed), true);
  assert.equal(indexed[0].a, 1);
  assert.equal(indexed[0].b, 2);
  assert.equal(indexed[1], 9);
  const replaced = merge([1], [2, 3], true, true);
  assert.equal(Array.isArray(replaced), true);
  assert.notEqual(replaced, ar);
  assert.equal(replaced.length, 2);
  const sparse = [, 1];
  const sparseCopy = merge(null, sparse, 0, 0);
  assert.equal(Array.isArray(sparseCopy), true);
  assert.equal(0 in sparseCopy, false);

  const symbol = Symbol('key');
  const sourceSymbols = {[symbol]: {x: 1}};
  const withSymbols = merge({}, sourceSymbols, 0, true);
  assert.notEqual(withSymbols[symbol], sourceSymbols[symbol]);
  const hidden = {};
  Object.defineProperty(hidden, 'nonEnumerable', {value: 1, enumerable: false});
  assert.equal('nonEnumerable' in merge({}, hidden, true, true), false);
  const copiedHidden = merge(null, hidden, true, true);
  assert.equal(copiedHidden.nonEnumerable, 1);
  assert.equal(Object.getOwnPropertyDescriptor(copiedHidden, 'nonEnumerable').enumerable, false);

  const prot = {inherited: 10};
  const inherited = Object.create(prot);
  inherited.own = 5;
  const ownOnly = merge({}, inherited, true, true);
  assert.equal(Object.hasOwn(ownOnly, 'inherited'), false);
  assert.equal(ownOnly.own, 5);
  const payload = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"broken":1}}}');
  const secure = merge({}, payload, true, true);
  assert.equal({}.polluted, undefined);
  assert.equal({}.broken, undefined);
  assert.equal(Object.hasOwn(secure, '__proto__'), true);
  assert.equal(secure['__proto__'].polluted, 'yes');

  const original = {point: 10};
  Object.defineProperty(original, 'point', {value: 10, writable: false});
  assert.throws(() => merge(original, {point: 11}), TypeError);
  assert.equal(original.point, 10);
  const privateSetter = {};
  Object.defineProperty(privateSetter, '__proto__', {value: {hello: 2}, enumerable: true});
  const saved = merge({}, privateSetter);
  assert.equal(Object.getPrototypeOf(saved), Object.prototype);
  assert.equal(Object.hasOwn(saved, '__proto__'), true);

  class Item
  {
    constructor()
    {
      this.x = {n: 3};
    }
    get()
    {
      return this.x.n;
    }
  }
  const obj = new Item();
  assert.equal(merge(null, obj, true, true), obj);
  const instanceCopy = merge(null, obj, true, true, false, true);
  assert.ok(instanceCopy instanceof Item);
  assert.notEqual(instanceCopy.x, obj.x);
  assert.equal(instanceCopy.get(), 3);
  const targetInstance = new Item();
  const mergedInstance = merge(targetInstance, obj, true, true, false, true);
  assert.equal(mergedInstance, targetInstance);
  assert.equal(targetInstance.get(), 3);

  function Fn() {}
  Fn.answer = {n: 1};
  const into = function Target() {};
  assert.equal(merge(into, Fn, true, true), into);
  assert.notEqual(into.answer, Fn.answer);

  const native = {date: new Date(100), map: new Map([['key', {n: 1}]])};
  const nativeCopy = merge({}, native, true, true);
  assert.notEqual(nativeCopy.date, native.date);
  assert.equal(nativeCopy.date.getTime(), 100);
  assert.notEqual(nativeCopy.map, native.map);
  assert.equal(nativeCopy.map.get('key').n, 1);

  let tags = 0;
  const tagSource = {};
  Object.defineProperty(tagSource, Symbol.toStringTag, {
    get() {tags++; return 'surprise';}, enumerable: true
  });
  merge({}, tagSource, true, true);
  assert.equal(tags, 0);

  assert.equal(legacy({a: 0}, {b: 1}).b, 1);
}
vm.runInContext
(
  '(' + verify.toString() + ')' +
    '(module.exports.object.merge, module.exports.util.merge, assert)',
  context,
  {timeout: 30000}
);
console.log('PASS real jsc m.object.merge depth, arrays, graph, safety and legacy behavior');
