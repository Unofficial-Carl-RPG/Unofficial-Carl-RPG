import { world, makeEffect, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyBenefits, rollBenefits, buildModsOf, cleanBuildRow } from '../module/helpers/build-mods.mjs';
import { skillCapOf, SKILL_CAP, SKILL_CAP_BOOSTED } from '../module/helpers/skill-cap.mjs';

beforeEach(() => world.reset());

const mods = (...rows) => makeEffect({ flags: { buildMods: rows } });

test('advantage comes from the stat, and only for rolls that use it', async () => {
  const crawler = await makeCrawler({ bonuses: { advStr: 1 } });
  assert.equal(rollBenefits(crawler, { stat: 'str' }).advantage, true);
  assert.equal(rollBenefits(crawler, { stat: 'dex' }).advantage, false);
  assert.equal(rollBenefits(crawler, {}).advantage, false);
  assert.equal(applyBenefits({}, rollBenefits(crawler, { stat: 'str' })).mode, 'advantage');
  // Disadvantage and advantage cancel.
  assert.equal(applyBenefits({ mode: 'disadvantage' }, rollBenefits(crawler, { stat: 'str' })).mode, 'normal');
});

test('the stat-skill bonus is only for skills that use the stat', async () => {
  const crawler = await makeCrawler({ bonuses: { skillInt: 2, skillDex: -1 } });
  assert.equal(rollBenefits(crawler, { stat: 'int', skill: true }).flat, 2);
  assert.equal(rollBenefits(crawler, { stat: 'int', skill: false }).flat, 0);
  assert.equal(rollBenefits(crawler, { stat: 'str', skill: true }).flat, 0);
  assert.equal(applyBenefits({ bonus: '+1' }, rollBenefits(crawler, { stat: 'dex', skill: true })).bonus, '+1 -1');
});

test('a check die is added to rolls against its target, and bad or switched off dice are ignored', async () => {
  const crawler = await makeCrawler({
    effects: [
      mods({ kind: 'checkDie', target: 'evade', value: '1d4' }, { kind: 'checkDie', target: 'evade', value: 'nonsense' }),
      makeEffect({ flags: { buildMods: [{ kind: 'checkDie', target: 'evade', value: '1d6' }] }, disabled: true }),
    ],
  });
  assert.deepEqual(rollBenefits(crawler, { target: 'evade' }).dice, ['1d4']);
  assert.deepEqual(rollBenefits(crawler, { target: 'str' }).dice, []);
  assert.equal(applyBenefits({ bonus: '2' }, rollBenefits(crawler, { target: 'evade' })).bonus, '2 + 1d4');
});

test('a health stat swaps the modifier a health box is worth, and the last one wins', async () => {
  const plain = await makeCrawler({ abilities: { str: 14, con: 6 } });
  assert.equal(plain.system.health.perBox, plain.system.abilities.con.mod);
  const swapped = await makeCrawler({
    abilities: { str: 14, con: 6 },
    effects: [mods({ kind: 'healthStat', target: 'dex' }), mods({ kind: 'healthStat', target: 'str' })],
  });
  assert.equal(swapped.system.health.perBox, swapped.system.abilities.str.mod);
  assert.notEqual(swapped.system.health.perBox, swapped.system.abilities.con.mod);
});

test('a stat cap stops the enhanced score at the number, and the lowest cap wins', async () => {
  const crawler = await makeCrawler({
    abilities: { str: 10 },
    bonuses: { str: 4 },
    effects: [mods({ kind: 'statCap', target: 'str', value: '12' }), mods({ kind: 'statCap', target: 'str', value: '9' })],
  });
  assert.equal(crawler.system.abilities.str.enhanced, 9);
  const free = await makeCrawler({ abilities: { str: 10 }, bonuses: { str: 4 } });
  assert.equal(free.system.abilities.str.enhanced, 14);
  assert.equal(buildModsOf(crawler).length, 2);
});

test('Step gets what effects add', async () => {
  const crawler = await makeCrawler({ bonuses: { step: 5 } });
  assert.equal(crawler.system.move.stepTotal, 15);
});

const skill = (identifier, tags = [], type = 'skill') =>
  makeItem({ type, name: identifier || 'Unnamed', system: { identifier, tags } });
const capRow = (target, value = '') => mods({ kind: 'skillCap', target, value });

test('the skill cap is 15, and a Skill cap row for everything raises it to 20', async () => {
  const plain = await makeCrawler();
  assert.equal(skillCapOf(plain, skill('lockpicking')), SKILL_CAP);
  const all = await makeCrawler({ effects: [capRow('all')] });
  assert.equal(skillCapOf(all, skill('lockpicking')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(all), SKILL_CAP_BOOSTED);
});

test('a Skill cap row for one skill covers it by Identifier (skills and spells), nothing else', async () => {
  const crawler = await makeCrawler({ effects: [capRow('skill', 'Lockpicking')] });
  assert.equal(skillCapOf(crawler, skill('lockpicking')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(crawler, skill('lockpicking', [], 'spell')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(crawler, skill('climbing')), SKILL_CAP);
  assert.equal(skillCapOf(crawler, skill('')), SKILL_CAP);
  assert.equal(skillCapOf(crawler), SKILL_CAP);
  // A row with no skill picked yet covers nothing.
  const empty = await makeCrawler({ effects: [capRow('skill')] });
  assert.equal(skillCapOf(empty, skill('')), SKILL_CAP);
});

test('a Skill cap row for a tag covers the skills and spells with that tag', async () => {
  const crawler = await makeCrawler({ effects: [capRow('tag', 'Stealth')] });
  assert.equal(skillCapOf(crawler, skill('sneak', ['stealth'])), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(crawler, skill('shadow', ['Stealth'], 'spell')), SKILL_CAP_BOOSTED);
  assert.equal(skillCapOf(crawler, skill('fireball', ['fire'])), SKILL_CAP);
  assert.equal(skillCapOf(crawler, skill('plain')), SKILL_CAP);
  assert.equal(skillCapOf(crawler), SKILL_CAP);
});

test('switched off Skill cap rows do nothing, and pets have no cap', async () => {
  const off = await makeCrawler({
    effects: [makeEffect({ flags: { buildMods: [{ kind: 'skillCap', target: 'all', value: '' }] }, disabled: true })],
  });
  assert.equal(skillCapOf(off, skill('lockpicking')), SKILL_CAP);
  assert.equal(skillCapOf({ type: 'pet' }, skill('lockpicking')), Infinity);
});

test('a build row is tidied when saved: scope kept, what no longer fits cleared', () => {
  const picked = { kind: 'skillCap', target: 'skill', value: 'lockpicking', name: 'Lockpicking' };
  assert.deepEqual(cleanBuildRow({ ...picked }, picked), picked);
  // Changing the scope clears the skill (and its name).
  assert.deepEqual(cleanBuildRow({ ...picked, target: 'tag' }, picked), { kind: 'skillCap', target: 'tag', value: '' });
  // A typed tag is kept and trimmed; "all" never holds a value.
  const tagged = { kind: 'skillCap', target: 'tag', value: 'Stealth' };
  assert.deepEqual(cleanBuildRow({ kind: 'skillCap', target: 'tag', value: ' Fire ' }, tagged), {
    kind: 'skillCap',
    target: 'tag',
    value: 'Fire',
  });
  assert.deepEqual(
    cleanBuildRow({ kind: 'skillCap', target: 'all', value: 'x' }, { kind: 'skillCap', target: 'all', value: '' }),
    { kind: 'skillCap', target: 'all', value: '' }
  );
  // Switching to Skill cap from another kind starts at "all"; switching away resets the target.
  assert.deepEqual(
    cleanBuildRow({ kind: 'skillCap', target: 'evade', value: '1d4' }, { kind: 'checkDie', target: 'evade', value: '1d4' }),
    { kind: 'skillCap', target: 'all', value: '' }
  );
  assert.deepEqual(cleanBuildRow({ kind: 'statCap', target: 'tag', value: 'Stealth' }, tagged), {
    kind: 'statCap',
    target: 'evade',
    value: '',
  });
  // Other rows are only trimmed.
  assert.deepEqual(
    cleanBuildRow({ kind: 'checkDie', target: 'str', value: ' 1d6 ' }, { kind: 'checkDie', target: 'str', value: '1d4' }),
    { kind: 'checkDie', target: 'str', value: '1d6' }
  );
});
