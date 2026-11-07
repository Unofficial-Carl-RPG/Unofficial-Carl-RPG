import { world, makeItem, makeEffect, makeActor } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  critReplaces,
  multiplierFor,
  multiplierNote,
  needsMelee,
  resolveMultipliers,
  scaleBase,
  scopeOf,
  targetDamage,
} from '../module/helpers/damage-multiply.mjs';
import { modRules, needsMeleeMod, resolveMods, whenMet } from '../module/helpers/roll-mods.mjs';
import { adjustParts } from '../module/helpers/damage-types.mjs';
import { changeProblem, computeEffective, summarizeChanges } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

/** An upgrade made of damageMultiply rows [value, scope, when]. */
const mult = (rank, ...rows) => ({
  id: `m${rank}`,
  rank,
  description: '',
  changes: rows.map(([value, scope = 'total', when = '']) => ({
    type: 'damageMultiply',
    value: String(value),
    stat: 'str',
    when,
    scope,
  })),
  grants: [],
  unlocksEffects: [],
  events: [],
});

const row = (value, scope = 'total', when = '') => ({ value, scope, when });

/* -------------------------------------------- */
/*  The change                                  */
/* -------------------------------------------- */

test('a multiplier needs a number above 0, a known scope and a condition that works on damage', () => {
  const ok = (change) => changeProblem({ type: 'damageMultiply', ...change });
  assert.equal(ok({ value: '3', scope: 'base' }), false);
  assert.equal(ok({ value: '0.5', scope: 'total', when: 'crit' }), false);
  assert.equal(ok({ value: '5', scope: '', when: 'melee' }), false);
  assert.ok(ok({ value: '' }));
  assert.ok(ok({ value: '0' }));
  assert.ok(ok({ value: '-2' }));
  assert.ok(ok({ value: 'abc' }));
  assert.ok(ok({ value: '2', scope: 'half' }));
  // a condition that makes no sense for damage (the roll is already made)
  assert.ok(ok({ value: '2', when: 'miss' }));
});

test('the "only when" ids a multiplier accepts are the roll ones, melee range and the degrees', () => {
  const allowed = CONFIG.CARL_RPG.rollMods.allowed.damageMultiply;
  assert.deepEqual(allowed, ['', 'disadvantage', 'advantage', 'surprise', 'melee', 'hit', 'amazing', 'crit']);
  assert.equal(whenMet('melee', { melee: true }), true);
  assert.equal(whenMet('melee', {}), false);
});

test('multipliers are collected from the unlocked upgrades by rank', () => {
  const system = {
    rank: 15,
    upgrades: [mult(5, [2, 'total', 'crit']), mult(15, [3, 'base'])],
  };
  assert.deepEqual(computeEffective(system).multipliers.map((m) => [m.value, m.scope, m.when]), [
    [2, 'total', 'crit'],
    [3, 'base', ''],
  ]);
  assert.deepEqual(computeEffective({ ...system, rank: 10 }).multipliers.map((m) => m.value), [2]);
  assert.deepEqual(computeEffective({ ...system, rank: 1 }).multipliers, []);
});

test('the four reference skills as upgrades', () => {
  const at = (rank, ...upgrades) => computeEffective({ rank, upgrades }).multipliers;
  // Magic Missile rank 15: base dice x3
  assert.deepEqual(at(15, mult(15, [3, 'base'])), [row(3, 'base', '')]);
  assert.deepEqual(at(14, mult(15, [3, 'base'])), []);
  // Shock Treatment rank 15: x5 at melee range
  assert.deepEqual(at(15, mult(15, [5, 'total', 'melee'])), [row(5, 'total', 'melee')]);
  // Vine Porn and Double Tap: x4 and x3 on a Critical Hit
  assert.deepEqual(at(1, mult(1, [4, 'total', 'crit'])), [row(4, 'total', 'crit')]);
  assert.deepEqual(at(1, mult(1, [3, 'total', 'crit'])), [row(3, 'total', 'crit')]);
});

test('the summary says what a multiplier does and when', () => {
  const text = summarizeChanges(mult(1, [3, 'base'], [5, 'total', 'melee']));
  assert.match(text, /3/);
  assert.match(text, /5/);
  assert.match(text, /melee/);
});

/* -------------------------------------------- */
/*  Picking the rows                            */
/* -------------------------------------------- */

test('rows keyed to the roll are kept or dropped by the final mode and the ticks', () => {
  const rows = [row(2), row(3, 'total', 'advantage'), row(4, 'total', 'surprise'), row(5, 'total', 'melee'), row(6, 'total', 'crit')];
  const values = (roll) => resolveMultipliers(rows, roll).map((r) => r.value);
  assert.deepEqual(values({}), [2, 6]);
  assert.deepEqual(values({ mode: 'advantage' }), [2, 3, 6]);
  assert.deepEqual(values({ surprise: true }), [2, 4, 6]);
  assert.deepEqual(values({ melee: true }), [2, 5, 6]);
  assert.deepEqual(resolveMultipliers(undefined), []);
});

test('the melee tick is only offered when a row needs it', () => {
  assert.equal(needsMelee([row(2), row(5, 'total', 'melee')]), true);
  assert.equal(needsMelee([row(2)]), false);
  assert.equal(needsMelee(undefined), false);
});

test('the highest applying row of each scope wins, and degree rows follow the target', () => {
  const rows = [row(2), row(3), row(4, 'total', 'crit'), row(2, 'base'), row(3, 'base', 'amazing')];
  assert.deepEqual(multiplierFor(rows, 'success'), { base: 2, total: 3 });
  assert.deepEqual(multiplierFor(rows, 'amazing'), { base: 3, total: 3 });
  assert.deepEqual(multiplierFor(rows, 'critHit'), { base: 3, total: 4 });
  assert.deepEqual(multiplierFor(rows, 'fail'), { base: 2, total: 3 });
  assert.deepEqual(multiplierFor([], 'success'), { base: 1, total: 1 });
});

test('a blank or unknown scope is the total', () => {
  assert.equal(scopeOf({ scope: 'base' }), 'base');
  assert.equal(scopeOf({ scope: '' }), 'total');
  assert.equal(scopeOf({ scope: 'x' }), 'total');
  assert.equal(scopeOf(undefined), 'total');
});

test('a Critical Hit row takes the place of the x2 on the item\'s own dice', () => {
  assert.equal(critReplaces([row(4, 'total', 'crit')]), true);
  assert.equal(critReplaces([row(4, 'total', 'amazing')]), false);
  assert.equal(critReplaces([]), false);
});

/* -------------------------------------------- */
/*  The numbers                                 */
/* -------------------------------------------- */

test('scaleBase grows only the dice', () => {
  // 1d6+3 rolled as 4+3 = 7; the dice are 4
  assert.deepEqual(scaleBase(7, 4, 3), { total: 15, diceSum: 12 });
  assert.deepEqual(scaleBase(7, 4, 1), { total: 7, diceSum: 4 });
  assert.deepEqual(scaleBase(7, 4, 0), { total: 7, diceSum: 4 });
  assert.deepEqual(scaleBase(7, 4, 0.5), { total: 5, diceSum: 2 });
});

test('Magic Missile rank 15: the base dice x3, the flat modifier is not tripled', () => {
  // 3d4 rolled as 9, + INT 3 = 12
  const r = targetDamage({ damage: 12, diceSum: 9, mult: { base: 3, total: 1 } });
  assert.deepEqual(r, { damage: 30, parts: null });
});

test('Shock Treatment x5 at melee range multiplies everything the target takes', () => {
  const r = targetDamage({ damage: 8, diceSum: 5, mult: { base: 1, total: 5 } });
  assert.equal(r.damage, 40);
});

test('Vine Porn x4 on a Critical Hit, with the dice rolled once', () => {
  // On a crit the dice are not doubled first (the caller skips the x2), so 2d6 = 7 + 2 = 9
  const r = targetDamage({ damage: 9, diceSum: 7, mult: { base: 1, total: 4 } });
  assert.equal(r.damage, 36);
});

test('both scopes together: the base first, then the total', () => {
  // dice 6 + 2 flat = 8; base x2 -> 14; total x3 -> 42
  assert.equal(targetDamage({ damage: 8, diceSum: 6, mult: { base: 2, total: 3 } }).damage, 42);
});

test('a multiplier below 1 rounds down and never goes under 0', () => {
  assert.equal(targetDamage({ damage: 7, diceSum: 7, mult: { base: 1, total: 0.5 } }).damage, 3);
  assert.equal(targetDamage({ damage: 1, diceSum: 1, mult: { base: 1, total: 0.5 } }).damage, 0);
});

test('with no multiplier the damage is what it was', () => {
  assert.deepEqual(targetDamage({ damage: 11, diceSum: 7 }), { damage: 11, parts: null });
});

test('the Roll Modifiers\' dice and the Amazing bonus count in the total, not the base', () => {
  const base = targetDamage({ damage: 10, diceSum: 6, modTotal: 4, bonus: 2, mult: { base: 2, total: 1 } });
  // 10 + 6 (base x2) = 16, + 2 bonus + 4 mod = 22
  assert.equal(base.damage, 22);
  const total = targetDamage({ damage: 10, diceSum: 6, modTotal: 4, bonus: 2, mult: { base: 1, total: 2 } });
  assert.equal(total.damage, 32);
});

test('typed damage is multiplied part by part and the types resist afterwards', () => {
  // 10 force with 4 fire from a typed die, x3 on the total
  const r = targetDamage({
    damage: 10,
    diceSum: 6,
    typed: [{ types: ['fire'], amount: 4 }],
    ownType: 'force',
    mult: { base: 1, total: 3 },
  });
  assert.ok(r.parts);
  assert.equal(r.damage, 42);
  const byType = Object.fromEntries(r.parts.map((p) => [p.type, p.amount]));
  assert.equal(byType.fire, 12);
  assert.equal(byType.force, 30);
  // A fire-resistant target halves only the (already multiplied) fire share
  const target = makeActor({
    effects: [makeEffect({ flags: { damageMods: [{ type: 'fire', mode: 'resist' }] } })],
  });
  assert.equal(adjustParts(r.parts, target).amount, 36);
});

/* -------------------------------------------- */
/*  The note                                    */
/* -------------------------------------------- */

test('the chat heading names the multipliers in play, and nothing when there are none', () => {
  assert.equal(multiplierNote({ base: 1, total: 1 }), '');
  assert.equal(multiplierNote(), '');
  assert.match(multiplierNote({ base: 3, total: 1 }), /3/);
  assert.match(multiplierNote({ base: 1, total: 4 }), /4/);
  assert.match(multiplierNote({ base: 2, total: 5 }), /2.*5/);
});

/* -------------------------------------------- */
/*  Roll Modifiers carry them too (Double Tap)  */
/* -------------------------------------------- */

const modSkill = (upgrades, rank = 1) =>
  makeItem({
    type: 'skill',
    name: 'Double Tap',
    system: { rank, upgrades, rollMod: { enabled: true, skills: '' } },
  });

test('a Roll Modifier\'s multiplier rows are read from its upgrades', () => {
  const rules = modRules({ rank: 1, upgrades: [mult(1, [3, 'total', 'crit'])] });
  assert.deepEqual(rules.multiply, [row(3, 'total', 'crit')]);
  // a bad row is skipped
  assert.deepEqual(modRules({ rank: 1, upgrades: [mult(1, [0, 'total', ''])] }).multiply, []);
  // locked upgrades are not read
  assert.deepEqual(modRules({ rank: 1, upgrades: [mult(5, [3, 'total', ''])] }).multiply, []);
});

test('resolveMods hands over the multiplier rows whose roll condition holds', () => {
  const doubleTap = modSkill([mult(1, [3, 'total', 'crit'], [2, 'total', 'melee'])]);
  const out = resolveMods([doubleTap], { mode: 'normal', melee: false });
  assert.deepEqual(out.multipliers.map((m) => [m.value, m.when]), [[3, 'crit']]);
  const melee = resolveMods([doubleTap], { mode: 'normal', melee: true });
  assert.deepEqual(melee.multipliers.map((m) => m.value), [3, 2]);
  assert.equal(needsMeleeMod(doubleTap), true);
  assert.equal(needsMeleeMod(modSkill([mult(1, [3, 'total', 'crit'])])), false);
});
