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
  check: 'Check',
  damage: 'Damage',
  ignoresDr: 'Ignores DR',
  health: (n, v) => `Health ${n} boxes, ${v} each`,
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

test('mob embed: kind line and numbers', () => {
  const info = mobEmbedInfo(mob(), words);
  assert.deepEqual(info.line, ['Elite', 'Goblin', 'Large', 'Level 4']);
  assert.deepEqual(info.chips, [['Evade', 14], ['DR', 3], ['Move', 20], ['Surprise', 11]]);
  assert.equal(info.health, 'Health 8 boxes, 3 each');
  assert.deepEqual(info.attributes.map((a) => [a.label, a.value, a.mod]), [['STR', 12, 1], ['DEX', 6, -2]]);
});

test('mob embed: a blank race is left out of the line', () => {
  const m = mob();
  m.system.race = '';
  assert.deepEqual(mobEmbedInfo(m, words).line, ['Elite', 'Large', 'Level 4']);
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
