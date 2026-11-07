import { world, makeItem, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gapSquares, tokenDistanceFeet, withinFeet, MELEE_FEET } from '../module/helpers/distance.mjs';
import { multiplierFor, targetDamage } from '../module/helpers/damage-multiply.mjs';
import { modRules, resolveMods, targetMet } from '../module/helpers/roll-mods.mjs';
import { changeProblem, computeEffective, summarizeChanges } from '../module/helpers/upgrades.mjs';
import { runEvents } from '../module/helpers/events.mjs';

beforeEach(() => world.reset());

const SIZE = 100;
const scene = { grid: { size: SIZE, distance: 5 } };
/** A token on the scene at a grid square (col, row), `w` x `h` squares big. */
const token = (col, row, w = 1, h = 1, parent = scene) => ({
  x: col * SIZE,
  y: row * SIZE,
  width: w,
  height: h,
  parent,
});

/* -------------------------------------------- */
/*  Measuring                                   */
/* -------------------------------------------- */

test('touching tokens are one square apart, each empty square between adds one', () => {
  const me = token(5, 5);
  assert.equal(gapSquares(me, token(6, 5), SIZE), 0);
  assert.equal(tokenDistanceFeet(me, token(6, 5)), 5);
  assert.equal(tokenDistanceFeet(me, token(7, 5)), 10);
  assert.equal(tokenDistanceFeet(me, token(5, 9)), 20);
  assert.equal(MELEE_FEET, 5);
});

test('a diagonal counts like a straight line (5-5-5)', () => {
  const me = token(5, 5);
  assert.equal(tokenDistanceFeet(me, token(6, 6)), 5);
  assert.equal(tokenDistanceFeet(me, token(7, 7)), 10);
  assert.equal(tokenDistanceFeet(me, token(8, 6)), 15);
});

test('big tokens are measured from their edges, not their middles', () => {
  const big = token(5, 5, 3, 3); // squares 5-7
  assert.equal(tokenDistanceFeet(big, token(8, 6)), 5);
  assert.equal(tokenDistanceFeet(token(8, 6), big), 5);
  assert.equal(tokenDistanceFeet(big, token(9, 6)), 10);
  assert.equal(tokenDistanceFeet(big, token(4, 4)), 5);
  // a token inside the footprint (it should not happen) is still adjacent
  assert.equal(tokenDistanceFeet(big, token(6, 6)), 5);
});

test('a token a little off the grid still touches', () => {
  const me = token(5, 5);
  const off = { ...token(6, 5), x: 6 * SIZE + 30 }; // 0.3 of a square to the side
  assert.equal(tokenDistanceFeet(me, off), 5);
  const far = { ...token(6, 5), x: 7 * SIZE - 1 }; // just under a whole empty square
  assert.equal(tokenDistanceFeet(me, far), 5);
});

test('the grid distance sets the feet per square', () => {
  const metres = { grid: { size: SIZE, distance: 1.5 } };
  assert.equal(tokenDistanceFeet(token(0, 0, 1, 1, metres), token(2, 0, 1, 1, metres)), 3);
});

test('no distance when a token is missing, on another scene or the grid is unreadable', () => {
  const me = token(5, 5);
  assert.equal(tokenDistanceFeet(me, null), null);
  assert.equal(tokenDistanceFeet(null, me), null);
  assert.equal(tokenDistanceFeet(me, token(6, 5, 1, 1, { grid: { size: SIZE, distance: 5 } })), null);
  assert.equal(tokenDistanceFeet({ ...me, parent: null }, token(6, 5)), null);
  assert.equal(gapSquares(me, token(6, 5), 0), null);
  assert.equal(tokenDistanceFeet(token(0, 0, 1, 1, { grid: {} }), token(1, 0, 1, 1, { grid: {} })), null);
});

test('within: at or under the limit, never when the distance is unknown', () => {
  assert.equal(withinFeet(5, 5), true);
  assert.equal(withinFeet(10, 5), false);
  assert.equal(withinFeet(10, 10), true);
  assert.equal(withinFeet(null, 5), false);
  assert.equal(withinFeet(undefined, 5), false);
  assert.equal(withinFeet(5, 'abc'), false);
  assert.equal(withinFeet(5, null), false);
});

/* -------------------------------------------- */
/*  Rows                                        */
/* -------------------------------------------- */

/** An upgrade made of damageMultiply rows [value, when, feet]. */
const upgrade = (rank, changes) => ({
  id: `u${rank}`,
  rank,
  description: '',
  changes,
  grants: [],
  unlocksEffects: [],
  events: [],
});
const multiply = (value, when, feet = '') => ({ type: 'damageMultiply', value: String(value), stat: 'str', when, feet, scope: 'total' });

test('a "within" row needs a distance above 0', () => {
  assert.equal(changeProblem(multiply(5, 'within', '5')), false);
  assert.equal(changeProblem(multiply(5, 'within', '10.5')), false);
  assert.ok(changeProblem(multiply(5, 'within', '')));
  assert.ok(changeProblem(multiply(5, 'within', '0')));
  assert.ok(changeProblem(multiply(5, 'within', '-5')));
  assert.ok(changeProblem(multiply(5, 'within', 'far')));
  // other conditions do not look at it
  assert.equal(changeProblem(multiply(5, 'melee', '')), false);
  // roll dice take it too, the roll's own conditions and the Roll Modifier's DR and rank do not
  assert.equal(changeProblem({ type: 'rmDice', value: '1d4', when: 'within', feet: '5' }), false);
  assert.ok(changeProblem({ type: 'rmDice', value: '1d4', when: 'within', feet: '' }));
  assert.ok(changeProblem({ type: 'rmDR', value: '2', when: 'within', feet: '5' }));
  assert.ok(changeProblem({ type: 'rmRank', value: '', when: 'within', feet: '5' }));
});

test('the multiplier row carries its distance into the effective rules', () => {
  const system = { rank: 15, upgrades: [upgrade(15, [multiply(5, 'within', '5')])] };
  assert.deepEqual(computeEffective(system).multipliers, [{ value: 5, scope: 'total', when: 'within', feet: 5 }]);
  // rows of other conditions stay as they were
  const plain = { rank: 15, upgrades: [upgrade(15, [multiply(5, 'melee')])] };
  assert.deepEqual(computeEffective(plain).multipliers, [{ value: 5, scope: 'total', when: 'melee' }]);
  // a row without a distance is skipped (the sheet warns)
  const bad = { rank: 15, upgrades: [upgrade(15, [multiply(5, 'within', '')])] };
  assert.deepEqual(computeEffective(bad).multipliers, []);
});

test('the summary says how far', () => {
  const text = summarizeChanges(upgrade(1, [multiply(5, 'within', '5')]));
  assert.match(text, /WhenSummary\.within/);
});

test('a row is met by the degree, or by the distance for each target', () => {
  assert.equal(targetMet({ when: 'within', feet: 5 }, { feet: 5 }), true);
  assert.equal(targetMet({ when: 'within', feet: 5 }, { feet: 10 }), false);
  assert.equal(targetMet({ when: 'within', feet: 5 }, { feet: null }), false);
  assert.equal(targetMet({ when: 'within', feet: 5 }, { degree: 'critHit' }), false);
  assert.equal(targetMet({ when: 'within' }, { feet: 5 }), false);
  assert.equal(targetMet({ when: 'crit' }, { degree: 'critHit', feet: null }), true);
  assert.equal(targetMet({ when: 'crit' }, { degree: 'success', feet: 5 }), false);
  assert.equal(targetMet({ when: '' }, {}), true);
});

test('Shock Treatment rank 15: x5 total only at melee range, per target', () => {
  const rows = [{ value: 5, scope: 'total', when: 'within', feet: 5 }];
  assert.deepEqual(multiplierFor(rows, 'success', 5), { base: 1, total: 5 });
  assert.deepEqual(multiplierFor(rows, 'success', 10), { base: 1, total: 1 });
  assert.deepEqual(multiplierFor(rows, 'success', null), { base: 1, total: 1 });
  assert.deepEqual(multiplierFor(rows, 'success'), { base: 1, total: 1 });
  // it multiplies the whole damage, so a near target takes x5 and a far one the plain number
  const near = targetDamage({ damage: 7, diceSum: 4, mult: multiplierFor(rows, 'success', 5) });
  const far = targetDamage({ damage: 7, diceSum: 4, mult: multiplierFor(rows, 'success', 15) });
  assert.equal(near.damage, 35);
  assert.equal(far.damage, 7);
});

test('the highest row still wins when a within row and another both apply', () => {
  const rows = [
    { value: 5, scope: 'total', when: 'within', feet: 5 },
    { value: 3, scope: 'total', when: 'hit' },
  ];
  assert.deepEqual(multiplierFor(rows, 'success', 5), { base: 1, total: 5 });
  assert.deepEqual(multiplierFor(rows, 'success', 30), { base: 1, total: 3 });
});

test('a Roll Modifier keeps the distance on its dice and multiplier rows', () => {
  const mod = makeItem({
    type: 'skill',
    name: 'Point Blank',
    system: {
      rank: 5,
      rollMod: { enabled: true, skills: 'self' },
      upgrades: [
        upgrade(1, [
          { type: 'rmDice', value: '1d6', stat: 'str', when: 'within', feet: '5', bonusType: '', bonusAlso: '' },
          multiply(2, 'within', '10'),
        ]),
      ],
    },
  });
  const rules = modRules(mod.system);
  assert.deepEqual(rules.dice, [{ formula: '1d6', when: 'within', feet: 5 }]);
  assert.deepEqual(rules.multiply, [{ value: 2, scope: 'total', when: 'within', feet: 10 }]);
  const resolved = resolveMods([mod], {});
  assert.equal(resolved.dice[0].feet, 5);
  assert.equal(resolved.dice[0].when, 'within');
  assert.deepEqual(resolved.multipliers, [{ value: 2, scope: 'total', when: 'within', feet: 10 }]);
  // the dice are met per target: near yes, far no
  assert.equal(targetMet(resolved.dice[0], { degree: 'success', feet: 5 }), true);
  assert.equal(targetMet(resolved.dice[0], { degree: 'success', feet: 15 }), false);
});

/* -------------------------------------------- */
/*  The event condition                         */
/* -------------------------------------------- */

/** Whether a "target within N ft" event fires for an owner's token and a target token. */
async function fires(value, { owner, target, trigger = 'hit' }) {
  const item = makeItem({
    type: 'skill',
    name: 'Skill',
    system: {
      rank: 1,
      upgrades: [],
      events: [
        {
          id: 'e1',
          enabled: true,
          trigger,
          phase: 'any',
          match: 'all',
          conditions: [{ type: 'distance', value }],
          actions: [{ type: 'aiFavor', mode: 'award', amount: '1' }],
        },
      ],
    },
  });
  const crawler = await makeCrawler({ items: [item], system: { aiFavor: 0 } });
  // (an unlinked token's actor knows its token)
  crawler.token = owner;
  await runEvents(item, trigger, { actor: crawler, ...(target ? { targetToken: target } : {}) });
  return crawler.system.aiFavor === 1;
}

test('the distance condition compares the owner\'s token with the token that was hit', async () => {
  assert.equal(await fires('5', { owner: token(5, 5), target: token(6, 5) }), true);
  assert.equal(await fires('5', { owner: token(5, 5), target: token(7, 5) }), false);
  assert.equal(await fires('10', { owner: token(5, 5), target: token(7, 5) }), true);
});

test('the distance condition is false when it can\'t be measured', async () => {
  assert.equal(await fires('5', { owner: token(5, 5), target: null }), false);
  assert.equal(await fires('5', { owner: null, target: token(6, 5) }), false);
  assert.equal(await fires('abc', { owner: token(5, 5), target: token(6, 5) }), false);
  assert.equal(await fires('5', { owner: token(5, 5), target: token(6, 5, 1, 1, { grid: { size: SIZE, distance: 5 } }) }), false);
});

test('the distance can be a formula over roll data', async () => {
  assert.equal(await fires('2 + 3', { owner: token(5, 5), target: token(6, 5) }), true);
  assert.equal(await fires('2 + 3', { owner: token(5, 5), target: token(7, 5) }), false);
});
