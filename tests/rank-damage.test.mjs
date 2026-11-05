
import { world, makeEffect, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandRankDamage,
  rankDamageFormula,
  rankDamageMods,
  rankDamageOf,
  usesRankDamage,
} from '../module/helpers/rank-damage.mjs';
import { cleanBuildRow, hasAmount, isScopedKind } from '../module/helpers/build-mods.mjs';
import { changeProblem, computeEffective, summarizeChanges } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

/** A skill or spell on a crawler, with its upgrades worked out like prepareDerivedData does. */
async function ranked({ rank, upgrades = [], tags = [], identifier = 'blast', type = 'skill', effects = [] }) {
  const system = { rank, damage: '@rankDamage', manaCost: 0, upgrades, tags, identifier };
  system.effective = computeEffective(system);
  const item = makeItem({ type, name: identifier, system });
  const actor = await makeCrawler({ items: [item], effects });
  return { item, actor };
}

const row = (kind, amount, target = 'all', value = '') =>
  makeEffect({ flags: { buildMods: [{ kind, target, value, amount }] } });

test('the table gives each rank its dice, and rank 0 gives nothing', () => {
  const expected = {
    0: '',
    1: '1',
    2: '1d2',
    3: '1d2',
    4: '1d4',
    5: '1d4',
    6: '1d6',
    7: '1d6',
    8: '1d8',
    9: '1d8',
    10: '1d10',
    11: '1d10',
    12: '1d12',
    13: '1d12',
    14: '1d8 + 1d6',
    15: '1d8 + 1d6',
    16: '2d8',
    17: '2d8',
    18: '1d10 + 1d8',
    19: '1d10 + 1d8',
    20: '2d10',
    21: '2d10',
    30: '2d10',
  };
  for (const [rank, dice] of Object.entries(expected)) {
    assert.equal(rankDamageFormula(Number(rank)), dice, `rank ${rank}`);
  }
});

test('a rank bonus changes the rank read, a row step moves along the table, rank 0 stays nothing', () => {
  // Bonus: rank 4 with +2 reads as rank 6; a negative bonus can bring it below 1.
  assert.equal(rankDamageFormula(4, { bonus: 2 }), '1d6');
  assert.equal(rankDamageFormula(4, { bonus: 20 }), '2d10');
  assert.equal(rankDamageFormula(2, { bonus: -1 }), '1');
  assert.equal(rankDamageFormula(2, { bonus: -5 }), '');
  // Step: whole rows, whatever rank within the row.
  assert.equal(rankDamageFormula(5, { step: 1 }), '1d6');
  assert.equal(rankDamageFormula(4, { step: 2 }), '1d8');
  assert.equal(rankDamageFormula(13, { step: 1 }), '1d8 + 1d6');
  assert.equal(rankDamageFormula(19, { step: 3 }), '2d10'); // the top is the end
  assert.equal(rankDamageFormula(4, { step: -1 }), '1d2');
  assert.equal(rankDamageFormula(2, { step: -1 }), '1');
  assert.equal(rankDamageFormula(1, { step: -1 }), ''); // below the first row is nothing
  assert.equal(rankDamageFormula(1, { bonus: -3, step: 1 }), '1'); // nothing, then one row up
  // Both together: the bonus is read first, then the step.
  assert.equal(rankDamageFormula(4, { bonus: 2, step: 1 }), '1d8');
  // Rank 0 has no rank damage whatever moves it.
  assert.equal(rankDamageFormula(0, { bonus: 5, step: 3 }), '');
});

test('upgrades can add a rank bonus and a row step, and unusable values are skipped', () => {
  const system = {
    rank: 10,
    damage: '@rankDamage',
    manaCost: 0,
    upgrades: [
      { id: 'a', rank: 5, changes: [{ type: 'rankDamageBonus', value: '2' }] },
      { id: 'b', rank: 10, changes: [{ type: 'rankDamageStep', value: '1' }, { type: 'rankDamageStep', value: '2' }] },
      { id: 'c', rank: 10, changes: [{ type: 'rankDamageBonus', value: 'x' }] }, // not a number
      { id: 'd', rank: 15, changes: [{ type: 'rankDamageBonus', value: '9' }] }, // not reached
    ],
  };
  const eff = computeEffective(system);
  assert.equal(eff.rankBonus, 2);
  assert.equal(eff.rankStep, 3);
  assert.equal(eff.damage, '@rankDamage'); // the scalar is worked out when the damage is rolled
  assert.equal(changeProblem({ type: 'rankDamageBonus', value: 'x' }), true);
  assert.equal(changeProblem({ type: 'rankDamageStep', value: '-1' }), false);
  assert.match(summarizeChanges(system.upgrades[0]), /rankDamageBonus/);
  assert.match(summarizeChanges(system.upgrades[1]), /rankDamageStep/);
});

test('@rankDamage becomes the dice of the skill rank, with its upgrades', async () => {
  const plain = await ranked({ rank: 6 });
  assert.equal(rankDamageOf(plain.item), '1d6');
  const upgraded = await ranked({
    rank: 6,
    upgrades: [
      { id: 'a', rank: 5, changes: [{ type: 'rankDamageBonus', value: '2' }] },
      { id: 'b', rank: 6, changes: [{ type: 'rankDamageStep', value: '1' }] },
      { id: 'c', rank: 10, changes: [{ type: 'rankDamageStep', value: '5' }] },
    ],
  });
  assert.equal(rankDamageOf(upgraded.item), '1d10'); // rank 8 reads 1d8, one row up
  // A spell works the same, and rank 0 gives nothing even with upgrades.
  assert.equal(rankDamageOf((await ranked({ rank: 4, type: 'spell' })).item), '1d4');
  const untrained = await ranked({
    rank: 0,
    upgrades: [{ id: 'a', rank: 0, changes: [{ type: 'rankDamageBonus', value: '5' }] }],
  });
  assert.equal(rankDamageOf(untrained.item), '');
});

test('effects add a rank bonus and a row step to the skills their row covers, and rows add together', async () => {
  const { item, actor } = await ranked({
    rank: 4,
    tags: ['Fire'],
    identifier: 'fireball',
    effects: [
      row('rankDamageBonus', 1, 'tag', 'fire'),
      row('rankDamageBonus', 1, 'skill', 'Fireball'),
      row('rankDamageStep', 1, 'all'),
      row('rankDamageBonus', 7, 'tag', 'cold'), // another tag
      row('rankDamageBonus', 7, 'skill', 'frostbolt'), // another skill
    ],
  });
  assert.deepEqual(rankDamageMods(actor, item), { bonus: 2, step: 1 });
  assert.equal(rankDamageOf(item), '1d8'); // rank 6 reads 1d6, one row up

  // Switched off effects do nothing; a negative amount is a penalty.
  const off = makeEffect({ flags: { buildMods: [{ kind: 'rankDamageStep', target: 'all', value: '', amount: 3 }] }, disabled: true });
  const penalty = row('rankDamageBonus', -2, 'all');
  const other = await ranked({ rank: 6, effects: [off, penalty] });
  assert.equal(rankDamageOf(other.item), '1d4'); // rank 4

  // Both the upgrades and the effects count.
  const both = await ranked({
    rank: 4,
    upgrades: [{ id: 'a', rank: 1, changes: [{ type: 'rankDamageStep', value: '1' }] }],
    effects: [row('rankDamageStep', 1, 'all')],
  });
  assert.equal(rankDamageOf(both.item), '1d8');
});

test('the scalar is replaced wherever it stands, and only the whole word', async () => {
  const { item } = await ranked({ rank: 8 });
  assert.equal(usesRankDamage('@rankDamage + @str.mod'), true);
  assert.equal(usesRankDamage('1d6 + @str.mod'), false);
  assert.equal(usesRankDamage('@rankDamageX'), false);
  assert.equal(expandRankDamage('@rankDamage + @str.mod', item), '1d8 + @str.mod');
  assert.equal(expandRankDamage('@rankDamage + @rankDamage', item), '1d8 + 1d8');
  assert.equal(expandRankDamage('2 * @rankDamage', item), '2 * 1d8');
  assert.equal(expandRankDamage('1d6+@str.mod', item), '1d6+@str.mod'); // nothing to do
  assert.equal(expandRankDamage('@rankDamageX + @rankDamage.x', item), '@rankDamageX + @rankDamage.x');
  assert.equal(expandRankDamage('', item), '');
  // Several terms keep together after a minus, times or divide.
  const high = await ranked({ rank: 15 });
  assert.equal(expandRankDamage('@rankDamage + 1', high.item), '1d8 + 1d6 + 1');
  assert.equal(expandRankDamage('10 - @rankDamage', high.item), '10 - (1d8 + 1d6)');
  assert.equal(expandRankDamage('2*@rankDamage', high.item), '2*(1d8 + 1d6)');
});

test('with no rank to read the scalar is nothing', async () => {
  const untrained = await ranked({ rank: 0 });
  assert.equal(expandRankDamage('1d6 + @rankDamage', untrained.item), '1d6 + 0');
  // An item that has no rank of its own (gear, an item) and no skill adds nothing.
  const gear = makeItem({ type: 'gear', system: { rank: 9 } });
  assert.equal(expandRankDamage('@rankDamage', gear), '0');
  assert.equal(expandRankDamage('@rankDamage', null), '0');
  // A mob ability reads its own rank.
  const ability = makeItem({ type: 'mobAbility', name: 'Bite', system: { rank: 12 } });
  assert.equal(expandRankDamage('@rankDamage', ability), '1d12');
});

test('a weapon that rolls with a skill reads that skill rank for its own damage and the skill damage', async () => {
  // (item.mjs #useRollingSkill joins the weapon damage and the skill damage, then expands
  // the whole formula with the skill.)
  const { item: skill } = await ranked({ rank: 14 });
  const joined = ['1d4 + @rankDamage', skill.system.effective.damage].join(' + ');
  assert.equal(expandRankDamage(joined, skill), '1d4 + 1d8 + 1d6 + 1d8 + 1d6');
});

test('Rank damage build rows are scoped like Skill cap and hold an amount', () => {
  assert.equal(isScopedKind('rankDamageBonus'), true);
  assert.equal(isScopedKind('skillCap'), true);
  assert.equal(isScopedKind('checkDie'), false);
  assert.equal(hasAmount('rankDamageStep'), true);
  assert.equal(hasAmount('skillCap'), false);

  // A new row (no amount yet) starts at 1; a typed amount is whole; a tag is kept and trimmed.
  const tagged = { kind: 'rankDamageBonus', target: 'tag', value: 'Fire', amount: 2 };
  assert.deepEqual(cleanBuildRow({ ...tagged }, tagged), tagged);
  assert.deepEqual(cleanBuildRow({ kind: 'rankDamageStep', target: 'tag', value: ' Fire ', amount: '-2.7' }, tagged), {
    kind: 'rankDamageStep',
    target: 'tag',
    value: 'Fire',
    amount: -2,
  });
  assert.equal(cleanBuildRow({ kind: 'rankDamageBonus', target: 'all' }, null).amount, 1);
  assert.equal(cleanBuildRow({ kind: 'rankDamageBonus', target: 'all', amount: '' }, null).amount, 0);
  // Changing the scope clears the tag; switching between scoped kinds keeps it.
  assert.deepEqual(cleanBuildRow({ ...tagged, target: 'all' }, tagged), {
    kind: 'rankDamageBonus',
    target: 'all',
    value: '',
    amount: 2,
  });
  assert.equal(cleanBuildRow({ kind: 'skillCap', target: 'tag', value: 'Fire' }, tagged).value, 'Fire');
  assert.equal('amount' in cleanBuildRow({ kind: 'skillCap', target: 'tag', value: 'Fire' }, tagged), false);
  // Switching to another kind leaves no scope behind.
  assert.deepEqual(cleanBuildRow({ kind: 'checkDie', target: 'tag', value: 'Fire' }, tagged), {
    kind: 'checkDie',
    target: 'evade',
    value: '',
  });
});
