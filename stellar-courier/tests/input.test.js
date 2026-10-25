'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Input = require('../input.js');

function input() { return Input.create(); }

test('new non-repeating press is fresh and remains held until release', () => {
  const keys = input();
  assert.equal(keys.keydown('Enter', false), 'fresh');
  assert.equal(keys.keydown('Enter', true), 'held');
  assert.equal(keys.keydown('Enter', true), 'held');
  keys.keyup('Enter');
  assert.equal(keys.keydown('Enter', false), 'fresh');
});

test('duplicate non-repeat keydown cannot activate an action twice', () => {
  const keys = input();
  assert.equal(keys.keydown('Space', false), 'fresh');
  for (let i = 0; i < 20; i++) assert.equal(keys.keydown('Space', false), 'held');
  keys.keyup('Space');
  assert.equal(keys.keydown('Space', false), 'fresh');
});

test('missing repeat argument is treated as an ordinary non-repeating press', () => {
  const keys = input();
  assert.equal(keys.keydown('KeyP'), 'fresh');
  assert.equal(keys.keydown('KeyP'), 'held');
});

test('orphan repeat is blocked until the matching release, even if later repeat=false', () => {
  const keys = input();
  assert.equal(keys.keydown('Enter', true), 'blocked');
  assert.equal(keys.keydown('Enter', false), 'blocked');
  assert.equal(keys.keydown('Enter', true), 'blocked');
  keys.keyup('Enter');
  assert.equal(keys.keydown('Enter', false), 'fresh');
});

test('repeat arriving immediately after keyup is a new orphan rather than fresh', () => {
  const keys = input();
  keys.keydown('Space', false); keys.keyup('Space');
  assert.equal(keys.keydown('Space', true), 'blocked');
  keys.keyup('Space');
  assert.equal(keys.keydown('Space', false), 'fresh');
});

test('scene boundary blocks both repeat and duplicate non-repeat held keys', () => {
  const keys = input();
  keys.keydown('Enter', false); keys.boundary();
  assert.equal(keys.keydown('Enter', true), 'blocked');
  assert.equal(keys.keydown('Enter', false), 'blocked');
  keys.keyup('Enter');
  assert.equal(keys.keydown('Enter', false), 'fresh');
});

test('all held keys in a chord are blocked at the same boundary', () => {
  const keys = input(), chord = ['ArrowLeft', 'KeyW', 'Space', 'Enter'];
  chord.forEach(code => assert.equal(keys.keydown(code, false), 'fresh'));
  keys.boundary();
  chord.forEach(code => assert.equal(keys.keydown(code, false), 'blocked'));
  chord.forEach(code => assert.equal(keys.keydown(code, true), 'blocked'));
});

test('releasing one key in a blocked chord does not release the other keys', () => {
  const keys = input();
  keys.keydown('ArrowRight', false); keys.keydown('Space', false); keys.boundary();
  keys.keyup('Space');
  assert.equal(keys.keydown('Space', false), 'fresh');
  assert.equal(keys.keydown('ArrowRight', false), 'blocked');
});

test('repeated boundaries never implicitly release a held key', () => {
  const keys = input();
  keys.keydown('Enter', false);
  for (let i = 0; i < 25; i++) {
    keys.boundary();
    assert.equal(keys.keydown('Enter', i % 2 === 0), 'blocked');
  }
  keys.keyup('Enter');
  assert.equal(keys.keydown('Enter', false), 'fresh');
});

test('empty boundaries do not block future unrelated presses', () => {
  const keys = input();
  keys.boundary(); keys.boundary();
  assert.equal(keys.keydown('Enter', false), 'fresh');
  assert.equal(keys.keydown('Digit2', false), 'fresh');
});

test('key released before a scene boundary remains available in the next scene', () => {
  const keys = input();
  keys.keydown('Escape', false); keys.keyup('Escape'); keys.boundary();
  assert.equal(keys.keydown('Escape', false), 'fresh');
});

test('new keys after a boundary are fresh while the carried key remains blocked', () => {
  const keys = input();
  keys.keydown('Enter', false); keys.boundary();
  assert.equal(keys.keydown('ArrowDown', false), 'fresh');
  assert.equal(keys.keydown('Digit2', false), 'fresh');
  assert.equal(keys.keydown('Enter', false), 'blocked');
  keys.boundary();
  assert.equal(keys.keydown('ArrowDown', false), 'blocked');
  assert.equal(keys.keydown('Digit2', false), 'blocked');
});

test('unknown and duplicate releases are harmless and cannot clear another key', () => {
  const keys = input();
  keys.keydown('Enter', false); keys.boundary();
  keys.keyup('Space'); keys.keyup('Space');
  assert.equal(keys.keydown('Enter', false), 'blocked');
  keys.keyup('Enter'); keys.keyup('Enter');
  assert.equal(keys.keydown('Enter', false), 'fresh');
});

test('reset clears both ordinary down keys and scene-blocked keys', () => {
  const keys = input();
  keys.keydown('Enter', false); keys.boundary();
  keys.keydown('Space', false); keys.keydown('KeyP', true);
  keys.reset();
  for (const code of ['Enter', 'Space', 'KeyP']) assert.equal(keys.keydown(code, false), 'fresh');
});

test('repeat after blur reset is blocked until release instead of auto-activating', () => {
  const keys = input();
  keys.keydown('Enter', false); keys.reset();
  assert.equal(keys.keydown('Enter', true), 'blocked');
  assert.equal(keys.keydown('Enter', false), 'blocked');
  keys.keyup('Enter');
  assert.equal(keys.keydown('Enter', false), 'fresh');
});

test('reset is idempotent and independent created trackers cannot share key state', () => {
  const a = input(), b = input();
  a.keydown('Enter', false); a.boundary();
  assert.equal(b.keydown('Enter', false), 'fresh');
  b.reset(); b.reset();
  assert.equal(a.keydown('Enter', false), 'blocked');
  assert.equal(b.keydown('Enter', false), 'fresh');
});

test('movement and menu keys are tracked independently without DOM assumptions', () => {
  const keys = input();
  const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'Numpad1', 'Digit1', 'Escape'];
  codes.forEach(code => assert.equal(keys.keydown(code, false), 'fresh'));
  codes.forEach(code => assert.equal(keys.keydown(code, true), 'held'));
  keys.keyup('Digit1');
  assert.equal(keys.keydown('Digit1', false), 'fresh');
  assert.equal(keys.keydown('Numpad1', false), 'held');
});

test('previous and next arrows wrap at both ends of a three-choice menu', () => {
  for (const code of ['ArrowLeft', 'ArrowUp']) {
    assert.equal(Input.choiceIndex(code, 0, 3), 2);
    assert.equal(Input.choiceIndex(code, 1, 3), 0);
    assert.equal(Input.choiceIndex(code, 2, 3), 1);
  }
  for (const code of ['ArrowRight', 'ArrowDown']) {
    assert.equal(Input.choiceIndex(code, 0, 3), 1);
    assert.equal(Input.choiceIndex(code, 1, 3), 2);
    assert.equal(Input.choiceIndex(code, 2, 3), 0);
  }
});

test('arrow navigation supports one choice and any positive integer menu length', () => {
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(Input.choiceIndex(code, 0, 1), 0);
  assert.equal(Input.choiceIndex('ArrowLeft', 0, 10), 9);
  assert.equal(Input.choiceIndex('ArrowRight', 9, 10), 0);
  assert.equal(Input.choiceIndex('ArrowDown', 4, 10), 5);
});

test('Digit1..3 and Numpad1..3 select the requested zero-based choice', () => {
  for (const prefix of ['Digit', 'Numpad']) for (let digit = 1; digit <= 3; digit++) {
    assert.equal(Input.choiceIndex(prefix + digit, 2, 3), digit - 1);
    assert.equal(Input.choiceIndex(prefix + digit, 0, 10), digit - 1);
  }
});

test('number shortcuts outside the menu count are not handled', () => {
  for (const prefix of ['Digit', 'Numpad']) {
    assert.equal(Input.choiceIndex(prefix + '1', 0, 1), 0);
    assert.equal(Input.choiceIndex(prefix + '2', 0, 1), null);
    assert.equal(Input.choiceIndex(prefix + '3', 0, 2), null);
  }
});

test('empty or invalid menu counts return null rather than NaN or an impossible index', () => {
  for (const count of [0, -1, 1.5, NaN, Infinity, undefined, null, '3']) {
    assert.equal(Input.choiceIndex('ArrowRight', 0, count), null);
    assert.equal(Input.choiceIndex('Digit1', 0, count), null);
  }
});

test('stale integer selection is normalized and missing selection defaults to the first item', () => {
  assert.equal(Input.choiceIndex('ArrowRight', 5, 3), 0);
  assert.equal(Input.choiceIndex('ArrowLeft', -1, 3), 1);
  for (const current of [undefined, null, NaN, Infinity, 1.5, '2']) {
    assert.equal(Input.choiceIndex('ArrowRight', current, 3), 1);
    assert.equal(Input.choiceIndex('ArrowLeft', current, 3), 2);
  }
});

test('other keys, numeric keys beyond three and wrong-case codes are unhandled', () => {
  for (const code of ['Enter', 'Space', 'Escape', 'Tab', 'KeyW', 'KeyA', 'Digit0', 'Digit4', 'Numpad0', 'Numpad4', 'NumpadEnter', '1', 'digit1', 'arrowleft', '', null, undefined, {}, [], Symbol('Enter'), 1]) {
    assert.equal(Input.choiceIndex(code, 1, 3), null, String(code));
  }
});

test('a menu action cannot carry its confirming Enter into the next scene', () => {
  const keys = input(); let selection = 0, activations = 0;
  if (keys.keydown('ArrowRight', false) === 'fresh') selection = Input.choiceIndex('ArrowRight', selection, 3);
  keys.keyup('ArrowRight');
  if (keys.keydown('Enter', false) === 'fresh') { activations++; keys.boundary(); }
  for (const repeat of [true, false, true, false]) if (keys.keydown('Enter', repeat) === 'fresh') activations++;
  assert.equal(selection, 1); assert.equal(activations, 1);
  keys.keyup('Enter');
  if (keys.keydown('Enter', false) === 'fresh') activations++;
  assert.equal(activations, 2);
});

test('UMD browser export works without window, document or any DOM implementation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../input.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(typeof context.StellarInput.create, 'function');
  assert.equal(context.StellarInput.choiceIndex('Numpad3', 0, 3), 2);
  const keys = context.StellarInput.create();
  assert.equal(keys.keydown('Enter', false), 'fresh'); keys.boundary();
  assert.equal(keys.keydown('Enter', false), 'blocked');
});
