import { world, makeActor, makeItem, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runEvents, groupActors } from '../module/helpers/events.mjs';
import { evalAmount } from '../module/helpers/amounts.mjs';
import {
  raisedHealth,
  levelAllowed,
  planLimit,
  sizeKeyOf,
  footprintOf,
  roundsAfterTick,
  copyName,
  isPetOrMinion,
  minionActors,
  tickSummons,
  endSummons,
  expireSummon,
} from '../module/helpers/minions.mjs';
import { summonFlag, sideOfActor, isTempSummon } from '../module/helpers/minion-side.mjs';
import { needsLoot } from '../module/helpers/mob-loot.mjs';

const gm = () => game.user;
const NS = 'carl-rpg';

beforeEach(() => {
  world.reset();
  delete gm().targets;
  delete game.scenes;
  delete Actor.implementation;
});

/* -------------------------------------------- */
/*  The spells' formulas (as the compendium has them) */
/* -------------------------------------------- */

// Second Chance: 1, 5, 15 and 45 minutes (6, 30, 90, 270 rounds) at ranks 1, 5, 10, 15.
const SECOND_CHANCE_ROUNDS = '6 + 24 * min(1, floor(@rank / 5)) + 60 * min(1, floor(@rank / 10)) + 180 * min(1, floor(@rank / 15))';
// ...and the Mob may be below the caster's level (rank 1) or up to 5, 10, 15 levels above it.
const SECOND_CHANCE_LEVEL = '@lvl - 1 + 6 * min(1, floor(@rank / 5)) + 5 * min(1, floor(@rank / 10)) + 5 * min(1, floor(@rank / 15))';
// Clockwork Triplicate: 6 rounds per rank, 12 from rank 5, 18 from rank 10.
const TRIPLICATE_ROUNDS = '@rank * (6 + 6 * min(1, floor(@rank / 5)) + 6 * min(1, floor(@rank / 10)))';
// Rise, Dead Minion!: Medium (4), Large (5) from rank 10, Colossal (7) from rank 15.
const SKELETON_SIZE = '4 + min(1, floor(@rank / 10)) + 2 * min(1, floor(@rank / 15))';

test('Second Chance lasts 6, 30, 90 and 270 rounds at ranks 1, 5, 10 and 15', () => {
  for (const [rank, rounds] of [[1, 6], [4, 6], [5, 30], [9, 30], [10, 90], [14, 90], [15, 270], [20, 270]]) {
    assert.equal(evalAmount(SECOND_CHANCE_ROUNDS, { rank }), rounds, `rank ${rank}`);
  }
});

test('Second Chance reaches Mobs below the caster, then 5, 10 and 15 levels above', () => {
  for (const [rank, offset] of [[1, -1], [4, -1], [5, 5], [9, 5], [10, 10], [14, 10], [15, 15]]) {
    assert.equal(evalAmount(SECOND_CHANCE_LEVEL, { rank, lvl: 7 }), 7 + offset, `rank ${rank}`);
  }
});

test('Clockwork Triplicate lasts 6, 12 and 18 rounds per rank', () => {
  for (const [rank, rounds] of [[1, 6], [2, 12], [4, 24], [5, 60], [9, 108], [10, 180], [15, 270]]) {
    assert.equal(evalAmount(TRIPLICATE_ROUNDS, { rank }), rounds, `rank ${rank}`);
  }
});

test('the skeleton is Medium (4), Large (5) from rank 10 and Colossal (7) from rank 15', () => {
  for (const [rank, size] of [[1, 4], [9, 4], [10, 5], [14, 5], [15, 7]]) {
    assert.equal(evalAmount(SKELETON_SIZE, { rank }), size, `rank ${rank}`);
  }
});

/* -------------------------------------------- */
/*  Pure rules                                  */
/* -------------------------------------------- */

test('a raised Mob comes back with part of its max health, rounded down, at least 1', () => {
  assert.equal(raisedHealth(20, 0.5), 10);
  assert.equal(raisedHealth(7, 0.5), 3);
  assert.equal(raisedHealth(1, 0.5), 1);
  assert.equal(raisedHealth(20, 0), 1);
  assert.equal(raisedHealth(20, 2), 20);
  assert.equal(raisedHealth(20, null), 20);
  assert.equal(raisedHealth(20, undefined), 20);
});

test('a level is allowed up to the limit, or any level with no limit', () => {
  assert.equal(levelAllowed(4, 4), true);
  assert.equal(levelAllowed(5, 4), false);
  assert.equal(levelAllowed(99, null), true);
});

test('the limit decides how many to place and how many of the oldest end', () => {
  assert.deepEqual(planLimit(0, 2, 0), { place: 2, expire: 0 });
  assert.deepEqual(planLimit(5, 2, 0), { place: 2, expire: 0 });
  assert.deepEqual(planLimit(0, 1, 1), { place: 1, expire: 0 });
  assert.deepEqual(planLimit(1, 1, 1), { place: 1, expire: 1 });
  assert.deepEqual(planLimit(2, 2, 3), { place: 2, expire: 1 });
  assert.deepEqual(planLimit(0, 5, 3), { place: 3, expire: 0 });
});

test('a Size Class gives its size and token footprint', () => {
  assert.deepEqual([4, 5, 7].map(sizeKeyOf), ['medium', 'large', 'colossal']);
  assert.deepEqual([4, 5, 6, 7, 8].map(footprintOf), [1, 2, 3, 4, 5]);
  assert.equal(footprintOf(1), 1);
  assert.equal(sizeKeyOf(99), 'gargantuan');
  assert.equal(sizeKeyOf(0), 'tiny');
});

test('rounds count down and a copy is named after its number', () => {
  assert.equal(roundsAfterTick({ lasts: 6, roundsLeft: 6 }), 5);
  assert.equal(roundsAfterTick({ lasts: 1, roundsLeft: 1 }), 0);
  assert.equal(roundsAfterTick({ lasts: 3 }), 2);
  assert.equal(copyName('Rex', 2), 'Rex (2)');
});

/* -------------------------------------------- */
/*  Fakes                                       */
/* -------------------------------------------- */

/** A synthetic actor for a token, from the token's actor delta. */
function actorFromDelta(data) {
  const delta = data.delta ?? {};
  const actor = makeActor({ type: data.synthType ?? delta.type ?? 'mob', name: data.name, system: structuredClone(delta.system ?? { health: { value: 5, max: 5 } }) });
  actor.flags = structuredClone(delta.flags ?? {});
  actor.ownership = structuredClone(delta.ownership ?? {});
  actor.getFlag = (scope, key) => actor.flags[scope]?.[key];
  actor.setFlag = async (scope, key, value) => {
    (actor.flags[scope] ??= {})[key] = value;
  };
  actor.toObject = () =>
    structuredClone({ name: actor.name, img: '', system: actor.system, items: [], effects: [], ownership: actor.ownership, flags: actor.flags });
  return actor;
}

/** A scene with a 100px grid. Tokens made on it get an actor of their own and can be deleted. */
function makeScene() {
  const scene = { id: 'S1', documentName: 'Scene', grid: { size: 100 }, tokens: [] };
  let n = 0;
  scene.add = (data = {}) => {
    const token = {
      id: `T${++n}`,
      documentName: 'Token',
      parent: scene,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      elevation: 0,
      hidden: false,
      disposition: -1,
      actorId: '',
      ...data,
    };
    token.uuid = `Scene.S1.Token.${token.id}`;
    token.toObject = () => ({
      name: token.name,
      actorId: token.actorId,
      x: token.x,
      y: token.y,
      width: token.width,
      height: token.height,
      hidden: token.hidden,
      actorLink: token.actorLink ?? false,
      disposition: token.disposition,
    });
    token.update = async (changes) => Object.assign(token, changes);
    token.delete = async () => {
      scene.tokens.splice(scene.tokens.indexOf(token), 1);
    };
    if (token.delta && !token.actor) token.actor = actorFromDelta(token);
    scene.tokens.push(token);
    world.docs[token.uuid] = token;
    return token;
  };
  scene.createEmbeddedDocuments = async (kind, datas) => datas.map((d) => scene.add(d));
  game.scenes = [scene];
  return scene;
}

/** A token with a ready-made actor (a pet, a defeated Mob...). */
function addActorToken(scene, actor, data = {}) {
  const token = scene.add({ name: actor.name, actorId: actor.id, ...data });
  token.actor = actor;
  actor.token = token;
  token.toObject = () => ({ name: token.name, actorId: actor.id, x: token.x, y: token.y, width: token.width, height: token.height, actorLink: false, disposition: token.disposition });
  world.docs[actor.uuid] = actor;
  return token;
}

/** A mob whose token follows its prototype. */
function makeMob(name = 'Skeleton') {
  const mob = makeActor({ type: 'mob', name, system: { health: { value: 5, max: 5 }, mobType: 'basic', attributes: { level: { value: 1 } } } });
  mob.prototypeToken = { width: 1, height: 1 };
  mob.getTokenDocument = async (data) => ({
    toObject: () => ({ name, actorId: mob.id, width: 1, height: 1, actorLink: true, ...data }),
  });
  world.docs[mob.uuid] = mob;
  game.actors.push(mob);
  return mob;
}

const summonAction = (over = {}) => ({
  type: 'summon',
  mode: 'place',
  uuid: '',
  amount: '1',
  targetActor: '',
  runOn: 'user',
  selfItem: false,
  skipIfHas: true,
  ignoreDR: false,
  ask: false,
  text: '',
  targetGroup: '',
  hidden: false,
  joinCombat: false,
  duration: '0',
  limit: '0',
  sizeClass: '',
  levelMax: '',
  health: '',
  ...over,
});

/** A caster with a spell that summons, standing on a scene with a token at (500, 500). */
async function setup({ action = {}, rank = 1, level = 5, owners = [], trusted = true, name = 'Caster' } = {}) {
  const scene = makeScene();
  const spell = makeItem({
    type: 'spell',
    name: 'Summoner',
    system: {
      rank,
      upgrades: [],
      eventsTrusted: trusted,
      events: [{ id: 'e1', enabled: true, trigger: 'used', phase: 'any', conditions: [], match: 'all', actions: [summonAction(action)] }],
    },
  });
  const caster = await makeCrawler({ items: [spell], owners, name, system: { attributes: { level: { value: level } } } });
  caster.uuid = `Actor.${name}`;
  caster.getRollData = () => ({ lvl: level });
  caster.token = scene.add({ x: 500, y: 500, actorId: caster.id });
  world.docs[caster.uuid] = caster;
  game.actors.push(caster);
  return { scene, spell, caster };
}

const live = (scene) => scene.tokens.filter((tk) => summonFlag(tk.actor));
const player = (id = 'p1') => ({ id, name: id, isGM: false, active: true, can: () => true });

/* -------------------------------------------- */
/*  Place                                       */
/* -------------------------------------------- */

test('a placed summon follows the rank: size class, footprint and own actor data', async () => {
  for (const [rank, key, width] of [[1, 'medium', 1], [10, 'large', 2], [15, 'colossal', 4]]) {
    world.reset();
    const skeleton = makeMob();
    const { scene, spell } = await setup({ rank, action: { uuid: skeleton.uuid, duration: '1', sizeClass: SKELETON_SIZE } });
    await runEvents(spell, 'used', {});
    const [token] = live(scene);
    assert.ok(token, `rank ${rank}`);
    assert.equal(token.width, width);
    assert.equal(token.height, width);
    assert.equal(token.actorLink, false);
    assert.equal(token.delta.system.size, key);
    const flag = summonFlag(token.actor);
    assert.equal(flag.mode, 'place');
    assert.equal(flag.lasts, 1);
    assert.equal(flag.itemName, 'Summoner');
    assert.equal(flag.casterUuid, 'Actor.Caster');
    assert.equal(flag.side, 'crawler');
  }
});

test('a placed summon lasts its rounds, then collapses', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, duration: '3' } });
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 1);
  const combat = { scene };
  await tickSummons(combat);
  await tickSummons(combat);
  assert.equal(live(scene).length, 1);
  assert.equal(summonFlag(live(scene)[0].actor).roundsLeft, 1);
  await tickSummons(combat);
  assert.equal(live(scene).length, 0);
  assert.ok(world.chat.some((m) => m.content.includes('CARL_RPG.Summon.Fades')));
});

test('a one round summon collapses at the first round end', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, duration: '1' } });
  await runEvents(spell, 'used', {});
  await tickSummons({ scene });
  assert.equal(live(scene).length, 0);
});

test('with no duration a summon stays until the combat ends', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, duration: '0' } });
  await runEvents(spell, 'used', {});
  for (let i = 0; i < 5; i++) await tickSummons({ scene });
  assert.equal(live(scene).length, 1);
  await endSummons(scene);
  assert.equal(live(scene).length, 0);
});

test('the combat ending clears only the summons on its scene', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid } });
  await runEvents(spell, 'used', {});
  const other = { id: 'S2', tokens: [] };
  await endSummons(other);
  assert.equal(live(scene).length, 1);
  await endSummons(null);
  assert.equal(live(scene).length, 1);
});

test('a summon keeps clear of other tokens and joins the combat when it says so', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, amount: '2', joinCombat: true } });
  const joined = [];
  game.combats.push({ scene, active: true, isOwner: true, combatants: [], createEmbeddedDocuments: async (kind, datas) => joined.push(...datas) });
  await runEvents(spell, 'used', {});
  const tokens = live(scene);
  assert.equal(tokens.length, 2);
  assert.equal(new Set(tokens.map((tk) => `${tk.x},${tk.y}`)).size, 2);
  assert.ok(tokens.every((tk) => !(tk.x === 500 && tk.y === 500)));
  assert.equal(joined.length, 2);
});

test('a summon that does not join the combat has no combatant', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, joinCombat: false } });
  const joined = [];
  game.combats.push({ scene, active: true, isOwner: true, combatants: [], createEmbeddedDocuments: async (kind, datas) => joined.push(...datas) });
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 1);
  assert.equal(joined.length, 0);
});

test('the caster\'s players own what they summon', async () => {
  const skeleton = makeMob();
  game.users.push(gm(), player('p1'));
  const { scene, spell } = await setup({ owners: ['p1'], action: { uuid: skeleton.uuid } });
  await runEvents(spell, 'used', {});
  assert.equal(live(scene)[0].delta.ownership.p1, 3);
});

/* -------------------------------------------- */
/*  The limit                                   */
/* -------------------------------------------- */

test('past the limit the oldest summon from the spell ends first', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, limit: '1' } });
  await runEvents(spell, 'used', {});
  const [first] = live(scene);
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 1);
  assert.notEqual(live(scene)[0], first);
});

test('the limit is a formula over the rank and counts per spell and caster', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ rank: 10, action: { uuid: skeleton.uuid, limit: '1 + floor(@rank / 5)' } });
  for (let i = 0; i < 5; i++) await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 3);
  // Another spell's summon is not counted.
  const other = makeItem({ type: 'spell', name: 'Other' });
  const stray = scene.add({ delta: { flags: { [NS]: { summon: { mode: 'place', key: 'Item.Other', casterUuid: 'Actor.Caster', lasts: 0, at: 1, side: 'crawler' } } } } });
  await runEvents(spell, 'used', {});
  assert.ok(scene.tokens.includes(stray));
  assert.equal(live(scene).filter((tk) => tk !== stray).length, 3);
  void other;
});

test('asking for more than the limit places only the limit', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, amount: '4', limit: '2' } });
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 2);
});

/* -------------------------------------------- */
/*  Copy                                        */
/* -------------------------------------------- */

/** A pet owned by the caster, with a linked token at (900, 900). */
function addPet(scene, caster, name = 'Rex') {
  const pet = makeActor({ type: 'pet', name, system: { owner: caster.id, health: { value: 4, max: 6 }, mana: { value: 3 } } });
  pet.toObject = () => ({ name, img: 'pet.png', system: structuredClone(pet.system), items: [{ _id: 'i1', name: 'Bite' }], effects: [], ownership: { p1: 3 }, flags: {} });
  const token = addActorToken(scene, pet, { x: 900, y: 900 });
  return { pet, token };
}

test('copy splits a pet into full copies next to it, in its current state', async () => {
  const { scene, spell, caster } = await setup({ action: { mode: 'copy', amount: '2', duration: TRIPLICATE_ROUNDS, joinCombat: false }, rank: 5 });
  const { pet, token } = addPet(scene, caster);
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  const copies = live(scene);
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.map((c) => c.name).sort(), ['Rex (2)', 'Rex (3)']);
  for (const copy of copies) {
    assert.equal(copy.actorLink, false);
    // Its state right now, not full health: it is a copy.
    assert.equal(copy.actor.system.health.value, 4);
    assert.equal(copy.actor.system.owner, caster.id);
    assert.equal(summonFlag(copy.actor).mode, 'copy');
    assert.equal(summonFlag(copy.actor).lasts, 60);
    assert.ok(Math.abs(copy.x - 900) + Math.abs(copy.y - 900) >= 100);
  }
  // The original is untouched and not a summon.
  assert.ok(scene.tokens.includes(token));
  assert.equal(summonFlag(pet), null);
  assert.equal(new Set(copies.map((c) => `${c.x},${c.y}`)).size, 2);
});

test('copy is only for the caster\'s own pets and minions', async () => {
  const { scene, spell, caster } = await setup({ action: { mode: 'copy', amount: '2' } });
  const stranger = makeActor({ type: 'pet', name: 'Fido', system: { owner: 'someone-else' } });
  const token = addActorToken(scene, stranger, { x: 900, y: 900 });
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 0);
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.SummonNotMinion {"name":"Summoner"}']);
  const mob = makeMob('Goblin');
  const mobToken = addActorToken(scene, mob, { x: 300, y: 300 });
  world.warnings.length = 0;
  gm().targets = new Set([{ document: mobToken }]);
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 0);
  void caster;
});

test('copy needs a targeted token, not the caster\'s own', async () => {
  const { scene, spell } = await setup({ action: { mode: 'copy', amount: '2' } });
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 0);
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.SummonNoTarget']);
});

test('a minion can be copied too, and its copies expire with their rounds', async () => {
  const { scene, spell, caster } = await setup({ action: { mode: 'copy', amount: '2', duration: '2' } });
  const { token } = addPet(scene, caster);
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 2);
  // Copy a copy: it is the caster's minion.
  gm().targets = new Set([{ document: live(scene)[0] }]);
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 4);
  await tickSummons({ scene });
  await tickSummons({ scene });
  assert.equal(live(scene).length, 0);
});

/* -------------------------------------------- */
/*  Raise                                       */
/* -------------------------------------------- */

/** A Mob that was defeated: 0 health, dead, with a token. */
function addDefeated(scene, { level = 3, max = 20, name = 'Ogre' } = {}) {
  const mob = makeActor({ type: 'mob', name, system: { health: { value: 0, max }, mobType: 'basic', attributes: { level: { value: level } } } });
  mob.statuses.add('dead');
  mob.flags = {};
  mob.ownership = {};
  mob.getFlag = (scope, key) => mob.flags[scope]?.[key];
  mob.setFlag = async (scope, key, value) => {
    (mob.flags[scope] ??= {})[key] = value;
  };
  const token = addActorToken(scene, mob, { x: 300, y: 300 });
  return { mob, token };
}

const RAISE = { mode: 'raise', duration: SECOND_CHANCE_ROUNDS, levelMax: SECOND_CHANCE_LEVEL, health: '0.5', joinCombat: true };

test('raise brings a defeated Mob back on the caster\'s side with half its health, rounded down', async () => {
  game.users.push(gm(), player('p1'));
  const { scene, spell, caster } = await setup({ action: RAISE, owners: ['p1'], level: 5 });
  const { mob, token } = addDefeated(scene, { level: 3, max: 21 });
  const joined = [];
  game.combats.push({ scene, active: true, isOwner: true, combatants: [], createEmbeddedDocuments: async (kind, datas) => joined.push(...datas) });
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  assert.equal(mob.system.health.value, 10);
  assert.equal(mob.system.health.max, 21);
  assert.equal(mob.statuses.has('dead'), false);
  const flag = summonFlag(mob);
  assert.equal(flag.mode, 'raise');
  assert.equal(flag.lasts, 6);
  assert.equal(flag.casterUuid, caster.uuid);
  assert.equal(sideOfActor(mob), 'crawler');
  assert.equal(mob.ownership.p1, 3);
  assert.equal(token.disposition, 1);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].tokenId, token.id);
});

test('raise respects the level limit at each rank', async () => {
  for (const [rank, level, ok] of [[1, 4, true], [1, 5, false], [5, 10, true], [5, 11, false], [10, 15, true], [10, 16, false], [15, 20, true], [15, 21, false]]) {
    world.reset();
    const { scene, spell } = await setup({ action: RAISE, rank, level: 5 });
    const { mob, token } = addDefeated(scene, { level });
    gm().targets = new Set([{ document: token }]);
    await runEvents(spell, 'used', {});
    assert.equal(!!summonFlag(mob), ok, `rank ${rank}, level ${level}`);
    if (!ok) assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.SummonTooHigh {"name":"Summoner"}']);
  }
});

test('raise lasts 6, 30, 90 and 270 rounds by rank', async () => {
  for (const [rank, rounds] of [[1, 6], [5, 30], [10, 90], [15, 270]]) {
    world.reset();
    const { scene, spell } = await setup({ action: RAISE, rank, level: 9 });
    const { mob, token } = addDefeated(scene, { level: 1 });
    gm().targets = new Set([{ document: token }]);
    await runEvents(spell, 'used', {});
    assert.equal(summonFlag(mob).lasts, rounds, `rank ${rank}`);
  }
});

test('raise needs a defeated Mob', async () => {
  const { scene, spell } = await setup({ action: RAISE });
  const alive = makeMob('Goblin');
  const token = addActorToken(scene, alive, { x: 300, y: 300 });
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.SummonNotDefeated']);
  assert.equal(summonFlag(alive), null);
});

test('a raised Mob goes down again when its rounds run out, as the GM\'s Mob', async () => {
  game.users.push(gm(), player('p1'));
  const { scene, spell } = await setup({ action: { ...RAISE, duration: '2' }, owners: ['p1'] });
  const { mob, token } = addDefeated(scene, { level: 1 });
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  await tickSummons({ scene });
  assert.equal(mob.statuses.has('dead'), false);
  await tickSummons({ scene });
  assert.equal(mob.system.health.value, 0);
  assert.equal(mob.statuses.has('dead'), true);
  assert.equal(summonFlag(mob), null);
  assert.equal(sideOfActor(mob), 'mob');
  assert.equal(mob.ownership.p1, undefined);
  assert.equal(token.disposition, -1);
  assert.ok(scene.tokens.includes(token));
  assert.ok(world.chat.some((m) => m.content.includes('CARL_RPG.Summon.GoesDown')));
});

test('a raised Mob that is killed early stays down, and the combat ending clears the mark', async () => {
  const { scene, spell } = await setup({ action: RAISE });
  const { mob, token } = addDefeated(scene, { level: 1 });
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  // It falls again in the fight.
  mob.system.health.value = 0;
  mob.statuses.add('dead');
  await endSummons(scene);
  assert.equal(mob.statuses.has('dead'), true);
  assert.equal(summonFlag(mob), null);
  assert.equal(world.chat.filter((m) => m.content.includes('GoesDown')).length, 1);
});

test('a raised Mob keeps its loot state: still lootable when it is down again', async () => {
  const { scene, spell } = await setup({ action: RAISE });
  const { mob, token } = addDefeated(scene, { level: 1 });
  mob.system.loot = { junk: '', gold: '5', items: [], looted: false };
  gm().targets = new Set([{ document: token }]);
  await runEvents(spell, 'used', {});
  assert.equal(needsLoot(mob), false); // up and fighting
  await expireSummon(token);
  assert.equal(needsLoot(mob), true);
  assert.equal(mob.system.loot.looted, false);
});

test('a player cannot raise a Mob by themselves: it goes through the GM, if the events are approved', async () => {
  for (const trusted of [false, true]) {
    world.reset();
    const p = player('p1');
    game.users.push(gm(), p);
    game.users.activeGM = gm();
    const { scene, spell } = await setup({ action: RAISE, owners: ['p1'], trusted });
    const { mob, token } = addDefeated(scene, { level: 1 });
    game.user = p;
    p.targets = new Set([{ document: token }]);
    await runEvents(spell, 'used', {});
    assert.equal(summonFlag(mob), null);
    if (trusted) {
      const relay = world.chat[0].flags[NS].eventRelay;
      assert.equal(relay.actionIndex, 0);
      assert.equal(relay.anchorUuid, token.uuid);
    } else {
      assert.equal(world.chat.length, 0);
      assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.NotTrusted {"name":"Summoner"}']);
    }
  }
});

/* -------------------------------------------- */
/*  Sides, loot and groups                      */
/* -------------------------------------------- */

test('a summon is on the side of whoever made it; everything else keeps its own', () => {
  const mob = makeActor({ type: 'mob' });
  const pet = makeActor({ type: 'pet' });
  const crawler = makeActor({ type: 'crawler' });
  assert.deepEqual([mob, pet, crawler].map(sideOfActor), ['mob', 'crawler', 'crawler']);
  mob.flags = { [NS]: { summon: { mode: 'raise', side: 'crawler' } } };
  assert.equal(sideOfActor(mob), 'crawler');
  mob.flags = { [NS]: { summon: { mode: 'place', side: 'mob' } } };
  assert.equal(sideOfActor(mob), 'mob');
  assert.equal(sideOfActor(null), 'crawler');
});

test('copies and placed tokens give no loot; a raised Mob is still the real Mob', () => {
  const mob = makeActor({ type: 'mob', system: { loot: { gold: '5', items: [], junk: '', looted: false } } });
  mob.statuses.add('dead');
  assert.equal(needsLoot(mob), true);
  mob.flags = { [NS]: { summon: { mode: 'copy', side: 'crawler' } } };
  assert.equal(isTempSummon(mob), true);
  assert.equal(needsLoot(mob), false);
  mob.flags = { [NS]: { summon: { mode: 'place', side: 'crawler' } } };
  assert.equal(needsLoot(mob), false);
  mob.flags = { [NS]: { summon: { mode: 'raise', side: 'crawler' } } };
  assert.equal(isTempSummon(mob), false);
  assert.equal(needsLoot(mob), true);
});

test('allies and enemies follow the side a summon is on', async () => {
  const { scene, caster } = await setup();
  const raised = makeActor({ type: 'mob', name: 'Raised' });
  raised.flags = { [NS]: { summon: { mode: 'raise', side: 'crawler' } } };
  const foe = makeActor({ type: 'mob', name: 'Foe' });
  setupCombatants([raised, foe, caster]);
  assert.ok(groupActors('allies', caster, {}).includes(raised));
  assert.ok(!groupActors('enemies', caster, {}).includes(raised));
  assert.ok(groupActors('enemies', caster, {}).includes(foe));
  void scene;
});

function setupCombatants(actors) {
  game.combat = { started: true, combatants: Object.assign([], actors.map((actor) => ({ actor }))) };
}

test('minions are the caster\'s pets plus the live summons they made, no one else\'s', async () => {
  const skeleton = makeMob();
  const { scene, spell, caster } = await setup({ action: { uuid: skeleton.uuid, amount: '2' } });
  const { pet } = addPet(scene, caster);
  game.actors.push(pet);
  const other = makeActor({ type: 'pet', name: 'Fido', system: { owner: 'someone-else' } });
  game.actors.push(other);
  await runEvents(spell, 'used', {});
  const minions = groupActors('minions', caster, {});
  assert.equal(minions.length, 3);
  assert.ok(minions.includes(pet));
  assert.ok(!minions.includes(other));
  assert.equal(minionActors(caster).length, 3);
  assert.equal(isPetOrMinion(pet, caster), true);
  assert.equal(isPetOrMinion(other, caster), false);
  assert.equal(isPetOrMinion(live(scene)[0].actor, caster), true);
  assert.deepEqual(groupActors('minions', null, {}), []);
});

test('an event can heal the minions group', async () => {
  const skeleton = makeMob();
  const { scene, spell, caster } = await setup({ action: { uuid: skeleton.uuid } });
  await runEvents(spell, 'used', {});
  const minion = live(scene)[0].actor;
  minion.type = 'pet';
  assert.deepEqual(groupActors('minions', caster, {}), [minion]);
});

/* -------------------------------------------- */
/*  Add token is unchanged                      */
/* -------------------------------------------- */

test('a summon needs a place and a real Actor to place', async () => {
  const skeleton = makeMob();
  const { scene, spell, caster } = await setup({ action: { uuid: skeleton.uuid } });
  caster.token = null;
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 0);
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.NoAnchor']);
  world.warnings.length = 0;
  delete world.docs[skeleton.uuid];
  caster.token = scene.add({ x: 500, y: 700, actorId: caster.id });
  await runEvents(spell, 'used', {});
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.ActorMissing']);
});

test('a formula that cannot be worked out stops the summon', async () => {
  const skeleton = makeMob();
  const { scene, spell } = await setup({ action: { uuid: skeleton.uuid, duration: '@nothing + 1' } });
  await runEvents(spell, 'used', {});
  assert.equal(live(scene).length, 0);
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.BadFormula {"formula":"@nothing + 1"}']);
});
