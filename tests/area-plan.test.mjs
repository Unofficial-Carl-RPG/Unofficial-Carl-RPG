import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaSteps, lastsRounds, splashReach } from '../module/helpers/area-plan.mjs';
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
