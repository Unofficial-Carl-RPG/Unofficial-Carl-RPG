import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ammoAmountLabel,
  ammoHave,
  ammoKey,
  ammoName,
  ammoRows,
  ammoSpan,
  ammoStacks,
  largestStack,
  matchesAmmo,
} from '../module/helpers/ammo.mjs';
import { costPaidData } from '../module/data/costs.mjs';

const item = (id, name, qty, system = {}, type = 'item') => ({
  id,
  name,
  type,
  system: { quantity: qty, ...system },
});

/* -------------------------------------------- */
/*  Which items count                           */
/* -------------------------------------------- */

test('a dropped item matches by Identifier when both have one, else by name', () => {
  const row = { resource: 'ammo', name: 'Arrow', identifier: 'arrow' };
  assert.equal(matchesAmmo(row, item('a', 'Wooden Arrow', 5, { identifier: 'ARROW' })), true);
  assert.equal(matchesAmmo(row, item('b', 'Arrow', 5)), true);
  assert.equal(matchesAmmo(row, item('c', 'Bolt', 5, { identifier: 'bolt' })), false);
  assert.equal(matchesAmmo(row, item('d', 'Bolt', 5)), false);
  assert.equal(matchesAmmo({ name: 'Arrow' }, item('e', 'arrow ', 5, { identifier: 'x' })), true);
});

test('a tag matches any inventory item that carries it, ignoring case', () => {
  const row = { resource: 'ammo', tag: 'Arrow' };
  assert.equal(matchesAmmo(row, item('a', 'Fire Arrow', 3, { tags: ['arrow', 'fire'] })), true);
  assert.equal(matchesAmmo(row, item('b', 'Bolt', 3, { tags: ['bolt'] })), false);
  assert.equal(matchesAmmo(row, item('c', 'Bolt', 3)), false);
});

test('a row with an item and a tag matches either; an empty row matches nothing', () => {
  const row = { resource: 'ammo', name: 'Arrow', tag: 'bolt' };
  assert.equal(matchesAmmo(row, item('a', 'Arrow', 1)), true);
  assert.equal(matchesAmmo(row, item('b', 'Steel Bolt', 1, { tags: ['bolt'] })), true);
  assert.equal(matchesAmmo({ resource: 'ammo' }, item('c', 'Arrow', 1)), false);
});

test('gear is never ammunition', () => {
  const row = { resource: 'ammo', name: 'Arrow', tag: 'arrow' };
  assert.equal(matchesAmmo(row, item('a', 'Arrow', 1, { tags: ['arrow'] }, 'gear')), false);
});

/* -------------------------------------------- */
/*  Stacks                                      */
/* -------------------------------------------- */

test('stacks list matching items that have some left, in order', () => {
  const row = { resource: 'ammo', tag: 'arrow' };
  const items = [
    item('a', 'Fire Arrow', 2, { tags: ['arrow'] }),
    item('b', 'Empty Arrow', 0, { tags: ['arrow'] }),
    item('c', 'Torch', 9),
    item('d', 'Ice Arrow', 7, { tags: ['arrow'] }),
  ];
  assert.deepEqual(ammoStacks(row, items), [
    { id: 'a', name: 'Fire Arrow', qty: 2 },
    { id: 'd', name: 'Ice Arrow', qty: 7 },
  ]);
  assert.equal(largestStack(ammoStacks(row, items)).id, 'd');
  assert.equal(ammoHave(row, items), 7);
});

test('what is already set aside is not free to spend again', () => {
  const row = { resource: 'ammo', name: 'Arrow' };
  const items = [item('a', 'Arrow', 3)];
  assert.deepEqual(ammoStacks(row, items, { a: 2 }), [{ id: 'a', name: 'Arrow', qty: 1 }]);
  assert.deepEqual(ammoStacks(row, items, { a: 3 }), []);
  assert.equal(largestStack([]), null);
  assert.equal(ammoHave(row, []), 0);
});

/* -------------------------------------------- */
/*  Rows and amounts                            */
/* -------------------------------------------- */

test('ammunition rows keep their place in the costs and have their own key', () => {
  const costs = [
    { resource: 'mana', amount: '1' },
    { resource: 'ammo', amount: '1', name: 'Arrow' },
    { resource: 'uses', amount: '1' },
    { resource: 'ammo', amount: '2', tag: 'bolt' },
  ];
  assert.deepEqual(
    ammoRows(costs).map((r) => r.index),
    [1, 3]
  );
  assert.equal(ammoKey(3), 'ammo:3');
  assert.equal(ammoName(costs[1]), 'Arrow');
  assert.equal(ammoName(costs[3]), 'bolt');
  assert.equal(ammoName({}), '');
  assert.deepEqual(ammoRows(undefined), []);
});

test('an ammunition amount is a number, a formula or a range', () => {
  assert.deepEqual(ammoSpan({ resource: 'ammo', amount: '2' }), { min: 2, max: 2, known: true, ranged: false });
  const burst = { resource: 'ammo', amount: '1', max: '@rank' };
  const span = ammoSpan(burst, { rank: 3 });
  assert.equal(span.min, 1);
  assert.equal(span.max, 3);
  assert.equal(span.ranged, true);
  assert.equal(ammoAmountLabel(burst, { rank: 3 }), '1-3');
  assert.equal(ammoAmountLabel({ resource: 'ammo', amount: '2' }), '2');
});

test('ammunition counts in what @cost reads, and in its total', () => {
  assert.deepEqual(costPaidData({ mana: 1, junk: 2, uses: 3, ammo: 4 }), {
    mana: 1,
    junk: 2,
    uses: 3,
    ammo: 4,
    total: 10,
  });
  assert.equal(costPaidData({ mana: 2 }).total, 2);
  assert.equal(costPaidData().ammo, 0);
});
