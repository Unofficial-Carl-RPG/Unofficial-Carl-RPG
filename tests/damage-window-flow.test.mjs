import { world } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCheck, rollAttackDamage, rollMobDamage } from '../module/helpers/attacks.mjs';

// (What a card, a roll and a token need to run the attack flow without Foundry.)
const docs = {};
Roll.prototype.alter = function () {
  return this;
};
Roll.prototype.render = async function () {
  return `<roll>${this.total}</roll>`;
};
globalThis.fromUuidSync = (uuid) => docs[uuid] ?? null;
globalThis.canvas = { tokens: { placeables: [] }, scene: null };
CONFIG.sounds = { dice: 'dice.wav' };

const merge = (into, from) => {
  for (const [key, value] of Object.entries(from)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      into[key] ??= {};
      merge(into[key], value);
    } else into[key] = value;
  }
};
/** A chat message with flags that can be read and updated, like Foundry's. */
const card = (data) => ({
  ...data,
  getFlag: (ns, key) => data.flags?.[ns]?.[key],
  async update(update) {
    if (update.content !== undefined) data.content = update.content;
    if (update.flags) merge(data.flags, structuredClone(update.flags));
    for (const [path, value] of Object.entries(update)) {
      if (!path.startsWith('flags.')) continue;
      const keys = path.split('.').slice(1);
      let at = data;
      for (const key of keys.slice(0, -1)) at = at.flags ? ((at = at.flags), (at[key] ??= {})) : (at[key] ??= {});
      at[keys.at(-1)] = value;
    }
  },
});

const d20 = (natural, total) => ({
  total,
  dice: [{ faces: 20, results: [{ result: natural, active: true }] }],
});

function setup({ damage = '6', floor = 1 } = {}) {
  world.settings.floor = floor;
  const owner = { type: 'crawler', uuid: 'Actor.hero', getRollData: () => ({}), system: {} };
  const item = {
    actor: owner,
    name: 'Slash',
    uuid: 'Actor.hero.Item.slash',
    type: 'skill',
    system: {
      damage,
      damageType: 'slashing',
      check: { target: 'evade' },
      targeting: {},
      action: { type: 'roll' },
    },
  };
  const rat = {
    type: 'mob',
    uuid: 'Actor.rat',
    system: { evadeTotal: 10, floor, size: 'tiny' },
  };
  const token = { uuid: 'Scene.s.Token.rat', name: 'Rat', actor: rat };
  docs[token.uuid] = token;
  docs[rat.uuid] = rat;
  game.user.targets = [{ document: token, actor: rat }];
  return { item, owner, rat, token };
}

beforeEach(() => {
  world.reset();
  world.chat.length = 0;
});

test('a deferred attack posts the degrees and waits: no damage, no hits yet', async () => {
  const { item } = setup();
  const result = await resolveCheck(item, d20(15, 17), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  assert.equal(result.deferred, true);
  assert.equal(result.damage, null);
  assert.deepEqual(result.hits, []);
  const attack = result.message.flags['carl-rpg'].attack;
  assert.equal(attack.damagePending, true);
  assert.equal(attack.damage, null);
  assert.equal(attack.targets.length, 1);
  assert.equal(attack.targets[0].degree, 'success'); // 17 vs Evade 10
  assert.equal(attack.targets[0].hit, true);
  assert.equal(attack.targets[0].damage, null);
  assert.equal(attack.pending.natural, 15);
  assert.equal(attack.pending.rollTotal, 17);
  assert.equal(attack.pending.itemUuid, item.uuid);
  assert.deepEqual(result.message.rolls, []);
});

test('without deferDamage the damage is rolled with the attack, as it always was', async () => {
  const { item } = setup();
  const result = await resolveCheck(item, d20(15, 17));
  assert.equal(result.deferred, false);
  assert.equal(result.damage.total, 6);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].damage, 6);
  assert.equal(result.message.flags['carl-rpg'].attack.damagePending, undefined);
  assert.equal(result.message.flags['carl-rpg'].attack.targets[0].damage, 6);
});

test('the damage roll fills in each target and hands the hits to the events', async () => {
  const { item } = setup();
  const attacked = await resolveCheck(item, d20(15, 17), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const message = card(attacked.message);
  const rolled = await rollAttackDamage(message, item);
  assert.equal(rolled.hits.length, 1);
  assert.equal(rolled.hits[0].damage, 6);
  assert.equal(rolled.hits[0].margin, 7);
  assert.equal(rolled.damage.total, 6);
  const attack = message.getFlag('carl-rpg', 'attack');
  assert.equal(attack.damagePending, false);
  assert.equal(attack.damage, 6);
  assert.equal(attack.targets[0].damage, 6);
  assert.equal(attack.damageType, 'slashing');
  // the dice get a message of their own
  assert.equal(world.chat.at(-1).content, '<roll>6</roll>');
});

test('a second Roll Damage finds the damage already rolled', async () => {
  const { item } = setup();
  const attacked = await resolveCheck(item, d20(15, 17), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const message = card(attacked.message);
  assert.ok(await rollAttackDamage(message, item));
  assert.equal(await rollAttackDamage(message, item), null);
});

test('a miss is on the card but the damage roll still works for the hand-applied row', async () => {
  const { item } = setup();
  // (a total of 0 against Evade 10 misses by 10)
  const attacked = await resolveCheck(item, d20(3, 0), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  assert.deepEqual(attacked.misses.map((m) => m.degree), ['majorFail']);
  const message = card(attacked.message);
  const rolled = await rollAttackDamage(message, item);
  assert.deepEqual(rolled.hits, []);
  assert.equal(message.getFlag('carl-rpg', 'attack').targets[0].damage, 6);
});

test('a natural 20 remembered from the attack is a Critical Hit when the damage rolls', async () => {
  const { item } = setup({ damage: '6' });
  const attacked = await resolveCheck(item, d20(20, 22), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const message = card(attacked.message);
  const rolled = await rollAttackDamage(message, item);
  assert.equal(rolled.hits[0].degree, 'critHit');
  // (the stand-in dice don't double; the flag the crit sets is what the real Roll#alter reads)
  assert.equal(message.getFlag('carl-rpg', 'attack').pending.natural, 20);
});

test('an Amazing Success adds the Floor when the damage rolls', async () => {
  const { item } = setup({ floor: 3 });
  // Evade 10 + a total of 25 beats it by 15
  const attacked = await resolveCheck(item, d20(12, 25), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const message = card(attacked.message);
  const rolled = await rollAttackDamage(message, item);
  assert.equal(rolled.hits[0].degree, 'amazing');
  assert.equal(rolled.hits[0].damage, 6 + 3);
});

test('the damage window: bonus damage, a multiplier, a new type and Ignore DR', async () => {
  const { item } = setup();
  const attacked = await resolveCheck(item, d20(15, 17), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const message = card(attacked.message);
  const rolled = await rollAttackDamage(message, item, {
    manual: { bonus: { formula: '2' }, multiplier: '2', type: 'fire', also: '', ignoreDR: true },
  });
  // (6 rolled + 2 bonus) x 2
  assert.equal(rolled.hits[0].damage, 16);
  const attack = message.getFlag('carl-rpg', 'attack');
  assert.equal(attack.damage, 16);
  assert.equal(attack.damageType, 'fire');
  assert.equal(attack.armorPiercing, true);
  // the card's heading now names the damage, its type and the multiplier
  assert.match(attacked.message.content, /&quot;damage&quot;:16/);
  assert.match(attacked.message.content, /Fire/);
  assert.match(attacked.message.content, /ArmorPiercing/);
  assert.match(attacked.message.content, /MultipliedTotal/);
});

test('leaving the window alone keeps the item\'s own type and Armor-Piercing', async () => {
  const { item } = setup();
  item.system.armorPiercing = true;
  const attacked = await resolveCheck(item, d20(15, 17), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const message = card(attacked.message);
  await rollAttackDamage(message, item, {
    manual: { bonus: null, multiplier: '', type: '', also: '', ignoreDR: true },
  });
  const attack = message.getFlag('carl-rpg', 'attack');
  assert.equal(attack.damage, 6);
  assert.equal(attack.damageType, 'slashing');
  assert.equal(attack.armorPiercing, true);
});

test('a card with no targets can still have its damage rolled', async () => {
  const { item } = setup();
  game.user.targets = [];
  const attacked = await resolveCheck(item, d20(15, 17), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const attack = attacked.message.flags['carl-rpg'].attack;
  assert.equal(attack.damagePending, true);
  assert.deepEqual(attack.targets, []);
  const message = card(attacked.message);
  const rolled = await rollAttackDamage(message, item);
  assert.equal(rolled.damage.total, 6);
  assert.equal(message.getFlag('carl-rpg', 'attack').damage, 6);
});

test('an item with no damage is never deferred', async () => {
  const { item } = setup({ damage: '' });
  const result = await resolveCheck(item, d20(15, 17), { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  assert.equal(result.deferred, false);
  assert.equal(result.message.flags['carl-rpg'].attack.damagePending, undefined);
});

// --- a mob's attack: the GM rolls its damage from the card too

test('a mob attack waits for its damage; the GM rolls it with Shift and the rows fill in', async () => {
  const { rat, token } = setup();
  rat.system.check = {};
  const goblin = { type: 'mob', uuid: 'Actor.goblin', getRollData: () => ({}), system: { floor: 1 } };
  const bite = {
    actor: goblin,
    name: 'Bite',
    uuid: 'Actor.goblin.Item.bite',
    type: 'mobAbility',
    system: {
      damage: '4',
      damageType: 'piercing',
      check: { target: 'evade', number: 12 },
      targeting: {},
      action: { type: 'roll' },
      events: [],
    },
  };
  world.docs[bite.uuid] = bite;
  // (another mob is hit by the number alone: 12 + Floor 1 = 13 against Evade 10)
  const result = await resolveCheck(bite, null, { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const posted = world.chat.at(-1);
  const attack = posted.flags['carl-rpg'].attack;
  assert.equal(attack.damagePending, true);
  assert.equal(attack.damage, null);
  assert.equal(attack.targets[0].state, 'resolved');
  assert.equal(attack.targets[0].degree, 'success');
  assert.equal(attack.targets[0].damage, null);
  assert.deepEqual(result.hits, []);
  assert.equal(attack.pending.itemUuid, bite.uuid);
  assert.deepEqual(posted.rolls, []);

  const message = card(posted);
  world.docs[bite.uuid] = bite;
  await rollMobDamage(message, { shift: true });
  const after = message.getFlag('carl-rpg', 'attack');
  assert.equal(after.damagePending, false);
  assert.equal(after.damage, 4);
  assert.equal(after.targets[0].damage, 4);
  assert.equal(after.damageType, 'piercing');
  // the dice are whispered to the GM only
  assert.deepEqual(world.chat.at(-1).whisper, ['gm1']);
  // a second click finds it done
  await rollMobDamage(message, { shift: true });
  assert.equal(world.chat.filter((c) => c.flavor?.includes('DamageDialog.Flavor')).length, 1);
});

test('a mob attack with a crawler who has not answered cannot roll its damage yet', async () => {
  const { item } = setup();
  const hero = { type: 'crawler', uuid: 'Actor.hero2', system: { evade: { total: 5 } } };
  const heroToken = { uuid: 'Scene.s.Token.hero2', name: 'Hero', actor: hero };
  docs[heroToken.uuid] = heroToken;
  docs[hero.uuid] = hero;
  game.user.targets = [{ document: heroToken, actor: hero }];
  const goblin = { type: 'mob', uuid: 'Actor.goblin', getRollData: () => ({}), system: { floor: 1 } };
  const bite = {
    actor: goblin,
    name: 'Bite',
    uuid: 'Actor.goblin.Item.bite',
    type: 'mobAbility',
    system: { damage: '4', check: { target: 'evade', number: 12 }, targeting: {}, action: { type: 'roll' } },
  };
  world.docs[bite.uuid] = bite;
  const result = await resolveCheck(bite, null, { deferDamage: { mode: 'normal', surprise: false, rolled: {} } });
  const posted = world.chat.at(-1);
  const attack = posted.flags['carl-rpg'].attack;
  assert.equal(attack.targets[0].state, 'pending');
  const message = card(posted);
  await rollMobDamage(message, { shift: true });
  assert.equal(message.getFlag('carl-rpg', 'attack').damagePending, true);
  assert.ok(world.warnings.some((w) => w.includes('WaitingForRolls')));
  assert.ok(item);
});
