import { world, makeEffect, makeActor, makeItem, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CarlRPGActor } from '../module/documents/actor.mjs';
import {
  adjustParts,
  damageParts,
  partsLabel,
  partsMatter,
  partsTotal,
  rowTypes,
  rowTypesProblem,
  scaleParts,
  splitAmount,
} from '../module/helpers/damage-types.mjs';
import { effectRules } from '../module/helpers/damage-effects.mjs';
import { modRules, resolveMods } from '../module/helpers/roll-mods.mjs';
import { changeProblem, summarizeChanges } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

const applyDamage = (actor, ...args) => CarlRPGActor.prototype.applyDamage.call(actor, ...args);
const mods = (...rows) => makeEffect({ flags: { damageMods: rows } });

/** An upgrade made of [type, value, bonusType, bonusAlso, when] changes. */
const up = (rank, ...changes) => ({
  id: `u${rank}`,
  rank,
  description: '',
  changes: changes.map(([type, value = '', bonusType = '', bonusAlso = '', when = '']) => ({
    type,
    value: String(value),
    stat: 'str',
    when,
    bonusType,
    bonusAlso,
  })),
  grants: [],
  unlocksEffects: [],
  events: [],
});

/* -------------------------------------------- */
/*  A bonus row's types                         */
/* -------------------------------------------- */

test('a row names no type, one, or two; blanks and repeats are dropped', () => {
  assert.deepEqual(rowTypes({}), []);
  assert.deepEqual(rowTypes({ bonusType: '' }), []);
  assert.deepEqual(rowTypes({ bonusType: 'fire' }), ['fire']);
  assert.deepEqual(rowTypes({ bonusType: 'fire', bonusAlso: 'lightning' }), ['fire', 'lightning']);
  assert.deepEqual(rowTypes({ bonusType: 'fire', bonusAlso: 'fire' }), ['fire']);
  // (a second type with no first one names nothing)
  assert.deepEqual(rowTypes({ bonusType: '', bonusAlso: 'fire' }), []);
});

test('a row with a type that has left the list, or a second with no first, is a problem', () => {
  assert.equal(rowTypesProblem({}), false);
  assert.equal(rowTypesProblem({ bonusType: 'fire', bonusAlso: 'lightning' }), false);
  assert.equal(rowTypesProblem({ bonusType: 'nonsense' }), true);
  assert.equal(rowTypesProblem({ bonusType: 'fire', bonusAlso: 'nonsense' }), true);
  assert.equal(rowTypesProblem({ bonusType: '', bonusAlso: 'fire' }), true);
  assert.equal(changeProblem({ type: 'rmDice', value: '1d6', when: '', bonusType: 'fire' }), false);
  assert.equal(changeProblem({ type: 'rmDice', value: '1d6', when: '', bonusType: 'nonsense' }), true);
  assert.equal(changeProblem({ type: 'deAddDice', value: '1d6', bonusType: 'fire' }), false);
  assert.equal(changeProblem({ type: 'deAddDice', value: '1d6', bonusType: 'nonsense' }), true);
  // (untyped rows are checked as before)
  assert.equal(changeProblem({ type: 'deAddDice', value: '1d6' }), false);
  assert.equal(changeProblem({ type: 'deAddDice', value: '' }), true);
});

test('rows read from the upgrades keep their types, and untyped rows look as they did', () => {
  const BANG_BRO = [
    up(1, ['rmDice', 2, 'fire', 'lightning']),
    up(5, ['rmDice', '1d6', 'fire', 'lightning']),
    up(10, ['rmDice', '1d6']),
  ];
  const rules = modRules({ rank: 10, upgrades: BANG_BRO });
  assert.deepEqual(rules.dice, [
    { formula: '2', when: '', types: ['fire', 'lightning'] },
    { formula: '1d6', when: '', types: ['fire', 'lightning'] },
    { formula: '1d6', when: '' }, // untyped: no types at all
  ]);
  const skill = makeItem({
    type: 'skill',
    name: 'Bang Bro',
    system: { rank: 10, upgrades: BANG_BRO, rollMod: { enabled: true, skills: '#weapon' } },
  });
  const rows = resolveMods([skill]).dice;
  assert.deepEqual(rows.map((d) => d.types), [['fire', 'lightning'], ['fire', 'lightning'], []]);
});

test('a Damage Effect keeps typed dice apart from its base dice', () => {
  const SKULLCRACKER = [
    up(1, ['deSameSize'], ['deAddDice', '1d4']),
    up(10, ['deAddDice', '@rankDamage', 'bludgeoning']),
    up(15, ['deAddDice', '@rankDamage', 'fire', 'lightning']),
  ];
  const rules = effectRules({ rank: 15, upgrades: SKULLCRACKER });
  assert.deepEqual(rules.addDice, ['1d4']);
  assert.deepEqual(rules.typedDice, [
    { formula: '@rankDamage', types: ['bludgeoning'] },
    { formula: '@rankDamage', types: ['fire', 'lightning'] },
  ]);
  // (an effect with no typed rows has none)
  assert.deepEqual(effectRules({ rank: 1, upgrades: SKULLCRACKER }).typedDice, []);
});

test('the sheet summary names the type of a typed row', () => {
  const typed = summarizeChanges(up(5, ['rmDice', '1d6', 'fire', 'lightning']));
  assert.match(typed, /Summary\.rmDiceTyped.*Fire & Lightning/);
  const plain = summarizeChanges(up(5, ['rmDice', '1d6']));
  assert.match(plain, /Summary\.rmDice /);
  assert.doesNotMatch(plain, /Typed/);
  assert.match(summarizeChanges(up(1, ['deAddDice', '1d4', 'bludgeoning'])), /Summary\.deAddDiceTyped.*Bludgeoning/);
  assert.match(summarizeChanges(up(1, ['deAddDice', '1d4'])), /Summary\.deAddDice /);
});

/* -------------------------------------------- */
/*  Damage in parts                             */
/* -------------------------------------------- */

test('an amount is split evenly between types, the first getting any odd point', () => {
  assert.deepEqual(splitAmount(6, 2), [3, 3]);
  assert.deepEqual(splitAmount(7, 2), [4, 3]);
  assert.deepEqual(splitAmount(1, 2), [1, 0]);
  assert.deepEqual(splitAmount(5, 1), [5]);
  assert.deepEqual(splitAmount(0, 2), [0, 0]);
  assert.deepEqual(splitAmount(-3, 2), [0, 0]);
  assert.equal(splitAmount(11, 3).reduce((a, b) => a + b, 0), 11);
});

test('typed bonus dice become their own parts; the attack keeps its type', () => {
  // A Bludgeoning attack for 5 with a 3 point mixed Fire and Lightning bonus.
  const parts = damageParts(5, 'bludgeoning', [{ types: ['fire', 'lightning'], amount: 3 }]);
  assert.deepEqual(parts, [
    { type: 'bludgeoning', amount: 5 },
    { type: 'fire', amount: 2 },
    { type: 'lightning', amount: 1 },
  ]);
  assert.equal(partsTotal(parts), 8);
  assert.equal(partsMatter(parts, 'bludgeoning'), true);
});

test('a bonus of the attack\'s own type merges into it, and an untyped row takes the attack\'s type', () => {
  const parts = damageParts(4, 'fire', [
    { types: ['fire'], amount: 2 },
    { types: [], amount: 3 },
  ]);
  assert.deepEqual(parts, [{ type: 'fire', amount: 9 }]);
  // One part of the attack's own type says nothing a single number does not.
  assert.equal(partsMatter(parts, 'fire'), false);
  assert.equal(partsMatter([], 'fire'), false);
});

test('a typed bonus still counts when the attack has no damage of its own or no type', () => {
  const noBase = damageParts(0, 'bludgeoning', [{ types: ['fire'], amount: 4 }]);
  assert.deepEqual(noBase, [{ type: 'fire', amount: 4 }]);
  assert.equal(partsMatter(noBase, 'bludgeoning'), true);
  const untypedAttack = damageParts(5, '', [{ types: ['fire'], amount: 2 }]);
  assert.deepEqual(untypedAttack, [
    { type: '', amount: 5 },
    { type: 'fire', amount: 2 },
  ]);
  assert.equal(partsLabel(untypedAttack), '5 + CARL_RPG.Damage.Part {"amount":2,"type":"Fire"}');
});

test('a zero typed roll leaves the damage as one plain number', () => {
  const parts = damageParts(6, 'slashing', [{ types: ['fire'], amount: 0 }]);
  assert.equal(partsMatter(parts, 'slashing'), false);
  assert.equal(partsTotal(parts), 6);
});

test('parts scale with the x2, x1 and x1/2 buttons, each rounding down', () => {
  const parts = [
    { type: 'bludgeoning', amount: 5 },
    { type: 'fire', amount: 3 },
  ];
  assert.deepEqual(scaleParts(parts, 2).map((p) => p.amount), [10, 6]);
  assert.deepEqual(scaleParts(parts, 1).map((p) => p.amount), [5, 3]);
  assert.deepEqual(scaleParts(parts, 0.5).map((p) => p.amount), [2, 1]);
  assert.equal(partsTotal(scaleParts(parts, 0.5)), 3);
});

/* -------------------------------------------- */
/*  Resistances act on each part                */
/* -------------------------------------------- */

test('a fire die against a fire-immune target does nothing while the base still lands', async () => {
  const target = await makeCrawler({
    abilities: { con: 6 },
    effects: [mods({ type: 'fire', mode: 'immune' })],
  });
  const parts = damageParts(5, 'bludgeoning', [{ types: ['fire'], amount: 4 }]);
  const result = await applyDamage(target, partsTotal(parts), { damageType: 'bludgeoning', parts });
  assert.equal(result.amount, 5);
  // The same hit with the fire die untyped (the old behaviour) is all Bludgeoning.
  const old = await applyDamage(target, 9, { damageType: 'bludgeoning' });
  assert.equal(old.amount, 9);
});

test('resist halves, vulnerable doubles and immune stops only the part of that type', () => {
  const target = makeActor({
    effects: [
      mods({ type: 'fire', mode: 'resist' }),
      mods({ type: 'cold', mode: 'vulnerable' }),
      mods({ type: 'acid', mode: 'immune' }),
    ],
  });
  const adjust = (parts) => adjustParts(parts, target).amount;
  assert.equal(adjust([{ type: 'physical', amount: 5 }, { type: 'fire', amount: 5 }]), 7); // 5 + 2
  assert.equal(adjust([{ type: 'physical', amount: 5 }, { type: 'cold', amount: 3 }]), 11); // 5 + 6
  assert.equal(adjust([{ type: 'physical', amount: 5 }, { type: 'acid', amount: 9 }]), 5);
  assert.equal(adjust([{ type: 'physical', amount: 5 }, { type: 'poison', amount: 2 }]), 7);
  assert.equal(adjust([{ type: '', amount: 4 }, { type: 'fire', amount: 4 }]), 6);
});

test('mixed damage is split, so resisting one of its types only halves that share', async () => {
  const target = makeActor({ effects: [mods({ type: 'fire', mode: 'resist' })] });
  // 7 mixed Fire and Lightning: 4 Fire and 3 Lightning.
  const parts = damageParts(0, 'bludgeoning', [{ types: ['fire', 'lightning'], amount: 7 }]);
  assert.deepEqual(parts.map((p) => [p.type, p.amount]), [['fire', 4], ['lightning', 3]]);
  assert.equal(adjustParts(parts, target).amount, 5); // 2 + 3
  const both = makeActor({
    effects: [mods({ type: 'fire', mode: 'immune' }), mods({ type: 'lightning', mode: 'immune' })],
  });
  assert.equal(adjustParts(parts, both).amount, 0);
});

test('the parts are added up before DR comes off, and the chat says what a type changed', async () => {
  const target = await makeCrawler({
    abilities: { con: 6 },
    bonuses: { dr: 2 },
    effects: [mods({ type: 'fire', mode: 'immune' })],
  });
  const parts = [
    { type: 'bludgeoning', amount: 6 },
    { type: 'fire', amount: 6 },
  ];
  const result = await applyDamage(target, 12, { parts });
  assert.equal(result.amount, 6);
  assert.equal(result.net, 6 - result.dr);
  assert.match(world.chat.at(-1).content, /Damage\.Immune/);
  assert.match(world.chat.at(-1).content, /Fire/);
});

test('a hit with no type change says nothing about types', async () => {
  const target = await makeCrawler({ abilities: { con: 6 }, effects: [mods({ type: 'cold', mode: 'immune' })] });
  await applyDamage(target, 8, {
    parts: [
      { type: 'bludgeoning', amount: 5 },
      { type: 'fire', amount: 3 },
    ],
  });
  assert.doesNotMatch(world.chat.at(-1).content, /Damage\.(Immune|Resisted|Vulnerable)/);
});

test('a mob works the parts out the same way, then loses a point for each point past DR', async () => {
  const mob = makeActor({
    type: 'mob',
    system: { drTotal: 1, health: { value: 20 } },
    effects: [mods({ type: 'fire', mode: 'resist' })],
  });
  const parts = [
    { type: 'bludgeoning', amount: 5 },
    { type: 'fire', amount: 4 },
  ];
  const result = await applyDamage(mob, 9, { parts });
  assert.deepEqual([result.amount, result.net, result.value], [7, 6, 14]);
});

test('damage with no parts works as it always did', async () => {
  const target = await makeCrawler({ abilities: { con: 6 }, effects: [mods({ type: 'fire', mode: 'resist' })] });
  assert.equal((await applyDamage(target, 9, { damageType: 'fire' })).amount, 4);
  assert.equal((await applyDamage(target, 9, { damageType: 'fire', parts: null })).amount, 4);
  assert.equal((await applyDamage(target, 9, { damageType: 'fire', parts: [] })).amount, 4);
  assert.equal((await applyDamage(target, 9)).amount, 9);
});
