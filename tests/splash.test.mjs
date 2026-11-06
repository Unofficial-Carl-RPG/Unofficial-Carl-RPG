import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSplash,
  distanceToShape,
  noteArea,
  setSplash,
  splashBand,
  takeSplash,
} from '../module/helpers/splash.mjs';

const circle = { x: 0, y: 0, radius: 100 };
const rect = { x: 0, y: 0, width: 100, height: 50 };
const square = { points: [0, 0, 100, 0, 100, 100, 0, 100] };

test('splash: distance to a circle, rectangle and polygon', () => {
  assert.equal(distanceToShape(circle, { x: 50, y: 0 }), 0);
  assert.equal(distanceToShape(circle, { x: 130, y: 0 }), 30);
  assert.equal(distanceToShape(rect, { x: 50, y: 20 }), 0);
  assert.equal(distanceToShape(rect, { x: 130, y: 20 }), 30);
  assert.equal(distanceToShape(rect, { x: 130, y: 90 }), 50);
  assert.equal(distanceToShape(square, { x: 50, y: 50 }), 0);
  assert.equal(distanceToShape(square, { x: 100, y: 130 }), 30);
  assert.equal(distanceToShape(square, { x: 130, y: 140 }), 50);
  assert.equal(distanceToShape(null, { x: 0, y: 0 }), Infinity);
  assert.equal(distanceToShape({}, { x: 0, y: 0 }), Infinity);
});

test('splash: the band is outside the area and within reach of its edge', () => {
  const points = [
    { id: 'in', x: 20, y: 0 },
    { id: 'near', x: 130, y: 0 },
    { id: 'edge', x: 150, y: 0 },
    { id: 'far', x: 151, y: 0 },
  ];
  assert.deepEqual(splashBand(circle, 50, points, ['in']), ['near', 'edge']);
  // A token already inside is never splash, whatever skip says.
  assert.deepEqual(splashBand(circle, 50, points), ['in', 'near', 'edge']);
  assert.deepEqual(splashBand(circle, 0, points), []);
  assert.deepEqual(splashBand(circle, -5, points), []);
});

test('splash: a cone-like polygon splashes around its edge', () => {
  const cone = { points: [0, 0, 100, -40, 100, 40] };
  assert.equal(distanceToShape(cone, { x: 60, y: 0 }), 0);
  assert.ok(distanceToShape(cone, { x: 60, y: 60 }) > 20);
  assert.equal(distanceToShape(cone, { x: 130, y: 0 }), 30);
  assert.equal(distanceToShape(cone, { x: -20, y: 0 }), 20);
});

test('splash: what a placement finds is taken once, by its own item', () => {
  clearSplash();
  noteArea('Item.a', ['t1'], ['t2', 't3']);
  assert.deepEqual(takeSplash('Item.b'), []);
  // (taking for another item forgets it)
  assert.deepEqual(takeSplash('Item.a'), []);
  noteArea('Item.a', ['t1'], ['t2', 't3']);
  assert.deepEqual(takeSplash('Item.a').sort(), ['t2', 't3']);
  assert.deepEqual(takeSplash('Item.a'), []);
});

test('splash: a token inside any of the item\'s areas is never splash', () => {
  clearSplash();
  noteArea('Item.a', ['t1'], ['t2', 't3']);
  noteArea('Item.a', ['t2'], ['t1', 't4']);
  assert.deepEqual(takeSplash('Item.a').sort(), ['t3', 't4']);
});

test('splash: a new target prompt forgets the last one; a declared use sets it back', () => {
  noteArea('Item.a', [], ['t2']);
  clearSplash();
  assert.deepEqual(takeSplash('Item.a'), []);
  setSplash('Item.a', ['t5']);
  assert.deepEqual(takeSplash('Item.a'), ['t5']);
  setSplash('Item.a', []);
  assert.deepEqual(takeSplash('Item.a'), []);
});
