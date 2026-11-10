import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areaSteps,
  countAreaShapes,
  lastsRounds,
  originAtCaster,
  SINGLE_TARGET,
  singleTarget,
  splashReach,
} from '../module/helpers/area-plan.mjs';
import { computeEffective } from '../module/helpers/upgrades.mjs';

/** A spell's system data, as the sheet would hold it. */
const spell = (rank, targeting, upgrades = []) => ({
  rank,
  damage: '1d6',
  manaCost: 3,
  check: { target: 'evade' },
  targeting: { mode: 'count', shape: 'circle', size: '10', splash: '0', lasts: '0', ...targeting },
  upgrades,
});

const up = (rank, ...changes) => ({ id: `u${rank}`, rank, changes });
const splashAdd = (value) => ({ type: 'splashAdd', value: String(value) });

/** The splash distance of a spell at some ranks. */
const reachAt = (targeting, upgrades, ranks) =>
  ranks.map((rank) => splashReach(targeting, computeEffective(spell(rank, targeting, upgrades)), { rank }));

/* -------------------------------------------- */
/*  Splash around a chosen target (Count)        */

test('splash by rank: Bad Faith +5 ft at ranks 5 and 15', () => {
  const upgrades = [up(5, splashAdd(5)), up(10), up(15, splashAdd(5))];
  assert.deepEqual(reachAt({ mode: 'count' }, upgrades, [1, 4, 5, 10, 14, 15, 20]), [0, 0, 5, 5, 5, 10, 10]);
});

test('splash by rank: Earworm +10 ft at 15, Shotgun +5 ft at 15', () => {
  assert.deepEqual(reachAt({ mode: 'count' }, [up(15, splashAdd(10))], [1, 14, 15]), [0, 0, 10]);
  assert.deepEqual(reachAt({ mode: 'count' }, [up(15, splashAdd(5))], [1, 14, 15]), [0, 0, 5]);
});

test('splash by rank: Fear +5 ft of blast radius at ranks 5, 10 and 15', () => {
  const upgrades = [up(5, splashAdd(5)), up(10, splashAdd(5)), up(15, splashAdd(5))];
  assert.deepEqual(reachAt({ mode: 'count' }, upgrades, [1, 5, 9, 10, 15]), [0, 5, 5, 10, 15]);
});

test('splash by rank: Heal Others reaches 20 ft from rank 15 only', () => {
  assert.deepEqual(reachAt({ mode: 'count' }, [up(15, splashAdd(20))], [5, 10, 14, 15]), [0, 0, 0, 20]);
});

test('splash: the Splash amount (a formula) and the upgrades add up, never below 0', () => {
  // (Fireball's own splash, unchanged for an Area item: 40 ft from rank 15)
  const fireball = { mode: 'area', splash: '40 * min(1, floor(@rank / 15))' };
  assert.deepEqual(reachAt(fireball, [], [14, 15]), [0, 40]);
  assert.deepEqual(reachAt(fireball, [up(15, splashAdd(10))], [14, 15]), [0, 50]);
  assert.deepEqual(reachAt({ mode: 'count' }, [up(5, splashAdd(-8))], [5]), [0]);
});

test('splash: a change that cannot be used is skipped', () => {
  assert.deepEqual(reachAt({ mode: 'count' }, [up(5, splashAdd('lots'))], [5]), [0]);
});

/* -------------------------------------------- */
/*  A different size per area shape              */

const fireball = [
  up(5),
  up(10, { type: 'areaShapeExtra', value: 'ray', size: '80', keep: true }),
  up(15),
];
const stepsAt = (rank, chosen, upgrades = fireball, targeting = {}) =>
  areaSteps(
    spell(rank, { mode: 'area', ...targeting }).targeting,
    computeEffective(spell(rank, { mode: 'area', ...targeting }, upgrades)),
    chosen,
    { rank }
  );

test('area shapes: Fireball is a 10 ft circle, and from rank 10 can be an 80 ft line that keeps the blast', () => {
  assert.deepEqual(stepsAt(9, 'ray'), [{ shape: 'circle', size: 10, base: false }]);
  assert.deepEqual(stepsAt(10, null), [{ shape: 'circle', size: 10, base: false }]);
  assert.deepEqual(stepsAt(10, 'circle'), [{ shape: 'circle', size: 10, base: false }]);
  assert.deepEqual(stepsAt(10, 'ray'), [
    { shape: 'ray', size: 80, base: false },
    { shape: 'circle', size: 10, base: true },
  ]);
});

test('area shapes: the line keeps its own size when the area grows, the blast does not', () => {
  const grown = [...fireball, up(15, { type: 'areaSizeAdd', value: '5' })];
  assert.deepEqual(stepsAt(15, 'ray', grown), [
    { shape: 'ray', size: 80, base: false },
    { shape: 'circle', size: 15, base: true },
  ]);
});

test('area shapes: an added shape without a size of its own uses the area size', () => {
  const upgrades = [up(5, { type: 'areaSizeAdd', value: '5' }, { type: 'areaShapeExtra', value: 'cone' })];
  assert.deepEqual(stepsAt(5, 'cone', upgrades), [{ shape: 'cone', size: 15, base: false }]);
});

test('area shapes: an added shape that does not keep the base is placed alone', () => {
  const upgrades = [up(5, { type: 'areaShapeExtra', value: 'rect', size: '25', keep: false })];
  assert.deepEqual(stepsAt(5, 'rect', upgrades), [{ shape: 'rect', size: 25, base: false }]);
});

test('area shapes: its own size can be a formula over the roll data', () => {
  const upgrades = [up(5, { type: 'areaShapeExtra', value: 'ray', size: '8 * @rank' })];
  assert.deepEqual(stepsAt(10, 'ray', upgrades), [{ shape: 'ray', size: 80, base: false }]);
  // (one that cannot be worked out falls back to the area's size)
  const broken = [up(5, { type: 'areaShapeExtra', value: 'ray', size: '8 * @nothing' })];
  assert.deepEqual(stepsAt(10, 'ray', broken), [{ shape: 'ray', size: 10, base: false }]);
});

test('area shapes: a shape that was never offered is ignored', () => {
  assert.deepEqual(stepsAt(10, 'cone'), [{ shape: 'circle', size: 10, base: false }]);
});

test('area shapes: a size that cannot be read is flagged and the shape is still offered at the area size', async () => {
  const { changeProblem } = await import('../module/helpers/upgrades.mjs');
  assert.equal(changeProblem({ type: 'areaShapeExtra', value: 'ray', size: '80' }), false);
  assert.equal(changeProblem({ type: 'areaShapeExtra', value: 'ray', size: '' }), false);
  assert.equal(changeProblem({ type: 'areaShapeExtra', value: 'ray', size: '8 *' }), true);
});

/* -------------------------------------------- */
/*  Lasting area duration by rank                */

const fog = '2 + 4 * min(1, floor(@rank / 5)) + 24 * min(1, floor(@rank / 10)) + 60 * min(1, floor(@rank / 15))';

test('lasting area: Confusing Fog lasts 2, 6, 30 and 90 rounds at ranks 1, 5, 10 and 15', () => {
  const rounds = (rank) => lastsRounds({ lasts: fog }, { rank });
  assert.deepEqual([1, 4, 5, 9, 10, 14, 15, 20].map(rounds), [2, 2, 6, 6, 30, 30, 90, 90]);
});

test('lasting area: a plain number, 0 (until removed) and bad values', () => {
  assert.equal(lastsRounds({ lasts: '3' }), 3);
  assert.equal(lastsRounds({ lasts: 3 }), 3);
  assert.equal(lastsRounds({ lasts: '0' }), 0);
  assert.equal(lastsRounds({ lasts: '2.9' }), 2);
  assert.equal(lastsRounds({ lasts: '-4' }), 0);
  assert.equal(lastsRounds({ lasts: 'forever' }), 0);
  assert.equal(lastsRounds({}), 0);
});

/* -------------------------------------------- */
/*  A Count item that can also be an area        */

const extra = (value, size, keep = false) => ({ type: 'areaShapeExtra', value, size, keep });
// Ice Blast and Thunderlash: a 15 ft cone from rank 15. Lightning Bolt: a 100 ft line from rank 10.
const iceBlast = [up(5), up(10), up(15, extra('cone', '15'))];
const lightningBolt = [up(5), up(10, extra('ray', '100')), up(15)];

const countAt = (rank, chosen, upgrades, targeting = {}) => {
  const cfg = spell(rank, { mode: 'count', ...targeting });
  return areaSteps(cfg.targeting, computeEffective(spell(rank, { mode: 'count', ...targeting }, upgrades)), chosen, {
    rank,
  });
};
const offeredAt = (rank, upgrades, targeting = { mode: 'count' }) =>
  countAreaShapes(spell(rank, targeting).targeting, computeEffective(spell(rank, targeting, upgrades)));

test('count area: Ice Blast offers a 15 ft cone from rank 15, and acts as single target before', () => {
  assert.deepEqual(offeredAt(14, iceBlast), []);
  assert.deepEqual(offeredAt(15, iceBlast), ['cone']);
  assert.deepEqual(countAt(14, 'cone', iceBlast), []);
  assert.deepEqual(countAt(15, 'cone', iceBlast), [{ shape: 'cone', size: 15, base: false }]);
  // (single target is no area at all)
  assert.deepEqual(countAt(15, null, iceBlast), []);
  assert.deepEqual(countAt(15, SINGLE_TARGET, iceBlast), []);
});

test('count area: Lightning Bolt offers a 100 ft line from rank 10', () => {
  assert.deepEqual(offeredAt(9, lightningBolt), []);
  assert.deepEqual(offeredAt(10, lightningBolt), ['ray']);
  assert.deepEqual(countAt(10, 'ray', lightningBolt), [{ shape: 'ray', size: 100, base: false }]);
  assert.deepEqual(countAt(20, 'ray', lightningBolt), [{ shape: 'ray', size: 100, base: false }]);
  // (a shape that was never offered is ignored)
  assert.deepEqual(countAt(20, 'cone', lightningBolt), []);
});

test('count area: it never keeps a base area, and the stored Size and size upgrades do not change it', () => {
  const upgrades = [up(5, extra('cone', '15', true), { type: 'areaSizeAdd', value: '10' })];
  assert.deepEqual(countAt(5, 'cone', upgrades, { size: '40' }), [{ shape: 'cone', size: 15, base: false }]);
});

test('count area: its size can be a formula, and a blank one falls back to the Size field', () => {
  assert.deepEqual(countAt(10, 'ray', [up(5, extra('ray', '10 * @rank'))]), [{ shape: 'ray', size: 100, base: false }]);
  assert.deepEqual(countAt(5, 'ray', [up(5, extra('ray', ''))], { size: '30' }), [
    { shape: 'ray', size: 30, base: false },
  ]);
});

test('count area: several shapes are offered in the order they were added, a circle too', () => {
  const upgrades = [up(5, extra('circle', '10')), up(10, extra('cone', '15')), up(15, extra('circle', '20'))];
  assert.deepEqual(offeredAt(5, upgrades), ['circle']);
  assert.deepEqual(offeredAt(10, upgrades), ['circle', 'cone']);
  // (the later size for the same shape wins, as for an Area item)
  assert.deepEqual(countAt(15, 'circle', upgrades), [{ shape: 'circle', size: 20, base: false }]);
});

test('count area: items with no such upgrades, and other modes, offer nothing new', () => {
  assert.deepEqual(offeredAt(20, []), []);
  assert.deepEqual(countAreaShapes({ mode: 'count' }, {}), []);
  assert.deepEqual(countAreaShapes({ mode: 'count' }, undefined), []);
  // (an Area item keeps using its own shapes: this is only for Count)
  assert.deepEqual(offeredAt(10, [up(5, extra('ray', '80'))], { mode: 'area' }), []);
  assert.deepEqual(offeredAt(10, [up(5, extra('ray', '80'))], { mode: 'self' }), []);
  assert.deepEqual(stepsAt(10, null), [{ shape: 'circle', size: 10, base: false }]);
});

test('count area: splash for the area version is the item splash plus the upgrades', () => {
  const upgrades = [up(15, extra('cone', '15'), splashAdd(5))];
  const targeting = { mode: 'count', splash: '5' };
  assert.equal(splashReach(targeting, computeEffective(spell(15, targeting, upgrades)), { rank: 15 }), 10);
});

test('count area: the origin has to be within a grid square of the caster token', () => {
  // (a 5 ft token: its square corner is about 3.5 ft from the centre)
  assert.equal(originAtCaster(0, 5), true);
  assert.equal(originAtCaster(3.6, 5), true);
  assert.equal(originAtCaster(7.5, 5), true);
  assert.equal(originAtCaster(7.6, 5), false);
  // (a 10 ft token reaches 5 ft further out from its centre)
  assert.equal(originAtCaster(10, 10), true);
  assert.equal(originAtCaster(10.1, 10), false);
  assert.equal(originAtCaster(12, 5, 10), true);
});

test('single target: a Count item whose target count works out to 1', () => {
  assert.equal(singleTarget({ mode: 'count', count: '1' }), true);
  assert.equal(singleTarget({ mode: 'count', count: '3' }), false);
  // the count is an amount: it can read roll data
  assert.equal(singleTarget({ mode: 'count', count: '@rank' }, { rank: 1 }), true);
  assert.equal(singleTarget({ mode: 'count', count: '1 + @rank' }, { rank: 1 }), false);
  // a blank or unreadable count is 1, like the target prompt
  assert.equal(singleTarget({ mode: 'count', count: '' }), true);
  assert.equal(singleTarget({ mode: 'count', count: 'nonsense' }), true);
  // other modes, and no targeting, are not single-target
  assert.equal(singleTarget({ mode: 'area', count: '1' }), false);
  assert.equal(singleTarget({ mode: 'none', count: '1' }), false);
  assert.equal(singleTarget(null), false);
});
