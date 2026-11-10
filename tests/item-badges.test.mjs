import './stubs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBadges } from '../module/helpers/item-badges.mjs';

const weapon = (system) => ({ type: 'gear', system: { quantity: 1, ...system } });

test('a weapon that targets with a splash lists the splash without throwing', () => {
  const badges = describeBadges(weapon({ targeting: { mode: 'count', count: '1', range: '30', splash: '10' } }));
  assert.ok(badges.some((b) => /10/.test(b)));
});

test('a weapon skill with an area and no upgrades builds its badges', () => {
  const skill = { type: 'skill', system: { stat: 'str', targeting: { mode: 'area', range: '20', splash: '5' } } };
  assert.doesNotThrow(() => describeBadges(skill));
});

test('an item with no targeting has no splash badge', () => {
  assert.doesNotThrow(() => describeBadges(weapon({})));
});
