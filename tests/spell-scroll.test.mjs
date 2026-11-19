import { world, makeEffect, makeActor, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import CarlRPGSpellScroll from '../module/data/item-spell-scroll.mjs';
import CarlRPGSpell from '../module/data/item-spell.mjs';
import {
  afterReading,
  assignment,
  COPIED_FIELDS,
  isScroll,
  isSpellLike,
  lookFrom,
  scrollBlock,
  scrollLeft,
  sourceOf,
  systemFrom,
} from '../module/helpers/spell-scroll.mjs';
import { castBlockedByHotlist } from '../module/helpers/hotlist-rule.mjs';
import { listAccepts, listEntries } from '../module/helpers/skill-list.mjs';
import { rankDamageOf } from '../module/helpers/rank-damage.mjs';

beforeEach(() => world.reset());

const scrollOf = (system = {}) => ({
  type: 'spellScroll',
  name: 'Scroll of Frost Bolt',
  system: { quantity: 2, spellSource: { name: 'Frost Bolt' }, ...system },
});

/** The spell a GM would drop on a scroll. */
const iceBlast = () => ({
  uuid: 'Item.frost-bolt',
  name: 'Frost Bolt',
  img: 'icons/ice.svg',
  system: {
    identifier: 'frost-bolt',
    description: '<p>A bolt of ice.</p>',
    shortDescription: 'Cold.',
    tags: ['ice', 'ranged'],
    interrupt: false,
    check: { target: 'evade', number: 0 },
    damage: '@rankDamage',
    damageType: 'cold',
    damageTypeAlso: '',
    armorPiercing: false,
    targeting: { mode: 'count', count: '1' },
    events: [{ id: 'e1', name: 'Chill', trigger: 'hit', actions: [] }],
    stat: 'int',
    passive: false,
    upgrades: [{ id: 'u5', rank: 5, changes: [] }],
    // (not copied)
    value: 300,
    costs: [{ resource: 'mana', amount: '3' }],
    requirements: [{ type: 'mana', value: '3' }],
    uses: { max: 2, spent: 1 },
    rank: 9,
  },
});

/* -------------------------------------------- */

test('spell-like: spells and scrolls cast, nothing else does', () => {
  assert.ok(isSpellLike({ type: 'spell' }));
  assert.ok(isSpellLike({ type: 'spellScroll' }));
  assert.ok(!isSpellLike({ type: 'skill' }));
  assert.ok(!isSpellLike({ type: 'item' }));
  assert.ok(isScroll({ type: 'spellScroll' }));
  assert.ok(!isScroll({ type: 'spell' }));
  assert.ok(!isSpellLike(null));
});

test('a scroll needs a spell on it and one left to read', () => {
  assert.equal(scrollBlock(scrollOf()), null);
  assert.equal(scrollBlock(scrollOf({ spellSource: { name: '' } })), 'NoSpell');
  assert.equal(scrollBlock(scrollOf({ spellSource: { name: '   ' } })), 'NoSpell');
  assert.equal(scrollBlock(scrollOf({ quantity: 0 })), 'NoneLeft');
  // (no spell is reported first)
  assert.equal(scrollBlock(scrollOf({ quantity: 0, spellSource: { name: '' } })), 'NoSpell');
  // anything else is never blocked here
  assert.equal(scrollBlock({ type: 'item', system: { quantity: 0 } }), null);
});

test('reading a scroll takes one off, never below 0', () => {
  assert.equal(scrollLeft(scrollOf({ quantity: 3 })), 3);
  assert.equal(afterReading(scrollOf({ quantity: 3 })), 2);
  assert.equal(afterReading(scrollOf({ quantity: 1 })), 0);
  assert.equal(afterReading(scrollOf({ quantity: 0 })), 0);
  assert.equal(afterReading(scrollOf({ quantity: -4 })), 0);
  assert.equal(scrollLeft(scrollOf({ quantity: 'x' })), 0);
});

/* -------------------------------------------- */

test('putting a spell on a scroll copies its settings at the scroll rank, with no costs', () => {
  const spell = iceBlast();
  const system = systemFrom(spell.system, 4);
  assert.equal(system.rank, 4);
  assert.equal(system.damage, '@rankDamage');
  assert.equal(system.stat, 'int');
  assert.deepEqual(system.tags, ['ice', 'ranged']);
  assert.deepEqual(system.check, { target: 'evade', number: 0 });
  assert.equal(system.upgrades.length, 1);
  assert.equal(system.events[0].trigger, 'hit');
  // free to read, whatever the spell asked for
  assert.deepEqual(system.costs, []);
  assert.deepEqual(system.requirements, []);
  assert.equal(system.uses.max, 0);
  assert.equal(system.uses.spent, 0);
  // what stays behind
  assert.equal(system.identifier, undefined);
  assert.equal(system.value, undefined);
  assert.deepEqual(Object.keys(system).filter((k) => !COPIED_FIELDS.includes(k)).sort(), [
    'costs',
    'rank',
    'requirements',
    'uses',
  ]);
});

test('the copy is a snapshot: changing it never changes the spell', () => {
  const spell = iceBlast();
  const system = systemFrom(spell.system, 1);
  system.tags.push('extra');
  system.events[0].name = 'Changed';
  system.upgrades[0].rank = 99;
  system.targeting.count = '5';
  assert.deepEqual(spell.system.tags, ['ice', 'ranged']);
  assert.equal(spell.system.events[0].name, 'Chill');
  assert.equal(spell.system.upgrades[0].rank, 5);
  assert.equal(spell.system.targeting.count, '1');
});

test('a scroll remembers which spell it came from', () => {
  assert.deepEqual(sourceOf(iceBlast()), {
    uuid: 'Item.frost-bolt',
    name: 'Frost Bolt',
    identifier: 'frost-bolt',
    img: 'icons/ice.svg',
  });
  assert.deepEqual(sourceOf({ name: 'Plain', system: {} }), {
    uuid: '',
    name: 'Plain',
    identifier: '',
    img: '',
  });
});

/* -------------------------------------------- */

const defaults = {
  makeName: (spell) => `Scroll of ${spell}`,
  defaultName: 'New Spell Scroll',
  defaultImg: 'icons/svg/item-bag.svg',
};

test('a scroll takes its name and picture from the spell only while they are still defaults', () => {
  const spell = iceBlast();
  // fresh scroll
  assert.deepEqual(
    lookFrom({ name: 'New Spell Scroll', img: 'icons/svg/item-bag.svg' }, null, spell, defaults),
    { name: 'Scroll of Frost Bolt', img: 'icons/ice.svg' }
  );
  // a blank name counts as default
  assert.equal(lookFrom({ name: '  ', img: '' }, null, spell, defaults).name, 'Scroll of Frost Bolt');
  // the GM named and pictured it: left alone
  assert.deepEqual(lookFrom({ name: 'Grandma\'s Spare', img: 'mine.png' }, null, spell, defaults), {});
});

test('swapping the spell renames only a scroll that still wears the earlier spell\'s look', () => {
  const fire = { name: 'Fireball', img: 'icons/fire.svg', system: {} };
  const previous = { name: 'Frost Bolt', img: 'icons/ice.svg' };
  assert.deepEqual(
    lookFrom({ name: 'Scroll of Frost Bolt', img: 'icons/ice.svg' }, previous, fire, defaults),
    { name: 'Scroll of Fireball', img: 'icons/fire.svg' }
  );
  assert.deepEqual(lookFrom({ name: 'Custom', img: 'icons/ice.svg' }, previous, fire, defaults), {
    img: 'icons/fire.svg',
  });
  assert.deepEqual(lookFrom({ name: 'Scroll of Frost Bolt', img: 'mine.png' }, previous, fire, defaults), {
    name: 'Scroll of Fireball',
  });
});

test('a spell with no picture leaves the scroll\'s picture alone', () => {
  const spell = { name: 'Plain', img: '', system: {} };
  assert.deepEqual(lookFrom({ name: 'New Spell Scroll', img: '' }, null, spell, defaults), {
    name: 'Scroll of Plain',
  });
});

test('the whole assignment keeps the scroll rank and records the spell', () => {
  const scroll = { name: 'New Spell Scroll', img: 'icons/svg/item-bag.svg', system: { rank: 7 } };
  const update = assignment(scroll, iceBlast(), iceBlast().system, defaults);
  assert.equal(update.name, 'Scroll of Frost Bolt');
  assert.equal(update.img, 'icons/ice.svg');
  assert.equal(update.system.rank, 7);
  assert.equal(update.system.spellSource.name, 'Frost Bolt');
  assert.deepEqual(update.system.costs, []);
  // a scroll with no rank set yet starts at 1
  assert.equal(assignment({ name: '', system: {} }, iceBlast(), iceBlast().system, defaults).system.rank, 1);
  // swapping: the earlier spell is read from the scroll
  const swapped = assignment(
    { name: 'Scroll of Frost Bolt', img: 'icons/ice.svg', system: { rank: 2, spellSource: { name: 'Frost Bolt', img: 'icons/ice.svg' } } },
    { name: 'Fireball', img: 'icons/fire.svg', uuid: 'Item.fb', system: {} },
    {},
    defaults
  );
  assert.equal(swapped.name, 'Scroll of Fireball');
  assert.equal(swapped.system.rank, 2);
});

/* -------------------------------------------- */

/**
 * A spell or scroll on a crawler, prepared by the real data models.
 * @param {'spell'|'spellScroll'} type
 */
async function owned(type, { rank = 5, effects = [] } = {}) {
  const Model = type === 'spellScroll' ? CarlRPGSpellScroll : CarlRPGSpell;
  const system = Object.create(Model.prototype);
  Object.assign(system, {
    rank,
    stat: 'int',
    identifier: type === 'spell' ? 'frost-bolt' : '',
    tags: ['ice'],
    upgrades: [],
    damage: '@rankDamage',
    costs: [{ resource: 'mana', amount: '3' }],
    manaCost: 0,
    check: { target: 'evade' },
    damageType: '',
    armorPiercing: false,
  });
  const item = makeItem({ type, name: type === 'spell' ? 'Frost Bolt' : 'Scroll of Frost Bolt', system });
  system.parent = item;
  const actor = await makeCrawler({ items: [item], effects });
  system.prepareDerivedData();
  return { item, system, actor };
}

const rankBonus = (amount, kind = 'skillRankBonus') =>
  makeEffect({ flags: { buildMods: [{ kind, target: 'all', value: '', amount }] } });

test('a scroll casts at exactly its own rank: rank bonuses and penalties never touch it', async () => {
  const effects = [rankBonus(3)];
  const spell = await owned('spell', { rank: 5, effects });
  const scroll = await owned('spellScroll', { rank: 5, effects });
  assert.equal(spell.system.effectiveRank, 8);
  assert.equal(scroll.system.effectiveRank, 5);
  assert.equal(scroll.system.rankBonus, 0);

  const penalty = [rankBonus(-2)];
  assert.equal((await owned('spell', { rank: 5, effects: penalty })).system.effectiveRank, 3);
  assert.equal((await owned('spellScroll', { rank: 5, effects: penalty })).system.effectiveRank, 5);
});

test('a scroll\'s rank is its own, even on a pet\'s floor', async () => {
  const scroll = await owned('spellScroll', { rank: 4 });
  const pet = makeActor({ type: 'pet', items: [scroll.item] });
  scroll.item.parent = pet;
  scroll.system.prepareDerivedData();
  assert.equal(scroll.system.rank, 4);
  assert.equal(scroll.system.effectiveRank, 4);
});

test('the rank damage dice follow the scroll rank, not the owner\'s rank damage rows', async () => {
  const effects = [rankBonus(6, 'rankDamageBonus')];
  const plain = rankDamageOf((await owned('spell', { rank: 4 })).item);
  const boosted = rankDamageOf((await owned('spell', { rank: 4, effects })).item);
  const scroll = rankDamageOf((await owned('spellScroll', { rank: 4, effects })).item);
  assert.notEqual(boosted, plain);
  assert.equal(scroll, plain);
  assert.notEqual(scroll, '');
});

test('the scroll formula uses its stat and rank', async () => {
  const scroll = await owned('spellScroll', { rank: 6 });
  assert.equal(scroll.system.formula, '1d20 + @int.mod + 6');
});

/* -------------------------------------------- */

test('a Roll Modifier list that names the spell also covers a scroll of it', () => {
  const scroll = { name: 'Scroll of Frost Bolt', system: { identifier: '', tags: [], spellSource: { name: 'Frost Bolt', identifier: 'frost-bolt' } } };
  assert.ok(listAccepts(listEntries('Frost Bolt'), scroll));
  assert.ok(listAccepts(listEntries('frost-bolt'), scroll));
  assert.ok(!listAccepts(listEntries('Fireball'), scroll));
  // tags work as they do for any item
  const tagged = { ...scroll, system: { ...scroll.system, tags: ['ice'] } };
  assert.ok(listAccepts(listEntries('#ice'), tagged));
});

/* -------------------------------------------- */

const asPlayer = () => {
  game.user = { id: 'p1', isGM: false };
};

function onActor(type, hotlist) {
  const item = makeItem({ type, name: type, system: {} });
  const actor = makeActor({ type: 'crawler', items: [item], system: { hotlist } });
  item.parent = actor;
  return item;
}

test('Hotlist-only spells: a scroll must be on the hotlist itself', () => {
  world.settings.hotlistOnlySpells = true;
  asPlayer();
  const scroll = onActor('spellScroll', { size: 3, items: [] });
  assert.equal(castBlockedByHotlist(scroll), true);
  scroll.parent.system.hotlist.items = ['other', scroll.id];
  assert.equal(castBlockedByHotlist(scroll), false);
  // a slot beyond the hotlist size does not count
  scroll.parent.system.hotlist = { size: 1, items: ['other', scroll.id] };
  assert.equal(castBlockedByHotlist(scroll), true);
});

test('Hotlist-only spells: spells still blocked, other items and the GM not', () => {
  world.settings.hotlistOnlySpells = true;
  asPlayer();
  assert.equal(castBlockedByHotlist(onActor('spell', { size: 3, items: [] })), true);
  assert.equal(castBlockedByHotlist(onActor('item', { size: 3, items: [] })), false);
  game.user = { id: 'gm', isGM: true };
  assert.equal(castBlockedByHotlist(onActor('spellScroll', { size: 3, items: [] })), false);
});

test('Hotlist-only spells off: nothing is blocked', () => {
  world.settings.hotlistOnlySpells = false;
  asPlayer();
  assert.equal(castBlockedByHotlist(onActor('spellScroll', { size: 3, items: [] })), false);
});
