import { world, makeEffect, makeActor, makeCrawler, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  damageDiceFor,
  diceNeeds,
  diceRowProblem,
  rowCovers,
  statSwapsFor,
  swapRowProblem,
  swapStat,
} from '../module/helpers/build-damage.mjs';
import { buildModsOf, cleanBuildRow, isScopedKind, kindFields } from '../module/helpers/build-mods.mjs';
import { damageParts, partsTotal } from '../module/helpers/damage-types.mjs';
import { resolveMods } from '../module/helpers/roll-mods.mjs';
import { whenOptionsFor } from '../module/helpers/roll-mods.mjs';

beforeEach(() => world.reset());

/** An effect holding build rows. */
const effect = (name, ...rows) => makeEffect({ name, flags: { buildMods: rows } });

/** Frost Kin's row: +1d4 Ice on melee-tagged attacks, when the melee tick is on. */
const frost = (extra = {}) => ({
  kind: 'damageDice',
  target: 'tag',
  value: 'melee',
  dice: '1d4',
  bonusType: 'ice',
  bonusAlso: '',
  when: 'melee',
  ...extra,
});

/** Feline Kin's row: Blade Attack adds Cha instead of Str. */
const swap = (extra = {}) => ({
  kind: 'damageStat',
  target: 'skill',
  value: 'blade-attack',
  from: 'str',
  to: 'cha',
  ...extra,
});

const skill = (name, identifier, tags = [], damage = '1d4 + @str.mod') =>
  makeItem({ type: 'skill', name, system: { identifier, tags, damage, damageType: 'slashing' } });

const crawlerWith = (...effects) => makeCrawler({ effects });

/* -------------------------------------------- */
/*  Saving the rows                             */
/* -------------------------------------------- */

test('both kinds are scoped build rows', () => {
  assert.equal(isScopedKind('damageDice'), true);
  assert.equal(isScopedKind('damageStat'), true);
});

test('a new Bonus damage dice row starts as 1d4, and a within condition starts at 5 ft', () => {
  const fresh = cleanBuildRow({ kind: 'damageDice', target: 'all' });
  assert.deepEqual(fresh, {
    kind: 'damageDice',
    target: 'all',
    value: '',
    dice: '1d4',
    bonusType: '',
    bonusAlso: '',
    when: '',
  });
  const near = cleanBuildRow({ kind: 'damageDice', target: 'all', dice: '1d6', when: 'within' });
  assert.equal(near.feet, 5);
  const far = cleanBuildRow({ kind: 'damageDice', target: 'all', dice: '1d6', when: 'within', feet: '30' });
  assert.equal(far.feet, 30);
  // (a distance is only kept with "within")
  assert.equal('feet' in cleanBuildRow({ kind: 'damageDice', target: 'all', dice: '1d6', when: 'melee', feet: 30 }), false);
});

test('a second damage type needs a first, and keeps the scope of the row', () => {
  const row = cleanBuildRow({ ...frost(), bonusType: '', bonusAlso: 'fire' });
  assert.equal(row.bonusAlso, '');
  const mixed = cleanBuildRow({ ...frost(), bonusAlso: 'fire' }, frost());
  assert.deepEqual([mixed.bonusType, mixed.bonusAlso], ['ice', 'fire']);
  assert.deepEqual([mixed.target, mixed.value], ['tag', 'melee']);
});

test('a new Damage stat row swaps Str for Cha, and unknown stats fall back', () => {
  const fresh = cleanBuildRow({ kind: 'damageStat', target: 'all' });
  assert.deepEqual([fresh.from, fresh.to], ['str', 'cha']);
  const dex = cleanBuildRow(swap({ from: 'str', to: 'dex' }));
  assert.deepEqual([dex.from, dex.to], ['str', 'dex']);
  const odd = cleanBuildRow(swap({ from: 'luck', to: '' }));
  assert.deepEqual([odd.from, odd.to], ['str', 'cha']);
});

test('changing a row\'s kind drops the fields of the old kind', () => {
  const asStat = cleanBuildRow({ ...frost(), kind: 'damageStat' }, frost());
  assert.equal('dice' in asStat, false);
  assert.equal('bonusType' in asStat, false);
  const asCap = cleanBuildRow({ ...swap(), kind: 'skillCap' }, swap());
  assert.equal('from' in asCap, false);
});

test('kindFields gives just the fields of the row\'s own kind', () => {
  assert.deepEqual(Object.keys(kindFields(swap())).sort(), ['from', 'to']);
  assert.deepEqual(Object.keys(kindFields(frost())).sort(), ['bonusAlso', 'bonusType', 'dice', 'when']);
  assert.deepEqual(kindFields({ kind: 'skillCap' }), {});
});

/* -------------------------------------------- */
/*  Which rows can be used                      */
/* -------------------------------------------- */

test('a dice row needs rollable dice, a known damage type and a usable condition', () => {
  assert.equal(diceRowProblem(frost()), false);
  assert.equal(diceRowProblem(frost({ dice: '' })), true);
  assert.equal(diceRowProblem(frost({ dice: '??' })), true);
  // (a type that has left the GM's list, or a second type with no first)
  assert.equal(diceRowProblem(frost({ bonusType: 'unobtainium' })), true);
  assert.equal(diceRowProblem(frost({ bonusType: '', bonusAlso: 'fire' })), true);
  assert.equal(diceRowProblem(frost({ when: 'someday' })), true);
  assert.equal(diceRowProblem(frost({ when: 'within' })), true);
  assert.equal(diceRowProblem(frost({ when: 'within', feet: 5 })), false);
});

test('the Ice type is in the starter damage list, and melee is a condition dice rows can use', () => {
  assert.equal(diceRowProblem(frost({ bonusType: 'ice' })), false);
  assert.ok(whenOptionsFor('damageDice').melee);
  assert.equal(whenOptionsFor('damageDice').within !== undefined, true);
});

test('a stat swap needs two different known stats', () => {
  assert.equal(swapRowProblem(swap()), false);
  assert.equal(swapRowProblem(swap({ to: 'str' })), true);
  assert.equal(swapRowProblem(swap({ to: 'luck' })), true);
});

/* -------------------------------------------- */
/*  What a row covers                           */
/* -------------------------------------------- */

test('a row covers the item used or the skill it rolls with', () => {
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const bow = skill('Ranged Attacks', 'ranged-attacks', ['ranged']);
  const sword = makeItem({ type: 'gear', name: 'Sword', system: { tags: [] } });
  const spear = makeItem({ type: 'gear', name: 'Spear', system: { tags: ['melee'] } });
  const tagRow = { target: 'tag', value: 'melee' };
  assert.equal(rowCovers(tagRow, slice), true);
  assert.equal(rowCovers(tagRow, bow), false);
  // A weapon rolling Blade Attack is covered by the skill's tag...
  assert.equal(rowCovers(tagRow, sword, slice), true);
  // ...and a melee weapon rolling an untagged skill by its own.
  assert.equal(rowCovers(tagRow, spear, bow), true);
  assert.equal(rowCovers(tagRow, sword, bow), false);
  assert.equal(rowCovers({ target: 'skill', value: 'blade-attack' }, sword, slice), true);
  assert.equal(rowCovers({ target: 'all' }, bow), true);
});

/* -------------------------------------------- */
/*  Bonus damage dice                           */
/* -------------------------------------------- */

test('Frost Kin: +1d4 Ice on a melee attack, only with the melee tick', async () => {
  const actor = await crawlerWith(effect('Cold Strikes', frost()));
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  assert.deepEqual(damageDiceFor(actor, slice, null, { melee: true }), [
    { item: null, name: 'Cold Strikes', formula: '1d4', when: 'melee', types: ['ice'] },
  ]);
  assert.deepEqual(damageDiceFor(actor, slice, null, { melee: false }), []);
  // Shift, events and macros never tick it.
  assert.deepEqual(damageDiceFor(actor, slice), []);
});

test('the dice reach only the attacks the scope covers', async () => {
  const actor = await crawlerWith(effect('Cold Strikes', frost()));
  const bow = skill('Ranged Attacks', 'ranged-attacks', ['ranged']);
  assert.deepEqual(damageDiceFor(actor, bow, null, { melee: true }), []);
  const sword = makeItem({ type: 'gear', name: 'Sword', system: { tags: [] } });
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  assert.equal(damageDiceFor(actor, sword, slice, { melee: true }).length, 1);
});

test('the dice have the shape a Roll Modifier\'s dice have, so resolveCheck reads both', async () => {
  const actor = await crawlerWith(effect('Cold Strikes', frost()));
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const [mine] = damageDiceFor(actor, slice, null, { melee: true });
  const modifier = makeItem({
    type: 'skill',
    name: 'Double Tap',
    system: {
      rank: 5,
      rollMod: { enabled: true, skills: '' },
      upgrades: [
        {
          id: 'u1',
          rank: 1,
          description: '',
          changes: [{ type: 'rmDice', value: '1d4', stat: 'str', when: '', bonusType: 'ice', bonusAlso: '' }],
          grants: [],
          unlocksEffects: [],
          events: [],
        },
      ],
    },
  });
  const [theirs] = resolveMods([modifier]).dice;
  assert.deepEqual(Object.keys(mine).sort(), Object.keys(theirs).sort());
});

test('an unticked row, a switched-off effect, a mob and a bad row give nothing', async () => {
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const off = makeEffect({ name: 'Off', flags: { buildMods: [frost()] }, disabled: true });
  assert.deepEqual(damageDiceFor(await crawlerWith(off), slice, null, { melee: true }), []);
  const bad = await crawlerWith(effect('Bad', frost({ dice: '??' }), frost({ bonusType: 'unobtainium' })));
  assert.deepEqual(damageDiceFor(bad, slice, null, { melee: true }), []);
  const mob = makeActor({ type: 'mob', effects: [effect('Cold Strikes', frost())] });
  assert.deepEqual(damageDiceFor(mob, slice, null, { melee: true }), []);
});

test('conditions on the roll are checked now, degree and distance ones are kept for each target', async () => {
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const all = (when, extra = {}) => ({ kind: 'damageDice', target: 'all', dice: '1d6', when, ...extra });
  const actor = await crawlerWith(
    effect('Rows', all(''), all('advantage'), all('surprise'), all('hit'), all('within', { feet: 10 }))
  );
  const whens = (roll) => damageDiceFor(actor, slice, null, roll).map((d) => d.when);
  assert.deepEqual(whens({}), ['', 'hit', 'within']);
  assert.deepEqual(whens({ mode: 'advantage', surprise: true }), ['', 'advantage', 'surprise', 'hit', 'within']);
  const within = damageDiceFor(actor, slice, null, {}).find((d) => d.when === 'within');
  assert.equal(within.feet, 10);
  assert.equal(damageDiceFor(actor, slice, null, {}).find((d) => d.when === '').types.length, 0);
});

test('a row can name two damage types', async () => {
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const actor = await crawlerWith(effect('Mixed', frost({ bonusAlso: 'fire', when: '' })));
  assert.deepEqual(damageDiceFor(actor, slice)[0].types, ['ice', 'fire']);
});

test('the pop-up ticks are offered only for the rows in reach', async () => {
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const bow = skill('Ranged Attacks', 'ranged-attacks', ['ranged']);
  const actor = await crawlerWith(
    effect('Rows', frost(), { kind: 'damageDice', target: 'all', dice: '1d4', when: 'surprise' })
  );
  assert.deepEqual(diceNeeds(actor, slice), { surprise: true, melee: true });
  assert.deepEqual(diceNeeds(actor, bow), { surprise: true, melee: false });
  assert.deepEqual(diceNeeds(await crawlerWith(), slice), { surprise: false, melee: false });
});

test('the Ice dice are a part of their own, apart from the attack\'s slashing', () => {
  // (4 slashing from the skill, 3 rolled on the 1d4 Ice row)
  const parts = damageParts(4, 'slashing', [{ types: ['ice'], amount: 3 }]);
  assert.deepEqual(parts, [
    { type: 'slashing', amount: 4 },
    { type: 'ice', amount: 3 },
  ]);
  assert.equal(partsTotal(parts), 7);
});

/* -------------------------------------------- */
/*  Damage stat swaps                           */
/* -------------------------------------------- */

test('Feline Kin: Blade Attack offers Cha in place of Str, other skills do not', async () => {
  const actor = await crawlerWith(effect('Claws', swap()));
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const bite = skill('Bite', 'bite', ['melee'], '1d8 + @str.mod');
  assert.deepEqual(statSwapsFor(actor, slice, null, slice.system.damage), [
    { id: 'str>cha', from: 'str', to: 'cha' },
  ]);
  assert.deepEqual(statSwapsFor(actor, bite, null, bite.system.damage), []);
});

test('Rodent Kin: Bite offers Dex in place of Str', async () => {
  const actor = await crawlerWith(effect('Fangs', swap({ value: 'bite', to: 'dex' })));
  const bite = skill('Bite', 'bite', ['melee'], '1d8 + @str.mod');
  assert.deepEqual(statSwapsFor(actor, bite, null, bite.system.damage).map((s) => s.id), ['str>dex']);
});

test('a weapon rolling the skill is covered too, and its joined damage is what is checked', async () => {
  const actor = await crawlerWith(effect('Claws', swap()));
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const sword = makeItem({ type: 'gear', name: 'Sword', system: { tags: [], damage: '1d6' } });
  assert.equal(statSwapsFor(actor, sword, slice, '1d6 + 1d4 + @str.mod').length, 1);
});

test('a swap is not offered when the damage has no such stat, and equal swaps are offered once', async () => {
  const actor = await crawlerWith(
    effect('Claws', swap(), swap({ target: 'all' }), swap({ target: 'tag', value: 'melee', to: 'dex' }))
  );
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  assert.deepEqual(statSwapsFor(actor, slice, null, '1d4 + @int.mod'), []);
  // (str to cha twice is one choice; str to dex is another)
  assert.deepEqual(statSwapsFor(actor, slice, null, '1d4 + @str.mod').map((s) => s.id), ['str>cha', 'str>dex']);
  // (with no formula given every covered swap is listed)
  assert.equal(statSwapsFor(actor, slice, null).length, 2);
});

test('a switched-off effect, a bad row and a mob give no swap', async () => {
  const slice = skill('Blade Attack', 'blade-attack', ['melee']);
  const off = makeEffect({ name: 'Off', flags: { buildMods: [swap()] }, disabled: true });
  assert.deepEqual(statSwapsFor(await crawlerWith(off), slice), []);
  assert.deepEqual(statSwapsFor(await crawlerWith(effect('Bad', swap({ to: 'str' }))), slice), []);
  assert.deepEqual(statSwapsFor(makeActor({ type: 'mob', effects: [effect('Claws', swap())] }), slice), []);
});

test('swapStat replaces every modifier of the stat and leaves the rest alone', () => {
  const to = { from: 'str', to: 'cha' };
  assert.equal(swapStat('1d4 + @str.mod', to), '1d4 + @cha.mod');
  assert.equal(swapStat('1d4 + @str.mod + @int.mod + @str.mod', to), '1d4 + @cha.mod + @int.mod + @cha.mod');
  assert.equal(swapStat('1d4 + @str.mod', null), '1d4 + @str.mod');
  assert.equal(swapStat('1d4 + 2', to), '1d4 + 2');
  assert.equal(swapStat(undefined, to), '');
  // (@strength is not a stat modifier)
  assert.equal(swapStat('@strength + @str.total', to), '@strength + @str.total');
});

test('the rows stay on the effect: buildModsOf still lists them', async () => {
  const actor = await crawlerWith(effect('Both', frost(), swap()));
  assert.deepEqual(buildModsOf(actor).map((r) => r.kind), ['damageDice', 'damageStat']);
});
