import { world } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { speciesAllowed, SPECIES_SETTING } from '../module/helpers/creation.mjs';
import { purposeTypes } from '../module/helpers/sources.mjs';

beforeEach(() => world.reset());

test('species in character creation are off until the GM allows them', () => {
  assert.equal(speciesAllowed(), false);
  world.settings[SPECIES_SETTING] = true;
  assert.equal(speciesAllowed(), true);
});

test('species have their own list in the compendium sources', () => {
  assert.deepEqual(purposeTypes('species'), ['species']);
});
