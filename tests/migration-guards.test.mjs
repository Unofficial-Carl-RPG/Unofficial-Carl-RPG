import { world, makeActor, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CarlRPGItem } from '../module/documents/item.mjs';
import { CarlRPGActor } from '../module/documents/actor.mjs';

beforeEach(() => world.reset());

const gmUser = { id: 'gm', isGM: true };
const playerUser = { id: 'p1', isGM: false };
const migration = { carlMigration: true };

const itemPreUpdate = (changes, options, user) =>
  CarlRPGItem.prototype._preUpdate.call(makeItem({ type: 'skill' }), changes, options, user);
const petPreUpdate = (changes, options, user) =>
  CarlRPGActor.prototype._preUpdate.call(makeActor({ type: 'pet' }), changes, options, user);

test('only a GM\'s own save of events marks an item\'s events as approved', async () => {
  const save = async (user, options = {}) => {
    const changes = { system: { events: [{ id: 'e' }] } };
    await itemPreUpdate(changes, options, user);
    return changes.system.eventsTrusted;
  };
  assert.equal(await save(gmUser), true);
  assert.equal(await save(playerUser), false);
});

test('a migration save leaves the approval of an item\'s events as it was', async () => {
  for (const key of ['events', 'requirements', 'upgrades']) {
    const changes = { system: { [key]: [] } };
    await itemPreUpdate(changes, migration, gmUser);
    assert.equal('eventsTrusted' in changes.system, false, key);
  }
});

test('a migration save leaves the approval of a pet\'s upgrades as it was', async () => {
  const normal = { system: { upgrades: [] } };
  await petPreUpdate(normal, {}, gmUser);
  assert.equal(normal.system.eventsTrusted, true);

  const migrated = { system: { upgrades: [] } };
  await petPreUpdate(migrated, migration, gmUser);
  assert.equal('eventsTrusted' in migrated.system, false);
});

test('a migration save does not start Dying or defeat a mob', () => {
  const calls = [];
  const crawler = makeActor({ type: 'crawler' });
  crawler.system = { health: { value: 0 } };
  crawler.createEmbeddedDocuments = async (...args) => calls.push(args);
  crawler.effects = [];
  game.users.activeGM = game.user;
  // A normal save of 0 health starts Dying (an effect is created) ...
  CarlRPGActor.prototype._onUpdate.call(crawler, { system: { health: { value: 0 } } }, {}, 'gm');
  assert.equal(calls.length, 1);
  // ... a migration save does not.
  const before = calls.length;
  CarlRPGActor.prototype._onUpdate.call(crawler, { system: { health: { value: 0 } } }, migration, 'gm');
  assert.equal(calls.length, before);
});

test('a migration save does not run an item\'s own follow-ups (deity tiers, and gear skills)', () => {
  let granted = 0;
  game.user = { id: 'gm', isGM: true };
  // (The deity branch is the one reachable without a world; gear's follow-up sits
  // after the same early return.)
  const deity = makeItem({ type: 'deity', system: { tier: 2 } });
  deity.syncDeityTiers = () => granted++;
  CarlRPGItem.prototype._onUpdate.call(deity, { system: { tier: 2 } }, {}, 'gm');
  assert.equal(granted, 1);
  CarlRPGItem.prototype._onUpdate.call(deity, { system: { tier: 2 } }, migration, 'gm');
  assert.equal(granted, 1);
});
