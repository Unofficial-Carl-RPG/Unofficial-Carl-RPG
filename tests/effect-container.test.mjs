import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canHoldEffects,
  isEffectContainer,
  newEffectData,
  planDrop,
  replaceUpdate,
  startsDisabled,
} from '../module/helpers/effect-container.mjs';

const NS = 'carl-rpg';

// A stand-in for an ActiveEffect document: the getters the rules read, plus toObject().
const fx = (name, { identifier = '', kind = 'passive', equipLinked = false, flags = {} } = {}) => ({
  name,
  identifier,
  kind,
  equipLinked,
  toObject() {
    return structuredClone({
      _id: `id-${name}`,
      _stats: { coreVersion: '13' },
      name,
      img: 'icons/svg/aura.svg',
      origin: 'Item.abc',
      transfer: true,
      disabled: false,
      changes: [{ key: 'system.bonuses.str', mode: 2, value: '1' }],
      flags: { [NS]: { kind, identifier, equipLinked, sourceItems: ['old'], stacks: 3, roundsLeft: 2, ...flags } },
    });
  },
});
const matches = (a, b) => (a.identifier && b.identifier ? a.identifier === b.identifier : a.name === b.name);

test('which documents are containers and which can hold effects', () => {
  assert.equal(isEffectContainer({ documentName: 'Item', type: 'effectContainer' }), true);
  assert.equal(isEffectContainer({ documentName: 'Item', type: 'gear' }), false);
  assert.equal(isEffectContainer({ documentName: 'Actor', type: 'effectContainer' }), false);
  for (const type of ['crawler', 'mob', 'pet']) assert.equal(canHoldEffects({ documentName: 'Actor', type }), true);
  for (const type of ['mount', 'lootPile']) assert.equal(canHoldEffects({ documentName: 'Actor', type }), false);
  for (const type of ['skill', 'spell', 'gear', 'item', 'mobAbility', 'club', 'deity', 'race', 'class', 'subclass', 'species', 'effectContainer']) {
    assert.equal(canHoldEffects({ documentName: 'Item', type }), true, type);
  }
  for (const type of ['spellScroll', 'lootBox', 'store', 'quest', 'achievement', 'background', 'sponsor', 'personalSpace']) {
    assert.equal(canHoldEffects({ documentName: 'Item', type }), false, type);
  }
  assert.equal(canHoldEffects(null), false);
});

test('planDrop pairs matching effects (identifier first, else name) and adds the rest', () => {
  const have = [fx('Burning'), fx('Other', { identifier: 'shield' })];
  const plan = planDrop([fx('Burning'), fx('Renamed', { identifier: 'shield' }), fx('Fresh')], have, matches);
  assert.equal(plan.length, 3);
  assert.equal(plan[0].replaces, have[0]);
  assert.equal(plan[1].replaces, have[1]);
  assert.equal(plan[2].replaces, null);
});

test('planDrop treats matching effects inside the container as one, except stacking buffs', () => {
  const twice = [fx('Burning'), fx('Burning')];
  assert.equal(planDrop(twice, [], matches).length, 1);
  assert.equal(planDrop(twice, [], matches, () => true).length, 2);
});

test('planDrop replaces each existing effect only once', () => {
  const a = fx('Rage');
  const b = fx('Rage');
  const plan = planDrop([fx('Rage'), fx('Rage')], [a, b], matches, () => true);
  assert.equal(plan[0].replaces, a);
  assert.equal(plan[1].replaces, b);
  const third = planDrop([fx('Rage'), fx('Rage'), fx('Rage')], [a], matches, () => true);
  assert.equal(third[0].replaces, a);
  assert.equal(third[1].replaces, null);
  assert.equal(third[2].replaces, null);
});

test('buffs start off; gear-tied effects follow the gear; the rest start on', () => {
  assert.equal(startsDisabled(fx('b', { kind: 'buff' })), true);
  assert.equal(startsDisabled(fx('d', { kind: 'debuff' })), false);
  assert.equal(startsDisabled(fx('p', { kind: 'passive' })), false);
  const tied = fx('t', { kind: 'passive', equipLinked: true });
  assert.equal(startsDisabled(tied, { gear: true, equipped: false }), true);
  assert.equal(startsDisabled(tied, { gear: true, equipped: true }), false);
  // Tied to equipment but not given by gear: nothing controls it, so it follows its kind.
  assert.equal(startsDisabled(tied, { gear: false }), false);
});

test('an effect put on an actor by hand has no source, no origin and fresh stacks', () => {
  const data = newEffectData(fx('Burning', { kind: 'debuff' }), { onActor: true });
  assert.equal(data._id, undefined);
  assert.equal(data._stats, undefined);
  assert.equal(data.transfer, false);
  assert.equal(data.origin, null);
  assert.equal(data.disabled, false);
  assert.deepEqual(data.flags[NS].sourceItems, []);
  assert.equal(data.flags[NS].stacks, 1);
  assert.equal(data.flags[NS].roundsLeft, undefined);
  assert.equal(newEffectData(fx('Buff', { kind: 'buff' }), { onActor: true }).disabled, true);
});

test('an effect passed on from an item an actor holds is sourced from that item', () => {
  const gear = { id: 'g1', uuid: 'Actor.a.Item.g1', type: 'gear', system: { equipped: false } };
  const tied = fx('Grip', { equipLinked: true });
  const off = newEffectData(tied, { onActor: true, source: gear });
  assert.deepEqual(off.flags[NS].sourceItems, ['g1']);
  assert.equal(off.origin, 'Actor.a.Item.g1');
  assert.equal(off.disabled, true);
  gear.system.equipped = true;
  assert.equal(newEffectData(tied, { onActor: true, source: gear }).disabled, false);
});

test('an effect put on an item is a template with no runtime state', () => {
  const data = newEffectData(fx('Burning'), {});
  assert.equal(data.origin, undefined);
  assert.equal(data.flags[NS].sourceItems, undefined);
  assert.equal(data.flags[NS].stacks, undefined);
  assert.equal(data.flags[NS].roundsLeft, undefined);
  assert.equal(data.changes[0].value, '1');
  assert.equal(newEffectData(fx('Smite'), { tier: 1 }).flags[NS].tier, 1);
});

test('replacing keeps the old effect\'s state and sources and drops flags the new one lacks', () => {
  const old = {
    _id: 'e1',
    disabled: true,
    origin: 'Actor.a.Item.old',
    flags: { [NS]: { kind: 'debuff', rounds: 3, sourceItems: ['i1'], stacks: 2, roundsLeft: 1 } },
  };
  const fresh = newEffectData(fx('Burning', { kind: 'passive' }), {});
  const update = replaceUpdate(old, fresh, 'i2');
  assert.equal(update.name, 'Burning');
  assert.deepEqual(update.changes, fresh.changes);
  for (const key of ['_id', 'origin', 'transfer', 'disabled', 'start', 'sort', 'ownership']) {
    assert.equal(key in update, false, key);
  }
  const carl = update.flags[NS];
  assert.deepEqual(carl.sourceItems, ['i1', 'i2']);
  assert.equal(carl.kind, 'passive');
  assert.equal(carl['-=rounds'], null);
  assert.equal('stacks' in carl, false);
  assert.equal('roundsLeft' in carl, false);
  assert.equal('-=stacks' in carl, false);
});

test('replacing does not repeat a source and can set a deity tier', () => {
  const old = { flags: { [NS]: { sourceItems: ['i1'] } } };
  const fresh = newEffectData(fx('Smite'), {});
  assert.deepEqual(replaceUpdate(old, fresh, 'i1').flags[NS].sourceItems, ['i1']);
  assert.equal(replaceUpdate(old, fresh, '', 2).flags[NS].tier, 2);
  assert.deepEqual(replaceUpdate({}, fresh).flags[NS].sourceItems, []);
});

test('the type and its messages are in the manifest and en.json', () => {
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
  const system = JSON.parse(readFileSync(new URL('../system.json', import.meta.url), 'utf8'));
  assert.ok(system.documentTypes.Item.effectContainer);
  assert.equal(lang.TYPES.Item.effectContainer, 'Effect Container');
  for (const key of ['Hint', 'Done', 'Empty', 'NoEffects', 'NotOnActors']) {
    assert.ok(lang.CARL_RPG.EffectContainer[key], key);
  }
  assert.ok(lang.CARL_RPG.Drop.effect);
});
