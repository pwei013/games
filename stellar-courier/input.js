/* Stellar Courier — DOM-free keyboard state and menu navigation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StellarInput = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create() {
    const down = new Set();
    const blocked = new Set();

    return {
      keydown: function (code, repeat) {
        if (blocked.has(code)) return 'blocked';
        // Some platforms report a second keydown with repeat=false. It is still held.
        if (down.has(code)) return 'held';
        down.add(code);
        // After focus changes, a repeating key may arrive without its initial press.
        if (repeat) {
          blocked.add(code);
          return 'blocked';
        }
        return 'fresh';
      },
      keyup: function (code) {
        down.delete(code);
        blocked.delete(code);
      },
      boundary: function () {
        // Do not release held keys on scene changes: only a real keyup can do that.
        down.forEach(function (code) { blocked.add(code); });
      },
      reset: function () {
        down.clear();
        blocked.clear();
      }
    };
  }

  function choiceIndex(code, current, count) {
    if (typeof code !== 'string' || !Number.isInteger(count) || count < 1) return null;
    const index = Number.isInteger(current) ? ((current % count) + count) % count : 0;
    if (code === 'ArrowLeft' || code === 'ArrowUp') return (index + count - 1) % count;
    if (code === 'ArrowRight' || code === 'ArrowDown') return (index + 1) % count;
    const match = /^(?:Digit|Numpad)([123])$/.exec(code);
    if (match) {
      const selected = Number(match[1]) - 1;
      return selected < count ? selected : null;
    }
    return null;
  }

  return { create: create, choiceIndex: choiceIndex };
}));
