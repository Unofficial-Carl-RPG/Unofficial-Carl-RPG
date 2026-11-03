import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionFormula, addModifier, migrateAction } from '../module/data/action.mjs';

test('stat check rolls a d20 plus the stat, with an optional modifier', () => {
  assert.equal(actionFormula({ type: 'stat', stat: 'dex', modifier: '' }), '1d20 + @dex.mod');
  assert.equal(actionFormula({ type: 'stat', stat: 'dex', modifier: '2' }), '1d20 + @dex.mod + 2');
  assert.equal(actionFormula({ type: 'stat', stat: 'dex', modifier: '-1' }), '1d20 + @dex.mod - 1');
  assert.equal(addModifier('1d20', ' + 1d4 '), '1d20 + 1d4');
});

test('none has no formula, custom uses its own, skill starts as a plain d20', () => {
  assert.equal(actionFormula({ type: 'none' }), '');
  assert.equal(actionFormula({ type: 'custom', formula: ' 2d6+@str.mod ' }), '2d6+@str.mod');
  assert.equal(actionFormula({ type: 'skill', modifier: '3' }), '1d20');
});

test('old gear: skills become a skill check, a changed roll becomes custom, the rest none', () => {
  const plain = { diceNum: 1, diceSize: 'd20', diceBonus: '+@str.mod+ceil(@lvl / 2)' };
  assert.deepEqual(migrateAction({ skills: ['Item.a'], roll: plain }, 'gear').action, { type: 'skill' });
  assert.deepEqual(migrateAction({ skills: [], roll: plain }, 'gear').action, { type: 'none' });
  assert.deepEqual(
    migrateAction({ roll: { diceNum: 2, diceSize: 'd6', diceBonus: '+3' } }, 'gear').action,
    { type: 'custom', formula: '2d6+3' }
  );
  assert.equal(migrateAction({ skills: ['Item.a'], roll: plain }, 'item').action, undefined);
  const kept = { action: { type: 'stat', stat: 'str' } };
  assert.equal(migrateAction(kept, 'gear').action.type, 'stat');
});

test('a partial update never gets an action added (it would reset the real one)', () => {
  // Foundry runs the migration on update data like this too.
  assert.equal('action' in migrateAction({ rollSkill: 'Actor.a.Item.b' }, 'gear'), false);
  assert.equal('action' in migrateAction({ equipped: true }, 'gear'), false);
  assert.equal('action' in migrateAction({ skills: ['Item.a'] }, 'gear'), false);
  assert.equal('action' in migrateAction({ quantity: 2 }, 'item'), false);
});
