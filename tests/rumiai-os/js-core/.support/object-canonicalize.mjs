// Exercise m.object.canonicalize through the real jsc-assembled CommonJS core.
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
  {module: {exports: {}}, require: createRequire(import.meta.url), process, console}
);
vm.runInContext(built.stdout, context, {timeout: 15000});

const m = context.module.exports;
const canonicalize = m.object.canonicalize;
assert.equal(typeof canonicalize, 'function');
assert.equal(m.json.canonicalize, canonicalize, 'legacy API must be an alias');

const valid =
[
  ['', ''],
  ['.user.name', '["user"]["name"]'],
  ['[0].name', '[0]["name"]'],
  ['["name"]', '["name"]'],
  ["['name']", '["name"]'],
  ['["a.b"]', '["a.b"]'],
  ["['a\\'b']", '["a\'b"]'],
  ['.items[index]', '["items"][index]'],
  ['.items[values[i]]', '["items"][values[i]]'],
  ['["a]b"]', '["a]b"]'],
  ["['\\u0062']", '["b"]'],
  ["['\\x41']", '["A"]'],
  ['.a[0]["b"]', '["a"][0]["b"]'],
  ["[ ' spaced ' ]", '[" spaced "]'],
  ['[foo["x]"]]', '[foo["x]"]]']
];

for(const [source, expected] of valid)
{
  assert.equal(canonicalize(source), expected, source);
  assert.equal(canonicalize(expected), expected, 'canonical output must be stable');
}

const invalid =
[
  '.a..b', '.a.', '[', '[a', '["abc]', '["x"', '[]', '[  ]',
  "['x'", '["\\xZZ"]', '["\\uXYZZ"]', '["\\8"]', '["\\u{110000}"]'
];

for(const path of invalid)
{
  assert.throws(() => canonicalize(path), {name: 'SyntaxError'}, path);
}

for(const value of [null, undefined, 0, [], {}])
{
  assert.throws(() => canonicalize(value), {name: 'TypeError'});
}

const data = {value: 42, target: "@ref:$['value']"};
assert.equal(m.json.resolve(data), data);
assert.equal(data.target, 42, 'resolve must use the compatible canonicalizer');
console.log('PASS real jsc m.object.canonicalize and legacy m.json alias');
