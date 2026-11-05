import { world, makeActor, makeItem, makeEffect, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  stepDice,
  unlockedUpgrades,
  computeEffective,
  computePetUpgrades,
} from '../module/helpers/upgrades.mjs';
import {
  getPartyName,
  setPartyName,
  getTitle,
  setTitle,
  setLeader,
  getLeader,
  isLeader,
  canManageParty,
  partyMembers,
} from '../module/helpers/party.mjs';
import { restActor } from '../module/helpers/rests.mjs';
import { applyInjury } from '../module/helpers/attacks.mjs';

beforeEach(() => world.reset());

const NS = 'carl-rpg';
const player = { id: 'p1', name: 'Player', isGM: false, active: true };

/* -------------------------------------------- */
/*  Upgrades                                    */
/* -------------------------------------------- */

test('stepping dice moves every die along d4, d6, d8, d10, d12, d20 and stops at the ends', () => {
  assert.equal(stepDice('1d6', 1), '1d8');
  assert.equal(stepDice('2d6 + 3', 2), '2d10 + 3');
  assert.equal(stepDice('1d6 + 1d4', 1), '1d8 + 1d6');
  assert.equal(stepDice('1d12', 1), '1d20');
  assert.equal(stepDice('1d20', 3), '1d20');
  assert.equal(stepDice('1d4', -2), '1d4');
  assert.equal(stepDice('1d6', -1), '1d4');
  assert.equal(stepDice('1d100', 1), '1d100'); // a size that isn't on the ladder is left alone
  assert.equal(stepDice('1d6', 0), '1d6');
});

const spell = (rank, upgrades) => ({
  rank,
  damage: '1d6',
  manaCost: 3,
  check: { target: 'evade' },
  upgrades,
});

const ladder = [
  { id: 'a', rank: 5, changes: [{ type: 'damageAdd', value: '1d4' }] },
  { id: 'b', rank: 10, changes: [{ type: 'dieStep', value: '1' }] },
  { id: 'c', rank: 15, changes: [{ type: 'manaCost', value: '-1' }, { type: 'rollBonus', value: '2' }] },
  { id: 'd', rank: 20, changes: [{ type: 'rollTarget', value: 'size' }] },
];

test('upgrades are cumulative, applied in rank order, and worked out from the current rank', () => {
  const at = (rank) => computeEffective(spell(rank, ladder));
  assert.deepEqual(
    [at(4).damage, at(4).manaCost, at(4).rollBonus, at(4).target],
    ['1d6', 3, 0, 'evade']
  );
  assert.equal(at(5).damage, '1d6 + 1d4');
  assert.equal(at(10).damage, '1d8 + 1d6'); // every die steps up, the earlier addition too
  assert.deepEqual([at(15).manaCost, at(15).rollBonus], [2, 2]);
  assert.equal(at(20).target, 'size');
  assert.deepEqual(at(10).unlocked, ['a', 'b']);
  // Lowering the rank undoes them again: nothing was written to the spell.
  assert.equal(at(4).damage, '1d6');
});

test('upgrades listed out of order still apply lowest rank first', () => {
  const system = spell(10, [...ladder].reverse());
  assert.deepEqual(unlockedUpgrades(system).map((u) => u.id), ['a', 'b']);
  assert.equal(computeEffective(system).damage, '1d8 + 1d6');
});

test('a replacement formula wins, mana never goes below 0, and unusable changes are skipped', () => {
  const system = {
    rank: 5,
    damage: '1d6',
    manaCost: 1,
    check: { target: 'unopposed' },
    upgrades: [
      {
        id: 'x',
        rank: 5,
        changes: [
          { type: 'damageReplace', value: '2d8' },
          { type: 'manaCost', value: '-5' },
          { type: 'damageAdd', value: '!!' }, // not a formula
          { type: 'rollTarget', value: 'bogus' }, // not a target
          { type: 'dieStep', value: 'x' }, // not a number
        ],
      },
    ],
  };
  const eff = computeEffective(system);
  assert.equal(eff.damage, '2d8');
  assert.equal(eff.manaCost, 0);
  assert.equal(eff.target, 'unopposed');
  assert.equal(eff.rollBonus, 0);
});

test('a pet\'s upgrades add bonuses, step its size and give skills, at its level', () => {
  const upgrades = [
    {
      id: 'p1',
      rank: 15,
      changes: [
        { type: 'statBonus', stat: 'str', value: '2' },
        { type: 'sizeStep', value: '1' },
        { type: 'evade', value: '1' },
        { type: 'actions', value: '1' },
      ],
      grants: ['Item.Bite'],
    },
    { id: 'p2', rank: 30, changes: [{ type: 'statBonus', stat: 'str', value: '5' }], grants: ['Item.Bite', 'Item.Roar'] },
  ];
  const at = (level, size = 'small') =>
    computePetUpgrades({ attributes: { level: { value: level } }, size, upgrades });
  const none = at(14);
  assert.deepEqual([none.bonuses, none.size, none.grants], [{}, 'small', []]);
  const first = at(15);
  assert.deepEqual(first.bonuses, { str: 2, evade: 1, actions: 1 });
  assert.equal(first.size, 'petite'); // small -> petite
  assert.deepEqual(first.grants, ['Item.Bite']);
  const both = at(30);
  assert.equal(both.bonuses.str, 7);
  assert.deepEqual(both.grants, ['Item.Bite', 'Item.Roar']); // a skill given twice is listed once
  // Size steps stop at the ends of the list.
  const huge = computePetUpgrades({
    attributes: { level: { value: 15 } },
    size: 'colossal',
    upgrades: [{ id: 's', rank: 1, changes: [{ type: 'sizeStep', value: '9' }] }],
  });
  assert.equal(huge.size, 'gargantuan');
});

/* -------------------------------------------- */
/*  Party                                       */
/* -------------------------------------------- */

test('the party has a default name until the GM names it', async () => {
  assert.equal(getPartyName(), 'CARL_RPG.GMTab.DefaultParty');
  await setPartyName('  The Misfits ');
  assert.equal(getPartyName(), 'The Misfits');
});

test('titles belong to crawlers, are trimmed and capped, and clear when emptied', async () => {
  const carl = await makeCrawler({ name: 'Carl', id: 'carl' });
  const mob = makeActor({ type: 'mob', name: 'Goblin', id: 'gob' });
  game.actors.push(carl, mob);
  await setTitle('carl', '  Prince  ');
  assert.equal(getTitle(carl), 'Prince');
  await setTitle('carl', 'x'.repeat(60));
  assert.equal(getTitle(carl).length, 40);
  await setTitle('gob', 'Lord'); // not a crawler: ignored
  assert.equal(getTitle(mob), '');
  await setTitle('carl', '   ');
  assert.equal(getTitle(carl), '');
  assert.equal(world.settings.partyTitles.carl, undefined);
});

test('the party lists its crawlers by name with their titles', async () => {
  const b = await makeCrawler({ name: 'Bea', id: 'b' });
  const a = await makeCrawler({ name: 'Al', id: 'a' });
  game.actors.push(b, makeActor({ type: 'mob', name: 'Zed' }), a);
  await setTitle('a', 'Chief');
  assert.deepEqual(partyMembers(), [
    { id: 'a', name: 'Al', title: 'Chief' },
    { id: 'b', name: 'Bea', title: '' },
  ]);
});

test('the leader is the player who owns the leader crawler; only they and the GM manage the party', async () => {
  const carl = await makeCrawler({ name: 'Carl', id: 'carl', owners: ['p1'] });
  const mob = makeActor({ type: 'mob', name: 'Goblin', id: 'gob', owners: ['p1'] });
  game.actors.push(carl, mob);
  await setLeader('gob'); // a mob can't lead
  assert.equal(getLeader(), null);
  await setLeader('carl');
  assert.equal(getLeader(), carl);
  assert.equal(isLeader(player), true);
  assert.equal(isLeader({ id: 'p2', isGM: false }), false);
  assert.equal(isLeader(game.user), false); // the GM is not "a leader"
  assert.equal(canManageParty(player), true);
  assert.equal(canManageParty({ id: 'p2', isGM: false }), false);
  assert.equal(canManageParty(game.user), true);
});

test('a leader\'s changes go to the GM\'s client instead of being made directly', async () => {
  const carl = await makeCrawler({ name: 'Carl', id: 'carl', owners: ['p1'] });
  game.actors.push(carl);
  await setLeader('carl');
  const gmUser = game.user;
  game.users.activeGM = gmUser;
  const sent = [];
  game.socket.emit = (channel, message) => sent.push(message);
  game.user = player;
  await setPartyName('Rebels');
  await setTitle('carl', 'Boss');
  assert.equal(world.settings.partyName, undefined); // nothing was changed here
  assert.deepEqual(sent.map((m) => m.change.kind), ['name', 'title']);
  game.socket.emit = () => {};
  // Someone who isn't the leader can't ask at all.
  game.user = { id: 'p2', isGM: false };
  sent.length = 0;
  game.socket.emit = (channel, message) => sent.push(message);
  await setPartyName('Hijack');
  assert.equal(sent.length, 0);
});

/* -------------------------------------------- */
/*  Rests                                       */
/* -------------------------------------------- */

/** A crawler with Int 20 (20 mana) and the health and mana set. */
async function restingCrawler({ health = 3, mana = 4, items = [], effects = [] } = {}) {
  const crawler = await makeCrawler({ abilities: { int: 20 }, items, effects });
  crawler.system.health.value = health;
  crawler.system.mana.value = mana;
  return crawler;
}

test('a short rest heals 5 health boxes and half the total mana (rounded down)', async () => {
  const crawler = await restingCrawler({ health: 3, mana: 4 });
  await restActor(crawler, 'short');
  assert.equal(crawler.system.health.value, 8);
  assert.equal(crawler.system.mana.value, 14);
  await restActor(crawler, 'short'); // health stops at 10; mana at its maximum
  assert.equal(crawler.system.health.value, 10);
  assert.equal(crawler.system.mana.value, 20);
  assert.equal(world.chat.length, 2);
});

test('half of an odd mana total is rounded down', async () => {
  const crawler = await makeCrawler({ abilities: { int: 15 } });
  crawler.system.health.value = 10;
  await restActor(crawler, 'short');
  assert.equal(crawler.system.mana.value, 7);
});

test('long and full rests restore everything, and a rest never lowers what you have', async () => {
  for (const rest of ['long', 'full']) {
    const crawler = await restingCrawler({ health: 1, mana: 0 });
    await restActor(crawler, rest);
    assert.deepEqual([crawler.system.health.value, crawler.system.mana.value], [10, 20], rest);
  }
  const over = await restingCrawler({ health: 10, mana: 25 }); // mana above its maximum
  await restActor(over, 'long');
  assert.equal(over.system.mana.value, 25);
});

test('a rest ends the effects that last until it or a shorter one', async () => {
  const mk = (name, lastsUntil) => makeEffect({ name, flags: lastsUntil ? { lastsUntil } : {} });
  const effects = () => [mk('short', 'short'), mk('long', 'long'), mk('full', 'full'), mk('combat', 'combat'), mk('open')];
  const left = async (rest) => {
    const crawler = await restingCrawler({ effects: effects() });
    await restActor(crawler, rest);
    return crawler.effects.map((e) => e.name);
  };
  assert.deepEqual(await left('short'), ['long', 'full', 'combat', 'open']);
  assert.deepEqual(await left('long'), ['full', 'combat', 'open']);
  assert.deepEqual(await left('full'), ['combat', 'open']);
});

test('a rest gives back uses and runs the rest events', async () => {
  const wand = makeItem({
    type: 'gear',
    name: 'Wand',
    system: {
      uses: { max: 2, spent: 2, recharge: 'long' },
      events: [
        {
          id: 'e',
          enabled: true,
          trigger: 'restTaken',
          phase: 'any',
          conditions: [{ type: 'restKind', text: 'long' }],
          match: 'all',
          actions: [{ type: 'aiFavor', mode: 'award', amount: '1' }],
        },
      ],
    },
  });
  const crawler = await makeCrawler({ items: [wand], system: { aiFavor: 0 } });
  await restActor(crawler, 'short');
  assert.deepEqual([wand.system.uses.spent, crawler.system.aiFavor], [2, 0]); // a short rest isn't enough
  await restActor(crawler, 'long');
  assert.deepEqual([wand.system.uses.spent, crawler.system.aiFavor], [0, 1]);
});

test('players can only rest in a safe room, unless the GM allows it', async () => {
  const crawler = await restingCrawler();
  game.user = player;
  await restActor(crawler, 'long');
  assert.equal(crawler.system.health.value, 3);
  assert.equal(world.warnings.length, 1);

  world.settings.floorState = 'safe';
  await restActor(crawler, 'long');
  assert.equal(crawler.system.health.value, 10);

  const other = await restingCrawler();
  world.settings.floorState = 'exploring';
  world.settings.restsOutsideSafeRoom = true;
  await restActor(other, 'long');
  assert.equal(other.system.health.value, 10);
});

test('only an owner can rest a crawler', async () => {
  const crawler = await restingCrawler();
  crawler.isOwner = false;
  await restActor(crawler, 'long');
  assert.equal(crawler.system.health.value, 3);
});

/* -------------------------------------------- */
/*  Injuries                                    */
/* -------------------------------------------- */

const STATS = ['str', 'int', 'con', 'dex', 'cha'];

test('a Minor Injury is -2 to all five stats until a short rest; a Major one is -5 until a long rest', async () => {
  const crawler = await makeCrawler();
  await applyInjury(crawler, 'minor');
  await applyInjury(crawler, 'major');
  const [minor, major] = crawler.effects;
  assert.equal(crawler.effects.length, 2); // a Minor and a Major are separate effects
  assert.deepEqual(minor.changes.map((c) => c.key).sort(), STATS.map((s) => `system.bonuses.${s}`).sort());
  assert.ok(minor.changes.every((c) => c.value === '-2'));
  assert.ok(major.changes.every((c) => c.value === '-5'));
  assert.equal(minor.getFlag(NS, 'lastsUntil'), 'short');
  assert.equal(major.getFlag(NS, 'lastsUntil'), 'long');
});

test('the same injury does not stack, but lasts longer', async () => {
  const crawler = await makeCrawler();
  await applyInjury(crawler, 'minor');
  await applyInjury(crawler, 'minor');
  assert.equal(crawler.effects.length, 1);
  assert.equal(crawler.effects[0].getFlag(NS, 'lastsUntil'), 'long'); // short -> long
  const chats = world.chat.length;
  await applyInjury(crawler, 'minor'); // already as long as it gets
  assert.equal(crawler.effects[0].getFlag(NS, 'lastsUntil'), 'long');
  assert.equal(world.chat.length, chats);

  const other = await makeCrawler();
  await applyInjury(other, 'major');
  await applyInjury(other, 'major');
  assert.equal(other.effects.length, 1);
  assert.equal(other.effects[0].getFlag(NS, 'lastsUntil'), 'full'); // long -> full
});

test('an unknown injury does nothing', async () => {
  const crawler = await makeCrawler();
  await applyInjury(crawler, 'catastrophic');
  assert.equal(crawler.effects.length, 0);
});

/* -------------------------------------------- */
/*  Level-up points                             */
/* -------------------------------------------- */

test('a crawler earns 3 stat points a level after the first, and can spend them from floor 3', async () => {
  const crawler = await makeCrawler({ system: { attributes: { level: { value: 4 } }, statPointsSpent: 2 } });
  assert.deepEqual(
    { ...crawler.system.points },
    { earned: 9, spent: 2, available: 7, canSpend: false }
  );
  world.settings.floor = 3;
  const later = await makeCrawler({ system: { attributes: { level: { value: 1 } } } });
  assert.deepEqual({ ...later.system.points }, { earned: 0, spent: 0, available: 0, canSpend: true });
});

test('a new crawler starts with a Move of 20 and a Step of 10, 2 actions, and mana equal to Intelligence', async () => {
  const crawler = await makeCrawler({ abilities: { int: 6 }, bonuses: { mana: 2, move: 5, actions: 1 } });
  assert.equal(crawler.system.move.total, 25);
  assert.equal(crawler.system.move.step, 10);
  assert.equal(crawler.system.actions.max, 3);
  assert.equal(crawler.system.mana.max, 8); // Int 6 plus 2 from effects
});

test('mana cost changes add up to a delta, whatever the costs are (formulas, ranges)', () => {
  const system = {
    rank: 5,
    costs: [{ resource: 'mana', amount: '@int.mod', max: '@int.mod + 2' }],
    upgrades: [
      { id: 'a', rank: 5, changes: [{ type: 'manaCost', value: '-1' }] },
      { id: 'b', rank: 5, changes: [{ type: 'manaCost', value: '3' }] },
    ],
  };
  assert.equal(computeEffective(system).manaDelta, 2);
  assert.equal(computeEffective({ rank: 1, costs: [], upgrades: [] }).manaDelta, 0);
});
