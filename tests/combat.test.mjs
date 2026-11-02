import { world, makeActor, makeItem, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { degreeOf, checkDC, sizeClassOf, evadeOf, naturalD20 } from '../module/helpers/attacks.mjs';
import { CarlRPGActor } from '../module/documents/actor.mjs';

beforeEach(() => world.reset());

const checkItem = (target) => makeItem({ type: 'skill', system: { check: { target } } });
const applyDamage = (actor, ...args) => CarlRPGActor.prototype.applyDamage.call(actor, ...args);

/* -------------------------------------------- */
/*  Degrees of success                          */
/* -------------------------------------------- */

test('degrees of success follow the margin over the number to beat', () => {
  const rows = [
    // [natural, total, dc, degree]
    [20, 1, 50, 'critHit'], // a natural 20 always hits
    [1, 99, 5, 'critFail'], // a natural 1 always fails
    [10, 22, 12, 'amazing'], // beat it by 10
    [10, 21, 12, 'success'], // by 9
    [10, 12, 12, 'success'], // by 0
    [10, 11, 12, 'nearMiss'], // missed by 1
    [10, 10, 12, 'nearMiss'], // missed by 2
    [10, 9, 12, 'fail'], // missed by 3
    [10, 3, 12, 'fail'], // missed by 9
    [10, 2, 12, 'majorFail'], // missed by 10
    [null, 22, 12, 'amazing'], // no d20 (a flat check) still uses the margin
  ];
  for (const [natural, total, dc, degree] of rows) {
    assert.equal(degreeOf(natural, total, dc), degree, `natural ${natural}, ${total} vs ${dc}`);
  }
});

test('the natural d20 is the kept die (advantage and disadvantage drop the other)', () => {
  const roll = {
    dice: [{ faces: 20, results: [{ active: false, result: 3 }, { active: true, result: 17 }] }],
  };
  assert.equal(naturalD20(roll), 17);
  assert.equal(naturalD20({ dice: [{ faces: 6, results: [{ active: true, result: 4 }] }] }), null);
  assert.equal(naturalD20(null), null);
});

/* -------------------------------------------- */
/*  What a roll has to reach                    */
/* -------------------------------------------- */

test('an unopposed check needs 10 + 2 x Floor and no target', () => {
  world.settings.floor = 3;
  assert.equal(checkDC(checkItem('unopposed'), null), 16);
});

test('an Evade check needs the target\'s Evade (crawlers and pets work it out, mobs have a set total)', async () => {
  const crawler = await makeCrawler({ abilities: { dex: 20 } }); // Dex 20 is a +5 modifier
  assert.equal(evadeOf(crawler), 5);
  assert.equal(checkDC(checkItem('evade'), crawler), 5);
  const mob = makeActor({ type: 'mob', system: { evadeTotal: 14 } });
  assert.equal(evadeOf(mob), 14);
  assert.equal(checkDC(checkItem('evade'), mob), 14);
});

test('a stat or Size Class check needs 10 + the target\'s number + the Floor', async () => {
  world.settings.floor = 2;
  const crawler = await makeCrawler({ abilities: { str: 6, dex: 1 } }); // Str 6 is +3
  assert.equal(checkDC(checkItem('str'), crawler), 10 + 3 + 2);
  assert.equal(checkDC(checkItem('size'), crawler), 10 + 4 + 2); // Medium is Size Class 4
});

test('a mob counts with its own pinned Floor', () => {
  world.settings.floor = 2;
  const mob = makeActor({ type: 'mob', system: { floor: 7, size: 'large', abilities: { con: { mod: 2 } } } });
  assert.equal(checkDC(checkItem('size'), mob), 10 + 5 + 7);
  assert.equal(checkDC(checkItem('con'), mob), 10 + 2 + 7);
});

test('a check that needs a target says so when there is none', () => {
  assert.equal(checkDC(checkItem('evade'), null), null);
  assert.equal(checkDC(checkItem('str'), null), null);
  assert.equal(checkDC(checkItem('size'), null), null);
});

test('Size Class runs from Tiny 1 to Gargantuan 8, and a pet\'s upgraded size wins', () => {
  const sizes = ['tiny', 'small', 'petite', 'medium', 'large', 'huge', 'colossal', 'gargantuan'];
  sizes.forEach((size, i) => {
    assert.equal(sizeClassOf({ system: { size } }), i + 1, size);
  });
  assert.equal(sizeClassOf({ system: { size: 'small', effectiveSize: 'large' } }), 5);
  assert.equal(sizeClassOf({ system: { size: 'nonsense' } }), 1);
});

/* -------------------------------------------- */
/*  Damage and health boxes                     */
/* -------------------------------------------- */

test('a crawler loses (damage - DR) / CON modifier health boxes; the leftover is lost', async () => {
  const gear = makeItem({ type: 'gear', system: { equipped: true, dr: 2 } });
  const crawler = await makeCrawler({ abilities: { con: 6 }, items: [gear] }); // Con 6 is +3: 3 damage a box
  assert.equal(crawler.system.health.perBox, 3);
  assert.equal(crawler.system.dr.total, 2);

  const result = await applyDamage(crawler, 10); // 10 - 2 DR = 8; 8 / 3 = 2 boxes, 2 damage left over
  assert.deepEqual([result.net, result.boxes, result.value], [8, 2, 8]);
  assert.equal(crawler.system.health.value, 8);
  assert.equal(world.chat.length, 1);
});

test('damage that does not fill a box does nothing, and the leftover does not carry over', async () => {
  const crawler = await makeCrawler({ abilities: { con: 6 } }); // 3 damage a box
  await applyDamage(crawler, 2);
  await applyDamage(crawler, 2);
  assert.equal(crawler.system.health.value, 10);
});

test('only equipped gear gives Damage Resistance, and DR can be ignored', async () => {
  const worn = makeItem({ type: 'gear', system: { equipped: true, dr: 4 } });
  const packed = makeItem({ type: 'gear', system: { equipped: false, dr: 9 } });
  const crawler = await makeCrawler({ abilities: { con: 6 }, items: [worn, packed] });
  assert.equal(crawler.system.dr.armor, 4);
  const result = await applyDamage(crawler, 9, { ignoreDR: true });
  assert.deepEqual([result.dr, result.net, result.boxes], [0, 9, 3]);
  assert.equal(crawler.system.health.value, 7);
});

test('damage at or under the DR does nothing, and health never goes below 0', async () => {
  const gear = makeItem({ type: 'gear', system: { equipped: true, dr: 5 } });
  const crawler = await makeCrawler({ abilities: { con: 6 }, items: [gear] });
  const none = await applyDamage(crawler, 5);
  assert.deepEqual([none.net, none.boxes], [0, 0]);
  await applyDamage(crawler, 500);
  assert.equal(crawler.system.health.value, 0);
});

test('a crawler always has 10 health boxes, each worth its CON modifier', async () => {
  const crawler = await makeCrawler({ abilities: { con: 20 } }); // Con 20 is +5
  assert.equal(crawler.system.health.max, 10);
  assert.equal(crawler.system.health.perBox, 5);
  assert.equal(crawler.system.health.capacity, 50);
});

test('a mob takes its DR off, then loses a health point for each point left', async () => {
  const mob = makeActor({ type: 'mob', system: { drTotal: 3, health: { value: 20 } } });
  const result = await applyDamage(mob, 10);
  assert.deepEqual([result.dr, result.net, result.value], [3, 7, 13]);
  assert.equal(mob.system.health.value, 13);

  const ignored = await applyDamage(mob, 10, { ignoreDR: true });
  assert.equal(ignored.value, 3);
  await applyDamage(mob, 99);
  assert.equal(mob.system.health.value, 0);
});
