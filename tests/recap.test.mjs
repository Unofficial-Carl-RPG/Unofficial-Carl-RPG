import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Self-contained stand-ins: the recap only needs a journal page that keeps a flag,
// settings, the hooks it registers and chat.
const strings = JSON.parse(fs.readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')).CARL_RPG;
const lookup = (key) => key.replace(/^CARL_RPG\./, '').split('.').reduce((o, p) => o?.[p], strings);

let flags;
let page;
let hooks;
let chat;
let notes;

function reset() {
  flags = {};
  hooks = {};
  chat = [];
  notes = [];
  page = {
    name: 'Floor 3',
    text: { content: '' },
    getFlag: (ns, key) => flags[key],
    async update(data) {
      this.text.content = data['text.content'];
      flags.recap = data['flags.carl-rpg.recap'];
    },
  };
}

globalThis.foundry = {
  utils: {
    escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    deepClone: (o) => JSON.parse(JSON.stringify(o)),
  },
  data: { fields: { StringField: class {} } },
};
globalThis.game = {
  user: { id: 'gm', isGM: true },
  users: { activeGM: { id: 'gm' } },
  settings: {
    register() {},
    get: (ns, key) => (key === 'recapLogId' ? 'j1' : 3),
  },
  journal: {
    get: () => ({
      pages: { find: (f) => (f(page) ? page : undefined) },
      createEmbeddedDocuments: async () => [page],
    }),
  },
  i18n: {
    localize: (k) => lookup(k) ?? k,
    format: (k, d) => (lookup(k) ?? k).replace(/\{(\w+)\}/g, (_, n) => d[n]),
  },
  messages: { contents: [] },
};
globalThis.Hooks = { on: (name, fn) => (hooks[name] = fn), once() {} };
globalThis.ui = { notifications: { info: (m) => notes.push(m) } };
globalThis.ChatMessage = { create: async (d) => chat.push(d.content) };

const { registerRecap, recordRecap, postRecap } = await import('../module/helpers/recap.mjs');

const crawler = (id, name) => ({ id, name, type: 'crawler', system: { bossKills: 0, crawlerKills: 0 } });

beforeEach(() => {
  reset();
  registerRecap();
});

test('a rise in boss stars and crawler kills is counted for that crawler', async () => {
  const ann = crawler('a', 'Ann');
  const options = {};
  hooks.preUpdateActor(ann, { system: { bossKills: 1, crawlerKills: 3 } }, options);
  hooks.updateActor(ann, { system: { bossKills: 1, crawlerKills: 3 } }, options);
  await recordRecap({ kind: 'elite', line: 'x' });
  assert.deepEqual(flags.recap.crawlers.a, { name: 'Ann', stars: 1, kills: 3, achievements: 0, boxes: 0 });
  assert.equal(flags.recap.elites, 1);
});

test('lowering a counter, or changing something else, adds nothing', async () => {
  const bob = crawler('b', 'Bob');
  bob.system.bossKills = 2;
  const options = {};
  hooks.preUpdateActor(bob, { system: { bossKills: 1 } }, options);
  hooks.updateActor(bob, { system: { bossKills: 1 } }, options);
  const other = {};
  hooks.preUpdateActor(bob, { name: 'Rob' }, other);
  assert.equal(other.carlRecap, undefined);
  await recordRecap({ kind: 'elite', line: 'x' });
  assert.deepEqual(flags.recap.crawlers, {});
});

test('the card has a row per crawler and the party totals', async () => {
  await recordRecap({ kind: 'star', actor: crawler('a', 'Ann'), line: 's' });
  await recordRecap({ kind: 'star', actor: crawler('b', 'Bob'), line: 's' });
  await recordRecap({ kind: 'loot', actor: crawler('a', 'Ann'), line: 'l' });
  await recordRecap({ kind: 'elite', line: 'e' });
  await recordRecap({ kind: 'elite', line: 'e' });
  await postRecap();
  const card = chat[0];
  assert.match(card, /Floor 3 recap/);
  assert.match(card, /<th scope="row">Ann<\/th><td>1<\/td><td>0<\/td><td>0<\/td><td>1<\/td>/);
  assert.match(card, /<th scope="row">Party<\/th><td>2<\/td><td>0<\/td><td>0<\/td><td>1<\/td>/);
  assert.match(card, /Elites defeated: 2/);
  assert.match(page.text.content, /<strong>Ann<\/strong>: l/);
});

test('with nothing counted yet the GM is told instead of a card being posted', async () => {
  await postRecap();
  assert.equal(chat.length, 0);
  assert.match(notes[0], /Nothing to recap on floor 3/);
});
