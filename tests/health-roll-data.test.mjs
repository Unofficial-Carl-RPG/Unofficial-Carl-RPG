import { world, makeEffect, makeActor, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CarlRPGActor } from '../module/documents/actor.mjs';
import Crawler from '../module/data/actor-crawler.mjs';
import { healthRollData } from '../module/helpers/health-data.mjs';
import { damageDiceFor, diceNeeds, diceRowProblem } from '../module/helpers/build-damage.mjs';
import { cleanBuildRow } from '../module/helpers/build-mods.mjs';
import { evalAmount, fillData } from '../module/helpers/amounts.mjs';

beforeEach(() => world.reset());

/**
 * The real roll data of a stub actor (what resolveCheck hands to the damage Roll): the actor's
 * own getRollData, with a crawler's data model adding its stats like a real system object does.
 */
const rollDataOf = (actor) => {
  if (actor.type === 'crawler' && !actor.system.getRollData) {
    actor.system.getRollData = () => Crawler.prototype.getRollData.call(actor.system);
  }
  return CarlRPGActor.prototype.getRollData.call(actor);
};

/** Rage: +1 damage for each Health Bar slot lost, on melee attacks, with the melee tick. */
const rage = (extra = {}) => ({
  kind: 'damageDice',
  target: 'tag',
  value: 'melee',
  dice: '@health.lost',
  bonusType: '',
  bonusAlso: '',
  when: 'melee',
  ...extra,
});

const effect = (name, ...rows) => makeEffect({ name, flags: { buildMods: rows } });
const slice = () =>
  makeItem({
    type: 'skill',
    name: 'Slice Attack',
    system: { identifier: 'slice-attack', tags: ['melee'], damage: '1d4 + @str.mod', damageType: 'slashing' },
  });

/* -------------------------------------------- */
/*  The roll data                               */
/* -------------------------------------------- */

test('healthRollData gives value, max and the slots lost, and keeps the other fields', () => {
  const data = healthRollData({ value: 7, max: 10, perBox: 2, capacity: 20 });
  assert.deepEqual(data, { value: 7, max: 10, perBox: 2, capacity: 20, lost: 3 });
});

test('nothing lost at full health, everything at 0, never a negative', () => {
  assert.equal(healthRollData({ value: 10, max: 10 }).lost, 0);
  assert.equal(healthRollData({ value: 0, max: 10 }).lost, 10);
  // (more health than the bar holds, a bar with no max, text, nothing at all)
  assert.equal(healthRollData({ value: 12, max: 10 }).lost, 0);
  assert.deepEqual(healthRollData({ value: 3 }), { value: 3, max: 0, lost: 0 });
  assert.deepEqual(healthRollData({ value: 'x', max: '4' }), { value: 0, max: 4, lost: 4 });
  assert.deepEqual(healthRollData(undefined), { value: 0, max: 0, lost: 0 });
});

test('the actor\'s own health object is left alone', () => {
  const health = { value: 6, max: 10 };
  const data = healthRollData(health);
  data.value = 1;
  assert.deepEqual(health, { value: 6, max: 10 });
});

test('a crawler\'s roll data has @health.value, .max and .lost next to its stats', async () => {
  const crawler = await makeCrawler({ abilities: { str: 14 }, system: { health: { value: 7 } } });
  const data = rollDataOf(crawler);
  assert.equal(data.health.value, 7);
  assert.equal(data.health.max, 10);
  assert.equal(data.health.lost, 3);
  assert.equal(data.str.mod, crawler.system.abilities.str.mod);
});

test('it is read live: the roll data follows the health bar as it changes', async () => {
  const crawler = await makeCrawler();
  assert.equal(rollDataOf(crawler).health.lost, 0);
  crawler.system.health.value = 4;
  assert.equal(rollDataOf(crawler).health.lost, 6);
  crawler.system.health.value = 0;
  assert.equal(rollDataOf(crawler).health.lost, 10);
});

test('a pet\'s smaller bar counts its own boxes', () => {
  // (a pet's health boxes are worked out like a crawler's but can be fewer than 10)
  const pet = makeActor({ type: 'pet', system: { health: { value: 2, max: 4 } } });
  assert.equal(rollDataOf(pet).health.lost, 2);
});

test('a mob counts whole health points, max minus what is left', () => {
  const mob = makeActor({ type: 'mob', system: { health: { value: 20, max: 50, perBox: 2 } } });
  const data = rollDataOf(mob);
  assert.deepEqual([data.health.value, data.health.max, data.health.lost], [20, 50, 30]);
});

test('the formula reads it, alone or mixed with other numbers', async () => {
  const crawler = await makeCrawler({ system: { health: { value: 7 } } });
  const data = rollDataOf(crawler);
  assert.equal(fillData('@health.lost', data).text, '3');
  assert.equal(evalAmount('@health.lost', data), 3);
  assert.equal(evalAmount('@health.lost * 2 + 1', data), 7);
  assert.equal(evalAmount('@health.max - @health.value', data), 3);
  assert.equal(fillData('@health.lost', {}).missing[0], '@health.lost');
});

/* -------------------------------------------- */
/*  Rage: a Bonus damage dice row with a formula */
/* -------------------------------------------- */

test('a Bonus damage dice row takes a formula over roll data, and a die or number still works', () => {
  assert.equal(diceRowProblem(rage()), false);
  assert.equal(diceRowProblem(rage({ dice: '@health.lost + 1d4' })), false);
  assert.equal(diceRowProblem(rage({ dice: '2 * @health.lost' })), false);
  assert.equal(diceRowProblem(rage({ dice: '1d4' })), false);
  assert.equal(diceRowProblem(rage({ dice: '3' })), false);
  assert.equal(diceRowProblem(rage({ dice: '' })), true);
  assert.equal(diceRowProblem(rage({ dice: '??' })), true);
});

test('saving keeps the formula as typed (trimmed), and a new row still starts as 1d4', () => {
  assert.equal(cleanBuildRow(rage({ dice: '  @health.lost  ' })).dice, '@health.lost');
  assert.equal(cleanBuildRow({ kind: 'damageDice', target: 'all' }).dice, '1d4');
});

test('Rage on a melee attack with the melee tick: the row hands over @health.lost', async () => {
  const actor = await makeCrawler({ effects: [effect('Rage', rage())], system: { health: { value: 7 } } });
  const rows = damageDiceFor(actor, slice(), null, { melee: true });
  assert.deepEqual(rows, [{ item: null, name: 'Rage', formula: '@health.lost', when: 'melee', types: [] }]);
  // (what resolveCheck then rolls: the formula over the owner's roll data)
  assert.equal(evalAmount(rows[0].formula, rollDataOf(actor)), 3);
});

test('Rage grows as the Health Bar empties, and is 0 at full health', async () => {
  const actor = await makeCrawler({ effects: [effect('Rage', rage())] });
  const [row] = damageDiceFor(actor, slice(), null, { melee: true });
  const lost = () => evalAmount(row.formula, rollDataOf(actor));
  assert.equal(lost(), 0);
  actor.system.health.value = 5;
  assert.equal(lost(), 5);
  actor.system.health.value = 1;
  assert.equal(lost(), 9);
});

test('Rage needs the melee tick, and the pop-up offers it only for attacks the row covers', async () => {
  const actor = await makeCrawler({ effects: [effect('Rage', rage())] });
  assert.deepEqual(damageDiceFor(actor, slice(), null, { melee: false }), []);
  // (Shift, events and macros never tick it)
  assert.deepEqual(damageDiceFor(actor, slice()), []);
  const bow = makeItem({ type: 'skill', name: 'Ranged Attacks', system: { identifier: 'ranged-attacks', tags: ['ranged'] } });
  assert.deepEqual(damageDiceFor(actor, bow, null, { melee: true }), []);
  assert.deepEqual(diceNeeds(actor, slice()), { surprise: false, melee: true });
  assert.deepEqual(diceNeeds(actor, bow), { surprise: false, melee: false });
});

test('Rage can carry a damage type, and sits beside other rows on the effect', async () => {
  const frost = { kind: 'damageDice', target: 'tag', value: 'melee', dice: '1d4', bonusType: 'ice', bonusAlso: '', when: 'melee' };
  const actor = await makeCrawler({
    effects: [effect('Rage', rage()), effect('Frost Touch', frost)],
    system: { health: { value: 8 } },
  });
  const rows = damageDiceFor(actor, slice(), null, { melee: true });
  assert.deepEqual(rows.map((r) => [r.name, r.formula, r.types]), [
    ['Rage', '@health.lost', []],
    ['Frost Touch', '1d4', ['ice']],
  ]);
  const typed = damageDiceFor(await makeCrawler({ effects: [effect('Fire Rage', rage({ bonusType: 'fire' }))] }), slice(), null, { melee: true });
  assert.deepEqual(typed[0].types, ['fire']);
});

test('a switched-off Rage and a mob get nothing, even though a mob has the roll data', async () => {
  const off = makeEffect({ name: 'Rage', flags: { buildMods: [rage()] }, disabled: true });
  assert.deepEqual(damageDiceFor(await makeCrawler({ effects: [off] }), slice(), null, { melee: true }), []);
  const mob = makeActor({
    type: 'mob',
    effects: [effect('Rage', rage())],
    system: { health: { value: 10, max: 50 } },
  });
  assert.deepEqual(damageDiceFor(mob, slice(), null, { melee: true }), []);
  assert.equal(rollDataOf(mob).health.lost, 40);
});
