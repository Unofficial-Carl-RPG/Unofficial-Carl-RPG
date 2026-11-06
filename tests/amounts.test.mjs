
import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalAmount, fillData, rangeInfo, validAmount, wholeAmount } from '../module/helpers/amounts.mjs';
import { costLabel, costPaidData, costSpan, capSpan, shiftSpan } from '../module/data/costs.mjs';

const data = { int: { mod: 3 }, str: { mod: 1 }, lvl: 4, cost: costPaidData({ mana: 2, junk: 1 }) };

test('amounts: numbers, arithmetic and roll data', () => {
  assert.equal(evalAmount('3', data), 3);
  assert.equal(evalAmount(' @int.mod + 1 ', data), 4);
  assert.equal(evalAmount('2 + 3 * 4', data), 14);
  assert.equal(evalAmount('(2 + 3) * 4', data), 20);
  assert.equal(evalAmount('-@str.mod + 5', data), 4);
  assert.equal(evalAmount('2 ** 3', data), 8);
  assert.equal(evalAmount('7 % 4', data), 3);
  assert.equal(evalAmount('floor(@lvl / 3)', data), 1);
  assert.equal(evalAmount('max(@int.mod, @str.mod, 2)', data), 3);
  assert.equal(evalAmount('min(@int.mod, @str.mod)', data), 1);
});

test('amounts: @cost is the total paid, with a number for each resource', () => {
  assert.equal(evalAmount('@cost', data), 3);
  assert.equal(evalAmount('@cost.mana', data), 2);
  assert.equal(evalAmount('@cost.junk + @cost.uses', data), 1);
  assert.equal(evalAmount('@cost.mana * 2', data), 4);
});

test('amounts: dice, unknown names and broken formulas are not amounts', () => {
  for (const bad of ['1d4', '2d6 + 1', '', '   ', '1 +', '(1', 'foo(2)', 'floor()', '@', '1 2', '1 $ 2']) {
    assert.equal(validAmount(bad), false, bad);
    assert.equal(evalAmount(bad, data), null, bad);
  }
  assert.equal(validAmount('@anything.at.all + 1'), true);
});

test('amounts: missing data and division by zero give null, never a wrong number', () => {
  assert.equal(evalAmount('@wis.mod + 1', data), null);
  assert.equal(evalAmount('@int.mod + 1', {}), null);
  assert.equal(evalAmount('1 / 0', data), null);
});

test('fillData puts roll data into a formula and leaves the dice', () => {
  assert.deepEqual(fillData('1d6 + @int.mod', data), { text: '1d6 + 3', missing: [] });
  assert.equal(fillData('2d4 * @cost', data).text, '2d4 * 3');
  assert.equal(fillData('5 + @cost.mana', data).text, '5 + 2');
  assert.equal(fillData('3 - @neg', { neg: -2 }).text, '3 - (-2)');
  assert.deepEqual(fillData('@wis.mod + @int.mod', data), { text: '@wis.mod + 3', missing: ['@wis.mod'] });
  assert.equal(fillData('1d6', data).text, '1d6');
});

test('whole amounts round down and keep to their limits', () => {
  assert.equal(wholeAmount('7 / 2', data, { min: 1 }), 3);
  assert.equal(wholeAmount('-4', data, { min: 1 }), 1);
  assert.equal(wholeAmount('99', data, { max: 5 }), 5);
  assert.equal(wholeAmount('@nope', data, { min: 1 }), 1);
  assert.equal(wholeAmount('@nope', data, { min: 1, fallback: 2 }), 2);
});

test('cost spans: fixed, formula and range rows add up per resource', () => {
  const costs = [
    { resource: 'mana', amount: '1', max: '' },
    { resource: 'mana', amount: '@int.mod', max: '@int.mod + 2' },
    { resource: 'junk', amount: '2', max: '' },
  ];
  assert.deepEqual(costSpan(costs, 'mana', data), { min: 4, max: 6, known: true, ranged: true });
  assert.deepEqual(costSpan(costs, 'junk', data), { min: 2, max: 2, known: true, ranged: false });
  assert.deepEqual(costSpan(costs, 'uses', data), { min: 0, max: 0, known: true, ranged: false });
});

test('cost spans: a max below the min is raised to it, and unknown data is flagged', () => {
  assert.equal(costSpan([{ resource: 'mana', amount: '5', max: '2' }], 'mana', data).max, 5);
  const span = costSpan([{ resource: 'mana', amount: '@int.mod', max: '' }], 'mana', {});
  assert.equal(span.known, false);
  assert.equal(span.min, 0);
});

test('cost spans: upgrades shift both ends, never below 0; the user\'s amount caps the max', () => {
  const span = { min: 1, max: 3, known: true, ranged: true };
  assert.deepEqual(shiftSpan(span, -2), { min: 0, max: 1, known: true, ranged: true });
  assert.deepEqual(shiftSpan(span, -5), { min: 0, max: 0, known: true, ranged: false });
  assert.equal(shiftSpan(span, 2).min, 3);
  assert.equal(capSpan(span, 2).max, 2);
  assert.equal(capSpan(span, 9).max, 3);
  // Having less than the least still leaves the least (the "use anyway" question handles it).
  assert.deepEqual(capSpan(span, 0), { min: 1, max: 1, known: true, ranged: false });
});

test('range: a number, a formula over roll data, or melee, touch and unlimited', () => {
  assert.deepEqual(rangeInfo('30', data), { kind: 'feet', feet: 30, text: '30' });
  assert.equal(rangeInfo(' 10 + @str.mod * 5 ', data).feet, 15);
  assert.equal(rangeInfo('floor(@lvl / 3) * 10', data).feet, 10);
  assert.equal(rangeInfo('@cost.mana * 15', data).feet, 30);
  assert.equal(rangeInfo(15, data).feet, 15);
  assert.equal(rangeInfo('Melee', data).feet, 5);
  assert.equal(rangeInfo('TOUCH', data).kind, 'touch');
  assert.equal(rangeInfo('unlimited', data).feet, Infinity);
});

test('range: blank, zero or less, unreadable and not yet known', () => {
  assert.equal(rangeInfo('', data).kind, 'none');
  assert.equal(rangeInfo(undefined, data).feet, Infinity);
  assert.equal(rangeInfo('0', data).kind, 'unlimited');
  assert.equal(rangeInfo('@str.mod - 5', data).kind, 'unlimited');
  assert.equal(rangeInfo('1d6 * 5', data).kind, 'invalid');
  assert.equal(rangeInfo('far away', data).kind, 'invalid');
  // A formula that reads fine but needs data that isn't there yet.
  const pending = rangeInfo('@nothing.here * 5', data);
  assert.equal(pending.kind, 'pending');
  assert.equal(pending.feet, Infinity);
});

test('cost labels: a number, a range, or the formulas when they cannot be worked out', () => {
  const costs = [{ resource: 'mana', amount: '1', max: '@int.mod' }];
  assert.equal(costLabel(costs, 'mana', data), '1-3');
  assert.equal(costLabel([{ resource: 'mana', amount: '2', max: '' }], 'mana', data), '2');
  assert.equal(costLabel(costs, 'mana', {}), '1-@int.mod');
  assert.equal(costLabel(costs, 'junk', data), '');
  assert.equal(costLabel([{ resource: 'mana', amount: '2', max: '' }], 'mana', data, -1), '1');
});
