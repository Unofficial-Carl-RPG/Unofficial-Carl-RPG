import { world, makeActor, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS,
  MIGRATION_SETTING,
  compareVersions,
  pendingSteps,
  fillNewFields,
  runMigration,
} from '../module/helpers/migration.mjs';

/** What the stand-in document classes were asked to save. */
const saved = { actors: [], items: [], embedded: [] };

beforeEach(() => {
  world.reset();
  saved.actors.length = saved.items.length = saved.embedded.length = 0;
  CONFIG.Actor = { documentClass: { updateDocuments: async (u, o) => saved.actors.push([u, o]) } };
  CONFIG.Item = { documentClass: { updateDocuments: async (u, o) => saved.items.push([u, o]) } };
  game.system = { version: '0.1.0' };
  game.users.activeGM = game.user;
});

/** An actor or item with some stored system data. */
function withSource(doc, system) {
  doc._source = { system };
  return doc;
}

const worldActor = (name, system = { health: { value: 4 } }) =>
  withSource(makeActor({ name, id: name }), system);

/* -------------------------------------------- */
/*  Versions and steps                          */
/* -------------------------------------------- */

test('versions compare number by number, and a blank version is the oldest', () => {
  const rows = [
    ['0.1.0', '0.1.0', 0],
    ['0.10.0', '0.9.0', 1],
    ['0.2.0', '0.10.0', -1],
    ['1.0', '1.0.0', 0],
    ['2.0.0', '10.0.0', -1],
    ['', '0.0.1', -1],
    ['', '', 0],
    [undefined, '0.1.0', -1],
  ];
  for (const [a, b, result] of rows) assert.equal(compareVersions(a, b), result, `${a} vs ${b}`);
});

test('a world runs the steps newer than where it was, up to the system\'s version, oldest first', () => {
  const extra = [{ version: '0.3.0', run() {} }, { version: '0.2.0', run() {} }, { version: '9.0.0', run() {} }];
  STEPS.push(...extra);
  try {
    const versions = (stored, current) => pendingSteps(stored, current).map((s) => s.version);
    assert.deepEqual(versions('', '0.3.0'), ['0.1.0', '0.1.1', '0.2.0', '0.3.0']);
    assert.deepEqual(versions('0.1.0', '0.3.0'), ['0.1.1', '0.2.0', '0.3.0']);
    assert.deepEqual(versions('0.2.0', '0.2.5'), []); // 0.3.0 is not reached yet
    assert.deepEqual(versions('0.3.0', '0.3.0'), []);
    assert.deepEqual(versions('', '0.0.9'), []);
  } finally {
    STEPS.splice(STEPS.length - extra.length, extra.length);
  }
});

test('the class-tag step is the first step, from 0.1.0', () => {
  assert.equal(STEPS[0].version, '0.1.0');
  assert.equal(typeof STEPS[0].run, 'function');
});

/* -------------------------------------------- */
/*  Filling in new fields                       */
/* -------------------------------------------- */

test('every world actor and item, and every item an actor holds, is saved with its full system data', async () => {
  const hero = worldActor('hero');
  const wand = withSource(makeItem({ name: 'Wand', id: 'wand' }), { rank: 2 });
  const sword = withSource(makeItem({ name: 'Sword', id: 'sword' }), { dr: 1 });
  hero.items.push(sword);
  sword.parent = hero;
  const embedded = [];
  hero.updateEmbeddedDocuments = async (kind, updates, options) => embedded.push([kind, updates, options]);
  game.actors.push(hero);
  game.items = [wand];

  await fillNewFields();

  const options = { diff: false, render: false, carlMigration: true };
  assert.deepEqual(saved.actors, [[[{ _id: 'hero', system: { health: { value: 4 } } }], options]]);
  assert.deepEqual(saved.items, [[[{ _id: 'wand', system: { rank: 2 } }], options]]);
  assert.deepEqual(embedded, [['Item', [{ _id: 'sword', system: { dr: 1 } }], options]]);
  // What is saved is a copy, not the document's own data.
  assert.notEqual(saved.actors[0][0][0].system, hero._source.system);
});

test('documents with no system data are skipped, and saves go a batch at a time', async () => {
  game.actors.push(withSource(makeActor({ name: 'a', id: 'a' }), undefined));
  for (let i = 0; i < 120; i++) game.actors.push(worldActor(`n${i}`));
  game.items = [];
  await fillNewFields();
  assert.deepEqual(saved.actors.map(([updates]) => updates.length), [50, 50, 20]);
  assert.ok(!saved.actors.flat().some((x) => x._id === 'a'));
  assert.equal(saved.items.length, 0);
});

/* -------------------------------------------- */
/*  Running the migration                       */
/* -------------------------------------------- */

const stored = () => world.settings[MIGRATION_SETTING];

/** Swap the first step for a spy while a test runs. */
function spyOnStep(fail = false) {
  const real = STEPS[0].run;
  const calls = [];
  STEPS[0].run = async () => {
    calls.push(1);
    if (fail) throw new Error('boom');
  };
  return { calls, restore: () => (STEPS[0].run = real) };
}

test('an older world is filled in, run through the steps, and recorded at the new version', async () => {
  game.actors.push(worldActor('hero'));
  game.items = [];
  const spy = spyOnStep();
  try {
    await runMigration();
    assert.equal(spy.calls.length, 1);
    assert.equal(saved.actors.length, 1);
    assert.equal(stored(), '0.1.0');
  } finally {
    spy.restore();
  }
});

test('a world already at the version is left alone', async () => {
  world.settings[MIGRATION_SETTING] = '0.1.0';
  game.actors.push(worldActor('hero'));
  game.items = [];
  const spy = spyOnStep();
  try {
    await runMigration();
    assert.deepEqual([spy.calls.length, saved.actors.length], [0, 0]);
  } finally {
    spy.restore();
  }
});

test('a world from a newer version is not touched or lowered', async () => {
  world.settings[MIGRATION_SETTING] = '0.2.0';
  game.actors.push(worldActor('hero'));
  game.items = [];
  await runMigration();
  assert.equal(saved.actors.length, 0);
  assert.equal(stored(), '0.2.0');
});

test('only the active GM\'s client migrates', async () => {
  game.users.activeGM = { id: 'other', isGM: true };
  game.items = [];
  const spy = spyOnStep();
  try {
    await runMigration();
    assert.deepEqual([spy.calls.length, stored()], [0, undefined]);
  } finally {
    spy.restore();
  }
});

test('a step that fails leaves the version unrecorded, so it is tried again', async () => {
  game.items = [];
  const spy = spyOnStep(true);
  const realError = console.error;
  console.error = () => {};
  try {
    await runMigration();
    assert.equal(stored(), undefined);
    assert.equal(world.warnings.length, 1);
  } finally {
    console.error = realError;
    spy.restore();
  }
});
