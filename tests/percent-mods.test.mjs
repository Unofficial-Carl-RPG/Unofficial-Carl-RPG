import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERCENT_STATS,
  cleanPercentRow,
  clearPercentRows,
  percentChanges,
  percentOf,
  settlePercentRows,
  totalOf,
} from '../module/helpers/percent-mods.mjs';
import { CarlRPGActiveEffect } from '../module/documents/active-effect.mjs';

const MODS = CONFIG.CARL_RPG.effectModifiers;
const ADD = 2;

const crawler = (con = 14, str = 10) => ({
  type: 'crawler',
  system: {
    abilities: { str: { enhanced: str }, con: { enhanced: con }, int: { enhanced: 8 }, dex: { enhanced: 9 }, cha: { enhanced: 7 } },
    dr: { armor: 6, total: 6 },
    evade: { total: 12 },
    move: { total: 30, stepTotal: 10 },
    mana: { max: 8 },
  },
});

test('percentOf rounds down, toward zero for penalties', () => {
  assert.equal(percentOf(12, 10), 1);
  assert.equal(percentOf(14, 5), 0);
  assert.equal(percentOf(20, 5), 1);
  assert.equal(percentOf(19, 10), 1);
  assert.equal(percentOf(12, -10), -1);
  assert.equal(percentOf(0, 50), 0);
  assert.equal(percentOf('x', 10), 0);
  assert.equal(percentOf(10, NaN), 0);
  assert.equal(percentOf(30, 100), 30);
});

test('totalOf reads the Enhanced value and the totals', () => {
  const actor = crawler(14, 10);
  assert.equal(totalOf(actor, 'con'), 14);
  assert.equal(totalOf(actor, 'dr'), 6);
  assert.equal(totalOf(actor, 'evade'), 12);
  assert.equal(totalOf(actor, 'move'), 30);
  assert.equal(totalOf(actor, 'step'), 10);
  assert.equal(totalOf(actor, 'mana'), 8);
  assert.equal(totalOf(actor, 'nope'), 0);
  assert.equal(totalOf(null, 'str'), 0);
});

test('totalOf covers mobs (set totals) and stats without an Enhanced value', () => {
  const mob = { system: { abilities: { str: { value: 5 } }, bonuses: { str: 2 }, drTotal: 14, evadeTotal: 21, moveTotal: 40 } };
  assert.equal(totalOf(mob, 'str'), 7);
  assert.equal(totalOf(mob, 'dr'), 14);
  assert.equal(totalOf(mob, 'evade'), 21);
  assert.equal(totalOf(mob, 'move'), 40);
  assert.equal(totalOf(mob, 'mana'), 0);
});

test('every percent stat has an effect modifier menu entry', () => {
  for (const id of PERCENT_STATS) assert.ok(MODS[id]?.key, id);
});

test('cleanPercentRow: known stat, whole percent, kept flat', () => {
  assert.deepEqual(cleanPercentRow({ stat: 'con', percent: '5.9', flat: '2' }), { stat: 'con', percent: 5, flat: 2 });
  assert.deepEqual(cleanPercentRow({ stat: 'nope', percent: 'x' }), { stat: 'str', percent: 0, flat: null });
  assert.equal(cleanPercentRow({ stat: 'dr', percent: 1, flat: '' }).flat, null);
});

test('settlePercentRows: landing on an actor works every row out from the actor total', () => {
  const rows = [
    { stat: 'con', percent: 10, flat: null },
    { stat: 'str', percent: 10, flat: null },
  ];
  const out = settlePercentRows(rows, { totalOf: (s) => totalOf(crawler(20, 15), s) });
  assert.deepEqual(out.map((r) => r.flat), [2, 1]);
});

test('settlePercentRows: later edits keep untouched rows and rework changed ones without their own old number', () => {
  // Con 22 now, of which this effect's old +2 (10% of 20) is part: 20% of 20 = 4, not of 22.
  const prev = [
    { stat: 'con', percent: 10, flat: 2 },
    { stat: 'str', percent: 10, flat: 3 },
  ];
  const next = [
    { stat: 'con', percent: 20, flat: 2 },
    { stat: 'str', percent: 10, flat: 3 },
    { stat: 'dex', percent: 50, flat: null },
  ];
  const totals = { con: 22, str: 40, dex: 9 };
  const out = settlePercentRows(next, {
    totalOf: (s) => totals[s],
    prev,
    own: (row) => row.flat,
  });
  assert.deepEqual(out.map((r) => r.flat), [4, 3, 4]);
});

test('clearPercentRows forgets the numbers (an effect on an item is a template)', () => {
  assert.deepEqual(clearPercentRows([{ stat: 'con', percent: 5, flat: 3 }]), [{ stat: 'con', percent: 5, flat: null }]);
});

test('percentChanges: flat adds in the usual keys, nothing for unsettled or zero rows', () => {
  const changes = percentChanges(
    [
      { stat: 'con', percent: 10, flat: 2 },
      { stat: 'str', percent: 10, flat: null },
      { stat: 'dr', percent: 5, flat: 0 },
      { stat: 'evade', percent: -10, flat: -1 },
    ],
    MODS,
    ADD
  );
  assert.deepEqual(changes, [
    { key: 'system.bonuses.con', mode: ADD, value: '2', priority: null },
    { key: 'system.bonuses.evade', mode: ADD, value: '-1', priority: null },
  ]);
});

/* The effect document: the flat result joins the applied changes, never the stored ones. */

function effect(flags, { parent, changes = [] } = {}) {
  const fx = Object.create(CarlRPGActiveEffect.prototype);
  fx.flags = { 'carl-rpg': flags };
  fx.changes = changes;
  Object.defineProperty(fx, 'parent', { value: parent });
  return fx;
}

test('an effect on an actor applies its percent as a flat change, once', () => {
  const actor = Object.create(globalThis.Actor.prototype);
  const fx = effect({ percentMods: [{ stat: 'con', percent: 10, flat: 2 }] }, {
    parent: actor,
    changes: [{ key: 'system.bonuses.str', mode: ADD, value: '1', priority: null }],
  });
  fx.prepareBaseData();
  fx.prepareBaseData(); // prepared again: not added twice
  assert.deepEqual(
    fx.changes.map((c) => [c.key, c.value]),
    [['system.bonuses.str', '1'], ['system.bonuses.con', '2']]
  );
});

test('an effect on an item (a template) applies nothing', () => {
  const item = Object.create(globalThis.Item.prototype);
  const fx = effect({ percentMods: [{ stat: 'con', percent: 10, flat: null }] }, { parent: item });
  fx.prepareBaseData();
  assert.deepEqual(fx.changes, []);
});

test('the three carl-content examples: percent of the owner, rounded down, then flat', () => {
  const grater = [{ stat: 'con', percent: 5, flat: null }];
  const wand = [{ stat: 'con', percent: 10, flat: null }];
  const grips = [{ stat: 'str', percent: 10, flat: null }];
  const owner = crawler(40, 25);
  const flats = (rows) => settlePercentRows(rows, { totalOf: (s) => totalOf(owner, s) })[0].flat;
  assert.equal(flats(grater), 2);
  assert.equal(flats(wand), 4);
  assert.equal(flats(grips), 2);
  // A smaller owner gets less, and a tiny 5% can round to nothing.
  const small = crawler(14, 10);
  assert.equal(settlePercentRows(grater, { totalOf: (s) => totalOf(small, s) })[0].flat, 0);
  assert.equal(settlePercentRows(wand, { totalOf: (s) => totalOf(small, s) })[0].flat, 1);
});
