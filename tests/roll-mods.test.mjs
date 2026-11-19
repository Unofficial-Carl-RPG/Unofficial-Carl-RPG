
import { world, makeItem, makeActor, makeEffect } from './stubs.mjs';
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
  listedSkills,
  resolveMods,
  scopeCovers,
  scopeRowProblem,
  scopeRowsOf,
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
  assert.deepEqual(ids('rmDice'), ['', 'disadvantage', 'advantage', 'surprise', 'hit', 'amazing', 'crit', 'miss', 'within']);
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

/* -------------------------------------------- */
/*  Roll Modifier scope (a build benefit)       */
/* -------------------------------------------- */

/** The Ice Caster's row: Aiming also covers ranged, single-target Ice spells. */
const ICE_ROW = {
  kind: 'rollModScope',
  target: 'skill',
  value: 'aiming',
  name: 'Aiming',
  entries: '#ice+#ranged',
  single: true,
};
/** Aiming as the compendium has it: its own list is ranged weapons only. */
const aimingSkill = () => mod('Aiming', 1, AIMING, '#ranged-weapon', { identifier: 'aiming' });
/** A spell with tags and targeting. */
const castable = (
  name,
  { tags = ['spell', 'attack', 'ranged', 'ice'], targeting = { mode: 'count', count: '1' } } = {}
) =>
  makeItem({
    type: 'spell',
    name,
    system: { identifier: name.toLowerCase().replace(/ /g, '-'), tags, targeting },
  });
/** A crawler whose effect carries the rows (the Ice Caster's by default). */
const withRows = (items, rows = [ICE_ROW], disabled = false) =>
  makeActor({ items, effects: [makeEffect({ name: 'Aiming for Ice', flags: { buildMods: rows }, disabled })] });
/** The names of the modifiers offered for a spell cast. */
const offered = (actor, spell) => availableMods(actor, spell, spell).map((m) => m.name);

test('a scope row gives Aiming to ranged single-target ice spells and no others', () => {
  const icicles = castable('Ice Shards');
  const iceBlast = castable('Frost Bolt');
  const frostScar = castable('Frost Slash', { tags: ['spell', 'attack', 'melee', 'ice'] });
  const fireball = castable('Fireball', {
    tags: ['spell', 'attack', 'ranged', 'fire'],
    targeting: { mode: 'area', count: '1' },
  });
  const volley = castable('Ice Volley', { targeting: { mode: 'count', count: '3' } });
  const nova = castable('Frost Nova', { targeting: { mode: 'area', count: '1' } });
  const actor = withRows([aimingSkill(), icicles, iceBlast, frostScar, fireball, volley, nova]);
  assert.deepEqual(offered(actor, icicles), ['Aiming']);
  assert.deepEqual(offered(actor, iceBlast), ['Aiming']);
  for (const other of [frostScar, fireball, volley, nova]) {
    assert.deepEqual(offered(actor, other), [], other.name);
  }
});

test('other crawlers, and a switched off effect, still cannot use Aiming on spells', () => {
  const none = makeActor({ items: [aimingSkill(), castable('Ice Shards')] });
  assert.deepEqual(offered(none, none.items[1]), []);
  const off = withRows([aimingSkill(), castable('Ice Shards')], [ICE_ROW], true);
  assert.deepEqual(offered(off, off.items[1]), []);
  const on = withRows([aimingSkill(), castable('Ice Shards')]);
  assert.deepEqual(offered(on, on.items[1]), ['Aiming']);
});

test('the modifier\'s own list is not changed: ranged weapons still work, with or without the row', () => {
  const aiming = aimingSkill();
  const actor = withRows([aiming]);
  assert.deepEqual(listedSkills(aiming), ['#ranged-weapon']);
  const ranged = makeItem({ name: 'Ranged Attacks', system: { tags: ['ranged-weapon'] } });
  assert.equal(modAccepts(aiming, ranged), true);
  assert.equal(modAccepts(aiming, ranged, null, { rows: scopeRowsOf(actor, aiming) }), true);
  assert.equal(modAccepts(aiming, makeItem({ name: 'Unarmed Combat' }), null, { rows: scopeRowsOf(actor, aiming) }), false);
});

test('scope rows name one modifier by Identifier (any case); unusable rows are skipped', () => {
  const aiming = aimingSkill();
  const cesta = mod('Cesta Punta', 10, CESTA, 'x', { identifier: 'cesta-punta' });
  const rows = [
    { ...ICE_ROW, value: ' AIMING ' },
    { ...ICE_ROW, value: 'cesta-punta', entries: '#fire', single: false },
    { ...ICE_ROW, entries: ' , ' },
    { ...ICE_ROW, value: '' },
    { kind: 'checkDie', target: 'evade', value: '1d4' },
  ];
  const actor = withRows([aiming, cesta], rows);
  assert.equal(scopeRowsOf(actor, aiming).length, 1);
  assert.deepEqual(scopeRowsOf(actor, cesta).map((r) => r.entries), ['#fire']);
  // a modifier with no Identifier, or no actor, gets nothing
  assert.deepEqual(scopeRowsOf(actor, mod('Plain', 1, AIMING, 'x')), []);
  assert.deepEqual(scopeRowsOf(null, aiming), []);
  assert.equal(scopeRowProblem(ICE_ROW), false);
  assert.equal(scopeRowProblem({ ...ICE_ROW, entries: ' , ' }), true);
  assert.equal(scopeRowProblem({ ...ICE_ROW, value: ' ' }), true);
  assert.equal(scopeRowProblem(null), true);
});

test('the single-target tick fails an area version of the cast; the modifier\'s own list does not', () => {
  const icicles = castable('Ice Shards');
  assert.equal(scopeCovers(ICE_ROW, icicles, icicles), true);
  assert.equal(scopeCovers(ICE_ROW, icicles, icicles, { area: true }), false);
  assert.equal(scopeCovers({ ...ICE_ROW, single: false }, icicles, icicles, { area: true }), true);
  // the item defaults to the skill (a spell is its own skill)
  assert.equal(scopeCovers(ICE_ROW, icicles), true);
  assert.equal(scopeCovers(ICE_ROW, null), false);
  assert.equal(modAccepts(aimingSkill(), icicles, icicles, { rows: [ICE_ROW] }), true);
  assert.equal(modAccepts(aimingSkill(), icicles, icicles, { rows: [ICE_ROW], area: true }), false);
  assert.equal(modAccepts(mod('Frost Focus', 1, AIMING, '#ice'), icicles, icicles, { rows: [ICE_ROW], area: true }), true);
});

test('the target count of a single-target check can read roll data', () => {
  const lance = castable('Frost Lance', { targeting: { mode: 'count', count: '@targets' } });
  assert.equal(scopeCovers(ICE_ROW, lance, lance, { data: { targets: 1 } }), true);
  assert.equal(scopeCovers(ICE_ROW, lance, lance, { data: { targets: 2 } }), false);
  const actor = withRows([aimingSkill(), lance]);
  assert.deepEqual(availableMods(actor, lance, lance, { data: { targets: 1 } }).map((m) => m.name), ['Aiming']);
  assert.deepEqual(availableMods(actor, lance, lance, { data: { targets: 2 } }), []);
});

test('scope entries are names, identifiers and #tags; the item\'s tags count; self never matches', () => {
  const row = { ...ICE_ROW, entries: 'Ice Shards, #thrown+#fire, self', single: false };
  assert.equal(scopeCovers(row, castable('Ice Shards')), true);
  assert.equal(scopeCovers(row, castable('Fireball', { tags: ['fire'] })), false);
  assert.equal(scopeCovers(row, makeItem({ name: 'self' })), false);
  const throwing = makeItem({ name: 'Throwing' });
  const torch = makeItem({ type: 'gear', name: 'Torch', system: { tags: ['thrown', 'fire'] } });
  const rock = makeItem({ type: 'gear', name: 'Rock', system: { tags: ['thrown'] } });
  assert.equal(scopeCovers(row, throwing, torch), true);
  assert.equal(scopeCovers(row, throwing, rock), false);
});

test('spells are offered the modifiers whose own list names them (a spell is its own skill)', () => {
  const focus = mod('Frost Focus', 1, AIMING, '#ice, Frost Slash', { identifier: 'frost-focus' });
  const icicles = castable('Ice Shards');
  const frostScar = castable('Frost Slash', { tags: ['spell', 'melee'] });
  const fireball = castable('Fireball', { tags: ['spell', 'fire'] });
  const actor = makeActor({ items: [focus, icicles, frostScar, fireball] });
  assert.deepEqual(offered(actor, icicles), ['Frost Focus']);
  assert.deepEqual(offered(actor, frostScar), ['Frost Focus']);
  assert.deepEqual(offered(actor, fireball), []);
  // a modifier never offers itself
  assert.deepEqual(offered(actor, focus), []);
});
