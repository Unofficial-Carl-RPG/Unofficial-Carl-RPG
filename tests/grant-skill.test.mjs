import { world, makeActor, makeItem } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runEvents } from '../module/helpers/events.mjs';

// Grant a skill or spell action, and the "has the skill or spell" condition
// (a Spell Book teaching a spell, skipped when it is already known).

beforeEach(() => {
  world.reset();
  game.items = {
    fromCompendium: (doc) => ({ name: doc.name, type: doc.type, system: structuredClone(doc.system) }),
  };
  game.users.push({ id: 'gm1', isGM: true }, { id: 'p1', isGM: false }, { id: 'p2', isGM: false });
});

const template = (type, name, system = {}) => {
  const doc = makeItem({ type, name, system: { rank: 1, identifier: '', ...system } });
  world.docs[doc.uuid] = doc;
  return doc;
};

/** An actor's own skill or spell, the kind the action finds. */
const owned = (type, name, rank, system = {}) =>
  makeItem({ type, name, system: { rank, identifier: '', ...system } });

const event = (conditions, actions) => ({
  id: 'e1',
  enabled: true,
  trigger: 'used',
  phase: 'any',
  match: 'all',
  conditions,
  actions,
});

const grant = (doc, amount) => ({ type: 'grantSkill', uuid: doc.uuid, ...(amount ? { amount } : {}) });
const marker = { type: 'aiFavor', mode: 'award', amount: '1' };

/** A Spell Book (a plain item) on a crawler; `items` are what the crawler already has. */
function bookOn(events, items = [], owners = ['p1']) {
  const book = makeItem({ type: 'item', name: 'Spell Book', system: { events, requirements: [] } });
  const actor = makeActor({ items: [book, ...items], owners, system: { aiFavor: 0 } });
  // The stub can only create effects; items a rule adds are kept as items here.
  actor.createEmbeddedDocuments = async (kind, docs) =>
    docs.map((d) => {
      const item = makeItem({ type: d.type, name: d.name, system: d.system });
      item.parent = actor;
      item.actor = actor;
      actor.items.push(item);
      return item;
    });
  return { book, actor };
}

const find = (actor, type, name) => actor.items.find((i) => i.type === type && i.name === name);

test('a Spell Book gives a spell at rank 1 by default', async () => {
  const fireball = template('spell', 'Fireball', { identifier: 'fireball' });
  const { book, actor } = bookOn([event([], [grant(fireball)])]);
  await runEvents(book, 'used', {});
  assert.equal(find(actor, 'spell', 'Fireball').system.rank, 1);
});

test('the amount is the rank the spell is given', async () => {
  const fireball = template('spell', 'Fireball');
  const { book, actor } = bookOn([event([], [grant(fireball, '3')])]);
  await runEvents(book, 'used', {});
  assert.equal(find(actor, 'spell', 'Fireball').system.rank, 3);
});

test('a spell the crawler has is raised and flagged as raised', async () => {
  const fireball = template('spell', 'Fireball', { identifier: 'fireball' });
  const has = owned('spell', 'Fireball', 2, { identifier: 'fireball' });
  const { book, actor } = bookOn([event([], [grant(fireball)])], [has]);
  await runEvents(book, 'used', {});
  assert.equal(has.system.rank, 3);
  assert.equal(has.flags['carl-rpg'].raised, true);
  assert.equal(actor.items.filter((i) => i.type === 'spell').length, 1);
});

test('a spell stops at the rank cap and a spell at the cap stays quiet', async () => {
  const fireball = template('spell', 'Fireball');
  const near = owned('spell', 'Fireball', 14);
  const { book } = bookOn([event([], [grant(fireball, '5')])], [near]);
  await runEvents(book, 'used', {});
  assert.equal(near.system.rank, 15);
  assert.equal(world.chat.length, 1);
  await runEvents(book, 'used', {});
  assert.equal(near.system.rank, 15);
  assert.equal(world.chat.length, 1);
});

test('a new spell is also held to the cap', async () => {
  const fireball = template('spell', 'Fireball');
  const { book, actor } = bookOn([event([], [grant(fireball, '40')])]);
  await runEvents(book, 'used', {});
  assert.equal(find(actor, 'spell', 'Fireball').system.rank, 15);
});

test('the owner and the GM get the whisper, nobody else', async () => {
  const fireball = template('spell', 'Fireball');
  const { book } = bookOn([event([], [grant(fireball)])]);
  await runEvents(book, 'used', {});
  assert.equal(world.chat.length, 1);
  assert.deepEqual([...world.chat[0].whisper].sort(), ['gm1', 'p1']);
  assert.match(world.chat[0].content, /grantSkillNotice/);
  assert.match(world.chat[0].content, /Fireball/);
});

test('a skill is granted exactly as before', async () => {
  const sneak = template('skill', 'Sneaking', { identifier: 'sneaking' });
  const { book, actor } = bookOn([event([], [grant(sneak, '2')])]);
  await runEvents(book, 'used', {});
  assert.equal(find(actor, 'skill', 'Sneaking').system.rank, 2);
  await runEvents(book, 'used', {});
  assert.equal(find(actor, 'skill', 'Sneaking').system.rank, 4);
  assert.equal(find(actor, 'skill', 'Sneaking').flags['carl-rpg'].raised, true);
});

test('a skill and a spell with the same name are kept apart', async () => {
  const spell = template('spell', 'Frost', { identifier: 'frost' });
  const skill = owned('skill', 'Frost', 4, { identifier: 'frost' });
  const { book, actor } = bookOn([event([], [grant(spell)])], [skill]);
  await runEvents(book, 'used', {});
  assert.equal(skill.system.rank, 4);
  assert.equal(find(actor, 'spell', 'Frost').system.rank, 1);
});

test('anything that is not a skill or spell is refused with a warning', async () => {
  const gear = template('gear', 'Sword');
  const { book, actor } = bookOn([event([], [grant(gear)])]);
  await runEvents(book, 'used', {});
  assert.equal(actor.items.length, 1);
  assert.equal(world.warnings.length, 1);
  assert.equal(world.chat.length, 0);
});

test('Has the skill or spell: true only once the crawler knows it', async () => {
  const fireball = template('spell', 'Fireball', { identifier: 'fireball' });
  const cond = { type: 'hasSkill', uuid: fireball.uuid, negate: false };
  const without = bookOn([event([cond], [marker])]);
  await runEvents(without.book, 'used', {});
  assert.equal(without.actor.system.aiFavor, 0);
  const withIt = bookOn([event([cond], [marker])], [owned('spell', 'Fireball', 1, { identifier: 'fireball' })]);
  await runEvents(withIt.book, 'used', {});
  assert.equal(withIt.actor.system.aiFavor, 1);
});

test('Has the skill or spell matches by identifier before name, and by name without one', async () => {
  const byId = template('spell', 'Fireball', { identifier: 'fireball' });
  const renamed = bookOn([event([{ type: 'hasSkill', uuid: byId.uuid }], [marker])], [
    owned('spell', 'Ball of Fire', 1, { identifier: 'fireball' }),
  ]);
  await runEvents(renamed.book, 'used', {});
  assert.equal(renamed.actor.system.aiFavor, 1);
  const sameNameOtherId = bookOn([event([{ type: 'hasSkill', uuid: byId.uuid }], [marker])], [
    owned('spell', 'Fireball', 1, { identifier: 'other' }),
  ]);
  await runEvents(sameNameOtherId.book, 'used', {});
  assert.equal(sameNameOtherId.actor.system.aiFavor, 0);
  const byName = template('spell', 'Zap');
  const named = bookOn([event([{ type: 'hasSkill', uuid: byName.uuid }], [marker])], [owned('spell', 'Zap', 1)]);
  await runEvents(named.book, 'used', {});
  assert.equal(named.actor.system.aiFavor, 1);
});

test('Has the skill or spell: a skill does not count for a spell of the same name', async () => {
  const spell = template('spell', 'Frost');
  const { book, actor } = bookOn([event([{ type: 'hasSkill', uuid: spell.uuid }], [marker])], [owned('skill', 'Frost', 5)]);
  await runEvents(book, 'used', {});
  assert.equal(actor.system.aiFavor, 0);
});

test('Has the skill or spell: no item, a missing item or another item type is false', async () => {
  const gear = template('gear', 'Sword');
  const { book, actor } = bookOn(
    [
      event([{ type: 'hasSkill', uuid: '' }], [marker]),
      { ...event([{ type: 'hasSkill', uuid: 'Item.Gone' }], [marker]), id: 'e2' },
      { ...event([{ type: 'hasSkill', uuid: gear.uuid }], [marker]), id: 'e3' },
    ],
    [owned('gear', 'Sword', 0)]
  );
  await runEvents(book, 'used', {});
  assert.equal(actor.system.aiFavor, 0);
});

test('a Spell Book skips a spell already known: Not has + grant, and the book is not used up', async () => {
  const fireball = template('spell', 'Fireball', { identifier: 'fireball' });
  const learn = event(
    [{ type: 'hasSkill', uuid: fireball.uuid, negate: true }],
    [grant(fireball), marker]
  );
  const known = owned('spell', 'Fireball', 1, { identifier: 'fireball' });
  const knows = bookOn([learn], [known]);
  await runEvents(knows.book, 'used', {});
  assert.equal(known.system.rank, 1);
  assert.equal(knows.actor.system.aiFavor, 0);
  assert.ok(knows.actor.items.includes(knows.book));
  const learner = bookOn([learn]);
  await runEvents(learner.book, 'used', {});
  assert.equal(find(learner.actor, 'spell', 'Fireball').system.rank, 1);
  assert.equal(learner.actor.system.aiFavor, 1);
});
