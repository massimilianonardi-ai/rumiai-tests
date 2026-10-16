// Real jsc core contract: linked reads, receiver detachment and nested shells.
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

function verify(link, linkProperty, legacy, assert)
{
  assert.notEqual(link, legacy);
  assert.equal(typeof linkProperty, 'function');
  assert.throws(() => link(), SyntaxError);
  assert.throws(() => link(null, {}), TypeError);
  assert.throws(() => link({}, null), TypeError);
  assert.throws(() => link({}, {}, 1), TypeError);
  assert.throws(() => link({}, {}, 'x', 7), TypeError);
  assert.throws(() => linkProperty({}, {}, 5), TypeError);

  const source = {count: 1, nested: {value: 2}};
  const target = {};
  assert.equal(link(source, target), target);
  source.count = 3;
  assert.equal(target.count, 3);
  target.count = 4;
  source.count = 5;
  assert.equal(target.count, 4);
  assert.equal(source.count, 5);
  assert.equal(target.nested, source.nested);
  const renamed = {};
  linkProperty(source, renamed, 'count', 'alias');
  assert.equal(renamed.alias, 5);
  source.count = 6;
  assert.equal(renamed.alias, 6);
  renamed.alias = 10;
  source.count = 11;
  assert.equal(renamed.alias, 10);

  const parent = {};
  linkProperty(source, parent, 'count');
  const child = Object.create(parent);
  child.count = 99;
  assert.equal(parent.count, 11);
  assert.equal(child.count, 99);
  source.count = 12;
  assert.equal(parent.count, 12);
  assert.equal(child.count, 99);

  assert.throws(() => link(source, source), TypeError);
  assert.throws(() => link(source, source, 'count', true), TypeError);
  assert.throws(() => linkProperty(source, source, 'count'), TypeError);
  const frozen = {};
  Object.defineProperty(frozen, 'count', {value: 1, configurable: false});
  assert.throws(() => linkProperty(source, frozen, 'count'), TypeError);

  const sym = Symbol('key');
  const inheritedSym = Symbol('proto');
  const proto = {inherited: 5};
  proto[inheritedSym] = 9;
  const object = Object.create(proto);
  object[sym] = 7;
  object.own = 8;
  const symbols = {};
  link(object, symbols);
  assert.equal(symbols.inherited, 5);
  assert.equal(symbols[inheritedSym], 9);
  assert.equal(symbols[sym], 7);
  object[sym] = 10;
  assert.equal(symbols[sym], 10);

  const payload = JSON.parse('{"__proto__":{"safe":true}}');
  const safe = {};
  link(payload, safe);
  assert.equal(Object.getPrototypeOf(safe), Object.prototype);
  assert.equal(Object.hasOwn(safe, '__proto__'), true);
  assert.equal(safe['__proto__'].safe, true);

  let reads = 0;
  const getter = {};
  Object.defineProperty
  (
    getter, 'value',
    {get() {reads++; return 42;}, enumerable: true}
  );
  const forwarded = {};
  link(getter, forwarded);
  assert.equal(reads, 0);
  assert.equal(forwarded.value, 42);
  assert.equal(reads, 1);

  const original = {branch: {name: 'Ada', nested: {score: 2}}};
  const deep = {};
  assert.equal(link(original, deep, true), deep);
  assert.notEqual(deep.branch, original.branch);
  assert.notEqual(deep.branch.nested, original.branch.nested);
  original.branch.name = 'Grace';
  assert.equal(deep.branch.name, 'Grace');
  deep.branch.name = 'local';
  original.branch.name = 'Other';
  assert.equal(deep.branch.name, 'local');
  deep.branch.nested.score = 4;
  assert.equal(original.branch.nested.score, 2);
  original.branch = {name: 'replacement'};
  assert.equal(deep.branch.nested.score, 4);

  const renamedDeep = {};
  link({branch: {leaf: 1}}, renamedDeep, 'branch', 'alias', true);
  assert.equal(renamedDeep.alias.leaf, 1);
  const compact = {};
  link({branch: {leaf: 3}}, compact, 'branch', true);
  assert.equal(compact.branch.leaf, 3);

  const shared = {value: 1};
  const graph = {left: shared, right: shared};
  graph.self = graph;
  const mirror = {};
  link(graph, mirror, true);
  assert.equal(mirror.self, mirror);
  assert.equal(mirror.left, mirror.right);
  assert.notEqual(mirror.left, shared);
  shared.value = 3;
  assert.equal(mirror.right.value, 3);
  mirror.left.value = 5;
  assert.equal(mirror.right.value, 5);
  assert.equal(shared.value, 3);

  const arrays = {items: [1, , {name: 'before'}]};
  const shallow = {};
  link(arrays, shallow, true, false);
  assert.equal(shallow.items, arrays.items);
  const nestedArrays = {};
  link(arrays, nestedArrays, true, true);
  assert.equal(Array.isArray(nestedArrays.items), true);
  assert.equal(nestedArrays.items.length, 3);
  assert.equal(1 in nestedArrays.items, false);
  assert.notEqual(nestedArrays.items[2], arrays.items[2]);
  arrays.items[0] = 2;
  assert.equal(nestedArrays.items[0], 2);
  nestedArrays.items[2].name = 'after';
  assert.equal(arrays.items[2].name, 'before');
  arrays.items.push(8);
  assert.equal(nestedArrays.items.length, 3);

  assert.equal(typeof legacy, 'function');
}
vm.runInContext
(
  '(' + verify.toString() + ')' +
    '(module.exports.object.link, module.exports.object.linkProperty,' +
    'module.exports.util.link, assert)',
  context,
  {timeout: 30000}
);
assert.equal(context.module.exports.json.link, undefined);
console.log('PASS real jsc object read-through, deep shells, cycles and legacy link');
