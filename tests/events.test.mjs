import { world, makeActor, makeItem, makeEffect, makeCrawler, setCombat } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  runEvents,
  runActorEvents,
  runFloorRules,
  isPhaseExecutor,
  checkRequirements,
} from '../module/helpers/events.mjs';
import { usesLeft, isLimited, spendUse, restoreUses, RECHARGE_BY_REST } from '../module/helpers/uses.mjs';
import { tickDurations, endCombatEffects } from '../module/helpers/effect-duration.mjs';

beforeEach(() => world.reset());

/** An event that gives the owner 1 AI Favor, so a count of how often it ran is on the actor. */
const favor = (over = {}) => ({
  id: over.id ?? 'e1',
  enabled: true,
  trigger: 'used',
  phase: 'any',
  conditions: [],
  match: 'all',
  actions: [{ type: 'aiFavor', mode: 'award', amount: '1' }],
  ...over,
});

const skillWith = (events, system = {}) =>
  makeItem({ type: 'skill', name: 'Skill', system: { rank: 1, events, upgrades: [], ...system } });

const crawlerWith = (item, extra = {}) =>
  makeCrawler({ items: [item], system: { aiFavor: 0 }, ...extra });

const ran = (actor) => actor.system.aiFavor;

const roll = (total, natural = 10) => ({ total, dice: [{ results: [{ result: natural }] }] });

/* -------------------------------------------- */
/*  Triggers                                    */
/* -------------------------------------------- */

test('only enabled events for the trigger run', async () => {
  const item = skillWith([
    favor({ id: 'a' }),
    favor({ id: 'b', enabled: false }),
    favor({ id: 'c', trigger: 'hit' }),
  ]);
  const crawler = await crawlerWith(item);
  await runActorEvents(crawler, 'used');
  assert.equal(ran(crawler), 1);
});

test('phase events run in their own phase, or any', async () => {
  const item = skillWith([
    favor({ id: 'a', trigger: 'phaseStart', phase: 'action' }),
    favor({ id: 'b', trigger: 'phaseStart', phase: 'react' }),
    favor({ id: 'c', trigger: 'phaseStart', phase: 'any' }),
  ]);
  const crawler = await crawlerWith(item);
  await runActorEvents(crawler, 'phaseStart', { phase: 'action' });
  assert.equal(ran(crawler), 2);
});

test('an effect\'s events run while it is on, not while it is off', async () => {
  const on = makeEffect({ name: 'On', flags: { events: [favor({ id: 'on' })] } });
  const off = makeEffect({ name: 'Off', flags: { events: [favor({ id: 'off' })] }, disabled: true });
  const crawler = await makeCrawler({ effects: [on, off], system: { aiFavor: 0 } });
  await runActorEvents(crawler, 'used');
  assert.equal(ran(crawler), 1);
});

test('upgrade events run only once the skill has reached the upgrade', async () => {
  const upgraded = (rank) =>
    skillWith([], { rank, upgrades: [{ id: 'u', rank: 5, changes: [], events: [favor({ id: 'u1' })] }] });
  const low = await crawlerWith(upgraded(4));
  await runActorEvents(low, 'used');
  assert.equal(ran(low), 0);
  const reached = await crawlerWith(upgraded(5));
  await runActorEvents(reached, 'used');
  assert.equal(ran(reached), 1);
});

test('a pet\'s upgrade events run at its level', async () => {
  const say = { type: 'message', text: '{name} growls' };
  const pet = (level) =>
    makeActor({
      type: 'pet',
      name: 'Rex',
      system: {
        attributes: { level: { value: level } },
        upgrades: [{ id: 'p', rank: 15, changes: [], events: [favor({ actions: [say] })] }],
      },
    });
  await runActorEvents(pet(14), 'used');
  assert.equal(world.chat.length, 0);
  await runActorEvents(pet(15), 'used');
  assert.equal(world.chat.length, 1);
  assert.match(world.chat[0].content, /Rex growls/);
});

test('an event stops at the depth limit', async () => {
  const item = skillWith([favor()]);
  const crawler = await crawlerWith(item);
  const max = CONFIG.CARL_RPG.maxEventDepth;
  await runEvents(item, 'used', { depth: max });
  assert.equal(ran(crawler), 0);
  assert.equal(world.warnings.length, 1);
  await runEvents(item, 'used', { depth: max - 1 });
  assert.equal(ran(crawler), 1);
});

/* -------------------------------------------- */
/*  Conditions                                  */
/* -------------------------------------------- */

/** Whether an event with these conditions fires (a fresh crawler each time). */
async function fires(conditions, ctx = {}, { match = 'all', actor = {} } = {}) {
  const item = skillWith([favor({ conditions, match })]);
  const crawler = await crawlerWith(item, actor);
  await runEvents(item, 'used', { actor: crawler, ...ctx });
  return ran(crawler) === 1;
}

test('roll conditions look at the total and the first d20', async () => {
  assert.equal(await fires([{ type: 'rollMin', value: 15 }], { roll: roll(15) }), true);
  assert.equal(await fires([{ type: 'rollMin', value: 15 }], { roll: roll(14) }), false);
  assert.equal(await fires([{ type: 'rollMax', value: 5 }], { roll: roll(5) }), true);
  assert.equal(await fires([{ type: 'rollMax', value: 5 }], { roll: roll(6) }), false);
  assert.equal(await fires([{ type: 'nat20' }], { roll: roll(25, 20) }), true);
  assert.equal(await fires([{ type: 'nat20' }], { roll: roll(25, 19) }), false);
  assert.equal(await fires([{ type: 'nat1' }], { roll: roll(2, 1) }), true);
  assert.equal(await fires([{ type: 'rollMin', value: 1 }], {}), false); // no roll, no match
});

test('a degree condition matches this target\'s degree, or any target\'s on "used"', async () => {
  const cond = [{ type: 'degree', degree: 'amazing' }];
  assert.equal(await fires(cond, { degree: 'amazing' }), true);
  assert.equal(await fires(cond, { degree: 'success' }), false);
  assert.equal(await fires(cond, { degrees: ['fail', 'amazing'] }), true);
  assert.equal(await fires(cond, { degrees: ['fail'] }), false);
});

test('stat, mana, health and floor conditions', async () => {
  assert.equal(await fires([{ type: 'stat', stat: 'str', value: 6 }], {}, { actor: { abilities: { str: 6 } } }), true);
  assert.equal(await fires([{ type: 'stat', stat: 'str', value: 7 }], {}, { actor: { abilities: { str: 6 } } }), false);
  assert.equal(await fires([{ type: 'mana', value: 3 }], {}, { actor: { abilities: { int: 9 }, system: { mana: { value: 3 } } } }), true);
  assert.equal(await fires([{ type: 'mana', value: 3 }], {}, { actor: { system: { mana: { value: 2 } } } }), false);
  assert.equal(await fires([{ type: 'health', value: 4 }], {}, { actor: { system: { health: { value: 4 } } } }), true);
  assert.equal(await fires([{ type: 'health', value: 4 }], {}, { actor: { system: { health: { value: 5 } } } }), false);
  world.settings.floor = 3;
  assert.equal(await fires([{ type: 'floor', value: 3 }]), true);
  assert.equal(await fires([{ type: 'floor', value: 4 }]), false);
  assert.equal(await fires([{ type: 'floorExact', value: 3 }]), true);
  world.settings.floor = 4;
  assert.equal(await fires([{ type: 'floorExact', value: 3 }]), false);
});

test('a rest condition means "at least" that rest', async () => {
  const cond = [{ type: 'restKind', text: 'short' }];
  assert.equal(await fires(cond, { rest: 'short' }), true);
  assert.equal(await fires(cond, { rest: 'long' }), true);
  const long = [{ type: 'restKind', text: 'long' }];
  assert.equal(await fires(long, { rest: 'short' }), false);
  assert.equal(await fires(long, {}), false);
});

test('phase and in-combat conditions need a running combat', async () => {
  assert.equal(await fires([{ type: 'phase', phase: 'action' }]), false);
  assert.equal(await fires([{ type: 'inCombat' }]), false);
  setCombat({ phase: 'action' });
  assert.equal(await fires([{ type: 'phase', phase: 'action' }]), true);
  assert.equal(await fires([{ type: 'phase', phase: 'react' }]), false);
  assert.equal(await fires([{ type: 'phase', phase: 'any' }]), true);
});

test('conditions can be negated, and an event can need all of them or any', async () => {
  assert.equal(await fires([{ type: 'rollMin', value: 15, negate: true }], { roll: roll(10) }), true);
  const both = [{ type: 'rollMin', value: 15 }, { type: 'nat20' }];
  assert.equal(await fires(both, { roll: roll(16, 12) }), false);
  assert.equal(await fires(both, { roll: roll(16, 12) }, { match: 'any' }), true);
  assert.equal(await fires(both, { roll: roll(5, 3) }, { match: 'any' }), false);
  assert.equal(await fires([{ type: 'chance', value: 100 }]), true);
  assert.equal(await fires([{ type: 'chance', value: 0 }]), false);
  assert.equal(await fires([{ type: 'nonsense' }]), false);
});

/* -------------------------------------------- */
/*  Requirements                                */
/* -------------------------------------------- */

test('requirements block use and say why', async () => {
  const item = skillWith([], { requirements: [{ type: 'mana', value: 5 }, { type: 'gold', value: 10 }] });
  const crawler = await crawlerWith(item, { system: { mana: { value: 4 }, gold: 10 } });
  assert.equal(checkRequirements(item), false);
  assert.equal(world.warnings.length, 1);
  crawler.system.mana.value = 5;
  assert.equal(checkRequirements(item), true);
  crawler.system.gold = 9;
  assert.equal(checkRequirements(item), false);
});

/* -------------------------------------------- */
/*  Who runs the events                         */
/* -------------------------------------------- */

const player = { id: 'p1', name: 'Player', isGM: false, active: true };

test('the GM covering a player\'s crawler only runs events a GM approved', async () => {
  const run = async (trusted) => {
    world.reset();
    const item = skillWith([favor()], { eventsTrusted: trusted });
    const crawler = await crawlerWith(item, { owners: ['p1'] });
    game.users.push(game.user, player);
    await runActorEvents(crawler, 'used');
    return ran(crawler);
  };
  assert.equal(await run(false), 0);
  assert.equal(await run(true), 1);
});

test('the owner\'s own client runs its events without approval', async () => {
  const item = skillWith([favor()], { eventsTrusted: false });
  const crawler = await crawlerWith(item, { owners: ['p1'] });
  game.users.push(game.user, player);
  game.user = player;
  await runActorEvents(crawler, 'used');
  assert.equal(ran(crawler), 1);
});

test('phase and round events run on the first connected owner\'s client, else the GM\'s', async () => {
  const crawler = await makeCrawler({ owners: ['p1'] });
  const players = [player];
  const gmUser = game.user;
  game.users.activeGM = gmUser;
  assert.equal(isPhaseExecutor(crawler, players), false); // the GM's client leaves it to the owner
  game.user = player;
  assert.equal(isPhaseExecutor(crawler, players), true);

  game.user = gmUser;
  const unowned = await makeCrawler({ owners: [] });
  assert.equal(isPhaseExecutor(unowned, players), true); // nobody owns it: the GM runs it
  assert.equal(isPhaseExecutor(unowned, []), true);
});

test('an actor with nothing to run for a trigger costs no permission look-ups', async () => {
  const item = skillWith([favor({ trigger: 'hit' })]);
  const crawler = await crawlerWith(item, { owners: ['p1'] });
  game.users.push(game.user, player);
  let looked = 0;
  const real = crawler.testUserPermission;
  crawler.testUserPermission = (...args) => {
    looked++;
    return real(...args);
  };
  await runActorEvents(crawler, 'used');
  assert.equal(looked, 0);
  await runActorEvents(crawler, 'hit');
  assert.ok(looked > 0);
});

/* -------------------------------------------- */
/*  Floor rules                                 */
/* -------------------------------------------- */

test('a floor rule with no target affects every crawler, on its floor only', async () => {
  const a = await makeCrawler({ name: 'A', system: { aiFavor: 0 } });
  const b = await makeCrawler({ name: 'B', system: { aiFavor: 0 } });
  const mob = makeActor({ type: 'mob', name: 'M', system: {} });
  game.actors.push(a, b, mob);
  world.settings.floorRules = [
    favor({ id: 'r', trigger: 'roundEnd', conditions: [{ type: 'floorExact', value: 3 }] }),
  ];
  world.settings.floor = 2;
  await runFloorRules('roundEnd');
  assert.deepEqual([ran(a), ran(b)], [0, 0]);
  world.settings.floor = 3;
  await runFloorRules('roundEnd');
  assert.deepEqual([ran(a), ran(b)], [1, 1]);
  await runFloorRules('combatEnd'); // another trigger
  assert.deepEqual([ran(a), ran(b)], [1, 1]);
});

/* -------------------------------------------- */
/*  Usage limits                                */
/* -------------------------------------------- */

const limited = (name, uses) => makeItem({ type: 'gear', name, system: { uses } });

test('uses: no limit is unlimited, otherwise max - spent', () => {
  assert.equal(isLimited(limited('a', { max: 0, spent: 0, recharge: 'never' })), false);
  assert.equal(usesLeft(limited('a', { max: 0, spent: 0, recharge: 'never' })), Infinity);
  assert.equal(usesLeft(limited('b', { max: 3, spent: 1, recharge: 'round' })), 2);
  assert.equal(usesLeft(limited('c', { max: 3, spent: 9, recharge: 'round' })), 0);
});

test('spending a use counts up and stops at the limit', async () => {
  const wand = limited('Wand', { max: 2, spent: 0, recharge: 'round' });
  await makeCrawler({ items: [wand] });
  await spendUse(wand);
  await spendUse(wand);
  await spendUse(wand); // none left: nothing happens
  assert.equal(wand.system.uses.spent, 2);
  const plain = limited('Plain', { max: 0, spent: 0, recharge: 'never' });
  await spendUse(plain);
  assert.equal(plain.system.uses.spent, 0);
});

test('a longer rest gives back what a shorter one does', () => {
  assert.deepEqual(RECHARGE_BY_REST.short, ['short']);
  assert.deepEqual(RECHARGE_BY_REST.long, ['short', 'long']);
  assert.deepEqual(RECHARGE_BY_REST.full, ['short', 'long', 'full']);
});

test('uses come back only for the recharge that came round', async () => {
  const items = ['round', 'combat', 'floor', 'short', 'never'].map((r) =>
    limited(r, { max: 2, spent: 2, recharge: r })
  );
  const spare = limited('unspent', { max: 2, spent: 0, recharge: 'round' });
  const crawler = await makeCrawler({ items: [...items, spare] });
  await restoreUses(crawler, ['round']);
  const left = Object.fromEntries(items.map((i) => [i.name, i.system.uses.spent]));
  assert.deepEqual(left, { round: 0, combat: 2, floor: 2, short: 2, never: 2 });
  await restoreUses(crawler, ['round', 'combat']);
  assert.equal(items[1].system.uses.spent, 0);
  await restoreUses(crawler, RECHARGE_BY_REST.short);
  assert.equal(items[3].system.uses.spent, 0);
  assert.equal(items[4].system.uses.spent, 2); // "never" never comes back
});

/* -------------------------------------------- */
/*  Effect durations                            */
/* -------------------------------------------- */

test('an effect that lasts rounds counts down at each round end, then ends with a note', async () => {
  const timed = makeEffect({ name: 'Burning', flags: { rounds: 2 } });
  const open = makeEffect({ name: 'Blessed', flags: {} });
  const off = makeEffect({ name: 'Old', flags: { rounds: 1 }, disabled: true });
  const crawler = await makeCrawler({ effects: [timed, open, off] });

  await tickDurations(crawler);
  assert.equal(timed.disabled, false);
  assert.equal(timed.getFlag('carl-rpg', 'roundsLeft'), 1);
  assert.equal(world.chat.length, 0);

  await tickDurations(crawler);
  assert.equal(timed.disabled, true);
  assert.equal(timed.getFlag('carl-rpg', 'roundsLeft'), undefined);
  assert.equal(world.chat.length, 1);
  assert.match(world.chat[0].content, /Burning/);
  assert.equal(open.disabled, false);
  assert.equal(off.getFlag('carl-rpg', 'roundsLeft'), undefined); // a switched-off effect isn't counted
});

test('effects that last until the end of the combat end with it', async () => {
  const combatLong = makeEffect({ name: 'Rage', flags: { lastsUntil: 'combat' } });
  const restLong = makeEffect({ name: 'Wound', flags: { lastsUntil: 'long' } });
  const crawler = await makeCrawler({ effects: [combatLong, restLong] });
  await endCombatEffects(crawler);
  assert.equal(combatLong.disabled, true);
  assert.equal(restLong.disabled, false);
});
