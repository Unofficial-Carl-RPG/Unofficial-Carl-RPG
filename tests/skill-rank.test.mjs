import { world, makeEffect, makeActor, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import CarlRPGFeature from '../module/data/item-feature.mjs';
import {
  applyEffectiveRank,
  effectiveRankOf,
  rankOf,
  skillRankBonusOf,
} from '../module/helpers/skill-rank.mjs';
import { buildModsOf, cleanBuildRow, hasAmount, isScopedKind } from '../module/helpers/build-mods.mjs';
import { lockedRankFor, levelOf } from '../module/helpers/upgrades.mjs';
import { rankDamageOf } from '../module/helpers/rank-damage.mjs';
import { resolveMods } from '../module/helpers/roll-mods.mjs';
import { eventData } from '../module/helpers/events.mjs';

beforeEach(() => world.reset());

const row = (amount, target = 'all', value = '', kind = 'skillRankBonus') =>
  makeEffect({ flags: { buildMods: [{ kind, target, value, amount }] } });

/**
 * A skill or spell on an actor, prepared by the real data model (prepareDerivedData).
 * Returns the item and a function that prepares it again (effects switched on or off).
 */
async function owned({
  rank,
  identifier = 'zone-of-control',
  tags = [],
  upgrades = [],
  effects = [],
  type = 'skill',
  actorType = 'crawler',
}) {
  const system = Object.create(CarlRPGFeature.prototype);
  Object.assign(system, {
    rank,
    stat: 'str',
    identifier,
    tags,
    upgrades,
    damage: '@rankDamage',
    costs: [],
    manaCost: 0,
    check: { target: 'unopposed' },
    damageType: '',
    armorPiercing: false,
  });
  const item = makeItem({ type, name: identifier, system });
  system.parent = item;
  const actor =
    actorType === 'crawler'
      ? await makeCrawler({ items: [item], effects })
      : makeActor({ type: actorType, items: [item], effects });
  const prepare = () => system.prepareDerivedData();
  prepare();
  return { item, system, actor, prepare };
}

const upgrade = (rank, changes, id = `u${rank}`) => ({
  id,
  rank,
  description: '',
  changes,
  unlocksEffects: [],
  events: [],
});

test('a Skill rank bonus row adds to the skills its scope covers, and rows add together', async () => {
  const effects = [
    row(1, 'all'),
    row(2, 'skill', 'Zone-Of-Control'),
    row(1, 'tag', 'polearm'),
    row(5, 'tag', 'fire'), // another tag
    row(5, 'skill', 'fireball'), // another skill
    makeEffect({ flags: { buildMods: [{ kind: 'skillRankBonus', target: 'all', value: '', amount: 9 }] }, disabled: true }),
  ];
  const { item, actor } = await owned({ rank: 3, tags: ['Polearm'], effects });
  assert.equal(skillRankBonusOf(actor, item), 4);
  // A skill that none of the narrower rows cover only gets the "all" row.
  const other = makeItem({ type: 'skill', name: 'Sneak', system: { identifier: 'sneak', tags: [] } });
  assert.equal(skillRankBonusOf(actor, other), 1);
  // A penalty is a negative amount.
  const penalty = await owned({ rank: 3, effects: [row(-2, 'all'), row(1, 'all')] });
  assert.equal(skillRankBonusOf(penalty.actor, penalty.item), -1);
  // No owner, no bonus.
  assert.equal(skillRankBonusOf(null, item), 0);
});

test('the rank is never below 0, a bonus lifts rank 0, and a bonus stops at the skill cap', () => {
  assert.equal(effectiveRankOf(4, 0), 4);
  assert.equal(effectiveRankOf(4, 2), 6);
  assert.equal(effectiveRankOf(4, -2), 2);
  assert.equal(effectiveRankOf(1, -3), 0);
  assert.equal(effectiveRankOf(0, 1), 1); // untrained skills are lifted too
  assert.equal(effectiveRankOf(0, -1), 0);
  // The cap limits what a bonus adds, not the stored rank.
  assert.equal(effectiveRankOf(14, 3, 15), 15);
  assert.equal(effectiveRankOf(15, 2, 15), 15);
  assert.equal(effectiveRankOf(15, 2, 20), 17);
  assert.equal(effectiveRankOf(16, 1, 15), 16); // stored above the cap stays as it is
  assert.equal(effectiveRankOf(16, -1, 15), 15); // a penalty is not held up by the cap
  assert.equal(effectiveRankOf(14, 3), 17); // no cap
});

test('Polearm +1 rank in Zone of Control: the skill acts one rank higher while the effect is on', async () => {
  const effect = row(1, 'skill', 'zone-of-control');
  const upgrades = [upgrade(6, [{ type: 'rollBonus', value: '2' }])];
  const { item, system, prepare } = await owned({ rank: 5, tags: ['Polearm'], upgrades, effects: [effect] });

  // Rank 5 reads as 6: the roll, the upgrade, @rank and the rank damage dice.
  assert.equal(system.rank, 5); // the stored rank is untouched
  assert.equal(system.rankBonus, 1);
  assert.equal(system.effectiveRank, 6);
  assert.deepEqual(system.effective.unlocked, ['u6']);
  assert.equal(system.effective.rollBonus, 2);
  assert.equal(system.formula, '1d20 + @str.mod + 6 + 2');
  assert.equal(rankDamageOf(item), '1d6');
  assert.equal(rankOf(system), 6);
  assert.equal(levelOf(system), 6);

  // Switched off: back to rank 5, without the upgrade.
  effect.disabled = true;
  prepare();
  assert.equal(system.effectiveRank, 5);
  assert.deepEqual(system.effective.unlocked, []);
  assert.equal(system.formula, '1d20 + @str.mod + 5');
  assert.equal(rankDamageOf(item), '1d4');
  assert.equal(system.rank, 5);

  // On again.
  effect.disabled = false;
  prepare();
  assert.equal(system.effectiveRank, 6);
  assert.equal(rankDamageOf(item), '1d6');
});

test('a skill another row does not cover keeps its rank; spells are covered like skills', async () => {
  const effects = [row(1, 'tag', 'polearm')];
  const other = await owned({ rank: 5, identifier: 'sneak', effects });
  assert.equal(other.system.effectiveRank, 5);
  assert.equal(other.system.rankBonus, 0);
  assert.equal(other.system.formula, '1d20 + @str.mod + 5');
  const spell = await owned({ rank: 5, type: 'spell', tags: ['Polearm'], effects });
  assert.equal(spell.system.effectiveRank, 6);
});

test('the skill cap limits the bonus; Skill cap 20 and pets change the cap', async () => {
  const capped = await owned({ rank: 15, effects: [row(2, 'all')] });
  assert.equal(capped.system.effectiveRank, 15);
  const boosted = await owned({
    rank: 15,
    effects: [row(2, 'all'), makeEffect({ flags: { buildMods: [{ kind: 'skillCap', target: 'all', value: '' }] } })],
  });
  assert.equal(boosted.system.effectiveRank, 17);
  // A pet has no cap (its skills use the floor as their rank).
  world.settings.floor = 18;
  const pet = await owned({ rank: 0, actorType: 'pet', effects: [row(3, 'all')] });
  assert.equal(pet.system.rank, 18);
  assert.equal(pet.system.effectiveRank, 21);
});

test('an item with no owner uses its stored rank', () => {
  const system = { rank: 7 };
  applyEffectiveRank(system, makeItem({ system }), null);
  assert.deepEqual([system.rankBonus, system.effectiveRank], [0, 7]);
  assert.equal(rankOf({ rank: 7 }), 7);
  assert.equal(rankOf({ rank: 7, effectiveRank: 9 }), 9);
  assert.equal(rankOf(null), 0);
  assert.equal(rankOf({}), 0);
});

test('effects an upgrade unlocks are judged by effective rank, except to work the bonus out', () => {
  const item = {
    system: {
      rank: 4,
      effectiveRank: 5,
      upgrades: [{ rank: 5, unlocksEffects: ['Zing'] }],
    },
  };
  assert.equal(lockedRankFor(item, 'Zing'), null); // effective rank 5 reaches it
  assert.equal(lockedRankFor(item, 'Zing', true), 5); // stored rank 4 does not
  assert.equal(levelOf(item.system, true), 4);
  assert.equal(lockedRankFor({ system: { rank: 4, upgrades: item.system.upgrades } }, 'Zing'), 5);

  // The rows used for the bonus are the ones that are on by stored ranks.
  const held = makeEffect({ flags: { buildMods: [{ kind: 'skillRankBonus', target: 'all', value: '', amount: 1 }] } });
  held.lockedRank = ({ stored } = {}) => (stored ? 5 : null);
  held.isSuppressed = false;
  const actor = makeActor({ effects: [held] });
  assert.equal(buildModsOf(actor).length, 1);
  assert.equal(buildModsOf(actor, { stored: true }).length, 0);
  // (Without it, the effect is simply on or off.)
  const plain = makeActor({ effects: [row(1)] });
  assert.equal(buildModsOf(plain, { stored: true }).length, 1);
});

test('@rank in event formulas and a Roll Modifier read the effective rank', async () => {
  const { item, actor } = await owned({ rank: 4, effects: [row(2, 'all')] });
  actor.getRollData = () => ({});
  assert.equal(eventData(item, { actor }).rank, 6);

  const mod = makeItem({
    type: 'skill',
    name: 'Aiming',
    system: {
      rank: 2,
      effectiveRank: 5,
      rollModRules: { rank: [{ when: '' }], dice: [], dr: [] },
    },
  });
  assert.deepEqual(resolveMods([mod]).rank, [{ id: mod.id, name: 'Aiming', amount: 5 }]);
});

test('Skill rank bonus rows are scoped like Skill cap and hold an amount', () => {
  assert.equal(isScopedKind('skillRankBonus'), true);
  assert.equal(hasAmount('skillRankBonus'), true);
  assert.deepEqual(cleanBuildRow({ kind: 'skillRankBonus', target: 'all' }, null), {
    kind: 'skillRankBonus',
    target: 'all',
    value: '',
    amount: 1,
  });
  const picked = { kind: 'skillRankBonus', target: 'skill', value: 'zone', name: 'Zone of Control', amount: -2 };
  assert.deepEqual(cleanBuildRow(picked, picked), picked);
  assert.equal(cleanBuildRow({ ...picked, amount: '2.7' }, picked).amount, 2);
  assert.deepEqual(cleanBuildRow({ ...picked, target: 'tag' }, picked), {
    kind: 'skillRankBonus',
    target: 'tag',
    value: '',
    amount: -2,
  });
});
