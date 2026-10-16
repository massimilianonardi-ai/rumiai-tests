// Protect the real classic JavaScript core assembly and representative runtime APIs.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import vm from 'node:vm';

const root = resolve(process.argv[2]);
const engine = join(root, 'lib/sys/js/jsc.lib.js');
const manifest = join(root, 'lib/sys/js/core/modules-js.json');
const built = spawnSync
(
  process.execPath,
  [engine, manifest],
  {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024}
);
assert.equal(built.status, 0, 'real core compilation failed: ' + built.stderr);
assert.ok(built.stdout.length > 0, 'compiled core source is empty');
new vm.Script(built.stdout);

const clock = {tick: 42, now() { return this.tick; }};
const browser = vm.createContext
(
  {
    window: {},
    navigator: {userAgent: 'Mozilla/5.0'},
    document: {currentScript: {src: 'https://example.test/assets/core.js'}},
    location: {origin: 'https://example.test', pathname: '/app'},
    console,
    performance: clock
  }
);
vm.runInContext(built.stdout, browser, {timeout: 15000});
assert.equal(browser.m.util.environment(), 'browser');
assert.equal(browser.m.util.timestamp(), 42, 'timestamp must use the correctly bound host clock');
assert.equal(browser.m.util.deviceMobility(), 'fixed');
assert.equal(browser.m.util.isMobile(), false);
browser.navigator.userAgent = 'Android';
assert.equal(browser.m.util.deviceMobility(), 'mobile');
assert.equal(browser.m.util.isMobile(), true);
assert.equal(browser.m.root, '/assets');
assert.equal(browser.m.path, '/assets/core.js');
assert.equal(browser.m.global, browser.m.g);
assert.equal(typeof browser.m.Class, 'function');
assert.equal(typeof browser.m.log.Log, 'function');
assert.equal(typeof browser.m.util.clone, 'function');
assert.equal(typeof browser.m.object.clone, 'function');
assert.equal(typeof browser.m.object.merge, 'function');
assert.equal(browser.m.json.path('.group[0]["value"]', {group: [{value: 42}]}), 42);

const classValue = vm.runInContext
(
  'function Example(){return Example.Class.construct(this,arguments);}' +
  'm.Class(Example).compose("answer",42);' +
  '(new Example()).answer;',
  browser
);
assert.equal(classValue, 42, 'legacy Class composition changed');

const commonjs = vm.createContext
(
  {module: {exports: {}}, require: createRequire(import.meta.url), process, console}
);
vm.runInContext(built.stdout, commonjs, {timeout: 15000});
assert.equal(commonjs.m, undefined, 'default Node compilation must not publish global m');
assert.equal(commonjs.module.exports.util.environment(), 'nodejs');
assert.equal(commonjs.module.exports.util.deviceMobility(), 'fixed');
assert.equal(commonjs.module.exports.util.isMobile(), false);
assert.ok(Number.isFinite(commonjs.module.exports.util.timestamp()));
assert.equal(commonjs.module.exports.json.path('["value"]', {value: 42}), 42);
assert.equal(typeof commonjs.module.exports.Class, 'function');
assert.equal(typeof commonjs.module.exports.object.clone, 'function');
assert.equal(typeof commonjs.module.exports.object.merge, 'function');

console.log('PASS real jsc core assembly: classic browser and independent CommonJS runtime');
