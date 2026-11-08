import { world, makeActor, makeEffect, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBuildRow, cleanSplit, splitTotal, statSplitOf, buildModsOf } from '../module/helpers/build-mods.mjs';
import { skillCapOf, SKILL_CAP, SKILL_CAP_BOOSTED } from '../module/helpers/skill-cap.mjs';
import { skillRankBonusOf } from '../module/helpers/skill-rank.mjs';
import {
  canReassign,
  checkSplit,
  isPickRow,
  matchesFilter,
  pendingSlots,
  pickSlots,
  pickSummary,
  poolFor,
  reassignSlots,
  tidyChoices,
  withBuildPicks,
  withoutAnswers,
  withSplit,
} from '../module/helpers/picks.mjs';

beforeEach(() => world.reset());

const skill = (name, { identifier = name.toLowerCase().replaceAll(' ', '-'), tags = [], stat = 'str', type = 'skill' } = {}) =>
  makeItem({ type, name, system: { identifier, tags, stat } });

/** A race on an actor with the given granted rows and recorded picks. */
const race = (grantedSkills, picks = {}) => {
  const item = makeItem({ type: 'race', name: 'Test Race', id: 'race1', system: { grantedSkills } });
  item.getFlag = (scope, key) => (key === 'picks' ? picks : undefined);
  return item;
};
const effectWith = (rows, extra = {}) => makeEffect({ name: 'Perk', flags: { buildMods: rows, ...extra } });

const crafting = (name) => skill(name, { tags: ['Crafting'], stat: 'int' });

/* -------------------------------------------- */
/*  The pool                                    */
/* -------------------------------------------- */

test('a filter needs every part it names: tag, stat and kind', () => {
  const smith = crafting('Smithing');
  const charm = skill('Charm', { stat: 'cha' });
  const fire = skill('Fireball', { type: 'spell', stat: 'int', tags: ['Fire'] });
  assert.ok(matchesFilter(smith, { tag: 'crafting', stat: '', kind: '' }));
  assert.ok(!matchesFilter(charm, { tag: 'crafting', stat: '', kind: '' }));
  assert.ok(matchesFilter(charm, { tag: '', stat: 'cha', kind: '' }));
  assert.ok(!matchesFilter(smith, { tag: '', stat: 'cha', kind: '' }));
  assert.ok(matchesFilter(fire, { tag: '', stat: '', kind: 'spell' }));
  assert.ok(!matchesFilter(smith, { tag: '', stat: '', kind: 'spell' }));
  // A blank kind takes skills and spells; a blank filter takes any of them.
  assert.ok(matchesFilter(fire, { tag: '', stat: '', kind: '' }));
  assert.ok(matchesFilter(charm, { tag: '', stat: '', kind: '' }));
  // Together.
  assert.ok(matchesFilter(fire, { tag: 'fire', stat: 'int', kind: 'spell' }));
  assert.ok(!matchesFilter(fire, { tag: 'fire', stat: 'dex', kind: 'spell' }));
  // Things that are not skills or spells never match.
  assert.ok(!matchesFilter(makeItem({ type: 'gear', system: {} }), { tag: '', stat: '', kind: '' }));
});

test('the pool is sorted by name and can be limited to skills with an Identifier', () => {
  const items = [crafting('Weaving'), crafting('Brewing'), skill('Charm', { tags: ['Crafting'], identifier: '' })];
  const filter = { tag: 'crafting', stat: '', kind: '' };
  assert.deepEqual(poolFor(items, filter).map((i) => i.name), ['Brewing', 'Charm', 'Weaving']);
  assert.deepEqual(poolFor(items, filter, { identified: true }).map((i) => i.name), ['Brewing', 'Weaving']);
});

/* -------------------------------------------- */
/*  Granted skills the player picks             */
/* -------------------------------------------- */

test('a granted-skills row with a count is a pick; one without is a fixed skill', () => {
  assert.ok(isPickRow({ uuid: '', rank: 3, count: 2, tag: 'crafting' }));
  assert.ok(!isPickRow({ uuid: 'Item.X', rank: 3, count: 0 }));
  assert.ok(!isPickRow({ uuid: 'Item.X', rank: 3 }));
});

test('a race pick row is pending until the player has picked, and fixed rows are not choices', () => {
  const item = race([
    { uuid: 'Item.Endurance', rank: 2, count: 0, tag: '', stat: '', kind: '' },
    { uuid: '', rank: 3, count: 2, tag: 'crafting', stat: '', kind: '' },
  ]);
  const actor = makeActor({ items: [item] });
  const slots = pickSlots(actor);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].type, 'grant');
  assert.equal(slots[0].index, 1);
  assert.equal(slots[0].rank, 3);
  assert.equal(slots[0].need, 2);
  assert.deepEqual(slots[0].filter, { tag: 'crafting', stat: '', kind: '' });
  assert.equal(pendingSlots(actor).length, 1);
});

test('picks already made are counted, and the rest stay pending', () => {
  const rows = [{ uuid: '', rank: 2, count: 2, tag: '', stat: '', kind: 'spell' }];
  const half = makeActor({ items: [race(rows, { 0: ['Item.Fireball'] })] });
  assert.equal(pickSlots(half)[0].need, 1);
  assert.equal(pendingSlots(half).length, 1);
  const done = makeActor({ items: [race(rows, { 0: ['Item.Fireball', 'Item.Frost'] })] });
  assert.equal(pickSlots(done)[0].need, 0);
  assert.equal(pendingSlots(done).length, 0);
});

test('only races, classes and subclasses have picks, and several rows are separate slots', () => {
  const species = makeItem({ type: 'species', system: { grantedSkills: [{ uuid: '', rank: 1, count: 1 }] } });
  const lajabless = race([
    { uuid: '', rank: 2, count: 2, tag: '', stat: '', kind: 'spell' },
    { uuid: '', rank: 3, count: 1, tag: 'weapon', stat: '', kind: 'skill' },
  ]);
  const actor = makeActor({ items: [species, lajabless] });
  const slots = pickSlots(actor);
  assert.deepEqual(slots.map((s) => [s.index, s.count, s.rank]), [[0, 2, 2], [1, 1, 3]]);
  assert.notEqual(slots[0].key, slots[1].key);
});

/* -------------------------------------------- */
/*  Skill cap for skills the player picks       */
/* -------------------------------------------- */

const capRow = (extra = {}) => ({
  kind: 'skillCap',
  target: 'pick',
  value: '',
  count: 2,
  tag: '',
  stat: 'cha',
  skillKind: '',
  picks: [],
  ...extra,
});

test('a Skill cap pick row is pending until the skills are picked, then raises only those', async () => {
  const effect = effectWith([capRow()]);
  const actor = makeActor({ effects: [effect] });
  const [slot] = pendingSlots(actor);
  assert.equal(slot.type, 'cap');
  assert.equal(slot.need, 2);
  assert.deepEqual(slot.filter, { tag: '', stat: 'cha', kind: '' });
  // Before picking, nothing is raised.
  assert.equal(skillCapOf(actor, skill('Charm', { stat: 'cha' })), SKILL_CAP);

  effect.flags['carl-rpg'].buildMods = withBuildPicks(effect.flags['carl-rpg'].buildMods, 0, [
    { value: 'charm', name: 'Charm' },
    { value: 'lie', name: 'Lie' },
  ]);
  assert.equal(pendingSlots(actor).length, 0);
  assert.equal(skillCapOf(actor, skill('Charm')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(actor, skill('Lie')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(actor, skill('Haggle')), SKILL_CAP);
  // (A skill with no Identifier is never covered by a pick.)
  assert.equal(skillCapOf(actor, skill('Nameless', { identifier: '' })), SKILL_CAP);
  // (The pick is not matched by the name, only the Identifier, ignoring case.)
  assert.equal(skillCapOf(actor, skill('Charm', { identifier: 'CHARM' })), SKILL_CAP_BOOSTED);
});

test('a pick can be for a pet-free actor without effects, and an effect that is off holds no choice', () => {
  const off = makeEffect({ name: 'Off', flags: { buildMods: [capRow()] }, disabled: true });
  const actor = makeActor({ effects: [off] });
  assert.equal(pickSlots(actor).length, 0);
});

test('the pick scope works for the other scoped benefits too (a rank bonus)', async () => {
  const bonus = { kind: 'skillRankBonus', target: 'pick', value: '', amount: 2, count: 1, tag: '', stat: '', skillKind: '', picks: [{ value: 'charm', name: 'Charm' }] };
  const actor = await makeCrawler({ effects: [effectWith([bonus])] });
  const charm = skill('Charm');
  charm.system.rank = 4;
  assert.equal(skillRankBonusOf(actor, charm), 2);
  assert.equal(skillRankBonusOf(actor, skill('Lie')), 0);
});

test('an existing skill scope still covers by Identifier, and a tag scope by tag', () => {
  const actor = makeActor({
    effects: [
      effectWith([{ kind: 'skillCap', target: 'skill', value: 'hide-in-shadows', name: 'Hide in Shadows' }]),
      effectWith([{ kind: 'skillCap', target: 'tag', value: 'crafting' }]),
    ],
  });
  assert.equal(skillCapOf(actor, skill('Hide in Shadows')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(actor, crafting('Smithing')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(actor, skill('Charm')), SKILL_CAP);
});

test('an effect copy says which item gave it, and the slot is named after that item', () => {
  const dwarf = race([]);
  dwarf.name = 'Dwarf, Classic';
  const effect = effectWith([capRow()], { sourceItems: ['race1'] });
  const actor = makeActor({ items: [dwarf], effects: [effect] });
  assert.equal(pickSlots(actor)[0].sourceName, 'Dwarf, Classic');
  const lone = makeActor({ effects: [effectWith([capRow()])] });
  assert.equal(pickSlots(lone)[0].sourceName, 'Perk');
});

/* -------------------------------------------- */
/*  Build rows, tidied for saving               */
/* -------------------------------------------- */

test('a Player picks row keeps its filter and picks, and defaults to one pick', () => {
  const fresh = cleanBuildRow({ kind: 'skillCap', target: 'pick', value: 'x', name: 'y' });
  assert.deepEqual(fresh, { kind: 'skillCap', target: 'pick', value: '', count: 1, tag: '', stat: '', skillKind: '', picks: [] });
  const before = capRow({ picks: [{ value: 'charm', name: 'Charm' }] });
  const kept = cleanBuildRow({ kind: 'skillCap', target: 'pick', count: '3', tag: ' crafting ', stat: 'int', skillKind: 'spell' }, before);
  assert.equal(kept.count, 3);
  assert.equal(kept.tag, 'crafting');
  assert.equal(kept.stat, 'int');
  assert.equal(kept.skillKind, 'spell');
  assert.deepEqual(kept.picks, before.picks);
  // Nonsense falls back.
  const odd = cleanBuildRow({ kind: 'skillCap', target: 'pick', count: '0', stat: 'luck', skillKind: 'gear' }, before);
  assert.equal(odd.count, 1);
  assert.equal(odd.stat, '');
  assert.equal(odd.skillKind, '');
});

test('changing a pick row to another scope drops its filter, and a rank bonus keeps its amount', () => {
  const before = capRow({ picks: [{ value: 'charm', name: 'Charm' }] });
  const all = cleanBuildRow({ kind: 'skillCap', target: 'all' }, before);
  assert.deepEqual(all, { kind: 'skillCap', target: 'all', value: '' });
  const bonus = cleanBuildRow({ kind: 'skillRankBonus', target: 'pick', amount: '2', count: '2' }, null);
  assert.equal(bonus.amount, 2);
  assert.equal(bonus.count, 2);
});

test('a Stat split row starts with 2 points, all stats and no redo, and keeps its answer', () => {
  const fresh = cleanBuildRow({ kind: 'statSplit' }, { kind: 'checkDie', target: 'evade', value: '1d4' });
  assert.deepEqual(fresh, { kind: 'statSplit', target: '', value: '', points: 2, stats: [], repick: 'never', split: {} });
  const before = { kind: 'statSplit', points: 6, stats: ['int', 'dex', 'cha'], repick: 'floor', split: { int: 2, dex: 2, cha: 2 }, usedFloor: 4 };
  const row = cleanBuildRow({ kind: 'statSplit', points: '6', stats: ['int', 'dex', 'cha', 'luck'], repick: 'floor' }, before);
  assert.deepEqual(row.stats, ['int', 'dex', 'cha']);
  assert.equal(row.points, 6);
  assert.equal(row.repick, 'floor');
  assert.deepEqual(row.split, before.split);
  assert.equal(row.usedFloor, 4);
  // Offering every stat is stored as "all".
  assert.deepEqual(cleanBuildRow({ kind: 'statSplit', points: 3, stats: ['str', 'int', 'con', 'dex', 'cha'] }).stats, []);
  // Points are at least 1; a bad redo rule is "never".
  const odd = cleanBuildRow({ kind: 'statSplit', points: '-3', repick: 'daily' });
  assert.equal(odd.points, 1);
  assert.equal(odd.repick, 'never');
  // Leaving the kind drops the split and its fields.
  assert.deepEqual(cleanBuildRow({ kind: 'checkDie', target: 'evade', value: '1d4' }, before), { kind: 'checkDie', target: 'evade', value: '1d4' });
});

/* -------------------------------------------- */
/*  Stat splits                                 */
/* -------------------------------------------- */

const cityElf = (extra = {}) => ({
  kind: 'statSplit',
  target: '',
  value: '',
  points: 6,
  stats: ['int', 'dex', 'cha'],
  repick: 'floor',
  split: {},
  ...extra,
});

test('a split is tidied: whole numbers, only the stats offered, and never more than the points', () => {
  const row = cityElf();
  assert.deepEqual(cleanSplit(row, { int: 2, dex: 2, cha: 2 }), { int: 2, dex: 2, cha: 2 });
  assert.deepEqual(cleanSplit(row, { int: 2.9, str: 4, dex: -3, cha: 'x' }), { int: 2 });
  // Too many: the later stats lose the excess.
  assert.deepEqual(cleanSplit(row, { int: 5, dex: 5, cha: 5 }), { int: 5, dex: 1 });
  assert.equal(splitTotal({ ...row, split: { int: 5, dex: 5 } }), 6);
  assert.equal(splitTotal(row), 0);
});

test('only an exact answer is valid', () => {
  const row = cityElf();
  assert.ok(checkSplit(row, { int: 3, dex: 2, cha: 1 }).ok);
  assert.ok(!checkSplit(row, { int: 3, dex: 2 }).ok);
  assert.ok(!checkSplit(row, { int: 3, dex: 2, cha: 2 }).ok);
  // Points on a stat that is not offered do not count.
  assert.ok(!checkSplit(row, { str: 6 }).ok);
  assert.ok(!checkSplit(row, { int: 6, str: 1 }).ok);
  assert.deepEqual(checkSplit(row, { int: 1, dex: 4, cha: 1 }).split, { int: 1, dex: 4, cha: 1 });
});

test('a split adds to the stats it was given, in the Enhanced value', async () => {
  const effect = effectWith([cityElf({ split: { int: 1, dex: 3, cha: 2 } })]);
  const crawler = await makeCrawler({ abilities: { int: 3, dex: 2, cha: 1, str: 4 }, effects: [effect] });
  assert.deepEqual(statSplitOf(crawler), { str: 0, int: 1, con: 0, dex: 3, cha: 2 });
  const stats = crawler.system.abilities;
  assert.equal(stats.int.enhanced, 4);
  assert.equal(stats.dex.enhanced, 5);
  assert.equal(stats.cha.enhanced, 3);
  assert.equal(stats.str.enhanced, 4);
});

test('a split adds to the bonuses effects already give, splits add up, and a switched-off effect gives nothing', async () => {
  const crawler = await makeCrawler({
    abilities: { int: 3 },
    bonuses: { int: 2 },
    effects: [
      effectWith([cityElf({ split: { int: 2, dex: 4 } })]),
      effectWith([cityElf({ points: 2, stats: [], split: { int: 2 } })]),
      makeEffect({ flags: { buildMods: [cityElf({ split: { int: 6 } })] }, disabled: true }),
    ],
  });
  assert.equal(crawler.system.abilities.int.enhanced, 3 + 2 + 2 + 2);
  assert.equal(crawler.system.abilities.dex.enhanced, 1 + 4);
});

test('a split that has not been made gives nothing, and a stat cap still applies after it', async () => {
  const none = await makeCrawler({ abilities: { int: 3 }, effects: [effectWith([cityElf()])] });
  assert.equal(none.system.abilities.int.enhanced, 3);
  const capped = await makeCrawler({
    abilities: { int: 3 },
    effects: [effectWith([cityElf({ split: { int: 6 } }), { kind: 'statCap', target: 'int', value: '5' }])],
  });
  assert.equal(capped.system.abilities.int.enhanced, 5);
});

test('a split row is a build benefit kind, so it is read at all', () => {
  const actor = makeActor({ effects: [effectWith([cityElf()])] });
  assert.equal(buildModsOf(actor).length, 1);
});

test('a Stat split is pending until every point is handed out', () => {
  const effect = effectWith([cityElf()]);
  const actor = makeActor({ effects: [effect] });
  const [slot] = pickSlots(actor);
  assert.equal(slot.type, 'split');
  assert.equal(slot.points, 6);
  assert.deepEqual(slot.stats, ['int', 'dex', 'cha']);
  assert.ok(!slot.done);
  assert.deepEqual(pickSummary(actor, 3), { pending: 1, reassign: false });

  effect.flags['carl-rpg'].buildMods = withSplit(effect.flags['carl-rpg'].buildMods, 0, { int: 2, dex: 2, cha: 2 });
  assert.ok(pickSlots(actor)[0].done);
  assert.equal(pendingSlots(actor).length, 0);
});

test('a made split can be redone once per floor, only when the row allows it', () => {
  const made = { int: 2, dex: 2, cha: 2 };
  const actor = makeActor({ effects: [effectWith([cityElf({ split: made })])] });
  const [slot] = pickSlots(actor);
  assert.ok(canReassign(slot, 3));
  assert.equal(reassignSlots(actor, 3).length, 1);
  assert.deepEqual(pickSummary(actor, 3), { pending: 0, reassign: true });

  // Redone on floor 3: not again on floor 3, but again on floor 4.
  const rows = withSplit([cityElf({ split: made })], 0, { int: 6 }, 3);
  assert.equal(rows[0].usedFloor, 3);
  assert.deepEqual(rows[0].split, { int: 6 });
  const used = pickSlots(makeActor({ effects: [effectWith(rows)] }))[0];
  assert.ok(!canReassign(used, 3));
  assert.ok(canReassign(used, 4));

  // "Never" rows cannot be redone, nor can one that was never made.
  const never = pickSlots(makeActor({ effects: [effectWith([cityElf({ repick: 'never', split: made })])] }))[0];
  assert.ok(!canReassign(never, 3));
  const unmade = pickSlots(makeActor({ effects: [effectWith([cityElf()])] }))[0];
  assert.ok(!canReassign(unmade, 3));
});

test('the first split does not use up the floor, and a split without a floor stamp is left unstamped', () => {
  const rows = withSplit([cityElf()], 0, { int: 3, dex: 3 });
  assert.equal('usedFloor' in rows[0], false);
  assert.deepEqual(rows[0].split, { int: 3, dex: 3 });
});

/* -------------------------------------------- */
/*  Resetting, and tidying choices              */
/* -------------------------------------------- */

test('resetting forgets picks and splits but leaves every other row alone', () => {
  const rows = [
    capRow({ picks: [{ value: 'charm', name: 'Charm' }] }),
    cityElf({ split: { int: 6 }, usedFloor: 4 }),
    { kind: 'skillCap', target: 'tag', value: 'crafting' },
    { kind: 'checkDie', target: 'evade', value: '1d4' },
  ];
  const reset = withoutAnswers(rows);
  assert.deepEqual(reset[0].picks, []);
  assert.deepEqual(reset[1].split, {});
  assert.equal('usedFloor' in reset[1], false);
  assert.deepEqual(reset[2], rows[2]);
  assert.deepEqual(reset[3], rows[3]);
  // (The originals are untouched.)
  assert.equal(rows[0].picks.length, 1);
});

test('chosen skills are tidied: no blanks, no repeats, none picked before, no more than needed', () => {
  assert.deepEqual(tidyChoices(['a', '', 'b', 'A', 'c'], [], 2), ['a', 'b']);
  assert.deepEqual(tidyChoices(['a', 'b', 'c'], ['B'], 5), ['a', 'c']);
  assert.deepEqual(tidyChoices(['', ''], [], 2), []);
});
