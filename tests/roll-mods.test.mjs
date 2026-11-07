
import { world, makeItem, makeActor } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRankBonus,
  appliesToSelf,
  availableMods,
  clearTempDR,
  degreeMet,
  drGrantsOf,
  drNotes,
  grantTempDR,
  isDegreeWhen,
  isRollMod,
  modAccepts,
  modRules,
  needsSurprise,
  resolveMods,
  selfModOf,
  tempDRTotal,
  whenMet,
  whenOptionsFor,
} from '../module/helpers/roll-mods.mjs';
import { changeProblem, summarizeChanges } from '../module/helpers/upgrades.mjs';

beforeEach(() => world.reset());

/** An upgrade made of [type, value, when] changes. */
const up = (rank, ...changes) => ({
  id: `u${rank}`,
  rank,
  description: '',
  changes: changes.map(([type, value = '', when = '']) => ({
    type,
    value: String(value),
    stat: 'str',
    when,
  })),
  grants: [],
  unlocksEffects: [],
  events: [],
});

/** A Roll Modifier skill. */
const mod = (name, rank, upgrades, skills = '', extra = {}) =>
  makeItem({
    type: 'skill',
    name,
    system: { rank, upgrades, rollMod: { enabled: true, skills }, ...extra },
  });

/** The four skills as an author would build them (rank 1 is the base text). */
const AIMING = [
  up(1, ['rmRank', '', 'disadvantage'], ['rmDice', '1d4', 'hit']),
  up(5, ['rmDice', '1d4', 'hit']),
  up(10, ['rmDice', '1d4', 'hit']),
];
const AMBUSH = [up(5, ['rmDice', '@rankDamage', 'surprise'])];
const CESTA = [up(10, ['rmDice', '@rankDamage'])];
const CATCHER = [up(5, ['rmDR', 5]), up(10, ['rmDR', 5]), up(15, ['rmDR', 5])];

test('rules are folded from the upgrades reached at the modifier\'s rank', () => {
  const at = (rank) => modRules({ rank, upgrades: AIMING });
  assert.deepEqual(at(0), { rank: [], dice: [], dr: [], multiply: [] });
  assert.deepEqual(at(1).rank, [{ when: 'disadvantage' }]);
  assert.deepEqual(at(1).dice, [{ formula: '1d4', when: 'hit' }]);
  assert.equal(at(5).dice.length, 2);
  assert.equal(at(10).dice.length, 3);
  assert.deepEqual(modRules({ rank: 15, upgrades: CATCHER }).dr.map((r) => r.amount), [5, 5, 5]);
  assert.deepEqual(modRules({ rank: 4, upgrades: CATCHER }).dr, []);
});

test('a change with a bad value or a condition its kind cannot use is skipped', () => {
  const rules = modRules({
    rank: 1,
    upgrades: [
      up(1, ['rmRank', '', 'hit'], ['rmDice', '', ''], ['rmDR', -2], ['rmDR', 'x'], ['rmDice', '1d4', 'bogus'], ['rmDice', '1d6', 'miss']),
    ],
  });
  assert.deepEqual(rules, { rank: [], dice: [{ formula: '1d6', when: 'miss' }], dr: [], multiply: [] });
});

test('changes are checked and described', () => {
  const change = (type, value = '', when = '') => ({ type, value, stat: 'str', when });
  assert.equal(changeProblem(change('rmRank')), false);
  assert.equal(changeProblem(change('rmRank', '', 'disadvantage')), false);
  // (A degree condition makes no sense on a roll bonus, which comes before the result.)
  assert.equal(changeProblem(change('rmRank', '', 'hit')), true);
  assert.equal(changeProblem(change('rmDR', 5, 'advantage')), false);
  assert.equal(changeProblem(change('rmDR', 5, 'crit')), true);
  assert.equal(changeProblem(change('rmDR', '')), true);
  assert.equal(changeProblem(change('rmDR', -1)), true);
  assert.equal(changeProblem(change('rmDice', '1d4', 'amazing')), false);
  assert.equal(changeProblem(change('rmDice', '')), true);
  assert.equal(changeProblem(change('rmDice', '@rankDamage', 'surprise')), false);
  // Every one of them is offered, and only on a Roll Modifier.
  const { changes, rollModOnly } = CONFIG.CARL_RPG.upgrades;
  for (const type of rollModOnly) assert.ok(type in changes, type);
  assert.deepEqual(rollModOnly, ['rmRank', 'rmDice', 'rmDR']);

  const text = summarizeChanges(up(1, ['rmRank', '', 'disadvantage'], ['rmDice', '1d4', 'hit'], ['rmDR', 5]));
  assert.match(text, /Summary\.rmRank/);
  assert.match(text, /WhenSummary\.disadvantage/);
  assert.match(text, /Summary\.rmDice.*WhenSummary\.hit/);
  assert.match(text, /Summary\.rmDR/);
});

test('each kind of change offers only the conditions that suit it', () => {
  const ids = (type) => Object.keys(whenOptionsFor(type));
  assert.deepEqual(ids('rmRank'), ['', 'disadvantage', 'advantage', 'surprise']);
  assert.deepEqual(ids('rmDR'), ['', 'disadvantage', 'advantage', 'surprise']);
  assert.deepEqual(ids('rmDice'), ['', 'disadvantage', 'advantage', 'surprise', 'hit', 'amazing', 'crit', 'miss']);
  assert.equal(whenOptionsFor('damageAdd'), null);
  // Every condition has a label.
  for (const when of Object.values(CONFIG.CARL_RPG.rollMods.when)) assert.match(when, /^CARL_RPG\.RollMod\.When\./);
});

test('conditions on the roll read the final mode and the Surprise tick', () => {
  assert.equal(whenMet('', {}), true);
  assert.equal(whenMet('disadvantage', { mode: 'disadvantage' }), true);
  assert.equal(whenMet('disadvantage', { mode: 'advantage' }), false);
  assert.equal(whenMet('disadvantage', {}), false);
  assert.equal(whenMet('advantage', { mode: 'advantage' }), true);
  assert.equal(whenMet('surprise', { surprise: true }), true);
  assert.equal(whenMet('surprise', { surprise: false }), false);
  // A degree condition is left for each target.
  assert.equal(whenMet('hit', {}), true);
});

test('degree conditions read each target\'s degree of success', () => {
  const hits = ['critHit', 'amazing', 'success'];
  const misses = ['nearMiss', 'fail', 'majorFail', 'critFail'];
  for (const d of hits) assert.equal(degreeMet('hit', d), true, d);
  for (const d of misses) assert.equal(degreeMet('hit', d), false, d);
  for (const d of misses) assert.equal(degreeMet('miss', d), true, d);
  for (const d of hits) assert.equal(degreeMet('miss', d), false, d);
  assert.deepEqual(['critHit', 'amazing', 'success', 'fail'].map((d) => degreeMet('amazing', d)), [true, true, false, false]);
  assert.deepEqual(['critHit', 'amazing', 'success', 'fail'].map((d) => degreeMet('crit', d)), [true, false, false, false]);
  // The roll conditions and "always" do not care.
  assert.equal(degreeMet('', 'fail'), true);
  assert.equal(degreeMet('surprise', 'fail'), true);
  assert.deepEqual(['hit', 'amazing', 'crit', 'miss'].map(isDegreeWhen), [true, true, true, true]);
  assert.equal(isDegreeWhen('surprise'), false);
  assert.equal(isDegreeWhen(''), false);
});

test('a modifier lists the skills it works with, by name or identifier, and itself with self', () => {
  const aiming = mod('Aiming', 1, AIMING, 'Ranged Attacks,  Throwing ');
  assert.equal(modAccepts(aiming, makeItem({ name: 'Ranged Attacks' })), true);
  assert.equal(modAccepts(aiming, makeItem({ name: 'throwing' })), true);
  assert.equal(modAccepts(aiming, makeItem({ name: 'Unarmed Combat' })), false);
  assert.equal(modAccepts(aiming, makeItem({ name: 'Bow', system: { identifier: 'ranged attacks' } })), true);
  assert.equal(modAccepts(aiming, null), false);
  assert.equal(modAccepts(mod('Blank', 1, AIMING), makeItem({ name: 'Ranged Attacks' })), false);
  assert.equal(appliesToSelf(aiming), false);

  const catcher = mod('Catcher', 5, CATCHER, 'self');
  assert.equal(appliesToSelf(catcher), true);
  assert.equal(selfModOf(catcher), catcher);
  assert.equal(selfModOf(aiming), null);
  assert.equal(selfModOf(null), null);
  assert.equal(selfModOf(makeItem({ name: 'Plain', system: { rollMod: { enabled: false, skills: 'self' } } })), null);
  // "self" is not a skill name: it never matches another skill.
  assert.equal(modAccepts(catcher, makeItem({ name: 'self' })), false);
});

test('only modifiers the actor owns, that list the skill, can be chosen (not the skill itself)', () => {
  const ranged = makeItem({ name: 'Ranged Attacks' });
  const aiming = mod('Aiming', 1, AIMING, 'Ranged Attacks');
  const cesta = mod('Cesta Punta', 10, CESTA, 'Ranged Attacks, Throwing');
  const ambush = mod('Ambush', 5, AMBUSH, 'Unarmed Combat');
  const plain = makeItem({ name: 'Not a modifier', system: { rollMod: { enabled: false, skills: 'Ranged Attacks' } } });
  const actor = makeActor({ items: [ranged, aiming, cesta, ambush, plain] });
  assert.deepEqual(availableMods(actor, ranged).map((m) => m.name), ['Aiming', 'Cesta Punta']);
  assert.deepEqual(availableMods(actor, null), []);
  assert.deepEqual(availableMods(null, ranged), []);
  // A modifier never offers itself, even when it lists its own name.
  const selfish = mod('Selfish', 1, AIMING, 'Selfish');
  const actor2 = makeActor({ items: [selfish] });
  assert.deepEqual(availableMods(actor2, selfish), []);
  assert.equal(isRollMod(aiming), true);
  assert.equal(isRollMod(plain), false);
  assert.equal(isRollMod(makeItem({ type: 'gear', system: { rollMod: { enabled: true } } })), false);
});

test('Aiming: its Rank is added only with Disadvantage, and 1d4 per reached upgrade on a hit', () => {
  const aiming = mod('Aiming', 10, AIMING, 'Ranged Attacks');
  const normal = resolveMods([aiming], { mode: 'normal' });
  assert.deepEqual(normal.rank, []);
  assert.equal(normal.dice.length, 3);
  assert.ok(normal.dice.every((d) => d.when === 'hit' && d.formula === '1d4' && d.item === aiming));

  const worse = resolveMods([aiming], { mode: 'disadvantage' });
  assert.deepEqual(worse.rank, [{ id: aiming.id, name: 'Aiming', amount: 10 }]);

  // A rank of 0 adds nothing; the build's advantage cancelling Disadvantage is the caller's mode.
  const zero = mod('Aiming', 0, AIMING, 'Ranged Attacks');
  assert.deepEqual(resolveMods([zero], { mode: 'disadvantage' }), { rank: [], dr: [], dice: [], multipliers: [] });
});

test('Ambush and Cesta Punta add their own rank die; Ambush only on a Surprise attack', () => {
  const ambush = mod('Ambush', 5, AMBUSH, 'Unarmed Combat');
  assert.equal(needsSurprise(ambush), true);
  assert.deepEqual(resolveMods([ambush], { surprise: false }).dice, []);
  const surprised = resolveMods([ambush], { surprise: true });
  assert.deepEqual(surprised.dice.map((d) => d.formula), ['@rankDamage']);
  assert.equal(surprised.dice[0].item, ambush);

  const cesta = mod('Cesta Punta', 10, CESTA, 'Throwing');
  assert.equal(needsSurprise(cesta), false);
  assert.equal(resolveMods([cesta], {}).dice.length, 1);
  // Before rank 10 the upgrade is not reached.
  assert.equal(resolveMods([mod('Cesta Punta', 9, CESTA, 'Throwing')], {}).dice.length, 0);
});

test('the Rank is added to the roll as extra bonus, with a note', () => {
  const aiming = mod('Aiming', 7, AIMING, 'Ranged Attacks');
  const resolved = resolveMods([aiming], { mode: 'disadvantage' });
  assert.deepEqual(addRankBonus({}, resolved).bonus, '7');
  assert.deepEqual(addRankBonus({ bonus: '2' }, resolved).bonus, '2 + 7');
  assert.deepEqual(addRankBonus({ bonus: '-1', auto: ['x'] }, resolved).auto.length, 2);
  assert.match(addRankBonus({}, resolved).auto[0], /RankNote/);
  // Nothing to add leaves the answers as they are.
  const options = { bonus: '3' };
  assert.equal(addRankBonus(options, resolveMods([aiming], { mode: 'normal' })), options);
});

test('Catcher: +5 DR per reached upgrade, held per modifier until used', async () => {
  const catcher = mod('Catcher', 10, CATCHER, 'self');
  const resolved = resolveMods([catcher], {});
  assert.deepEqual(drGrantsOf(resolved), { [catcher.id]: { amount: 10, name: 'Catcher' } });
  assert.equal(drNotes(drGrantsOf(resolved)).length, 1);
  assert.deepEqual(drGrantsOf({ dr: [] }), {});

  const actor = makeActor({ items: [catcher] });
  assert.equal(tempDRTotal(actor), 0);
  await grantTempDR(actor, drGrantsOf(resolved));
  assert.equal(tempDRTotal(actor), 10);
  // Used again before any damage: replaced, not stacked.
  await grantTempDR(actor, drGrantsOf(resolved));
  assert.equal(tempDRTotal(actor), 10);
  // Another modifier's bonus adds up with it.
  await grantTempDR(actor, { other: { amount: 3, name: 'Other' } });
  assert.equal(tempDRTotal(actor), 13);
  // Damage uses it all up.
  await clearTempDR(actor);
  assert.equal(tempDRTotal(actor), 0);
  assert.deepEqual(actor.flags['carl-rpg'], {});
});

test('holding or clearing DR with nothing to hold changes nothing', async () => {
  const actor = makeActor({});
  await grantTempDR(actor, {});
  await clearTempDR(actor);
  await grantTempDR(null, { a: { amount: 1, name: 'A' } });
  await clearTempDR(null);
  assert.deepEqual(actor.updates, []);
  assert.equal(tempDRTotal(null), 0);
});

test('the Surprise tick is offered by any modifier row that needs it', () => {
  const dr = mod('Dodgy', 1, [up(1, ['rmDR', 2, 'surprise'])], 'self');
  assert.equal(needsSurprise(dr), true);
  const rank = mod('Sneaky', 1, [up(1, ['rmRank', '', 'surprise'])], 'x');
  assert.equal(needsSurprise(rank), true);
  assert.equal(needsSurprise(mod('Aiming', 1, AIMING, 'x')), false);
  // Several modifiers add up on one roll.
  const both = resolveMods([mod('Aiming', 3, AIMING, 'x'), dr], { mode: 'disadvantage', surprise: true });
  assert.equal(both.rank.length, 1);
  assert.equal(both.dr.length, 1);
  assert.equal(both.dice.length, 1);
});
