import { world, makeItem, makeActor } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { actsAsClass } from '../module/helpers/class-combo.mjs';
import { classHasTag } from '../module/helpers/tags.mjs';
import { classRoleOf, comboOf } from '../module/helpers/origins.mjs';

beforeEach(() => world.reset());

const KEY = CONFIG.CARL_RPG.effectModifiers.classCombo.key;
const effectWith = (value) => ({ changes: [{ key: KEY, value: String(value) }] });

/** A race whose effects (if any) are given; a combo has one with the modifier above 0. */
function race(name, { effects = [], categories = [] } = {}) {
  const item = makeItem({ type: 'race', name, system: { categories, tags: [] } });
  item.effects = effects;
  return item;
}

function classItem(name, categories = []) {
  return makeItem({ type: 'class', name, system: { categories, tags: [] } });
}

/** A crawler holding the items, with the item lists the helpers read. */
function crawlerWith(...items) {
  const actor = makeActor({ items });
  const of = (type) => items.filter((i) => i.type === type);
  actor.itemTypes = { race: of('race'), class: of('class'), subclass: of('subclass') };
  return actor;
}

test('the Acts as Class modifier is an effect modifier on the actor bonuses', () => {
  assert.equal(KEY, 'system.bonuses.classCombo');
});

test('a race is a combo when an effect holds the modifier above 0', () => {
  assert.equal(actsAsClass(race('Combo', { effects: [effectWith(1)] })), true);
  assert.equal(actsAsClass(race('Zero', { effects: [effectWith(0)] })), false);
  assert.equal(actsAsClass(race('Plain')), false);
  assert.equal(
    actsAsClass(race('Other', { effects: [{ changes: [{ key: 'system.bonuses.str', value: '2' }] }] })),
    false
  );
});

test('only a race can be a combo', () => {
  const cls = classItem('Fighter');
  cls.effects = [effectWith(1)];
  assert.equal(actsAsClass(cls), false);
  assert.equal(actsAsClass(null), false);
});

test('a combo race fills the class role when there is no class item', () => {
  const combo = race('Combo', { effects: [effectWith(1)] });
  const actor = crawlerWith(combo);
  assert.equal(comboOf(actor), combo);
  assert.equal(classRoleOf(actor), combo);
});

test('a class item takes the class role over a combo (a GM override)', () => {
  const combo = race('Combo', { effects: [effectWith(1)] });
  const cls = classItem('Fighter');
  const actor = crawlerWith(combo, cls);
  assert.equal(classRoleOf(actor), cls);
});

test('a plain race leaves the class role empty', () => {
  const actor = crawlerWith(race('Plain'));
  assert.equal(comboOf(actor), null);
  assert.equal(classRoleOf(actor), null);
});

test('a combo race has class tags through its categories', () => {
  const combo = race('Combo', { effects: [effectWith(1)], categories: ['Fighter'] });
  assert.equal(classHasTag(crawlerWith(combo), 'fighter'), true);
  assert.equal(classHasTag(crawlerWith(combo), 'Mage'), false);
});

test('a plain race with categories does not count as a class', () => {
  const plain = race('Plain', { categories: ['Fighter'] });
  assert.equal(classHasTag(crawlerWith(plain), 'Fighter'), false);
});

test('with a class item, only its tags count, not the combo\'s', () => {
  const combo = race('Combo', { effects: [effectWith(1)], categories: ['Fighter'] });
  const cls = classItem('Wizard', ['Mage']);
  const actor = crawlerWith(combo, cls);
  assert.equal(classHasTag(actor, 'Mage'), true);
  assert.equal(classHasTag(actor, 'Fighter'), false);
});
