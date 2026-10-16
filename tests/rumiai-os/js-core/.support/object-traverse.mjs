// Protect object-identity traversal, inherited properties, and advanced callbacks through real jsc.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import vm from 'node:vm';

const root = resolve(process.argv[2]);
const build = spawnSync
(
  process.execPath,
  [join(root, 'lib/sys/js/jsc.lib.js'), join(root, 'lib/sys/js/core/modules-js.json')],
  {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024}
);
assert.equal(build.status, 0, build.stderr);

const context = vm.createContext
(
  {module: {exports: {}}, require: createRequire(import.meta.url), process, console, assert}
);
vm.runInContext(build.stdout, context, {timeout: 15000});

function exercise(traverse, legacy, resolve, assert)
{
  assert.equal(typeof traverse, 'function');
  assert.equal(traverse, legacy);
  assert.equal(traverse.advanced, legacy.advanced);

  const prototype = {inherited: 90};
  Object.defineProperty(prototype, 'hidden', {value: 'hidden', enumerable: false});
  const shared = {leaf: 7};
  const data = Object.create(prototype);
  data.first = shared;
  data.second = shared;
  data.self = data;
  data['01'] = 'leading zero';
  data['9007199254740993'] = 'huge key';
  data[1] = 'index';
  data.repeatA = 9;
  data.repeatB = 9;
  const symbol = Symbol('symbol');
  data[symbol] = 12;

  const contexts = new Map();
  const result = traverse
  (
    data,
    (value, path, pathArray, parents, parentsPaths) =>
    {
      contexts.set(path, {value, pathArray, parents, parentsPaths});
      return 'ante:' + path;
    }
  );
  const expectedPaths =
  [
    '',
    '[1]',
    '["first"]',
    '["first"]["leaf"]',
    '["01"]',
    '["9007199254740993"]',
    '["repeatA"]',
    '["repeatB"]',
    '["inherited"]'
  ];
  assert.deepEqual(result.paths, expectedPaths);
  assert.equal(result.nodes.filter(v => v === shared).length, 1);
  assert.equal(result.paths.includes('["second"]'), false);
  assert.equal(result.paths.includes('["self"]'), false);
  assert.equal(result.paths.includes('["hidden"]'), false);
  assert.equal(result.paths.includes('[Symbol(symbol)]'), false);
  assert.equal(result.nodes.filter(v => v === 9).length, 2);
  assert.deepEqual(result.calcs, expectedPaths.map(path => 'ante:' + path));
  assert.equal(Object.hasOwn(result, 'calcsPost'), false);
  assert.deepEqual(contexts.get('["first"]["leaf"]').pathArray, ['first', 'leaf']);
  assert.deepEqual(contexts.get('["first"]["leaf"]').parents, [shared, data]);
  assert.deepEqual(contexts.get('["first"]["leaf"]').parentsPaths, ['["first"]', '']);

  const events = [];
  const recurseArgs = new Map();
  const advanced = traverse.advanced
  (
    data,
    (value, path) =>
    {
      events.push('ante:' + path);
      return 'a:' + path;
    },
    (value, path) =>
    {
      events.push('post:' + path);
      return 'p:' + path;
    },
    (value, path, pathArray, parents, parentsPaths) =>
    {
      recurseArgs.set(path, {pathArray, parents, parentsPaths});
      return path !== '["first"]';
    }
  );
  assert.equal(advanced.paths.at(-1), '');
  assert.equal(advanced.paths.includes('["first"]["leaf"]'), false);
  assert.equal(advanced.paths.includes('["inherited"]'), true);
  assert.equal(advanced.nodes.filter(value => value === shared).length, 1);
  assert.equal(advanced.calcs.length, advanced.paths.length);
  assert.deepEqual(advanced.calcs, advanced.paths.map(path => 'a:' + path));
  assert.deepEqual(advanced.calcsPost, advanced.paths.map(path => 'p:' + path));
  assert.equal(events[0], 'ante:');
  assert.equal(events.at(-1), 'post:');
  assert.ok(events.indexOf('ante:["first"]') < events.indexOf('post:["first"]'));
  assert.deepEqual(recurseArgs.get('["first"]').pathArray, ['first']);
  assert.deepEqual(recurseArgs.get('["first"]').parents, [data]);
  assert.deepEqual(recurseArgs.get('["first"]').parentsPaths, ['']);
  assert.equal(recurseArgs.has('["first"]["leaf"]'), false);

  const live = {a: 0, b: 1};
  const liveValues = traverse
  (
    live,
    (value, path) =>
    {
      if(path === '["a"]')
      {
        live.b = 2;
      }
      return value;
    }
  );
  assert.equal(liveValues.calcs[liveValues.paths.indexOf('["b"]')], 2);

  let before = 0;
  let after = 0;
  const blocked = traverse.advanced
  (
    {child: {deep: true}},
    () => ++before,
    () => ++after,
    () => false
  );
  assert.deepEqual(blocked.paths, ['']);
  assert.deepEqual(blocked.calcs, [1]);
  assert.deepEqual(blocked.calcsPost, [1]);

  const leafFunction = function callback() {};
  leafFunction.child = {};
  assert.deepEqual(traverse(leafFunction).paths, ['']);
  assert.deepEqual(traverse(null).paths, ['']);
  assert.deepEqual(traverse.advanced(7).paths, ['']);
  const thrown = new Error('traverse callback failure');
  assert.throws(() => traverse({a: 2}, () => {throw thrown;}), error => error === thrown);
  assert.throws(() => traverse.advanced({}, undefined, () => {throw thrown;}), error => error === thrown);
  assert.throws(() => traverse.advanced({}, undefined, undefined, () => {throw thrown;}), error => error === thrown);

  const deep = {};
  let cursor = deep;
  for(let i = 0; i < 1500; i++)
  {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.equal(traverse(deep).nodes.length, 1501);
  assert.equal(traverse.advanced(deep).nodes.length, 1501);

  const config =
  {
    rootValue: 7,
    alias: ['@ref', '$.rootValue'],
    nested: {local: 12, alias: ['@ref', '^.local']}
  };
  const resolved = resolve(config);
  assert.notEqual(resolved, config);
  assert.equal(resolved.alias, 7);
  assert.equal(resolved.nested.alias, 12);
  assert.deepEqual(config.alias, ['@ref', '$.rootValue']);
}

vm.runInContext
(
  '(' + exercise.toString() + ')' +
    '(module.exports.object.traverse, module.exports.json.traverse, module.exports.json.resolve, assert)',
  context,
  {timeout: 30000}
);
console.log('PASS real jsc m.object.traverse identity, inherited props, advanced callbacks and json alias');
