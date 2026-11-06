import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeProblem, computeEffective, effectiveOf } from '../module/helpers/upgrades.mjs';

const spell = (rank, upgrades) => ({
  rank,
  damage: '1d6',
  manaCost: 3,
  check: { target: 'evade' },
  targeting: { mode: 'area', shape: 'circle', size: '10' },
  upgrades,
});

const up = (rank, ...changes) => ({ id: `u${rank}`, rank, changes });

test('area upgrades: with none reached the area is as the item has it', () => {
  const e = computeEffective(spell(1, [up(5, { type: 'areaShape', value: 'cone' })]));
  assert.equal(e.areaShape, 'circle');
  assert.deepEqual(e.areaShapes, ['circle']);
  assert.equal(e.areaSize, '10');
  assert.equal(e.areaSizeDelta, 0);
});

test('area upgrades: a shape change replaces the shape, the last one wins', () => {
  const upgrades = [up(5, { type: 'areaShape', value: 'cone' }), up(10, { type: 'areaShape', value: 'ray' })];
  assert.equal(computeEffective(spell(5, upgrades)).areaShape, 'cone');
  assert.equal(computeEffective(spell(10, upgrades)).areaShape, 'ray');
  // Lowering the rank undoes it: nothing was written.
  assert.equal(computeEffective(spell(4, upgrades)).areaShape, 'circle');
});

test('area upgrades: extra shapes are offered after the base one, once each', () => {
  const upgrades = [
    up(5, { type: 'areaShapeExtra', value: 'cone' }),
    up(10, { type: 'areaShapeExtra', value: 'rect' }, { type: 'areaShapeExtra', value: 'cone' }),
    up(15, { type: 'areaShapeExtra', value: 'circle' }),
  ];
  assert.deepEqual(computeEffective(spell(5, upgrades)).areaShapes, ['circle', 'cone']);
  assert.deepEqual(computeEffective(spell(10, upgrades)).areaShapes, ['circle', 'cone', 'rect']);
  // (the base shape is not listed twice)
  assert.deepEqual(computeEffective(spell(15, upgrades)).areaShapes, ['circle', 'cone', 'rect']);
});

test('area upgrades: a changed shape is the base the extras are added to', () => {
  const upgrades = [up(5, { type: 'areaShapeExtra', value: 'cone' }), up(10, { type: 'areaShape', value: 'cone' })];
  const e = computeEffective(spell(10, upgrades));
  assert.equal(e.areaShape, 'cone');
  assert.deepEqual(e.areaShapes, ['cone']);
});

test('area upgrades: size is added to, or replaced (which drops earlier additions)', () => {
  const upgrades = [
    up(5, { type: 'areaSizeAdd', value: '5' }),
    up(10, { type: 'areaSizeAdd', value: '-2' }),
    up(15, { type: 'areaSizeReplace', value: '20 + @int.mod' }),
    up(20, { type: 'areaSizeAdd', value: '10' }),
  ];
  const at = (rank) => computeEffective(spell(rank, upgrades));
  assert.deepEqual([at(5).areaSize, at(5).areaSizeDelta], ['10', 5]);
  assert.deepEqual([at(10).areaSize, at(10).areaSizeDelta], ['10', 3]);
  assert.deepEqual([at(15).areaSize, at(15).areaSizeDelta], ['20 + @int.mod', 0]);
  assert.deepEqual([at(20).areaSize, at(20).areaSizeDelta], ['20 + @int.mod', 10]);
});

test('area upgrades: changes that cannot be used are flagged and skipped', () => {
  assert.equal(changeProblem({ type: 'areaShape', value: 'cone' }), false);
  assert.equal(changeProblem({ type: 'areaShape', value: 'star' }), true);
  assert.equal(changeProblem({ type: 'areaShape', value: 'constructor' }), true);
  assert.equal(changeProblem({ type: 'areaShapeExtra', value: '' }), true);
  assert.equal(changeProblem({ type: 'areaSizeAdd', value: '5' }), false);
  assert.equal(changeProblem({ type: 'areaSizeAdd', value: 'lots' }), true);
  assert.equal(changeProblem({ type: 'areaSizeReplace', value: '10 + @str.mod' }), false);
  assert.equal(changeProblem({ type: 'areaSizeReplace', value: '' }), true);
  const bad = [up(5, { type: 'areaShape', value: 'star' }, { type: 'areaSizeAdd', value: 'x' })];
  const e = computeEffective(spell(5, bad));
  assert.deepEqual([e.areaShape, e.areaSizeDelta], ['circle', 0]);
});

test('area upgrades: an item with no upgrades gives its own shape and size', () => {
  const e = effectiveOf({ system: { targeting: { shape: 'ray', size: '30' }, damage: '1d4', check: {} } });
  assert.deepEqual([e.areaShape, e.areaShapes, e.areaSize, e.areaSizeDelta], ['ray', ['ray'], '30', 0]);
});
