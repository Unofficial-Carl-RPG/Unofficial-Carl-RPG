import { world } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAMAGE_TYPES_SETTING,
  DAMAGE_TYPE_CONFIG_SETTING,
  allDamageTypes,
  damageTypes,
  damageTypeLabel,
  damageTypeListProblem,
  damageTypeOptions,
  damageTypeRegistry,
  defaultDamageTypeList,
  normalizeDamageType,
  rowTypesProblem,
  saveDamageTypes,
} from '../module/helpers/damage-types.mjs';

beforeEach(() => {
  world.reset();
  damageTypeRegistry._clear();
});

const ids = (list) => list.map((d) => d.id);
const config = (value) => {
  world.settings[DAMAGE_TYPE_CONFIG_SETTING] = value;
};

test('the starter types all have an icon, a colour and a description, and match the old list', () => {
  const list = defaultDamageTypeList();
  assert.equal(new Set(ids(list)).size, list.length);
  for (const type of list) {
    assert.match(type.icon, /^fa-solid fa-/, type.id);
    assert.match(type.color, /^#[0-9a-f]{6}$/, type.id);
    assert.ok(type.description, type.id);
  }
  assert.equal(CONFIG.CARL_RPG.defaultDamageTypes, list.map((d) => d.label).join(', '));
});

test('Psionic is a starter type of its own, apart from Psychic', () => {
  const list = defaultDamageTypeList();
  assert.ok(ids(list).includes('psionic'));
  assert.ok(ids(list).includes('psychic'));
  assert.notEqual(list.find((d) => d.id === 'psionic').color, list.find((d) => d.id === 'psychic').color);
});

test('a world with nothing saved gets the starter types, with their icons', () => {
  const fire = damageTypes().find((d) => d.id === 'fire');
  assert.equal(fire.label, 'Fire');
  assert.equal(fire.icon, 'fa-solid fa-fire');
  assert.equal(fire.module, false);
});

test('an old comma list still works until the form is saved, keeping starter icons for known names', () => {
  world.settings[DAMAGE_TYPES_SETTING] = 'Fire, Cold Iron';
  const list = damageTypes();
  assert.deepEqual(ids(list), ['fire', 'cold-iron']);
  assert.equal(list[0].icon, 'fa-solid fa-fire');
  assert.equal(list[1].icon, '');
});

test('a saved list replaces the old one, in the GM order', () => {
  world.settings[DAMAGE_TYPES_SETTING] = 'Fire, Cold';
  config({ list: [{ id: 'sonic', label: 'Sonic' }, { id: 'fire', label: 'Flame' }] });
  assert.deepEqual(
    damageTypes().map((d) => [d.id, d.label]),
    [
      ['sonic', 'Sonic'],
      ['fire', 'Flame'],
    ]
  );
});

test('a saved empty list means no types of the GM\'s own', () => {
  config({ list: [] });
  assert.deepEqual(damageTypes(), []);
});

test('renaming keeps the id, so the old id still resolves to the new name', () => {
  config({ list: [{ id: 'fire', label: 'Hellfire' }] });
  assert.equal(damageTypeLabel('fire'), 'Hellfire');
  assert.equal(damageTypeLabel('gone'), 'gone'); // not in the list any more: the id itself
});

test('normalizing: id from the label, a slug, class-only icons, hex colours only', () => {
  assert.deepEqual(normalizeDamageType({ label: ' Cold Iron ' }), {
    id: 'cold-iron',
    label: 'Cold Iron',
    icon: '',
    color: '',
    description: '',
  });
  const type = normalizeDamageType({ id: 'My Id!', label: 'X', icon: 'FA-Solid  fa-fire"><b>', color: 'red', description: ' hi ' });
  assert.equal(type.id, 'my-id');
  assert.equal(type.icon, 'fa-solid fa-fireb');
  assert.equal(type.color, '');
  assert.equal(type.description, 'hi');
  assert.equal(normalizeDamageType({ label: 'X', color: '#ABCDEF' }).color, '#abcdef');
});

test('a module registers a type and it follows the GM\'s own', () => {
  const type = damageTypeRegistry.register({ label: 'Void', icon: 'fa-solid fa-circle', color: '#112233', source: 'my-mod' });
  assert.equal(type.id, 'void');
  const list = damageTypes();
  assert.equal(list.at(-1).id, 'void');
  assert.equal(list.at(-1).module, true);
  assert.equal(list.at(-1).source, 'my-mod');
  assert.ok(ids(list).includes('fire'));
  assert.ok(damageTypeOptions().void);
});

test('registering needs a label or id, replaces by id, and can be undone', () => {
  assert.throws(() => damageTypeRegistry.register({}), TypeError);
  damageTypeRegistry.register({ id: 'void', label: 'Void' });
  damageTypeRegistry.register({ id: 'void', label: 'Voidish' });
  assert.equal(damageTypeRegistry.list().length, 1);
  assert.equal(damageTypeRegistry.get('Void').label, 'Voidish');
  assert.equal(damageTypeRegistry.unregister('void'), true);
  assert.equal(damageTypeRegistry.unregister('void'), false);
  assert.equal(damageTypeRegistry.get('void'), undefined);
});

test('the GM\'s own type wins over a module type with the same id', () => {
  config({ list: [{ id: 'void', label: 'My Void' }] });
  damageTypeRegistry.register({ id: 'void', label: 'Module Void', source: 'my-mod' });
  const voids = allDamageTypes().filter((d) => d.id === 'void');
  assert.equal(voids.length, 1);
  assert.equal(voids[0].label, 'My Void');
  assert.equal(voids[0].module, false);
});

test('the GM can override a module type\'s look and hide it; the id stays', () => {
  damageTypeRegistry.register({ id: 'void', label: 'Void', icon: 'fa-solid fa-circle', color: '#112233', description: 'Dark.' });
  config({ list: [], modules: { void: { label: 'Abyss', color: '#ffffff' } } });
  const type = damageTypes().find((d) => d.id === 'void');
  assert.equal(type.label, 'Abyss');
  assert.equal(type.color, '#ffffff');
  assert.equal(type.icon, 'fa-solid fa-circle'); // not overridden: the module's own
  assert.equal(type.description, 'Dark.');
});

test('a hidden module type leaves the menus but still has its name and stays valid', () => {
  damageTypeRegistry.register({ id: 'void', label: 'Void' });
  config({ list: [], modules: { void: { hidden: true } } });
  assert.ok(!ids(damageTypes()).includes('void'));
  assert.ok(!('void' in damageTypeOptions()));
  assert.ok(ids(allDamageTypes()).includes('void'));
  assert.equal(damageTypeLabel('void'), 'Void');
  assert.equal(rowTypesProblem({ bonusType: 'void' }), false);
  assert.equal(rowTypesProblem({ bonusType: 'nothing' }), true);
});

test('a module type that is unregistered later drops out, its override is just ignored', () => {
  config({ list: [], modules: { void: { label: 'Abyss' } } });
  assert.deepEqual(damageTypes(), []);
});

test('the form refuses blank names, blank ids and repeated ids', () => {
  assert.equal(damageTypeListProblem([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]), null);
  assert.equal(damageTypeListProblem([{ id: 'a', label: ' ' }]), 'EmptyLabel');
  assert.equal(damageTypeListProblem([{ id: '', label: 'A' }]), 'EmptyId');
  assert.equal(damageTypeListProblem([{ id: 'a', label: 'A' }, { id: 'A', label: 'B' }]), 'DuplicateId');
});

test('saving keeps the list tidy and only the overrides that say something', async () => {
  await saveDamageTypes({
    list: [{ id: 'Fire', label: ' Fire ', icon: 'fa-solid fa-fire', color: '#E8590C', description: '' }],
    modules: {
      void: { label: ' Abyss ', icon: '', color: '', description: '', hidden: false },
      plain: { label: '', hidden: false },
      shy: { hidden: true },
    },
  });
  const saved = world.settings[DAMAGE_TYPE_CONFIG_SETTING];
  assert.deepEqual(saved.list, [
    { id: 'fire', label: 'Fire', icon: 'fa-solid fa-fire', color: '#e8590c', description: '' },
  ]);
  assert.deepEqual(saved.modules, { void: { label: 'Abyss' }, shy: { hidden: true } });
  assert.deepEqual(ids(damageTypes()), ['fire']);
});
