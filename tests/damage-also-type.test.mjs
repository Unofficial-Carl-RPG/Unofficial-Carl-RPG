import { world, makeEffect, makeActor } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { adjustParts, damageParts, partsMatter, partsTotal } from '../module/helpers/damage-types.mjs';
import { targetDamage } from '../module/helpers/damage-multiply.mjs';
import { changeProblem, computeEffective, effectiveOf, summarizeChanges } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

const resist = (...types) =>
  makeActor({
    effects: [makeEffect({ flags: { damageMods: types.map((type) => ({ type, mode: 'resist' })) } })],
  });

/** An upgrade made of [type, value] changes. */
const up = (rank, ...changes) => ({
  id: `u${rank}`,
  rank,
  description: '',
  changes: changes.map(([type, value = '']) => ({ type, value: String(value), stat: 'str', when: '' })),
  grants: [],
  unlocksEffects: [],
  events: [],
});

/* -------------------------------------------- */
/*  The split                                   */
/* -------------------------------------------- */

test('the attack\'s own damage is split evenly between its two types, an odd point to the first', () => {
  assert.deepEqual(damageParts(10, 'force', [], 'fire'), [
    { type: 'force', amount: 5 },
    { type: 'fire', amount: 5 },
  ]);
  assert.deepEqual(damageParts(11, 'force', [], 'fire'), [
    { type: 'force', amount: 6 },
    { type: 'fire', amount: 5 },
  ]);
  // Nothing is lost
  assert.equal(partsTotal(damageParts(13, 'force', [], 'fire')), 13);
});

test('a single point stays in the first type', () => {
  assert.deepEqual(damageParts(1, 'force', [], 'fire'), [{ type: 'force', amount: 1 }]);
});

test('the untyped bonus dice are part of the own damage and split with it', () => {
  // 7 of dice and 3 of untyped bonus dice: 10 own damage, 5 and 5
  const parts = damageParts(7, 'force', [{ types: [], amount: 3 }], 'fire');
  assert.deepEqual(parts, [
    { type: 'force', amount: 5 },
    { type: 'fire', amount: 5 },
  ]);
});

test('typed bonus dice keep their own types and are not split again', () => {
  const parts = damageParts(8, 'force', [{ types: ['cold'], amount: 4 }], 'fire');
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.amount]));
  assert.deepEqual(byType, { force: 4, fire: 4, cold: 4 });
});

test('a second type does nothing with no type of its own, or the same one', () => {
  assert.deepEqual(damageParts(10, '', [], 'fire'), [{ type: '', amount: 10 }]);
  assert.deepEqual(damageParts(10, 'fire', [], 'fire'), [{ type: 'fire', amount: 10 }]);
  assert.deepEqual(damageParts(10, 'force', [], ''), [{ type: 'force', amount: 10 }]);
});

test('the parts now say more than one number does', () => {
  assert.equal(partsMatter(damageParts(10, 'force', [], 'fire'), 'force'), true);
  assert.equal(partsMatter(damageParts(10, 'force', [], ''), 'force'), false);
});

/* -------------------------------------------- */
/*  Resistances and multipliers                 */
/* -------------------------------------------- */

test('resisting one of the two types only halves its share', () => {
  const parts = damageParts(10, 'force', [], 'fire');
  assert.equal(adjustParts(parts, resist('fire')).amount, 7); // 5 + 2
  assert.equal(adjustParts(parts, resist('force')).amount, 7);
  assert.equal(adjustParts(parts, resist('force', 'fire')).amount, 4); // 2 + 2
  assert.equal(adjustParts(parts, resist('cold')).amount, 10);
});

test('targetDamage splits the own damage, then multiplies each part', () => {
  const r = targetDamage({
    damage: 10,
    diceSum: 10,
    ownType: 'force',
    alsoType: 'fire',
    mult: { base: 1, total: 3 },
  });
  assert.equal(r.damage, 30);
  assert.deepEqual(r.parts, [
    { type: 'force', amount: 15 },
    { type: 'fire', amount: 15 },
  ]);
  // resisted after the multiplier
  assert.equal(adjustParts(r.parts, resist('fire')).amount, 22); // 15 + 7
});

test('the base multiplier grows the dice before they are split', () => {
  const r = targetDamage({
    damage: 8,
    diceSum: 6,
    ownType: 'force',
    alsoType: 'fire',
    mult: { base: 3, total: 1 },
  });
  // 8 + 6 * 2 = 20 -> 10 and 10
  assert.equal(r.damage, 20);
  assert.deepEqual(r.parts.map((p) => p.amount), [10, 10]);
});

test('with no second type targetDamage works as it did', () => {
  assert.deepEqual(targetDamage({ damage: 9, diceSum: 5, ownType: 'force' }), { damage: 9, parts: null });
});

/* -------------------------------------------- */
/*  The field and the upgrade                   */
/* -------------------------------------------- */

test('an upgrade gives a second type (the last wins)', () => {
  const system = {
    rank: 10,
    damageType: 'force',
    upgrades: [up(10, ['damageTypeAlso', 'fire']), up(15, ['damageTypeAlso', 'cold'])],
  };
  assert.equal(computeEffective(system).damageTypeAlso, 'fire');
  assert.equal(computeEffective({ ...system, rank: 15 }).damageTypeAlso, 'cold');
  assert.equal(computeEffective({ ...system, rank: 5 }).damageTypeAlso, '');
  assert.equal(computeEffective({ ...system, damageTypeAlso: 'acid', rank: 5 }).damageTypeAlso, 'acid');
});

test('the effective data always has a second type, blank by default', () => {
  assert.equal(computeEffective({ rank: 1, upgrades: [] }).damageTypeAlso, '');
});

test('Magic Missile rank 10: Force and Fire', () => {
  const system = { rank: 10, damageType: 'force', upgrades: [up(10, ['damageTypeAlso', 'fire'])] };
  const eff = computeEffective(system);
  const parts = damageParts(14, eff.damageType, [], eff.damageTypeAlso);
  assert.deepEqual(parts, [
    { type: 'force', amount: 7 },
    { type: 'fire', amount: 7 },
  ]);
});

test('a second type must be on the GM\'s list', () => {
  assert.equal(changeProblem({ type: 'damageTypeAlso', value: 'fire' }), false);
  assert.ok(changeProblem({ type: 'damageTypeAlso', value: 'nonsense' }));
  assert.ok(changeProblem({ type: 'damageTypeAlso', value: '' }));
});

test('the summary names the second type', () => {
  assert.match(summarizeChanges(up(10, ['damageTypeAlso', 'fire'])), /Fire/i);
});

test('effectiveOf reads the item\'s second type', () => {
  const item = { system: { rank: 1, damageType: 'force', damageTypeAlso: 'fire', upgrades: [] } };
  assert.equal(effectiveOf(item).damageTypeAlso, 'fire');
});
