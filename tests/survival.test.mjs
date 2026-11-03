import { world, makeActor, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { canDie, dyingEffectOf, startDying, cancelDying, hurtWhileDying, die, revive, isDead } from '../module/helpers/dying.mjs';
import { tickDurations } from '../module/helpers/effect-duration.mjs';
import { CarlRPGActor } from '../module/documents/actor.mjs';

beforeEach(() => world.reset());

const NS = 'carl-rpg';
const applyDamage = (actor, ...args) => CarlRPGActor.prototype.applyDamage.call(actor, ...args);
const left = (actor) => dyingEffectOf(actor)?.getFlag(NS, 'roundsLeft');

/* -------------------------------------------- */
/*  Who can die                                 */
/* -------------------------------------------- */

test('crawlers and Crawler-type mobs can be Dying; other mobs, pets and mounts just go down', () => {
  assert.equal(canDie(makeActor({ type: 'crawler' })), true);
  assert.equal(canDie(makeActor({ type: 'mob', system: { mobType: 'crawler' } })), true);
  assert.equal(canDie(makeActor({ type: 'mob', system: { mobType: 'basic' } })), false);
  assert.equal(canDie(makeActor({ type: 'mob', system: { mobType: 'boss' } })), false);
  assert.equal(canDie(makeActor({ type: 'pet' })), false);
  assert.equal(canDie(makeActor({ type: 'mount' })), false);
  assert.equal(canDie(null), false);
});

/* -------------------------------------------- */
/*  Dying                                       */
/* -------------------------------------------- */

test('Dying lasts rounds equal to the CON modifier, and starts only once', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 } }); // Con 6 is +3
  await startDying(crawler);
  const dying = dyingEffectOf(crawler);
  assert.equal(dying.getFlag(NS, 'rounds'), 3);
  assert.equal(left(crawler), 3);
  assert.equal(dying.getFlag(NS, 'kind'), 'debuff');
  assert.equal(world.chat.length, 2); // public note + GM whisper
  await startDying(crawler); // already Dying
  assert.equal(crawler.effects.length, 1);
  assert.equal(world.chat.length, 2);
});

test('Dying is at least 1 round, and a dead crawler cannot start Dying again', async () => {
  const weak = makeActor({ type: 'crawler', system: { abilities: { con: { mod: 0 } } } });
  await startDying(weak);
  assert.equal(left(weak), 1);

  const dead = await makeCrawler();
  dead.statuses.add('dead');
  await startDying(dead);
  assert.equal(dead.effects.length, 0);
});

test('every hit that gets through takes 1 off the count, and the last one kills', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 } });
  await startDying(crawler);
  await applyDamage(crawler, 3); // a full box
  assert.equal(left(crawler), 2);
  await applyDamage(crawler, 9);
  assert.equal(left(crawler), 1);
  await applyDamage(crawler, 3);
  assert.equal(dyingEffectOf(crawler), null);
  assert.equal(crawler.statuses.has('dead'), true);
});

test('a hit that does not fill a health box does not count', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 } });
  await startDying(crawler);
  await applyDamage(crawler, 2); // under one box (3)
  assert.equal(left(crawler), 3);
});

test('Dying counts down at each round end and kills at the end of the count', async () => {
  const crawler = await makeCrawler({ abilities: { con: 4 } }); // Con 4 is +2
  await startDying(crawler);
  await tickDurations(crawler);
  assert.equal(left(crawler), 1);
  assert.equal(crawler.statuses.has('dead'), false);
  await tickDurations(crawler);
  assert.equal(crawler.statuses.has('dead'), true);
  assert.equal(dyingEffectOf(crawler), null);
});

test('healing cancels Dying', async () => {
  const crawler = await makeCrawler();
  await startDying(crawler);
  await cancelDying(crawler);
  assert.equal(dyingEffectOf(crawler), null);
  await cancelDying(crawler); // nothing to cancel is fine
});

test('a switched-off Dying effect is not counted', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 } });
  await startDying(crawler);
  dyingEffectOf(crawler).disabled = true;
  await hurtWhileDying(crawler);
  assert.equal(left(crawler), 3);
});

test('death adds a permanent Dead effect, the skull overlay, and takes the crawler out of the combat', async () => {
  const crawler = await makeCrawler({ id: 'carl' });
  const removed = [];
  game.combats.push({
    combatants: [
      { id: 'c1', actorId: 'carl' },
      { id: 'c2', actorId: 'other' },
    ],
    deleteEmbeddedDocuments: async (kind, ids) => removed.push([kind, ids]),
  });
  await startDying(crawler);
  await die(crawler);
  assert.equal(dyingEffectOf(crawler), null);
  const dead = crawler.effects.find((e) => e.getFlag(NS, 'dead'));
  assert.ok(dead);
  assert.equal(dead.getFlag(NS, 'lastsUntil'), undefined); // never wears off
  assert.equal(crawler.statuses.has('dead'), true);
  assert.deepEqual(removed, [['Combatant', ['c1']]]);
  await die(crawler); // already dead: no second Dead effect
  assert.equal(crawler.effects.filter((e) => e.getFlag(NS, 'dead')).length, 1);
});

test('Dying and death are told to the GM only; death sends nothing public', async () => {
  const crawler = await makeCrawler({ id: 'carl' });
  await startDying(crawler);
  const before = world.chat.length;
  await die(crawler);
  const added = world.chat.slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].whisper, ['gm1']);
  assert.ok(world.chat.some((m) => m.whisper?.length && !m.flags)); // the Dying reminder
});

test('revive brings a dead crawler back with 1 health box and no Dying', async () => {
  const crawler = await makeCrawler({ id: 'carl' });
  await die(crawler);
  assert.equal(isDead(crawler), true);
  await revive(crawler);
  assert.equal(isDead(crawler), false);
  assert.equal(crawler.effects.some((e) => e.getFlag(NS, 'dead')), false);
  assert.equal(dyingEffectOf(crawler), null);
  assert.equal(crawler.system.health.value, 1);
});

/* -------------------------------------------- */
/*  Health and mana limits                      */
/* -------------------------------------------- */

test('health stays between 0 and 10 boxes, and mana between 0 and the maximum', async () => {
  const crawler = await makeCrawler({ abilities: { int: 3 }, system: { health: { value: 99 }, mana: { value: 50 } } });
  assert.equal(crawler.system.health.value, 10);
  assert.equal(crawler.system.mana.max, 3);
  assert.equal(crawler.system.mana.value, 3);
  const hurt = await makeCrawler({ system: { health: { value: -4 } } });
  assert.equal(hurt.system.health.value, 0);
});

test('mana is Intelligence plus effects, and Intelligence from effects counts', async () => {
  const crawler = await makeCrawler({ abilities: { int: 6 }, bonuses: { int: 4, mana: 1 } });
  assert.equal(crawler.system.mana.max, 11); // enhanced Int 10 + 1
});
