import { world, makeEffect, makeActor, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import CarlRPGFeature from '../module/data/item-feature.mjs';
import {
  applyEffectiveRank,
  effectiveRankOf,
  rankFloorOf,
  rankOf,
  skillRankBonusOf,
  skillRankModsOf,
} from '../module/helpers/skill-rank.mjs';
import { buildModsOf, cleanBuildRow, hasAmount, isScopedKind, kindFields } from '../module/helpers/build-mods.mjs';
import { skillCapOf } from '../module/helpers/skill-cap.mjs';
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
  stat = 'str',
}) {
  const system = Object.create(CarlRPGFeature.prototype);
  Object.assign(system, {
    rank,
    stat,
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

// --- By stat scope and the minimum ---

const statRow = (amount, stats, extra = {}, kind = 'skillRankBonus') =>
  makeEffect({ flags: { buildMods: [{ kind, target: 'stat', value: '', amount, stats, ...extra }] } });

test('a By stat row covers every skill and spell whose stat is ticked', async () => {
  const effects = [statRow(-3, ['dex', 'str'])];
  const str = await owned({ rank: 6, stat: 'str', effects });
  assert.equal(str.system.effectiveRank, 3);
  const dexSpell = await owned({ rank: 6, stat: 'dex', type: 'spell', effects });
  assert.equal(dexSpell.system.effectiveRank, 3);
  const int = await owned({ rank: 6, stat: 'int', effects });
  assert.deepEqual([int.system.rankBonus, int.system.effectiveRank], [0, 6]);
  // No stat ticked: the row covers nothing.
  const none = await owned({ rank: 6, effects: [statRow(-3, [])] });
  assert.equal(none.system.effectiveRank, 6);
  const unset = await owned({
    rank: 6,
    effects: [makeEffect({ flags: { buildMods: [{ kind: 'skillRankBonus', target: 'stat', amount: -3 }] } })],
  });
  assert.equal(unset.system.effectiveRank, 6);
  // Without a skill to judge, a By stat row covers nothing.
  assert.equal(skillRankBonusOf(str.actor, null), 0);
});

test('a By stat row can be narrowed to skills or to spells', async () => {
  const skillsOnly = [statRow(-2, ['str'], { skillKind: 'skill' })];
  assert.equal((await owned({ rank: 5, effects: skillsOnly })).system.effectiveRank, 3);
  assert.equal((await owned({ rank: 5, type: 'spell', effects: skillsOnly })).system.effectiveRank, 5);
  const spellsOnly = [statRow(-2, ['str'], { skillKind: 'spell' })];
  assert.equal((await owned({ rank: 5, effects: spellsOnly })).system.effectiveRank, 5);
  assert.equal((await owned({ rank: 5, type: 'spell', effects: spellsOnly })).system.effectiveRank, 3);
});

test('the By stat scope works for the other scoped benefits (Skill cap 20)', async () => {
  const cap = makeEffect({ flags: { buildMods: [{ kind: 'skillCap', target: 'stat', value: '', stats: ['dex'] }] } });
  const dex = await owned({ rank: 15, stat: 'dex', effects: [cap, row(2, 'all')] });
  assert.equal(skillCapOf(dex.actor, dex.item), 20);
  assert.equal(dex.system.effectiveRank, 17);
  const str = await owned({ rank: 15, stat: 'str', effects: [cap, row(2, 'all')] });
  assert.equal(skillCapOf(str.actor, str.item), 15);
  assert.equal(str.system.effectiveRank, 15);
});

test('a minimum stops a penalty, but only for a stored rank of 1 or more', () => {
  assert.equal(effectiveRankOf(6, -3, Infinity, 1), 3); // not reached
  assert.equal(effectiveRankOf(4, -3, Infinity, 1), 1);
  assert.equal(effectiveRankOf(2, -3, Infinity, 1), 1);
  assert.equal(effectiveRankOf(1, -3, Infinity, 1), 1);
  assert.equal(effectiveRankOf(0, -3, Infinity, 1), 0); // no ranks: stays 0
  assert.equal(effectiveRankOf(4, -3, Infinity, 2), 2);
  assert.equal(effectiveRankOf(1, -3, Infinity, 2), 1); // never lifted above the stored rank
  assert.equal(effectiveRankOf(4, -6, Infinity, 0), 0); // no minimum: as before
  assert.equal(effectiveRankOf(4, 2, 15, 9), 6); // a bonus ignores the minimum
  assert.equal(effectiveRankOf(4, 0, 15, 9), 4);
  assert.equal(rankFloorOf(4, -3, 1), 1);
  assert.equal(rankFloorOf(1, -3, 2), 1);
  assert.equal(rankFloorOf(0, -3, 1), 0);
  assert.equal(rankFloorOf(4, 3, 1), 0);
  assert.equal(rankFloorOf(4, -3, 0), 0);
});

test("Boring Ol' Mage: -3 ranks in Dexterity and Strength skills, to a minimum of 1", async () => {
  const dexRow = statRow(-3, ['dex'], { min: 1, skillKind: 'skill' });
  const strRow = statRow(-3, ['str'], { min: 1, skillKind: 'skill' });
  const effects = [dexRow, strRow];
  const read = ({ system }) => [system.rank, system.effectiveRank, system.rankBonus, system.rankChange, system.rankMin];

  // [stored, effective, the rows' total, the real change, the minimum holding it]
  assert.deepEqual(read(await owned({ rank: 5, stat: 'dex', effects })), [5, 2, -3, -3, 0]);
  assert.deepEqual(read(await owned({ rank: 4, stat: 'str', effects })), [4, 1, -3, -3, 0]);
  assert.deepEqual(read(await owned({ rank: 2, stat: 'dex', effects })), [2, 1, -3, -1, 1]);
  assert.deepEqual(read(await owned({ rank: 1, stat: 'str', effects })), [1, 1, -3, 0, 1]);
  assert.deepEqual(read(await owned({ rank: 0, stat: 'dex', effects })), [0, 0, -3, 0, 0]);
  assert.deepEqual(read(await owned({ rank: 5, stat: 'int', effects })), [5, 5, 0, 0, 0]);
  // (these rows are skills only)
  assert.deepEqual(read(await owned({ rank: 5, stat: 'dex', type: 'spell', effects })), [5, 5, 0, 0, 0]);

  // The held rank is the one everything reads; switched off, the stored rank is back.
  const held = await owned({ rank: 2, stat: 'dex', effects });
  assert.equal(held.system.formula, '1d20 + @dex.mod + 1');
  assert.equal(rankOf(held.system), 1);
  dexRow.disabled = true;
  held.prepare();
  assert.deepEqual(read(held), [2, 2, 0, 0, 0]);
  dexRow.disabled = false;
});

test('the minimum is a floor on the total of every covering row', async () => {
  const mage = statRow(-3, ['str'], { min: 1 });
  // A debuff without a minimum is held by the Mage row's.
  const both = await owned({ rank: 4, effects: [mage, row(-2, 'all')] });
  assert.deepEqual(skillRankModsOf(both.actor, both.item), { bonus: -5, min: 1 });
  assert.deepEqual([both.system.effectiveRank, both.system.rankChange, both.system.rankMin], [1, -3, 1]);
  // A bonus elsewhere softens the penalty; the minimum is not reached.
  const softened = await owned({ rank: 4, effects: [mage, row(2, 'all')] });
  assert.deepEqual([softened.system.effectiveRank, softened.system.rankMin], [3, 0]);
  // The highest minimum of the covering rows wins; a row that does not cover it is ignored.
  const two = await owned({
    rank: 6,
    effects: [mage, statRow(-4, ['str'], { min: 2 }), statRow(-1, ['dex'], { min: 5 })],
  });
  assert.deepEqual([two.system.effectiveRank, two.system.rankMin], [2, 2]);
  // A total that is not a penalty ignores the minimum (the rank is never lifted to it).
  const lifted = await owned({ rank: 1, effects: [statRow(-1, ['str'], { min: 3 }), row(2, 'all')] });
  assert.deepEqual([lifted.system.effectiveRank, lifted.system.rankMin], [2, 0]);
  // The minimum works on the other scopes too.
  const all = await owned({ rank: 2, effects: [makeEffect({ flags: { buildMods: [{ kind: 'skillRankBonus', target: 'all', value: '', amount: -5, min: 1 }] } })] });
  assert.deepEqual([all.system.effectiveRank, all.system.rankMin], [1, 1]);
});

test('By stat rows and the minimum are tidied for saving', () => {
  const order = Object.keys(CONFIG.CARL_RPG.abilities);
  const asked = { kind: 'skillRankBonus', target: 'stat', amount: -3, min: '1', stats: ['dex', 'luck', 'str'], skillKind: 'skill' };
  const saved = cleanBuildRow(asked, null);
  assert.deepEqual(saved, {
    kind: 'skillRankBonus',
    target: 'stat',
    value: '',
    amount: -3,
    stats: order.filter((key) => ['dex', 'str'].includes(key)),
    skillKind: 'skill',
    min: 1,
  });
  assert.deepEqual(cleanBuildRow(saved, saved), saved);
  // Nothing ticked yet, an unknown kind, no minimum.
  const fresh = cleanBuildRow({ kind: 'skillRankBonus', target: 'stat', skillKind: 'gear', min: '' }, null);
  assert.deepEqual(fresh, { kind: 'skillRankBonus', target: 'stat', value: '', amount: 1, stats: [], skillKind: '' });
  assert.equal('min' in cleanBuildRow({ ...asked, min: -2 }, saved), false);
  assert.equal(cleanBuildRow({ ...asked, min: 2.9 }, saved).min, 2);
  // Another scope drops the stats; the minimum stays with the Skill rank bonus.
  assert.deepEqual(cleanBuildRow({ ...saved, target: 'all' }, saved), {
    kind: 'skillRankBonus',
    target: 'all',
    value: '',
    amount: -3,
    min: 1,
  });
  // Another kind drops the minimum and keeps the By stat scope.
  assert.deepEqual(cleanBuildRow({ ...saved, kind: 'skillCap' }, saved), {
    kind: 'skillCap',
    target: 'stat',
    value: '',
    stats: saved.stats,
    skillKind: 'skill',
  });
  assert.deepEqual(kindFields({ kind: 'skillRankBonus', min: 3 }), { min: 3 });
  assert.deepEqual(kindFields({ kind: 'skillRankBonus' }), {});
  assert.deepEqual(kindFields({ kind: 'skillCap', min: 3 }), {});
  assert.ok('stat' in CONFIG.CARL_RPG.skillCapScopes);
});
