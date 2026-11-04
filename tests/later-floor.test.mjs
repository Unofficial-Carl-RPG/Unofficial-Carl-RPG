import { world } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { laterStart } from '../module/helpers/creation.mjs';

beforeEach(() => world.reset());

const defaults = {
  laterFloors: [
    { floor: 3, level: 9, gold: 500 },
    { floor: 5, level: 17, gold: 4000 },
  ],
};

test('a later-floor start is the row for the exact floor', () => {
  assert.deepEqual(laterStart(defaults, 5), { floor: 5, level: 17, gold: 4000 });
  assert.deepEqual(laterStart(defaults, 3), { floor: 3, level: 9, gold: 500 });
});

test('floors with no row start as a normal crawler', () => {
  assert.equal(laterStart(defaults, 1), null);
  assert.equal(laterStart(defaults, 4), null);
  assert.equal(laterStart({}, 3), null);
});
