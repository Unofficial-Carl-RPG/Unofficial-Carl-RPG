/** Skill lists with #tags, for Roll Modifiers and Damage Effects. */
import { makeItem, makeActor } from './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryTags, listAccepts, listEntries } from '../module/helpers/skill-list.mjs';
import { availableMods, modAccepts } from '../module/helpers/roll-mods.mjs';
import { availableEffects, effectAccepts } from '../module/helpers/damage-effects.mjs';

const skill = (name, tags = [], extra = {}) => makeItem({ name, system: { tags, ...extra } });
const mod = (name, skills) =>
  makeItem({ name, system: { rank: 1, upgrades: [], rollMod: { enabled: true, skills } } });
const effect = (name, skills) =>
  makeItem({ name, system: { rank: 1, upgrades: [], damageEffect: { enabled: true, skills } } });

test('list entries: lower case, trimmed, blanks dropped', () => {
  assert.deepEqual(listEntries(' Ranged Attacks, #Thrown ,, '), ['ranged attacks', '#thrown']);
  assert.deepEqual(listEntries(''), []);
  assert.deepEqual(listEntries(undefined), []);
});

test('tag entries: # marks one, + joins tags that must all be there', () => {
  assert.deepEqual(entryTags('#thrown'), ['thrown']);
  assert.deepEqual(entryTags('#thrown+#fire'), ['thrown', 'fire']);
  assert.deepEqual(entryTags('#thrown + fire'), ['thrown', 'fire']);
  assert.deepEqual(entryTags('thrown'), []);
  assert.deepEqual(entryTags('#'), []);
});

test('a #tag entry covers every skill with the tag, whatever its name', () => {
  const entries = listEntries('#thrown');
  assert.equal(listAccepts(entries, skill('Throwing', ['Thrown'])), true);
  assert.equal(listAccepts(entries, skill('Knife Toss', ['thrown', 'knife'])), true);
  assert.equal(listAccepts(entries, skill('Ranged Attacks', ['bow'])), false);
  assert.equal(listAccepts(entries, skill('Unarmed Combat')), false);
  assert.equal(listAccepts(entries, null), false);
  // Without the # it is a skill name, not a tag.
  assert.equal(listAccepts(listEntries('thrown'), skill('Throwing', ['thrown'])), false);
  assert.equal(listAccepts(listEntries('thrown'), skill('Thrown')), true);
});

test('the item being used counts too, not only the skill it rolls', () => {
  const entries = listEntries('#thrown');
  const ranged = skill('Ranged Attacks', ['bow']);
  const javelin = makeItem({ type: 'gear', name: 'Javelin', system: { tags: ['thrown'] } });
  assert.equal(listAccepts(entries, ranged, javelin), true);
  assert.equal(listAccepts(entries, ranged, makeItem({ type: 'gear', name: 'Sling' })), false);
  assert.equal(listAccepts(entries, ranged, null), false);
});

test('tags joined with + must all be there, across the skill and the item', () => {
  const entries = listEntries('#thrown+#fire');
  assert.equal(listAccepts(entries, skill('Fire Toss', ['thrown', 'fire'])), true);
  assert.equal(listAccepts(entries, skill('Throwing', ['thrown'])), false);
  const torch = makeItem({ type: 'gear', name: 'Torch', system: { tags: ['fire'] } });
  assert.equal(listAccepts(entries, skill('Throwing', ['thrown']), torch), true);
});

test('names, tags and self can share one list; any entry that matches is enough', () => {
  const entries = listEntries('Ranged Attacks, #thrown, self');
  assert.equal(listAccepts(entries, skill('Ranged Attacks')), true);
  assert.equal(listAccepts(entries, skill('Throwing', ['thrown'])), true);
  assert.equal(listAccepts(entries, skill('Unarmed Combat', ['unarmed'])), false);
  // A skipped entry (a modifier's self) never matches, even by name.
  assert.equal(listAccepts(entries, skill('self'), null, { skip: ['self'] }), false);
});

test('a Roll Modifier with #thrown works with thrown skills, and only the ones the actor owns are offered', () => {
  const cesta = mod('Cesta Punta', '#thrown');
  const throwing = skill('Throwing', ['thrown']);
  const ranged = skill('Ranged Attacks', ['bow']);
  assert.equal(modAccepts(cesta, throwing), true);
  assert.equal(modAccepts(cesta, ranged), false);
  const javelin = makeItem({ type: 'gear', name: 'Javelin', system: { tags: ['thrown'] } });
  assert.equal(modAccepts(cesta, ranged, javelin), true);
  const actor = makeActor({ items: [throwing, ranged, cesta] });
  assert.deepEqual(availableMods(actor, throwing).map((m) => m.name), ['Cesta Punta']);
  assert.deepEqual(availableMods(actor, ranged), []);
  assert.deepEqual(availableMods(actor, ranged, javelin).map((m) => m.name), ['Cesta Punta']);
  // self still works beside a tag and never matches another skill.
  const both = mod('Both', 'self, #thrown');
  assert.equal(modAccepts(both, throwing), true);
  assert.equal(modAccepts(both, skill('self')), false);
});

test('a Damage Effect takes #tags the same way', () => {
  const smush = effect('Smush', 'Foot Soldier, #melee');
  assert.equal(effectAccepts(smush, skill('Foot Soldier')), true);
  assert.equal(effectAccepts(smush, skill('Mace Hit', ['melee'])), true);
  assert.equal(effectAccepts(smush, skill('Throwing', ['thrown'])), false);
  const mace = makeItem({ type: 'gear', name: 'Mace', system: { tags: ['melee'] } });
  assert.equal(effectAccepts(smush, skill('Brawling'), mace), true);
  const actor = makeActor({ items: [smush] });
  assert.deepEqual(availableEffects(actor, skill('Mace Hit', ['melee'])).map((e) => e.name), ['Smush']);
  assert.deepEqual(availableEffects(actor, skill('Brawling'), mace).map((e) => e.name), ['Smush']);
  assert.deepEqual(availableEffects(actor, skill('Throwing', ['thrown'])), []);
});
