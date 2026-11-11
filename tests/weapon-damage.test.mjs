import '../tests/stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffective } from '../module/helpers/upgrades.mjs';
import { rolledDamageText, migrateWeapon } from '../module/helpers/weapon-damage.mjs';
import { chipsFor } from '../module/helpers/item-filter.mjs';

// A skill whose base damage is 1d6 with a rank 5 upgrade (+1d4) and a rank 10 die step.
const skill = (rank) => {
  const system = {
    rank,
    damage: '1d6',
    check: { target: 'evade' },
    upgrades: [
      { id: 'a', rank: 5, changes: [{ type: 'damageAdd', value: '1d4' }] },
      { id: 'b', rank: 10, changes: [{ type: 'dieStep', value: '1' }] },
    ],
  };
  system.effective = computeEffective(system);
  return system;
};

test('a weapon without Override uses only the skill damage, whatever its own damage says', () => {
  const gear = { weapon: true, overrideDamage: false, damage: '2d8' };
  assert.equal(rolledDamageText(gear, skill(1)), '1d6');
  assert.equal(rolledDamageText(gear, skill(5)), '1d6 + 1d4');
});

test('Override swaps in the gear formula for the skill base and keeps the skill upgrades', () => {
  const gear = { weapon: true, overrideDamage: true, damage: '1d8' };
  assert.equal(rolledDamageText(gear, skill(1)), '1d8');
  assert.equal(rolledDamageText(gear, skill(5)), '1d8 + 1d4');
  assert.equal(rolledDamageText(gear, skill(10)), '1d10 + 1d6'); // the step moves the gear dice too
});

test('Override with a blank damage formula falls back to the skill damage', () => {
  const gear = { weapon: true, overrideDamage: true, damage: '  ' };
  assert.equal(rolledDamageText(gear, skill(5)), '1d6 + 1d4');
});

test('Override never rewrites the skill itself', () => {
  const s = skill(5);
  rolledDamageText({ weapon: true, overrideDamage: true, damage: '1d8' }, s);
  assert.equal(s.damage, '1d6');
  assert.equal(s.effective.damage, '1d6 + 1d4');
});

test('gear that is not a weapon adds its own damage to the skill damage, as before', () => {
  assert.equal(rolledDamageText({ weapon: false, damage: '1d4' }, skill(5)), '1d4 + 1d6 + 1d4');
  assert.equal(rolledDamageText({ weapon: false, damage: '' }, skill(1)), '1d6');
});

test('old gear: a skill check or damage makes it a weapon, with Override on when it had damage', () => {
  const stored = (over) => ({ slot: 'hands', equipped: false, quantity: 1, ...over });
  const a = migrateWeapon(stored({ action: { type: 'skill' }, damage: '1d6' }));
  assert.deepEqual([a.weapon, a.overrideDamage], [true, true]);
  const b = migrateWeapon(stored({ action: { type: 'skill' }, damage: '' }));
  assert.deepEqual([b.weapon, b.overrideDamage], [true, false]);
  const c = migrateWeapon(stored({ action: { type: 'none' }, damage: '1d6' }));
  assert.deepEqual([c.weapon, c.overrideDamage], [true, true]);
  const d = migrateWeapon(stored({ action: { type: 'none' }, damage: '' }));
  assert.deepEqual([d.weapon, d.overrideDamage], [false, false]);
});

test('migration leaves partial update data and gear that already has the ticks alone', () => {
  assert.equal('weapon' in migrateWeapon({ action: { type: 'skill' }, damage: '1d6' }), false);
  assert.equal('weapon' in migrateWeapon({ damage: '1d6' }), false);
  const kept = migrateWeapon({
    slot: 'hands', equipped: false, quantity: 1, action: { type: 'skill' }, damage: '1d6',
    weapon: false, overrideDamage: false,
  });
  assert.deepEqual([kept.weapon, kept.overrideDamage], [false, false]);
});

test('the Weapon filter chip follows the Weapon tick, not the damage field', () => {
  const gear = (system) => ({ type: 'gear', system: { slot: 'hands', quantity: 1, ...system } });
  const category = (item) => chipsFor(item).filter((c) => c.group === 'category').map((c) => c.key);
  assert.deepEqual(category(gear({ weapon: true, damage: '' })), ['weapon']);
  assert.deepEqual(category(gear({ weapon: false, damage: '1d6' })), ['other']);
});
