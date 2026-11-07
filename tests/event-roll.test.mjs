import { test } from 'node:test';
import assert from 'node:assert/strict';
import { damageNumbers, damageOfTarget, marginOf, rollNumbers } from '../module/helpers/event-roll.mjs';

const DATA = { str: { mod: 2 }, dex: { mod: 4 } };

test('rollNumbers: bonus, the stat modifier used and the rank', () => {
  assert.deepEqual(rollNumbers({ options: { bonus: '2 + 1' }, data: DATA, defaultStat: 'str', rank: 3 }), {
    bonus: 3,
    mod: 2,
    rank: 3,
  });
  // A stat picked in the pop-up wins over the default one.
  assert.equal(rollNumbers({ options: { stat: 'dex' }, data: DATA, defaultStat: 'str' }).mod, 4);
  // A blank bonus, or one with dice in it, counts as 0.
  assert.equal(rollNumbers({ options: { bonus: '' }, data: DATA }).bonus, 0);
  assert.equal(rollNumbers({ options: { bonus: '1d4' }, data: DATA }).bonus, 0);
  // No stat to read: no modifier.
  assert.equal('mod' in rollNumbers({ data: DATA }), false);
  assert.equal(rollNumbers({ options: { stat: 'wis' }, data: DATA }).mod, undefined);
});

test('marginOf: over the number is positive, under is negative, none without a number', () => {
  assert.equal(marginOf(15, 12), 3);
  assert.equal(marginOf(9, 12), -3);
  assert.equal(marginOf(12, 12), 0);
  assert.equal(marginOf(undefined, 12), undefined);
  assert.equal(marginOf(12, null), undefined);
});

test('damage numbers: the use, then each target', () => {
  assert.equal(damageNumbers(null), null);
  assert.equal(damageNumbers({ base: null, dice: 3 }), null);
  const used = damageNumbers({ base: 9, dice: 6 }, 11);
  assert.deepEqual(used, { total: 11, dice: 6, base: 9 });
  assert.deepEqual(damageNumbers({ base: 9, dice: 6 }), { dice: 6, base: 9 });
  // A hit target takes its own total; a miss takes none.
  assert.deepEqual(damageOfTarget(used, 14), { dice: 6, base: 9, total: 14 });
  assert.deepEqual(damageOfTarget(used, 0), { dice: 6, base: 9, total: 0 });
  assert.deepEqual(damageOfTarget(used), { dice: 6, base: 9 });
  assert.equal(damageOfTarget(null, 5), undefined);
  // (the original is left alone)
  assert.equal(used.total, 11);
});
