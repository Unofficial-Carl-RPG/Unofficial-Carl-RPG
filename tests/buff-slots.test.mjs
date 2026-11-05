import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupNameOf,
  slotMates,
  usedBuffSlots,
} from '../module/helpers/buff-slots.mjs';

const buff = (id, extra = {}) => ({
  id,
  kind: 'buff',
  disabled: false,
  equipControlled: false,
  slotGroup: null,
  ...extra,
});

test('groupNameOf: only ticked buffs join a group, by text else fallback', () => {
  assert.equal(groupNameOf('buff', false, 'Evade', 'x'), null);
  assert.equal(groupNameOf('debuff', true, 'Evade', 'x'), null);
  assert.equal(groupNameOf('buff', true, ' Evade Up ', 'x'), 'evade up');
  assert.equal(groupNameOf('buff', true, '', 'Dodge'), 'dodge');
  assert.equal(groupNameOf('buff', true, '', ''), null);
});

test('usedBuffSlots: a group of buffs uses one slot', () => {
  const effects = [
    buff('a', { slotGroup: 'evade' }),
    buff('b', { slotGroup: 'evade' }),
    buff('c'),
    buff('d', { disabled: true }),
    buff('e', { equipControlled: true }),
    { ...buff('f'), kind: 'debuff' },
  ];
  assert.deepEqual(
    usedBuffSlots(effects).map((e) => e.id),
    ['a', 'c']
  );
});

test('usedBuffSlots: skip leaves an effect out', () => {
  const a = buff('a');
  const b = buff('b');
  assert.deepEqual(usedBuffSlots([a, b], a).map((e) => e.id), ['b']);
});

test('slotMates: same group only, never itself or equipment-controlled', () => {
  const a = buff('a', { slotGroup: 'evade' });
  const b = buff('b', { slotGroup: 'evade' });
  const c = buff('c', { slotGroup: 'other' });
  const d = buff('d', { slotGroup: 'evade', equipControlled: true });
  const e = buff('e');
  assert.deepEqual(slotMates([a, b, c, d, e], a).map((x) => x.id), ['b']);
  assert.deepEqual(slotMates([a, b, c, d, e], e), []);
});
