import { world, makeEffect, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyBenefits, rollBenefits, buildModsOf } from '../module/helpers/build-mods.mjs';

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
