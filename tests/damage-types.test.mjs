import { world, makeEffect, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CarlRPGActor } from '../module/documents/actor.mjs';
import { damageTypes, DAMAGE_TYPES_SETTING } from '../module/helpers/damage-types.mjs';
import { computeEffective } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

const applyDamage = (actor, ...args) => CarlRPGActor.prototype.applyDamage.call(actor, ...args);
const mods = (...rows) => makeEffect({ flags: { damageMods: rows } });

test('the damage types come from the GM list, with duplicates and blanks dropped', () => {
  assert.ok(damageTypes().some((d) => d.id === 'fire')); // the starter list
  world.settings[DAMAGE_TYPES_SETTING] = 'Fire, Cold Iron, , fire,Holy';
  assert.deepEqual(
    damageTypes().map((d) => [d.id, d.label]),
    [
      ['fire', 'Fire'],
      ['cold-iron', 'Cold Iron'],
      ['holy', 'Holy'],
    ]
  );
});

test('resist halves, vulnerable doubles and immune stops damage of that type only', async () => {
  const crawler = await makeCrawler({
    abilities: { con: 6 },
    effects: [
      mods({ type: 'fire', mode: 'resist' }),
      mods({ type: 'cold', mode: 'vulnerable' }),
      mods({ type: 'acid', mode: 'immune' }),
    ],
  });
  const taken = async (type) => (await applyDamage(crawler, 9, { damageType: type })).amount;
  assert.equal(await taken('fire'), 4); // halves round down
  assert.equal(await taken('cold'), 18);
  assert.equal(await taken('acid'), 0);
  assert.equal(await taken('poison'), 9); // no effect for this type
  assert.equal(await taken(''), 9); // no type at all
});

test('effects that are off, and resist with vulnerable, do not change damage', async () => {
  const crawler = await makeCrawler({
    abilities: { con: 6 },
    effects: [
      makeEffect({ flags: { damageMods: [{ type: 'fire', mode: 'immune' }] }, disabled: true }),
      mods({ type: 'cold', mode: 'resist' }),
      mods({ type: 'cold', mode: 'vulnerable' }),
    ],
  });
  assert.equal((await applyDamage(crawler, 8, { damageType: 'fire' })).amount, 8);
  assert.equal((await applyDamage(crawler, 8, { damageType: 'cold' })).amount, 8);
});

test('a damage type that changes the damage is said in the chat', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 }, effects: [mods({ type: 'fire', mode: 'immune' })] });
  await applyDamage(crawler, 5, { damageType: 'fire' });
  assert.match(world.chat.at(-1).content, /immune/i);
});

test('upgrades can set the damage type and make the item Armor-Piercing', () => {
  const system = {
    rank: 5,
    damage: '1d6',
    costs: [],
    check: { target: 'evade' },
    damageType: 'physical',
    upgrades: [
      { id: 'a', rank: 5, changes: [{ type: 'damageType', value: 'fire' }, { type: 'armorPiercing', value: '' }] },
      { id: 'b', rank: 10, changes: [{ type: 'damageType', value: 'cold' }] },
    ],
  };
  const reached = computeEffective(system);
  assert.equal(reached.damageType, 'fire'); // the rank 10 upgrade is not reached
  assert.equal(reached.armorPiercing, true);
  const plain = computeEffective({ ...system, rank: 0 });
  assert.equal(plain.damageType, 'physical');
  assert.equal(plain.armorPiercing, false);
});
