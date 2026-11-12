import './stubs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mobEmbedInfo } from '../module/helpers/mob-embed.mjs';

const words = {
  level: 'Level',
  evade: 'Evade',
  dr: 'DR',
  move: 'Move',
  surprise: 'Surprise',
  floor: 'F',
  step: 'S',
  check: 'Check',
  damage: 'Damage',
  ignoresDr: 'Ignores DR',
  kind: (key) => ({ elite: 'Elite', basic: 'Basic' })[key] ?? '',
  size: (key) => ({ large: 'Large' })[key] ?? '',
  target: (key) => ({ evade: 'Evade (attack)', str: 'Strength' })[key] ?? '',
  damageType: (id) => id.toUpperCase(),
  stat: (key) => key.toUpperCase(),
};

const ability = (name, system, sort = 0) => ({ type: 'mobAbility', name, img: `${name}.png`, sort, system });

const mob = (items = []) => ({
  items,
  system: {
    mobType: 'elite',
    race: 'Goblin',
    size: 'large',
    attributes: { level: { value: 4 } },
    evadeTotal: 14,
    drTotal: 3,
    moveTotal: 20,
    surpriseTotal: 11,
    floor: 2,
    health: { max: 8, perBox: 3 },
    abilities: { str: { value: 12, mod: 1 }, dex: { value: 6, mod: -2 } },
  },
});

test('mob embed: kind line and stat block', () => {
  const info = mobEmbedInfo(mob(), words);
  assert.deepEqual(info.line, ['Elite', 'Goblin', 'Large']);
  // Surprise, Evade and DR without the Floor (2), then "+F"; Move then "+S".
  assert.deepEqual(info.stats, [
    ['Level', '4'],
    ['Surprise', '9+F'],
    ['Evade', '12+F'],
    ['Move', '20+S'],
    ['DR', '1+F'],
  ]);
  assert.deepEqual(info.attributes.map((a) => a.text), ['12 (+1)', '6 (-2)']);
  assert.equal(info.health.length, 8);
  assert.deepEqual(info.health[0], { label: '3', percent: '13%' });
  assert.deepEqual(info.health[7], { label: '3', percent: '100%' });
  assert.deepEqual(info.attributes.map((a) => [a.label, a.value, a.mod]), [['STR', 12, 1], ['DEX', 6, -2]]);
});

test('mob embed: a box with a slot value shows that value', () => {
  const m = mob();
  m.system.health = { max: 3, perBox: 2, slots: [2, 5, 2] };
  assert.deepEqual(mobEmbedInfo(m, words).health.map((b) => b.label), ['2', '5', '2']);
});

test('mob embed: a blank race is left out of the line', () => {
  const m = mob();
  m.system.race = '';
  assert.deepEqual(mobEmbedInfo(m, words).line, ['Elite', 'Large']);
});

test('mob embed: only mob abilities, in sheet order, with the Floor added to the check', () => {
  const info = mobEmbedInfo(
    mob([
      { type: 'skill', name: 'Not listed', system: {} },
      ability('Slam', { check: { target: 'evade', number: 10 }, damage: '1d6', damageType: 'bludgeoning', armorPiercing: true }, 20),
      ability('Roar', { check: { target: 'unopposed', number: 5 }, damage: '' }, 10),
    ]),
    words
  );
  assert.deepEqual(info.abilities.map((a) => a.name), ['Roar', 'Slam']);
  assert.deepEqual(info.abilities[0].chips, [['Check', 7]]);
  assert.deepEqual(info.abilities[1].chips, [
    ['Check', 12],
    ['Evade (attack)', ''],
    ['Damage', '1d6 BLUDGEONING'],
    ['Ignores DR', ''],
  ]);
});

test('mob embed: a mob with no abilities has an empty list', () => {
  assert.deepEqual(mobEmbedInfo(mob(), words).abilities, []);
});
