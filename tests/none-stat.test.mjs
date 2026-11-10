import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasStat, skillRollFormula, NO_STAT } from '../module/helpers/stat-term.mjs';
import { statOfFormula } from '../module/helpers/roll-dialog.mjs';

test('None is the first stat choice, ahead of the five stats', () => {
  assert.equal(Object.keys(CONFIG.CARL_RPG.skillStats)[0], NO_STAT);
  assert.deepEqual(
    Object.keys(CONFIG.CARL_RPG.skillStats).slice(1),
    Object.keys(CONFIG.CARL_RPG.abilities)
  );
});

test('hasStat is false for none and blank', () => {
  assert.equal(hasStat('none'), false);
  assert.equal(hasStat(''), false);
  assert.equal(hasStat(undefined), false);
  assert.equal(hasStat('dex'), true);
});

test('a None stat adds no stat modifier to the roll', () => {
  assert.equal(skillRollFormula('none', 3), '1d20 + 3');
  assert.equal(skillRollFormula('none', 3, 2), '1d20 + 3 + 2');
  assert.equal(statOfFormula(skillRollFormula('none', 3)), null);
});

test('a real stat adds its modifier', () => {
  assert.equal(skillRollFormula('dex', 3), '1d20 + @dex.mod + 3');
  assert.equal(skillRollFormula('str', 0, -1), '1d20 + @str.mod + 0 - 1');
  assert.equal(statOfFormula(skillRollFormula('cha', 1)), 'cha');
});
