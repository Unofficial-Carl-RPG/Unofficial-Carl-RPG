import { world, makeItem, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { damageRollData, withCost } from '../module/helpers/cost-damage.mjs';
import { fillData, evalAmount } from '../module/helpers/amounts.mjs';
import { costSpan } from '../module/data/costs.mjs';
import { expandRankDamage } from '../module/helpers/rank-damage.mjs';
import { changeProblem, computeEffective } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

/* -------------------------------------------- */
/*  What a damage formula can read              */
/* -------------------------------------------- */

test('a bare @cost reads as the total paid; the fields are left alone', () => {
  assert.equal(withCost('1d6 + @cost'), '1d6 + @cost.total');
  assert.equal(withCost('@cost * 2 + @cost.mana'), '@cost.total * 2 + @cost.mana');
  assert.equal(withCost('@cost.total + @cost.junk + @cost.uses + @cost.ammo'), '@cost.total + @cost.junk + @cost.uses + @cost.ammo');
  assert.equal(withCost('@costly + 1'), '@costly + 1');
  assert.equal(withCost('1d4 + @int.mod'), '1d4 + @int.mod');
  assert.equal(withCost(undefined), '');
});

test('the roll data has what was paid, nothing paid reads as 0, and the owner\'s data is kept', () => {
  const owner = { int: { mod: 3 }, lvl: 4 };
  const data = damageRollData(owner, { mana: 4, junk: 1, uses: 2, ammo: 3 });
  assert.deepEqual(data.cost, { mana: 4, junk: 1, uses: 2, ammo: 3, total: 10 });
  assert.equal(data.int.mod, 3);
  assert.equal(data.lvl, 4);
  assert.deepEqual(damageRollData(owner).cost, { mana: 0, junk: 0, uses: 0, ammo: 0, total: 0 });
  assert.deepEqual(damageRollData(null, { mana: 2 }).cost.mana, 2);
  // (the owner's own data is not changed)
  assert.equal(owner.cost, undefined);
});

test('a damage change that reads @cost is a usable formula', () => {
  const formula = '1d4 + @int.mod - 2 * max(0, 5 - @cost.mana) + min(1, max(0, @cost.mana - 5)) * @rankDamage';
  assert.equal(changeProblem({ type: 'damageAdd', value: '@cost.mana' }), false);
  assert.equal(changeProblem({ type: 'damageReplace', value: formula }), false);
});

/* -------------------------------------------- */
/*  Magic Missile                               */
/* -------------------------------------------- */

// Cast for 3 to 6 Mana from rank 5 (5 is normal): -4 damage at 3, -2 at 4, normal at 5 and one
// more rank die at 6. Below rank 5 it costs 5, with no choice.
const MAGIC_MISSILE = (rank) => ({
  rank,
  damage: '1d4 + @int.mod - 2 * max(0, 5 - @cost.mana) + min(1, max(0, @cost.mana - 5)) * @rankDamage',
  damageType: 'force',
  costs: [
    {
      resource: 'mana',
      amount: '5 - 2 * min(1, floor(@rank / 5))',
      max: '5 + min(1, floor(@rank / 5))',
    },
  ],
  upgrades: [
    { id: 'a', rank: 5, description: '', changes: [{ type: 'damageAdd', value: '1d4', stat: 'str', when: '' }], grants: [], unlocksEffects: [], events: [] },
    { id: 'b', rank: 10, description: '', changes: [{ type: 'damageAdd', value: '1d4', stat: 'str', when: '' }], grants: [], unlocksEffects: [], events: [] },
  ],
});

/** Every die at its top face, so a formula comes to one number. */
const topDice = (text) => text.replace(/(\d*)d(\d+)/gi, (all, n, faces) => String((Number(n) || 1) * Number(faces)));

/** The most Magic Missile can do at a rank when `mana` is paid (INT modifier 3). */
async function damageAt(rank, mana) {
  const system = MAGIC_MISSILE(rank);
  system.effective = computeEffective(system);
  const item = makeItem({ type: 'spell', name: 'Magic Missile', system });
  await makeCrawler({ items: [item] });
  const formula = withCost(expandRankDamage(system.effective.damage, item));
  const { text, missing } = fillData(formula, damageRollData({ int: { mod: 3 } }, { mana }));
  assert.deepEqual(missing, []);
  return evalAmount(topDice(text));
}

test('Magic Missile costs 5 until rank 5, then 3 to 6', () => {
  const span = (rank) => costSpan(MAGIC_MISSILE(rank).costs, 'mana', { rank });
  assert.deepEqual([span(1).min, span(1).max], [5, 5]);
  assert.deepEqual([span(4).min, span(4).max], [5, 5]);
  assert.deepEqual([span(5).min, span(5).max], [3, 6]);
  assert.deepEqual([span(15).min, span(15).max], [3, 6]);
});

test('Magic Missile at rank 1 to 4 does the same whatever the cost reads', async () => {
  // 1d4 (4) + 3; the cost is always 5 here.
  assert.equal(await damageAt(1, 5), 7);
  assert.equal(await damageAt(4, 5), 7);
});

test('Magic Missile at rank 5: 3 Mana is -4, 4 Mana is -2, 5 Mana is normal, 6 Mana adds a rank die', async () => {
  // Normal: 1d4 + 1d4 (upgrade) + 3 = 11. The rank die at rank 5 is 1d4.
  assert.equal(await damageAt(5, 5), 11);
  assert.equal(await damageAt(5, 3), 7);
  assert.equal(await damageAt(5, 4), 9);
  assert.equal(await damageAt(5, 6), 15);
});

test('Magic Missile at rank 10: the rank die is the d10, and the steps still hold', async () => {
  // 1d4 + 1d4 + 1d4 + 3 = 15 normally.
  assert.equal(await damageAt(10, 5), 15);
  assert.equal(await damageAt(10, 3), 11);
  assert.equal(await damageAt(10, 4), 13);
  assert.equal(await damageAt(10, 6), 25); // + 1d10
});

test('paying more or less than the choices still reads sensibly', async () => {
  // Nothing paid reads as 0: the penalty keeps growing (the damage itself is held at 0 or more
  // when it is rolled).
  assert.equal(await damageAt(5, 0), 1);
  // Paying past 6 gives only the one extra rank die.
  assert.equal(await damageAt(5, 8), 15);
});
