import { world, makeEffect, makeActor, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CarlRPGActor } from '../module/documents/actor.mjs';
import Mob from '../module/data/actor-mob.mjs';
import { cleanBuildRow, healthSlotRowsOf } from '../module/helpers/build-mods.mjs';
import {
  boxesLost,
  capacityOf,
  slotCountOf,
  slotRowProblem,
  slotValues,
} from '../module/helpers/health-slots.mjs';

beforeEach(() => world.reset());

const applyDamage = (actor, ...args) => CarlRPGActor.prototype.applyDamage.call(actor, ...args);
const row = (target, position, amount) => ({ kind: 'healthSlotValue', target, position, amount });
const mods = (...rows) => makeEffect({ flags: { buildMods: rows } });

/* -------------------------------------------- */
/*  Slot count and values                       */
/* -------------------------------------------- */

test('the slot count takes the modifier, never below 1 or above 100', () => {
  assert.equal(slotCountOf(10, 0), 10);
  assert.equal(slotCountOf(10, -1), 9);
  assert.equal(slotCountOf(10, 3), 13);
  assert.equal(slotCountOf(10, -50), 1);
  assert.equal(slotCountOf(90, 50), 100);
  assert.equal(slotCountOf(10, undefined), 10);
});

test('with no rows every slot is worth the base value', () => {
  assert.deepEqual(slotValues(4, 3), [3, 3, 3, 3]);
  assert.equal(capacityOf(slotValues(10, 5)), 50);
});

test('a row adds to the slot counted from the top (1 = the 100% slot) or from the bottom', () => {
  const rows = [row('top', 1, 10)];
  assert.deepEqual(slotValues(4, 3, rows), [3, 3, 3, 13]);
  assert.deepEqual(slotValues(4, 3, [row('top', 2, 2)]), [3, 3, 5, 3]);
  assert.deepEqual(slotValues(4, 3, [row('bottom', 1, 1)]), [4, 3, 3, 3]);
  assert.deepEqual(slotValues(4, 3, [row('bottom', 4, 1)]), [3, 3, 3, 4]);
  // The top slot stays the top slot when the bar is shorter or longer.
  assert.deepEqual(slotValues(2, 3, rows), [3, 13]);
  assert.deepEqual(slotValues(6, 3, rows), [3, 3, 3, 3, 3, 13]);
});

test('rows add up, a slot that is not there is skipped, and a slot is worth at least 1', () => {
  assert.deepEqual(slotValues(3, 2, [row('top', 1, 10), row('bottom', 3, 5), row('top', 1, -4)]), [2, 2, 13]);
  assert.deepEqual(slotValues(3, 2, [row('top', 4, 10), row('bottom', 9, 10)]), [2, 2, 2]);
  assert.deepEqual(slotValues(3, 2, [row('top', 1, -50)]), [2, 2, 1]);
  assert.deepEqual(slotValues(3, 2, [{ kind: 'healthStat', target: 'str' }, row('side', 1, 5)]), [2, 2, 2]);
});

test('a slot value row is saved tidied', () => {
  const clean = cleanBuildRow({ kind: 'healthSlotValue', target: 'bottom', position: '2.7', amount: '-3' });
  assert.deepEqual(clean, { kind: 'healthSlotValue', target: 'bottom', value: '', position: 2, amount: -3 });
  // A row that just changed kind starts at the top, slot 1, +1
  const fresh = cleanBuildRow({ kind: 'healthSlotValue', target: 'evade' });
  assert.deepEqual([fresh.target, fresh.position, fresh.amount], ['top', 1, 1]);
  assert.equal(cleanBuildRow({ kind: 'healthSlotValue', target: 'top', position: '0', amount: '5' }).position, 1);
  assert.equal(slotRowProblem({ position: 3 }), false);
  assert.equal(slotRowProblem({ position: 0 }), true);
  assert.equal(slotRowProblem({ position: 1.5 }), true);
});

/* -------------------------------------------- */
/*  Damage through slots                        */
/* -------------------------------------------- */

test('even slots lose exactly what damage / value gave, rounding down', () => {
  const health = { value: 10, perBox: 3, slots: slotValues(10, 3) };
  for (let net = 0; net <= 40; net++) {
    assert.equal(boxesLost(net, health, 'floor'), Math.floor(net / 3), `net ${net}`);
  }
  assert.equal(boxesLost(4, health, 'ceil'), 2);
  assert.equal(boxesLost(4, health, 'round'), 1);
  assert.equal(boxesLost(5, health, 'round'), 2);
  // Overkill is counted past the last slot as before.
  assert.equal(boxesLost(500, health, 'floor'), 166);
});

test('a missing slot list falls back to the base value, and to 1 with none', () => {
  assert.equal(boxesLost(10, { value: 10, perBox: 4 }), 2);
  assert.equal(boxesLost(10, { value: 20 }), 10);
});

test('a bigger 100% slot is lost first and takes its extra damage', () => {
  const slots = slotValues(10, 3, [row('top', 1, 10)]); // top slot absorbs 13
  const full = { value: 10, perBox: 3, slots };
  assert.equal(boxesLost(12, full), 0); // not enough for the top slot, leftover lost
  assert.equal(boxesLost(13, full), 1);
  assert.equal(boxesLost(16, full), 2); // 13 + 3
  assert.equal(boxesLost(15, full), 1); // 13, then 2 left of a 3 slot
  // With the top slot already gone, hits land on plain slots.
  assert.equal(boxesLost(6, { ...full, value: 9 }), 2);
  assert.equal(boxesLost(12, { ...full, value: 9 }), 4);
});

test('damage through uneven slots works from the highest filled slot down', () => {
  const slots = slotValues(4, 2, [row('bottom', 1, 4)]); // [6, 2, 2, 2]
  assert.equal(boxesLost(6, { value: 4, perBox: 2, slots }), 3);
  assert.equal(boxesLost(11, { value: 4, perBox: 2, slots }), 3); // 2+2+2 then 5 short of the 6 slot
  assert.equal(boxesLost(12, { value: 4, perBox: 2, slots }), 4); // reaches the 6 slot last
  assert.equal(boxesLost(5, { value: 1, perBox: 2, slots }), 0); // the 6 slot alone
});

/* -------------------------------------------- */
/*  Crawlers                                    */
/* -------------------------------------------- */

test('a Health Bar slot value row from an effect that is on raises that slot', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 }, effects: [mods(row('top', 1, 10))] }); // 3 a slot
  assert.equal(crawler.system.health.max, 10);
  assert.equal(crawler.system.health.slots[9], 13);
  assert.equal(crawler.system.health.slots[8], 3);
  assert.equal(crawler.system.health.capacity, 40);
  assert.equal(healthSlotRowsOf(crawler).length, 1);

  const off = await makeCrawler({
    abilities: { con: 6 },
    effects: [makeEffect({ flags: { buildMods: [row('top', 1, 10)] }, disabled: true })],
  });
  assert.equal(off.system.health.slots[9], 3);
  assert.equal(off.system.health.capacity, 30);
});

test('Top slot bonus: a hit under the bigger 100% slot does nothing, a hit past it takes the slot', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 }, effects: [mods(row('top', 1, 10))] });
  const small = await applyDamage(crawler, 12);
  assert.deepEqual([small.net, small.boxes, small.value], [12, 0, 10]);
  const big = await applyDamage(crawler, 16); // 13 + 3
  assert.deepEqual([big.boxes, big.value], [2, 8]);
  assert.equal(crawler.system.health.value, 8);
});

test('Shorter bar: a slot taken off gives a shorter bar, and the damage already taken is only clamped', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 }, bonuses: { healthSlots: -1 } });
  assert.equal(crawler.system.health.max, 9);
  assert.equal(crawler.system.health.value, 9); // full bar is clamped to the new max
  assert.equal(crawler.system.health.slots.length, 9);
  assert.equal(crawler.system.health.capacity, 27);

  const hurt = await makeCrawler({ abilities: { con: 6 }, bonuses: { healthSlots: -1 }, system: { health: { value: 7 } } });
  assert.deepEqual([hurt.system.health.value, hurt.system.health.max], [7, 9]);

  const plain = await makeCrawler({ abilities: { con: 6 }, system: { health: { value: 7 } } });
  assert.deepEqual([plain.system.health.value, plain.system.health.max], [7, 10]);
});

test('slots can be added, a crawler keeps at least 1, and the top slot row follows the bar', async () => {
  const more = await makeCrawler({ abilities: { con: 6 }, bonuses: { healthSlots: 2 }, effects: [mods(row('top', 1, 10))] });
  assert.equal(more.system.health.max, 12);
  assert.equal(more.system.health.value, 10); // a new slot comes in empty
  assert.equal(more.system.health.slots.at(-1), 13);
  const least = await makeCrawler({ bonuses: { healthSlots: -40 } });
  assert.equal(least.system.health.max, 1);
  assert.equal(least.system.health.value, 1);
});

test('without these effects a crawler\'s health works as it always did', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 } });
  assert.equal(crawler.system.health.max, 10);
  assert.deepEqual(crawler.system.health.slots, Array(10).fill(3));
  assert.equal(crawler.system.health.capacity, 30);
  const result = await applyDamage(crawler, 8);
  assert.deepEqual([result.boxes, result.value], [2, 8]);
});

/* -------------------------------------------- */
/*  Mobs                                        */
/* -------------------------------------------- */

function mobWith({ con = 1, health = {}, bonuses = {}, effects = [] } = {}) {
  const stats = ['str', 'int', 'con', 'dex', 'cha'];
  const system = {
    abilities: Object.fromEntries(stats.map((k) => [k, { value: k === 'con' ? con : 1 }])),
    bonuses: { dr: 0, evade: 0, move: 0, actions: 0, surprise: 0, ...bonuses },
    attributes: { level: { value: 1 } },
    floorPinned: false,
    floorPin: null,
    dr: 0,
    move: 0,
    mobType: 'basic',
    actions: { base: 2 },
    health: { value: 10, max: 10, ...health },
  };
  const actor = makeActor({ type: 'mob', system, effects });
  system.parent = actor;
  Mob.prototype.prepareDerivedData.call(system);
  return actor;
}

test('each of a mob\'s health points is a slot worth its CON modifier, and effects change them like a crawler\'s', () => {
  const mob = mobWith({ con: 6, health: { max: 10 } }); // Con 6 is +3
  assert.equal(mob.system.health.max, 10);
  assert.equal(mob.system.health.perBox, 3);
  assert.deepEqual(mob.system.health.slots, Array(10).fill(3));

  const fewer = mobWith({ con: 6, health: { max: 10, value: 10 }, bonuses: { healthSlots: -2 } });
  assert.deepEqual([fewer.system.health.max, fewer.system.health.baseMax, fewer.system.health.value], [8, 10, 8]);

  const tough = mobWith({ con: 6, health: { max: 5 }, effects: [mods(row('top', 1, 4), row('bottom', 1, 1))] });
  assert.deepEqual(tough.system.health.slots, [4, 3, 3, 3, 7]);
  assert.equal(tough.system.health.capacity, 20);
});

test('a mob loses a box for each CON modifier of damage past its DR', async () => {
  const mob = mobWith({ con: 6, health: { max: 20, value: 20 } }); // 3 a box
  const result = await applyDamage(mob, 10);
  assert.deepEqual([result.net, result.boxes, result.value], [9, 3, 17]); // 10 - Floor 1 DR
  assert.equal(mob.system.health.value, 17);
  const big = mobWith({ con: 6, health: { max: 5, value: 5 }, effects: [mods(row('top', 1, 10))] });
  assert.equal((await applyDamage(big, 13)).boxes, 0); // 12 past DR: the 100% box holds 13
  assert.equal((await applyDamage(big, 14)).boxes, 1);
});
