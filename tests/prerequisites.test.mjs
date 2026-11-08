import { world, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluatePrerequisites,
  bestSkillRank,
  optionVisible,
} from '../module/helpers/origins.mjs';

beforeEach(() => world.reset());

/** A skill or spell the crawler holds. */
const skill = (name, stat, rank, tags = [], type = 'skill') =>
  makeItem({ type, name, system: { stat, rank, tags } });

/** A crawler with just what prerequisites read. */
function crawler({ skills = [], spells = [], species = [], level = 1, abilities = {} } = {}) {
  return {
    system: {
      abilities: Object.fromEntries(
        Object.entries({ str: 1, dex: 1, ...abilities }).map(([k, v]) => [k, { enhanced: v }])
      ),
      attributes: { level: { value: level } },
    },
    itemTypes: { skill: skills, spell: spells, species, race: [], achievement: [], class: [], subclass: [] },
  };
}

const origin = (prerequisites, extra = {}) => ({
  type: 'race',
  name: 'Test Race',
  uuid: 'Item.Test Race',
  system: { prerequisites, ...extra },
});

const amazonian = origin([{ type: 'skillStatRank', stats: ['str', 'dex'], value: 5 }]);
const obsidian = origin([{ type: 'skillTagRank', tag: 'edged', value: 5 }]);

/* -------------------------------------------- */
/*  Any skill of a stat at a rank               */
/* -------------------------------------------- */

test('a Strength skill at the rank meets the Strength-or-Dexterity prerequisite', async () => {
  const [r] = await evaluatePrerequisites(amazonian, crawler({ skills: [skill('Pugilism', 'str', 5)] }));
  assert.equal(r.met, true);
});

test('a Dexterity skill at the rank meets it too (any of the stats counts)', async () => {
  const [r] = await evaluatePrerequisites(amazonian, crawler({ skills: [skill('Bow', 'dex', 6)] }));
  assert.equal(r.met, true);
});

test('a high skill of another stat does not count, and the best matching rank is reported', async () => {
  const actor = crawler({
    skills: [skill('Bow', 'dex', 4), skill('Lore', 'int', 9)],
  });
  const [r] = await evaluatePrerequisites(amazonian, actor);
  assert.equal(r.met, false);
  assert.match(r.text, /"have":4/);
});

test('with no skills the stat prerequisite is unmet and reports 0', async () => {
  const [r] = await evaluatePrerequisites(amazonian, crawler());
  assert.equal(r.met, false);
  assert.match(r.text, /"have":0/);
});

test('spells count for the stat prerequisite', async () => {
  const actor = crawler({ spells: [skill('Fireball', 'str', 5, [], 'spell')] });
  const [r] = await evaluatePrerequisites(amazonian, actor);
  assert.equal(r.met, true);
});

test('a stat prerequisite with no stats chosen is never met', async () => {
  const none = origin([{ type: 'skillStatRank', stats: [], value: 1 }]);
  const [r] = await evaluatePrerequisites(none, crawler({ skills: [skill('Bow', 'dex', 9)] }));
  assert.equal(r.met, false);
});

test('the rank used is the stored rank', async () => {
  // A rank bonus from effects (effectiveRank) isn't counted.
  const bow = skill('Bow', 'dex', 4);
  bow.system.effectiveRank = 6;
  const [r] = await evaluatePrerequisites(amazonian, crawler({ skills: [bow] }));
  assert.equal(r.met, false);
});

/* -------------------------------------------- */
/*  Any skill with a tag at a rank              */
/* -------------------------------------------- */

test('a skill with the tag at the rank meets the tag prerequisite (ignoring case)', async () => {
  const actor = crawler({ skills: [skill('Longsword', 'str', 5, ['Edged'])] });
  const [r] = await evaluatePrerequisites(obsidian, actor);
  assert.equal(r.met, true);
});

test('the tag prerequisite needs the tag and the rank on the same skill', async () => {
  const actor = crawler({
    skills: [skill('Dagger', 'dex', 4, ['edged']), skill('Bow', 'dex', 9, ['ranged'])],
  });
  const [r] = await evaluatePrerequisites(obsidian, actor);
  assert.equal(r.met, false);
  assert.match(r.text, /"have":4/);
});

test('a spell with the tag counts', async () => {
  const actor = crawler({ spells: [skill('Blade Storm', 'int', 7, ['edged'], 'spell')] });
  const [r] = await evaluatePrerequisites(obsidian, actor);
  assert.equal(r.met, true);
});

test('a tag prerequisite with a blank tag is never met', async () => {
  const blank = origin([{ type: 'skillTagRank', tag: '  ', value: 1 }]);
  const [r] = await evaluatePrerequisites(blank, crawler({ skills: [skill('Dagger', 'dex', 9, ['edged'])] }));
  assert.equal(r.met, false);
});

test('bestSkillRank: no filter looks at every skill and spell', () => {
  const actor = crawler({
    skills: [skill('A', 'str', 3)],
    spells: [skill('B', 'int', 8, [], 'spell')],
  });
  assert.equal(bestSkillRank(actor), 8);
  assert.equal(bestSkillRank(actor, { stats: ['str'] }), 3);
  assert.equal(bestSkillRank(crawler()), 0);
});

/* -------------------------------------------- */
/*  Species                                     */
/* -------------------------------------------- */

const catSpecies = makeItem({ type: 'species', name: 'Cat', system: {} });
const catOnly = () => origin([{ type: 'species', uuid: catSpecies.uuid }]);

test('a crawler who is a Cat meets the Cat species prerequisite', async () => {
  world.docs[catSpecies.uuid] = catSpecies;
  const mine = makeItem({ type: 'species', name: 'Cat', system: {} });
  const [r] = await evaluatePrerequisites(catOnly(), crawler({ species: [mine] }));
  assert.equal(r.met, true);
});

test('a crawler without that species does not', async () => {
  world.docs[catSpecies.uuid] = catSpecies;
  const dog = makeItem({ type: 'species', name: 'Dog', system: {} });
  assert.equal((await evaluatePrerequisites(catOnly(), crawler()))[0].met, false);
  assert.equal((await evaluatePrerequisites(catOnly(), crawler({ species: [dog] })))[0].met, false);
});

test('species match by identifier when both have one', async () => {
  const wanted = makeItem({ type: 'species', name: 'Cat', system: { identifier: 'cat' } });
  world.docs[wanted.uuid] = wanted;
  const renamed = makeItem({ type: 'species', name: 'Housecat', system: { identifier: 'cat' } });
  const [r] = await evaluatePrerequisites(catOnly(), crawler({ species: [renamed] }));
  assert.equal(r.met, true);
});

test('a species prerequisite with nothing dropped (or a missing species) is unmet', async () => {
  const empty = origin([{ type: 'species', uuid: '' }]);
  const gone = origin([{ type: 'species', uuid: 'Item.Gone' }]);
  const mine = makeItem({ type: 'species', name: 'Cat', system: {} });
  assert.equal((await evaluatePrerequisites(empty, crawler({ species: [mine] })))[0].met, false);
  assert.equal((await evaluatePrerequisites(gone, crawler({ species: [mine] })))[0].met, false);
});

/* -------------------------------------------- */
/*  Existing types, and the hidden rule         */
/* -------------------------------------------- */

test('existing prerequisites behave as before', async () => {
  const bow = skill('Bow', 'dex', 3);
  world.docs[bow.uuid] = bow;
  const item = origin([
    { type: 'stat', stat: 'str', value: 3 },
    { type: 'level', value: 2 },
    { type: 'skillRank', uuid: bow.uuid, value: 3 },
  ]);
  const actor = crawler({ skills: [bow], level: 2, abilities: { str: 3 } });
  assert.deepEqual((await evaluatePrerequisites(item, actor)).map((r) => r.met), [true, true, true]);
  const weak = crawler({ skills: [skill('Bow', 'dex', 2)], level: 1, abilities: { str: 2 } });
  assert.deepEqual((await evaluatePrerequisites(item, weak)).map((r) => r.met), [false, false, false]);
});

test('all prerequisites must hold, new and old together', async () => {
  const item = origin([
    { type: 'skillStatRank', stats: ['str', 'dex'], value: 5 },
    { type: 'level', value: 3 },
  ]);
  const actor = crawler({ skills: [skill('Bow', 'dex', 5)], level: 2 });
  assert.deepEqual((await evaluatePrerequisites(item, actor)).map((r) => r.met), [true, false]);
});

test('a hidden race with an unmet new prerequisite stays hidden until met or revealed', async () => {
  const hidden = origin(
    [{ type: 'skillStatRank', stats: ['str'], value: 5 }],
    { hidden: true }
  );
  const unmet = (await evaluatePrerequisites(hidden, crawler())).every((r) => r.met);
  const met = (
    await evaluatePrerequisites(hidden, crawler({ skills: [skill('Pugilism', 'str', 5)] }))
  ).every((r) => r.met);
  assert.equal(optionVisible(hidden, unmet, false, []), false);
  assert.equal(optionVisible(hidden, unmet, true, []), true); // the GM sees it
  assert.equal(optionVisible(hidden, unmet, false, [hidden.uuid]), true); // revealed
  assert.equal(optionVisible(hidden, met, false, []), true); // once met
});

/* -------------------------------------------- */
/*  Menu and wording                            */
/* -------------------------------------------- */

test('every prerequisite type has a menu label and a requirement text in en.json', () => {
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
  const prereq = lang.CARL_RPG.Origin.Prereq;
  const needs = lang.CARL_RPG.Origin.Needs;
  for (const key of ['skillStatRank', 'skillTagRank', 'species']) {
    assert.ok(CONFIG.CARL_RPG.prerequisiteTypes[key], `${key} is in the menu`);
    assert.ok(prereq[key], `${key} has a label`);
    assert.ok(needs[key], `${key} has a requirement text`);
  }
  assert.ok(lang.CARL_RPG.Origin.Drop.species);
  assert.ok(lang.CARL_RPG.Origin.Drop.Wrong.species);
  for (const key of Object.keys(CONFIG.CARL_RPG.prerequisiteTypes)) {
    assert.ok(prereq[key], `${key} has a label`);
    assert.ok(needs[key], `${key} has a requirement text`);
  }
});
