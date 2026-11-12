import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_ALSO_TYPE,
  bonusFormula,
  changesDamage,
  chosenTypes,
  manualMultiplier,
} from '../module/helpers/damage-options.mjs';
import { targetDamage } from '../module/helpers/damage-multiply.mjs';

// (a formula the stand-in dice can read: numbers, dice and + - signs)
const validate = (formula) => /^[\dd+\-\s]+$/.test(formula);

test('bonus damage: blank is nothing, a leading + is dropped, junk is an error', () => {
  assert.equal(bonusFormula('', validate), null);
  assert.equal(bonusFormula('   ', validate), null);
  assert.equal(bonusFormula(undefined, validate), null);
  assert.deepEqual(bonusFormula('2', validate), { formula: '2' });
  assert.deepEqual(bonusFormula('+ 1d4', validate), { formula: '1d4' });
  assert.deepEqual(bonusFormula('1d6 + 2', validate), { formula: '1d6 + 2' });
  assert.deepEqual(bonusFormula('lots', validate), { error: true });
});

test('multiplier: only a number above zero counts, anything else is x1', () => {
  assert.equal(manualMultiplier(''), 1);
  assert.equal(manualMultiplier('abc'), 1);
  assert.equal(manualMultiplier(0), 1);
  assert.equal(manualMultiplier(-2), 1);
  assert.equal(manualMultiplier('2'), 2);
  assert.equal(manualMultiplier('0.5'), 0.5);
});

test('types: as written keeps the item\'s, a pick replaces it, the second can be cleared', () => {
  const own = { type: 'fire', also: 'ice' };
  assert.deepEqual(chosenTypes({}, own), { damageType: 'fire', damageTypeAlso: 'ice' });
  assert.deepEqual(chosenTypes({ type: 'acid' }, own), { damageType: 'acid', damageTypeAlso: 'ice' });
  assert.deepEqual(chosenTypes({ also: NO_ALSO_TYPE }, own), { damageType: 'fire', damageTypeAlso: '' });
  assert.deepEqual(chosenTypes({ type: 'acid', also: 'poison' }, own), {
    damageType: 'acid',
    damageTypeAlso: 'poison',
  });
});

test('types: a second type the same as the first, or with no first, is dropped', () => {
  assert.deepEqual(chosenTypes({ type: 'ice' }, { type: 'fire', also: 'ice' }), {
    damageType: 'ice',
    damageTypeAlso: '',
  });
  assert.deepEqual(chosenTypes({ also: 'ice' }, { type: '', also: '' }), {
    damageType: '',
    damageTypeAlso: '',
  });
  // an item with no type can be given one
  assert.deepEqual(chosenTypes({ type: 'fire' }, {}), { damageType: 'fire', damageTypeAlso: '' });
});

test('changesDamage: only real changes count', () => {
  assert.equal(changesDamage(null), false);
  assert.equal(changesDamage({ multiplier: 1, ignoreDR: false }, { armorPiercing: false }), false);
  assert.equal(changesDamage({ multiplier: 1, ignoreDR: true }, { armorPiercing: true }), false);
  assert.equal(changesDamage({ multiplier: 1, ignoreDR: true }, { armorPiercing: false }), true);
  assert.equal(changesDamage({ multiplier: 2, ignoreDR: false }, {}), true);
  assert.equal(changesDamage({ multiplier: 1, bonus: { formula: '2' } }, {}), true);
  assert.equal(changesDamage({ multiplier: 1, type: 'fire' }, {}), true);
  assert.equal(changesDamage({ multiplier: 1, also: NO_ALSO_TYPE }, {}), true);
});

test('the window\'s multiplier multiplies the item\'s own total multiplier, halves round down', () => {
  const base = { damage: 7, diceSum: 4 };
  // x1 changes nothing
  assert.equal(targetDamage({ ...base, mult: { base: 1, total: 1 * manualMultiplier('') } }).damage, 7);
  // x2 doubles; an item x3 and a window x2 give x6
  assert.equal(targetDamage({ ...base, mult: { base: 1, total: 2 } }).damage, 14);
  assert.equal(targetDamage({ ...base, mult: { base: 1, total: 3 * manualMultiplier(2) } }).damage, 42);
  // x0.5 halves, rounding down
  assert.equal(targetDamage({ ...base, mult: { base: 1, total: manualMultiplier(0.5) } }).damage, 3);
});

test('bonus damage and the window\'s multiplier together: the bonus is multiplied too', () => {
  // 7 rolled + 3 from the bonus row = 10, x2 = 20
  assert.equal(
    targetDamage({ damage: 7, diceSum: 4, modTotal: 3, mult: { base: 1, total: 2 } }).damage,
    20
  );
});

test('a window multiplier is applied to each typed part', () => {
  const result = targetDamage({
    damage: 6,
    diceSum: 3,
    typed: [{ types: ['ice'], amount: 3 }],
    ownType: 'fire',
    mult: { base: 1, total: 2 },
  });
  assert.equal(result.damage, 18);
  assert.deepEqual(
    result.parts.map((p) => [p.type, p.amount]),
    [
      ['fire', 12],
      ['ice', 6],
    ]
  );
});
