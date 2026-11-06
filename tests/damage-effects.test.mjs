
import { world, makeItem, makeActor } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  appliesTo,
  availableEffects,
  clearRoundCooldowns,
  cooldownLeft,
  damageWithEffect,
  diceSumOf,
  effectAccepts,
  effectRules,
  hasFilters,
  healthPercentOf,
  isReady,
  passRestHours,
  resetCooldown,
  startCooldown,
} from '../module/helpers/damage-effects.mjs';
import { changeProblem, summarizeChanges } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

/** An upgrade made of [type, value] changes. */
const up = (rank, ...changes) => ({
  id: `u${rank}`,
  rank,
  description: '',
  changes: changes.map(([type, value = '']) => ({ type, value: String(value), stat: 'str' })),
  grants: [],
  unlocksEffects: [],
  events: [],
});

/** The seven effects as an author would build them (rank 1 is the base text). */
const SMUSH = [
  up(1, ['deHealthMax', 20], ['deTotalMultiplier', 2], ['deCooldownRound']),
  up(5, ['deHealthMax', 30], ['deTotalMultiplier', 3]),
  up(10, ['deCooldownNone']),
  up(15, ['deHealthMax', 40], ['deTotalMultiplier', 4]),
];
const CHOKE_OUT = [
  up(1, ['deHealthMax', 10], ['deTotalMultiplier', 2]),
  up(5, ['deHealthMax', 20]),
  up(10, ['deHealthMax', 40], ['deTotalMultiplier', 4]),
  up(15, ['deHealthMax', 80], ['deTotalMultiplier', 8]),
];
const POWERFUL_STRIKE = [
  up(1, ['deBaseByRank'], ['deCooldownHours', 30]),
  up(5, ['deCooldownHours', 10]),
  up(10, ['deCooldownHours', 5]),
  up(15, ['deCooldownHours', 2]),
];
const IRON_PUNCH = [
  up(1, ['deAddDice', '1d2']),
  up(5, ['deAddDice', '@rankDamage']),
  up(10, ['deStunOption', 1]),
  up(15, ['deAddDice', '@rankDamage'], ['deStunOption', 0]),
];
const SKULLCRACKER = [
  up(1, ['deSameSize'], ['deAddDice', '1d4']),
  up(5, ['deAddDice', '1d4']),
  up(10, ['deAddDice', '@rankDamage']),
];
const TOSS = [
  up(1, ['deSizeMax', -1], ['deAddDice', '1d8 + @str.mod']),
  up(5, ['deSizeMax', 0]),
  up(10, ['deSizeMax', 1]),
  up(15, ['deSizeMax', 2], ['deAddDice', '1d8']),
];

/** A Damage Effect skill at a rank, with its rules worked out like prepareDerivedData does. */
function effect(name, rank, upgrades, extra = {}) {
  const system = {
    rank,
    upgrades,
    damageEffect: { enabled: true, skills: '', cooldownHours: 0, cooldownRound: false, ...extra },
  };
  system.damageRules = effectRules(system);
  return makeItem({ type: 'skill', name, system, id: name });
}
const rulesAt = (upgrades, rank) => effectRules({ rank, upgrades });

test('Smush: threshold, multiplier and cooldown follow the rank', () => {
  let r = rulesAt(SMUSH, 1);
  assert.equal(r.healthMax, 20);
  assert.equal(r.totalMultiplier, 2);
  assert.equal(r.cooldown.kind, 'round');
  r = rulesAt(SMUSH, 5);
  assert.equal(r.healthMax, 30);
  assert.equal(r.totalMultiplier, 3);
  assert.equal(r.cooldown.kind, 'round');
  r = rulesAt(SMUSH, 9);
  assert.equal(r.healthMax, 30);
  r = rulesAt(SMUSH, 10);
  assert.equal(r.cooldown.kind, 'none');
  assert.equal(r.totalMultiplier, 3);
  r = rulesAt(SMUSH, 15);
  assert.equal(r.healthMax, 40);
  assert.equal(r.totalMultiplier, 4);
  assert.equal(r.cooldown.kind, 'none');
});

test('Choke Out: 10% x2, then 20%, 40% x4 and 80% x8', () => {
  const at = (rank) => {
    const r = rulesAt(CHOKE_OUT, rank);
    return [r.healthMax, r.totalMultiplier];
  };
  assert.deepEqual(at(1), [10, 2]);
  assert.deepEqual(at(5), [20, 2]);
  assert.deepEqual(at(10), [40, 4]);
  assert.deepEqual(at(15), [80, 8]);
});

test('Powerful Strike: multiplies the base dice, cooldown 30 / 10 / 5 / 2 game hours', () => {
  const hours = (rank) => rulesAt(POWERFUL_STRIKE, rank).cooldown;
  assert.equal(rulesAt(POWERFUL_STRIKE, 1).baseByRank, true);
  assert.deepEqual(hours(1), { kind: 'hours', hours: 30 });
  assert.deepEqual(hours(4), { kind: 'hours', hours: 30 });
  assert.deepEqual(hours(5), { kind: 'hours', hours: 10 });
  assert.deepEqual(hours(10), { kind: 'hours', hours: 5 });
  assert.deepEqual(hours(15), { kind: 'hours', hours: 2 });
});

test('Iron Punch: extra dice add up, the stun option is offered from rank 10 to 14', () => {
  assert.deepEqual(rulesAt(IRON_PUNCH, 1).addDice, ['1d2']);
  assert.deepEqual(rulesAt(IRON_PUNCH, 5).addDice, ['1d2', '@rankDamage']);
  assert.equal(rulesAt(IRON_PUNCH, 9).stunOption, false);
  assert.equal(rulesAt(IRON_PUNCH, 10).stunOption, true);
  assert.equal(rulesAt(IRON_PUNCH, 14).stunOption, true);
  const top = rulesAt(IRON_PUNCH, 15);
  assert.equal(top.stunOption, false);
  assert.deepEqual(top.addDice, ['1d2', '@rankDamage', '@rankDamage']);
});

test('a rank-0 effect does nothing: its rank 1 base changes are not reached', () => {
  const r = rulesAt(SMUSH, 0);
  assert.equal(r.healthMax, null);
  assert.equal(r.totalMultiplier, 1);
  assert.equal(r.cooldown.kind, 'none');
  assert.equal(hasFilters(r), false);
});

test('Toss and Skullcracker filters', () => {
  assert.equal(rulesAt(SKULLCRACKER, 1).sameSize, true);
  assert.deepEqual(rulesAt(SKULLCRACKER, 10).addDice, ['1d4', '1d4', '@rankDamage']);
  const size = (rank) => rulesAt(TOSS, rank).sizeMax;
  assert.deepEqual([size(1), size(5), size(10), size(15)], [-1, 0, 1, 2]);
  assert.deepEqual(rulesAt(TOSS, 15).addDice, ['1d8 + @str.mod', '1d8']);
});

test('the filters are checked per target', () => {
  const smush = rulesAt(SMUSH, 1);
  const facts = (healthPct) => ({ attackerSize: 4, targetSize: 4, healthPct });
  assert.equal(appliesTo(smush, facts(20)), true);
  assert.equal(appliesTo(smush, facts(20.5)), false);
  assert.equal(appliesTo(smush, facts(5)), true);
  const skull = rulesAt(SKULLCRACKER, 1);
  assert.equal(appliesTo(skull, { attackerSize: 4, targetSize: 4, healthPct: 100 }), true);
  assert.equal(appliesTo(skull, { attackerSize: 4, targetSize: 5, healthPct: 100 }), false);
  assert.equal(appliesTo(skull, { attackerSize: 4, targetSize: 3, healthPct: 100 }), false);
  // Toss: smaller only, then up to your size, one larger, two larger.
  const toss = (rank, targetSize) =>
    appliesTo(rulesAt(TOSS, rank), { attackerSize: 4, targetSize, healthPct: 100 });
  assert.deepEqual([toss(1, 3), toss(1, 4), toss(1, 5)], [true, false, false]);
  assert.deepEqual([toss(5, 4), toss(5, 5)], [true, false]);
  assert.deepEqual([toss(10, 5), toss(10, 6)], [true, false]);
  assert.deepEqual([toss(15, 6), toss(15, 7)], [true, false]);
  // No filters: works against everyone.
  assert.equal(appliesTo(rulesAt(POWERFUL_STRIKE, 1), { attackerSize: 1, targetSize: 8, healthPct: 100 }), true);
});

test('the Health Bar percent is boxes left over boxes', () => {
  assert.equal(healthPercentOf({ system: { health: { value: 3, max: 10 } } }), 30);
  assert.equal(healthPercentOf({ system: { health: { value: 5, max: 20 } } }), 25);
  assert.equal(healthPercentOf({ system: { health: { value: 0, max: 10 } } }), 0);
  assert.equal(healthPercentOf({ system: {} }), 100);
  assert.equal(healthPercentOf(null), 100);
});

test('damage: Powerful Strike multiplies only the dice, then modifiers are added', () => {
  const ps = rulesAt(POWERFUL_STRIKE, 6);
  // 1d4 + 1d4 rolled 3 and 4 (7), plus a Str modifier of 2: total 9.
  assert.equal(damageWithEffect({ total: 9, diceSum: 7, rules: ps, rank: 6, applies: true }), 7 * 6 + 2);
  // Amazing Success bonus is flat, not multiplied by the Rank.
  assert.equal(damageWithEffect({ total: 9, diceSum: 7, bonus: 3, rules: ps, rank: 6, applies: true }), 7 * 6 + 2 + 3);
});

test('damage: the total multiplier comes after modifiers and the Amazing bonus', () => {
  const smush = rulesAt(SMUSH, 1);
  assert.equal(damageWithEffect({ total: 10, diceSum: 6, bonus: 4, rules: smush, rank: 1, applies: true }), 28);
  // A target the effect doesn't work against takes the normal damage.
  assert.equal(damageWithEffect({ total: 10, diceSum: 6, bonus: 4, rules: smush, rank: 1, applies: false }), 14);
  assert.equal(damageWithEffect({ total: 10, diceSum: 6, rules: null, rank: 0, applies: true }), 10);
});

test('damage: extra dice are added to every target the effect works against', () => {
  const punch = rulesAt(IRON_PUNCH, 1);
  assert.equal(damageWithEffect({ total: 5, diceSum: 3, extra: 2, rules: punch, rank: 1, applies: true }), 7);
  assert.equal(damageWithEffect({ total: 5, diceSum: 3, extra: 2, rules: punch, rank: 1, applies: false }), 5);
});

test('damage is never negative and is rounded down', () => {
  const half = { ...rulesAt(SMUSH, 1), totalMultiplier: 0.5 };
  assert.equal(damageWithEffect({ total: 7, diceSum: 4, rules: half, rank: 1, applies: true }), 3);
  assert.equal(damageWithEffect({ total: -3, diceSum: 0, rules: null, rank: 0, applies: true }), 0);
});

test('the dice of a roll are summed apart from flat numbers', () => {
  const die = (total) => ({ faces: 4, total });
  const op = (operator) => ({ operator });
  const flat = (number) => ({ number });
  assert.equal(diceSumOf({ terms: [die(3), op('+'), die(4), op('+'), flat(2)] }), 7);
  assert.equal(diceSumOf({ terms: [die(6), op('-'), die(2)] }), 4);
  assert.equal(diceSumOf({ terms: [flat(5)] }), 0);
  assert.equal(diceSumOf(null), 0);
  // Dice inside parentheses count too.
  assert.equal(diceSumOf({ terms: [{ roll: { terms: [die(2), op('+'), die(3)] } }, op('+'), flat(1)] }), 5);
});

test('an effect lists the attack skills it works with, by name or identifier', () => {
  const smush = effect('Smush', 1, SMUSH, { skills: 'Foot Soldier,  noggin nocker ' });
  assert.equal(effectAccepts(smush, makeItem({ name: 'Foot Soldier' })), true);
  assert.equal(effectAccepts(smush, makeItem({ name: 'Noggin Nocker' })), true);
  assert.equal(effectAccepts(smush, makeItem({ name: 'Unarmed Combat' })), false);
  const byId = makeItem({ name: 'Brawl', system: { identifier: 'foot soldier' } });
  assert.equal(effectAccepts(smush, byId), true);
  // An effect with an empty list works with nothing.
  assert.equal(effectAccepts(effect('Blank', 1, SMUSH), makeItem({ name: 'Foot Soldier' })), false);
  assert.equal(effectAccepts(smush, null), false);
});

test('only effects the crawler owns, that fit the skill and are off cooldown, can be chosen', () => {
  const footSoldier = makeItem({ name: 'Foot Soldier' });
  const smush = effect('Smush', 1, SMUSH, { skills: 'Foot Soldier' });
  const ps = effect('Powerful Strike', 1, POWERFUL_STRIKE, { skills: 'Foot Soldier, Noggin Nocker' });
  const toss = effect('Toss', 1, TOSS, { skills: 'Wrasslin\'' });
  const plain = makeItem({ type: 'skill', name: 'Not an effect', system: { damageEffect: { enabled: false, skills: 'Foot Soldier' }, rank: 1, upgrades: [] } });
  const actor = makeActor({ items: [footSoldier, smush, ps, toss, plain] });
  assert.deepEqual(availableEffects(actor, footSoldier).map((e) => e.name), ['Smush', 'Powerful Strike']);

  // Powerful Strike on cooldown disappears; Smush (a round cooldown) as well once used.
  ps.system.damageEffect.cooldownHours = 12;
  smush.system.damageEffect.cooldownRound = true;
  assert.deepEqual(availableEffects(actor, footSoldier), []);
  assert.deepEqual(availableEffects(actor, null), []);
  assert.deepEqual(availableEffects(null, footSoldier), []);
});

test('cooldowns: hours start, tick down with rests, and are reset by hand', async () => {
  const ps = effect('Powerful Strike', 1, POWERFUL_STRIKE, { skills: 'Foot Soldier' });
  const actor = makeActor({ items: [ps] });
  assert.equal(isReady(ps), true);
  await startCooldown(ps);
  assert.equal(ps.system.damageEffect.cooldownHours, 30);
  assert.equal(isReady(ps), false);

  await passRestHours(actor, 'short'); // 1 hour
  assert.equal(ps.system.damageEffect.cooldownHours, 29);
  await passRestHours(actor, 'long'); // 8 hours
  assert.equal(ps.system.damageEffect.cooldownHours, 21);
  await passRestHours(actor, 'full'); // 24 hours
  assert.equal(ps.system.damageEffect.cooldownHours, 0);
  assert.equal(isReady(ps), true);

  await startCooldown(ps);
  await resetCooldown(ps);
  assert.equal(ps.system.damageEffect.cooldownHours, 0);
  assert.equal(isReady(ps), true);
});

test('cooldowns: a round cooldown clears when the round ends', async () => {
  const smush = effect('Smush', 1, SMUSH, { skills: 'Foot Soldier' });
  const actor = makeActor({ items: [smush] });
  await startCooldown(smush);
  assert.equal(smush.system.damageEffect.cooldownRound, true);
  assert.equal(isReady(smush), false);
  await clearRoundCooldowns(actor);
  assert.equal(smush.system.damageEffect.cooldownRound, false);
  assert.equal(isReady(smush), true);
});

test('cooldowns: an effect with no cooldown never starts one, and stale state is ignored', async () => {
  // Smush at rank 10 has no cooldown; a left-over round flag from rank 9 doesn't block it.
  const smush = effect('Smush', 10, SMUSH, { cooldownRound: true });
  assert.equal(isReady(smush), true);
  await startCooldown(smush);
  assert.equal(smush.system.damageEffect.cooldownHours, 0);
  // Powerful Strike rising to rank 15 caps the hours left at the new cooldown.
  const ps = effect('Powerful Strike', 15, POWERFUL_STRIKE, { cooldownHours: 25 });
  assert.equal(cooldownLeft(ps.system).hours, 2);
});

test('rests spend no hours on effects with nothing running', async () => {
  const ps = effect('Powerful Strike', 1, POWERFUL_STRIKE);
  const actor = makeActor({ items: [ps] });
  await passRestHours(actor, 'full');
  assert.equal(ps.system.damageEffect.cooldownHours, 0);
});

test('the new changes are checked and described', () => {
  const change = (type, value = '') => ({ type, value, stat: 'str' });
  assert.equal(changeProblem(change('deAddDice', '1d4')), false);
  assert.equal(changeProblem(change('deAddDice', '')), true);
  for (const type of ['deTotalMultiplier', 'deHealthMax', 'deSizeMax', 'deCooldownHours', 'deStunOption']) {
    assert.equal(changeProblem(change(type, '2')), false, type);
    assert.equal(changeProblem(change(type, '')), true, type);
    assert.equal(changeProblem(change(type, 'x')), true, type);
  }
  for (const type of ['deBaseByRank', 'deSameSize', 'deCooldownRound', 'deCooldownNone']) {
    assert.equal(changeProblem(change(type)), false, type);
  }
  // Every one of them is offered, and only on a Damage Effect.
  const { changes, damageEffectOnly } = CONFIG.CARL_RPG.upgrades;
  for (const type of damageEffectOnly) assert.ok(type in changes, type);
  assert.equal(damageEffectOnly.length, 10);
  const text = summarizeChanges(up(1, ['deHealthMax', 20], ['deTotalMultiplier', 2], ['deStunOption', 0]));
  assert.match(text, /deHealthMax/);
  assert.match(text, /deTotalMultiplier/);
  assert.match(text, /deStunOptionOff/);
});

test('a rest is worth 1, 8 or 24 game hours', () => {
  assert.deepEqual(CONFIG.CARL_RPG.damageEffects.restHours, { short: 1, long: 8, full: 24 });
});
