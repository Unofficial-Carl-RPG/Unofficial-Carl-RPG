import { world, makeActor, makeItem, makeEffect, makeCrawler, setCombat } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAG,
  advance,
  dealEntry,
  makeEntry,
  planDelayed,
  queueDelayed,
  queueOf,
  tickDelayed,
} from '../module/helpers/delayed-damage.mjs';
import { expandRankDamage } from '../module/helpers/rank-damage.mjs';
import { runEvents, groupActors } from '../module/helpers/events.mjs';
import { applyActionDefaults, newAction } from '../module/helpers/event-editor.mjs';
import { summarizeAction } from '../module/helpers/event-summary.mjs';
import { CarlRPGActor } from '../module/documents/actor.mjs';

beforeEach(() => world.reset());

const NS = 'carl-rpg';

/** A combat that keeps its flags, like a real one. */
function combatWithFlags() {
  const combat = setCombat();
  combat.flags = {};
  combat.setFlag = async (scope, key, value) => {
    combat.flags[scope] ??= {};
    combat.flags[scope][key] = value;
  };
  return combat;
}

/** The real damage rules on a stub actor, and a place in the world for fromUuid to find it. */
function withDamage(actor) {
  actor.applyDamage = (...args) => CarlRPGActor.prototype.applyDamage.call(actor, ...args);
  world.docs[actor.uuid] = actor;
  return actor;
}

const entry = (over = {}) => ({
  id: 'd1',
  targetUuid: 'Actor.Target',
  targetName: 'Target',
  sourceName: 'Shock Treatment',
  formula: '6',
  type: 'lightning',
  ignoreDR: false,
  left: 1,
  ...over,
});

/* -------------------------------------------- */
/*  Planning the action                         */
/* -------------------------------------------- */

test('a plan fills in the roll data and waits for the next round end by default', () => {
  const plan = planDelayed({ amount: '1d4 + @int.mod', damageType: 'lightning' }, { int: { mod: 3 } });
  assert.deepEqual(plan, { formula: '1d4 + 3', delay: 1, type: 'lightning', ignoreDR: false });
});

test('@rankDamage becomes the rank dice of the item before it is queued', () => {
  const skill = makeItem({ type: 'skill', system: { rank: 10, upgrades: [] } });
  const plan = planDelayed({ amount: '@rankDamage' }, {}, skill);
  assert.equal(plan.formula, expandRankDamage('@rankDamage', skill));
  assert.doesNotMatch(plan.formula, /@/);
  assert.ok(plan.formula.length > 0);
  // rank 0 has no dice, so it is a plain 0 that deals nothing
  const none = planDelayed({ amount: '@rankDamage' }, {}, makeItem({ type: 'skill', system: { rank: 0, upgrades: [] } }));
  assert.equal(none.formula, '0');
});

test('the wait is a number or formula, at least one round end', () => {
  const wait = (delay, data = {}) => planDelayed({ amount: '2', delay }, data);
  assert.equal(wait('').delay, 1);
  assert.equal(wait('1').delay, 1);
  assert.equal(wait('3').delay, 3);
  assert.equal(wait('0').delay, 1);
  assert.equal(wait('-2').delay, 1);
  assert.equal(wait('2.9').delay, 2);
  assert.equal(wait('1 + floor(@rank / 5)', { rank: 10 }).delay, 3);
  assert.ok(wait('@missing').error);
  assert.ok(wait('banana').error);
});

test('a plan that can\'t be read says so instead of queuing', () => {
  assert.equal(planDelayed({ amount: '' }, {}).error, 'CARL_RPG.Events.Warn.DelayedNoAmount');
  assert.equal(planDelayed({ amount: '  ' }, {}).error, 'CARL_RPG.Events.Warn.DelayedNoAmount');
  assert.equal(planDelayed({ amount: '2 + #!' }, {}).error, 'CARL_RPG.Events.Warn.DelayedNoAmount');
  const missing = planDelayed({ amount: '@nothing.here' }, {});
  assert.equal(missing.error, 'CARL_RPG.Events.Warn.BadFormula');
  assert.deepEqual(missing.data, { formula: '@nothing.here' });
});

test('the type and ignoring DR are carried through', () => {
  const plan = planDelayed({ amount: '2', damageType: ' fire ', ignoreDR: true }, {});
  assert.equal(plan.type, 'fire');
  assert.equal(plan.ignoreDR, true);
  assert.equal(planDelayed({ amount: '2' }, {}).type, '');
});

/* -------------------------------------------- */
/*  The queue                                   */
/* -------------------------------------------- */

test('an entry waits as many round ends as the plan says', () => {
  const plan = planDelayed({ amount: '2', delay: '2' }, {});
  const made = makeEntry(plan, { id: 'x', targetUuid: 'Actor.A', targetName: 'A', sourceName: 'S' });
  assert.deepEqual(made, {
    id: 'x',
    targetUuid: 'Actor.A',
    targetName: 'A',
    sourceName: 'S',
    formula: '2',
    type: '',
    ignoreDR: false,
    left: 2,
  });
});

test('each round end counts the entries down and hands over the ones that are due', () => {
  const entries = [entry({ id: 'a', left: 1 }), entry({ id: 'b', left: 2 }), entry({ id: 'c', left: 3 })];
  const first = advance(entries);
  assert.deepEqual(first.due.map((e) => e.id), ['a']);
  assert.deepEqual(first.rest.map((e) => [e.id, e.left]), [['b', 1], ['c', 2]]);
  const second = advance(first.rest);
  assert.deepEqual(second.due.map((e) => e.id), ['b']);
  assert.deepEqual(advance(second.rest).due.map((e) => e.id), ['c']);
  assert.deepEqual(advance(undefined), { due: [], rest: [] });
  // (the entries it was given are not changed)
  assert.equal(entries[1].left, 2);
});

test('the queue lives in a flag of the combat and builds up', async () => {
  const combat = combatWithFlags();
  assert.deepEqual(queueOf(combat), []);
  await queueDelayed(combat, entry({ id: 'a' }));
  await queueDelayed(combat, entry({ id: 'b' }));
  assert.deepEqual(queueOf(combat).map((e) => e.id), ['a', 'b']);
  assert.equal(combat.flags[NS][FLAG].length, 2);
  assert.deepEqual(queueOf(null), []);
});

/* -------------------------------------------- */
/*  The event action                            */
/* -------------------------------------------- */

/** A skill with a "hit" event that queues delayed damage on the target that was hit. */
function shockSkill(action = {}) {
  return makeItem({
    type: 'skill',
    name: 'Shock Treatment',
    system: {
      rank: 10,
      upgrades: [],
      events: [
        {
          id: 'e1',
          enabled: true,
          trigger: 'hit',
          phase: 'any',
          match: 'all',
          conditions: [],
          actions: [{ ...newAction({ type: 'delayedDamage', amount: '@rankDamage', damageType: 'lightning', targetGroup: 'hit' }), ...action }],
        },
      ],
    },
  });
}

test('a hit queues the damage on the target that was hit, to land at a round end', async () => {
  const combat = combatWithFlags();
  const skill = shockSkill();
  const caster = await makeCrawler({ items: [skill], name: 'Caster' });
  const mob = makeActor({ type: 'mob', name: 'Goblin' });
  await runEvents(skill, 'hit', { actor: caster, target: mob });
  const queue = queueOf(combat);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].targetUuid, mob.uuid);
  assert.equal(queue[0].targetName, 'Goblin');
  assert.equal(queue[0].sourceName, 'Shock Treatment');
  assert.equal(queue[0].type, 'lightning');
  assert.equal(queue[0].left, 1);
  assert.doesNotMatch(queue[0].formula, /@/);
  // it was only queued: the target has taken nothing yet
  assert.equal(world.chat.length, 0);
});

test('each target that is hit gets its own entry', async () => {
  const combat = combatWithFlags();
  const skill = shockSkill();
  const caster = await makeCrawler({ items: [skill] });
  const a = makeActor({ type: 'mob', name: 'A' });
  const b = makeActor({ type: 'mob', name: 'B' });
  await runEvents(skill, 'hit', { actor: caster, target: a });
  await runEvents(skill, 'hit', { actor: caster, target: b });
  assert.deepEqual(queueOf(combat).map((e) => e.targetName), ['A', 'B']);
});

test('with no running combat nothing is queued and the user is told', async () => {
  const skill = shockSkill();
  const caster = await makeCrawler({ items: [skill] });
  const mob = makeActor({ type: 'mob', name: 'Goblin' });
  await runEvents(skill, 'hit', { actor: caster, target: mob });
  assert.ok(world.warnings.some((w) => /DelayedNoCombat/.test(String(w))));
  // a combat that has not started does not count either
  const waiting = combatWithFlags();
  waiting.started = false;
  world.warnings.length = 0;
  await runEvents(skill, 'hit', { actor: caster, target: mob });
  assert.deepEqual(queueOf(waiting), []);
  assert.ok(world.warnings.some((w) => /DelayedNoCombat/.test(String(w))));
});

test('a bad amount is a warning, not an entry', async () => {
  const combat = combatWithFlags();
  const skill = shockSkill({ amount: '' });
  const caster = await makeCrawler({ items: [skill] });
  await runEvents(skill, 'hit', { actor: caster, target: makeActor({ type: 'mob' }) });
  assert.deepEqual(queueOf(combat), []);
  assert.ok(world.warnings.some((w) => /DelayedNoAmount/.test(String(w))));
});

test('"the target that was hit" is the creature the event is for, and nothing without one', () => {
  const owner = makeActor({ name: 'Owner' });
  const target = makeActor({ type: 'mob', name: 'Goblin' });
  assert.deepEqual(groupActors('hit', owner, { target }), [target]);
  assert.deepEqual(groupActors('hit', owner, {}), []);
  assert.ok(CONFIG.CARL_RPG.eventTargetGroups.hit);
  assert.ok(CONFIG.CARL_RPG.eventActions.delayedDamage);
});

test('choosing the action aims it at the hit target unless a group is already set', () => {
  const system = { events: [{ actions: [{ type: 'delayedDamage', targetGroup: '' }, { type: 'delayedDamage', targetGroup: 'enemies' }] }] };
  applyActionDefaults(system, 'events.0.actions.0.type', 'delayedDamage');
  applyActionDefaults(system, 'events.0.actions.1.type', 'delayedDamage');
  assert.equal(system.events[0].actions[0].targetGroup, 'hit');
  assert.equal(system.events[0].actions[1].targetGroup, 'enemies');
  // other actions, other fields and upgrade events are left alone or reached by the same path
  const other = { events: [{ actions: [{ type: 'health', targetGroup: '' }] }] };
  applyActionDefaults(other, 'events.0.actions.0.type', 'health');
  assert.equal(other.events[0].actions[0].targetGroup, '');
  const upgrade = { upgrades: [{ events: [{ actions: [{ type: 'delayedDamage', targetGroup: '' }] }] }] };
  applyActionDefaults(upgrade, 'upgrades.0.events.0.actions.0.type', 'delayedDamage');
  assert.equal(upgrade.upgrades[0].events[0].actions[0].targetGroup, 'hit');
  applyActionDefaults(other, 'events.0.actions.0.amount', 'delayedDamage');
  assert.equal(other.events[0].actions[0].targetGroup, '');
});

test('the event card says what it will do', async () => {
  const text = await summarizeAction(newAction({ type: 'delayedDamage', amount: '1d6', damageType: 'lightning', targetGroup: 'hit' }));
  assert.match(text, /delayedDamage/);
  const later = await summarizeAction(newAction({ type: 'delayedDamage', amount: '1d6', delay: '3' }));
  assert.match(later, /delayedDamageLater/);
});

/* -------------------------------------------- */
/*  Dealing it at the round end                 */
/* -------------------------------------------- */

test('a round end deals what is due through the normal damage rules and keeps the rest', async () => {
  const combat = combatWithFlags();
  const crawler = withDamage(await makeCrawler({ abilities: { con: 6 }, name: 'Target' })); // 3 damage a box
  await queueDelayed(combat, entry({ id: 'now', targetUuid: crawler.uuid, formula: '9', left: 1 }));
  await queueDelayed(combat, entry({ id: 'later', targetUuid: crawler.uuid, formula: '3', left: 2 }));
  await tickDelayed(combat);
  assert.equal(crawler.system.health.value, 7); // 9 damage is 3 boxes
  assert.deepEqual(queueOf(combat).map((e) => [e.id, e.left]), [['later', 1]]);
  await tickDelayed(combat);
  assert.equal(crawler.system.health.value, 6);
  assert.deepEqual(queueOf(combat), []);
  // an empty queue is left alone
  const before = JSON.stringify(combat.flags);
  await tickDelayed(combat);
  assert.equal(JSON.stringify(combat.flags), before);
});

test('Damage Resistance comes off, unless the damage ignores it', async () => {
  const gear = makeItem({ type: 'gear', system: { equipped: true, dr: 4 } });
  const crawler = withDamage(await makeCrawler({ abilities: { con: 6 }, items: [gear], name: 'Target' }));
  await dealEntry(entry({ targetUuid: crawler.uuid, formula: '10' })); // 10 - 4 DR = 6: 2 boxes
  assert.equal(crawler.system.health.value, 8);
  await dealEntry(entry({ targetUuid: crawler.uuid, formula: '6', ignoreDR: true })); // 6: 2 boxes
  assert.equal(crawler.system.health.value, 6);
});

test('the damage type is resisted, stopped or doubled like any other damage', async () => {
  const resist = makeEffect({ flags: { damageMods: [{ type: 'lightning', mode: 'resist' }] } });
  const immune = makeEffect({ flags: { damageMods: [{ type: 'lightning', mode: 'immune' }] } });
  const weak = makeEffect({ flags: { damageMods: [{ type: 'lightning', mode: 'vulnerable' }] } });
  const run = async (effects, type = 'lightning') => {
    const crawler = withDamage(await makeCrawler({ abilities: { con: 6 }, effects, name: `T${Math.random()}` }));
    await dealEntry(entry({ targetUuid: crawler.uuid, formula: '12', type }));
    return crawler.system.health.value;
  };
  assert.equal(await run([]), 6); // 12 damage: 4 boxes
  assert.equal(await run([resist]), 8); // 6 damage: 2 boxes
  assert.equal(await run([immune]), 10);
  assert.equal(await run([weak]), 2); // 24 damage: 8 boxes
  assert.equal(await run([resist], 'fire'), 6); // another type is unaffected
});

test('a mob loses health without a player ever seeing the numbers', async () => {
  const mob = withDamage(makeActor({ type: 'mob', name: 'Goblin', system: { health: { value: 20, max: 20 }, drTotal: 1 } }));
  mob.applyDamage = (...args) => CarlRPGActor.prototype.applyDamage.call(mob, ...args);
  await dealEntry(entry({ targetUuid: mob.uuid, formula: '6' }));
  assert.equal(mob.system.health.value, 15); // 6 - 1 DR
  // the public note carries no numbers; the damage line is a whisper to the GM
  const notes = world.chat.filter((m) => !m.whisper);
  assert.ok(notes.every((m) => !/\d/.test(String(m.content).replace(/<[^>]*>/g, ''))));
  assert.ok(world.chat.some((m) => m.whisper?.length));
});

test('a creature that is gone or dead takes nothing, and 0 damage does nothing', async () => {
  const dead = withDamage(await makeCrawler({ abilities: { con: 6 }, name: 'Dead' }));
  dead.statuses.add('dead');
  assert.equal(await dealEntry(entry({ targetUuid: dead.uuid, formula: '12' })), false);
  assert.equal(dead.system.health.value, 10);
  assert.equal(await dealEntry(entry({ targetUuid: 'Actor.Nobody', formula: '12' })), false);
  const alive = withDamage(await makeCrawler({ abilities: { con: 6 }, name: 'Alive' }));
  assert.equal(await dealEntry(entry({ targetUuid: alive.uuid, formula: '0' })), false);
  assert.equal(alive.system.health.value, 10);
});

test('a broken formula is skipped without stopping the others', async () => {
  const combat = combatWithFlags();
  const crawler = withDamage(await makeCrawler({ abilities: { con: 6 }, name: 'Target' }));
  const realRoll = globalThis.Roll;
  globalThis.Roll = class extends realRoll {
    async evaluate() {
      if (this.formula === 'boom') throw new Error('boom');
      return super.evaluate();
    }
  };
  try {
    await queueDelayed(combat, entry({ id: 'bad', targetUuid: crawler.uuid, formula: 'boom' }));
    await queueDelayed(combat, entry({ id: 'good', targetUuid: crawler.uuid, formula: '6' }));
    const quiet = console.error;
    console.error = () => {};
    try {
      await tickDelayed(combat);
    } finally {
      console.error = quiet;
    }
  } finally {
    globalThis.Roll = realRoll;
  }
  assert.equal(crawler.system.health.value, 8);
  assert.deepEqual(queueOf(combat), []);
});

test('the queue goes with the combat: a new combat starts empty', () => {
  const first = combatWithFlags();
  first.flags[NS] = { [FLAG]: [entry()] };
  assert.equal(queueOf(first).length, 1);
  world.reset();
  const second = combatWithFlags();
  assert.deepEqual(queueOf(second), []);
});
