import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTwoHanded, slotCost, planEquip } from '../module/helpers/gear-slots.mjs';

const gear = (id, slot = 'hands', twoHanded = false) => ({ id, system: { slot, twoHanded } });
const HANDS = 2;

/* -------------------------------------------- */
/*  Two-handed                                  */
/* -------------------------------------------- */

test('only gear in the Hands slot can be two-handed', () => {
  assert.equal(isTwoHanded({ slot: 'hands', twoHanded: true }), true);
  assert.equal(isTwoHanded({ slot: 'hands', twoHanded: false }), false);
  assert.equal(isTwoHanded({ slot: 'torso', twoHanded: true }), false);
  assert.equal(isTwoHanded(undefined), false);
});

test('two-handed gear takes every hand, other gear takes one place', () => {
  assert.equal(slotCost({ slot: 'hands', twoHanded: true }, HANDS), 2);
  assert.equal(slotCost({ slot: 'hands', twoHanded: false }, HANDS), 1);
  assert.equal(slotCost({ slot: 'torso', twoHanded: true }, 1), 1);
});

/* -------------------------------------------- */
/*  Making room                                 */
/* -------------------------------------------- */

test('gear that fits needs nothing to come off', () => {
  assert.deepEqual(planEquip(gear('a', 'hands', true), [], HANDS), { fits: true, options: [] });
  assert.equal(planEquip(gear('a'), [gear('b')], HANDS).fits, true);
  assert.equal(planEquip(gear('a', 'head'), [], 1).fits, true);
});

test('a one-handed item with both hands full: either held item can come off', () => {
  const plan = planEquip(gear('c'), [gear('a'), gear('b')], HANDS);
  assert.equal(plan.fits, false);
  assert.deepEqual(plan.options, [['a'], ['b']]);
});

test('a two-handed item with one hand busy takes that item off', () => {
  const plan = planEquip(gear('c', 'hands', true), [gear('a')], HANDS);
  assert.deepEqual(plan, { fits: false, options: [['a']] });
});

test('a two-handed item with both hands full takes both items off together', () => {
  const plan = planEquip(gear('c', 'hands', true), [gear('a'), gear('b')], HANDS);
  assert.deepEqual(plan, { fits: false, options: [['a', 'b']] });
});

test('anything equipped while a two-handed item is held takes it off', () => {
  const plan = planEquip(gear('c'), [gear('a', 'hands', true)], HANDS);
  assert.deepEqual(plan, { fits: false, options: [['a']] });
  assert.deepEqual(planEquip(gear('c', 'hands', true), [gear('a', 'hands', true)], HANDS).options, [['a']]);
});

test('single-place slots swap one item as before', () => {
  assert.deepEqual(planEquip(gear('b', 'head'), [gear('a', 'head')], 1), { fits: false, options: [['a']] });
});

test('accessories: room until all ten places are used', () => {
  const held = Array.from({ length: 9 }, (_, i) => gear(`x${i}`, 'accessory'));
  assert.equal(planEquip(gear('n', 'accessory'), held, 10).fits, true);
  const full = [...held, gear('x9', 'accessory')];
  const plan = planEquip(gear('n', 'accessory'), full, 10);
  assert.equal(plan.fits, false);
  assert.equal(plan.options.length, 10);
});
