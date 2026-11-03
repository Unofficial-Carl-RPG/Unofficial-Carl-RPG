import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, manaCostOf, migrateCosts, usesCost } from '../module/data/costs.mjs';

test('costs add up per resource', () => {
  const costs = [
    { resource: 'mana', amount: 2 },
    { resource: 'junk', amount: 3 },
    { resource: 'mana', amount: 1 },
    { resource: 'uses', amount: 2 },
  ];
  assert.equal(costOf(costs, 'mana'), 3);
  assert.equal(costOf(costs, 'junk'), 3);
  assert.equal(usesCost({ system: { costs } }), 2);
  assert.equal(costOf(undefined, 'mana'), 0);
});

test('mana cost comes from the costs, or an old spell number before they exist', () => {
  assert.equal(manaCostOf([{ resource: 'mana', amount: 4 }], 9), 4);
  assert.equal(manaCostOf([], 9), 0);
  assert.equal(manaCostOf(undefined, 9), 9);
  assert.equal(manaCostOf(undefined), 0);
});

test('old items: a spell mana cost and a use limit become cost rows', () => {
  assert.deepEqual(migrateCosts({ manaCost: 3, uses: { max: 2 } }).costs, [
    { resource: 'mana', amount: 3 },
    { resource: 'uses', amount: 1 },
  ]);
  assert.deepEqual(migrateCosts({ manaCost: 0, uses: { max: 0 } }).costs, []);
  const kept = { costs: [{ resource: 'junk', amount: 1 }], manaCost: 5 };
  assert.deepEqual(migrateCosts(kept).costs, [{ resource: 'junk', amount: 1 }]);
});

test('a partial update never gets costs added (they would reset the real ones)', () => {
  // Foundry runs the migration on update data like this too.
  assert.equal('costs' in migrateCosts({}), false);
  assert.equal('costs' in migrateCosts({ equipped: true }), false);
  assert.equal('costs' in migrateCosts({ uses: { max: 3 } }), false);
});
