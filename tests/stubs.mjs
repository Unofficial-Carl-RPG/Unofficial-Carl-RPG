/**
 * Stand-ins for Foundry's globals, so the rule code in module/ can run under plain
 * Node. Import this file FIRST in every test file. The stand-ins only cover what the
 * rules touch: settings, chat, documents (fake actors, items and effects) and a few
 * utilities. Anything else under `foundry.*` is an inert placeholder.
 */
import { CARL_RPG } from '../module/helpers/config.mjs';
import { evalAmount } from '../module/helpers/amounts.mjs';

const NS = 'carl-rpg';

/* -------------------------------------------- */
/*  Inert placeholder (for foundry.* classes)   */
/* -------------------------------------------- */

const dummy = () =>
  new Proxy(function () {}, {
    get(target, key) {
      if (key === 'prototype') return target.prototype;
      if (key === Symbol.toPrimitive) return () => '';
      if (typeof key === 'symbol' || key === 'then') return undefined;
      return dummy();
    },
    apply: () => dummy(),
    construct: (target, args, newTarget) => Object.create(newTarget.prototype),
  });

/* -------------------------------------------- */
/*  Utilities                                   */
/* -------------------------------------------- */

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function getProperty(object, path) {
  return String(path)
    .split('.')
    .reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), object);
}

function setProperty(object, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  let at = object;
  for (const key of keys) {
    if (!isObject(at[key]) && !Array.isArray(at[key])) at[key] = {};
    at = at[key];
  }
  at[last] = value;
  return true;
}

function mergeObject(original, other = {}) {
  for (const [key, value] of Object.entries(other ?? {})) {
    if (isObject(value) && isObject(original[key])) mergeObject(original[key], value);
    else original[key] = value;
  }
  return original;
}

const utils = {
  deepClone: (v) => structuredClone(v),
  escapeHTML: (v) =>
    String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
  getProperty,
  setProperty,
  hasProperty: (o, p) => getProperty(o, p) !== undefined,
  isEmpty: (v) => v === undefined || v === null || (typeof v === 'object' && !Object.keys(v).length),
  mergeObject,
  randomID: () => Math.random().toString(36).slice(2, 10),
};

/* -------------------------------------------- */
/*  The world: settings, chat, warnings         */
/* -------------------------------------------- */

const gm = { id: 'gm', name: 'GM', isGM: true, active: true };

class Collection extends Array {
  // (Foundry's filter and map give plain arrays.)
  static get [Symbol.species]() {
    return Array;
  }
  get(id) {
    return this.find((d) => d.id === id);
  }
}

export const world = {
  settings: {},
  chat: [],
  warnings: [],
  docs: {},
  reset() {
    this.settings = { floor: 1 };
    this.chat.length = 0;
    this.warnings.length = 0;
    this.docs = {};
    game.actors.length = 0;
    game.users.length = 0;
    game.users.activeGM = null;
    game.combat = null;
    game.combats.length = 0;
    game.user = gm;
  },
};

/* -------------------------------------------- */
/*  Globals                                     */
/* -------------------------------------------- */

// (The document hooks the system's classes call on their parent do nothing here.)
class Actor {
  async _preUpdate() {}
  _onUpdate() {}
}
class Item {
  async _preUpdate() {}
  _onUpdate() {}
}
class ActiveEffect {}
class ChatMessage {
  static getWhisperRecipients() {
    return [{ id: 'gm1' }];
  }
  static async create(data) {
    world.chat.push(data);
    return data;
  }
  static getSpeaker() {
    return {};
  }
}

class Roll {
  constructor(formula) {
    this.formula = String(formula);
  }
  static validate(formula) {
    return /^[\d\s+\-*/().d@a-z]+$/i.test(String(formula));
  }
  async evaluate() {
    this.total = evalAmount(this.formula) ?? Number(this.formula);
    return this;
  }
}

// The change log holds its notes for a few seconds; don't let that keep Node waiting.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  const timer = realSetTimeout(fn, ms, ...args);
  timer.unref?.();
  return timer;
};

globalThis.foundry = new Proxy({ utils }, { get: (t, k) => (k in t ? t[k] : dummy()) });
globalThis.CONFIG = {
  CARL_RPG: Object.assign(CARL_RPG, {
    getFloor: () => world.settings.floor ?? 1,
  }),
  statusEffects: [],
};
globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { ADD: 2 },
  TOKEN_DISPLAY_MODES: { ALWAYS: 50 },
  TOKEN_DISPOSITIONS: { FRIENDLY: 1 },
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 },
};
globalThis.game = {
  i18n: {
    localize: (key) => key,
    format: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
  },
  settings: {
    get: (ns, key) => world.settings[key],
    set: async (ns, key, value) => {
      world.settings[key] = value;
    },
    register() {},
  },
  user: gm,
  users: Object.assign([], { activeGM: null }),
  actors: new Collection(),
  combat: null,
  combats: [],
  socket: { emit() {}, on() {} },
};
globalThis.ui = {
  notifications: {
    warn: (m) => world.warnings.push(m),
    info() {},
    error: (m) => world.warnings.push(m),
  },
};
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.Handlebars = { escapeExpression: (v) => utils.escapeHTML(v) };
globalThis.fromUuid = async (uuid) => world.docs[uuid] ?? null;
Object.assign(globalThis, { Actor, Item, ActiveEffect, ChatMessage, Roll });

/* -------------------------------------------- */
/*  Fake documents                              */
/* -------------------------------------------- */

/** An active effect. `flags` are the carl-rpg flags. */
export function makeEffect({ name = 'Effect', flags = {}, disabled = false, id } = {}) {
  const effect = new ActiveEffect();
  Object.assign(effect, {
    id: id ?? utils.randomID(),
    documentName: 'ActiveEffect',
    name,
    disabled,
    flags: { [NS]: { ...flags } },
    parent: null,
    getFlag: (scope, key) => effect.flags[scope]?.[key],
    async setFlag(scope, key, value) {
      (effect.flags[scope] ??= {})[key] = value;
    },
    async unsetFlag(scope, key) {
      delete effect.flags[scope]?.[key];
    },
    async setActive(active) {
      effect.disabled = !active;
    },
    async removeAllStacks() {
      effect.disabled = true;
    },
    stackable: false,
    async delete() {
      const list = effect.parent?.effects;
      const at = list?.indexOf(effect) ?? -1;
      if (at >= 0) list.splice(at, 1);
    },
  });
  Object.defineProperty(effect, 'active', { get: () => !effect.disabled });
  Object.defineProperty(effect, 'actor', { get: () => effect.parent });
  return effect;
}

/** An item. `system` is the item's system data. */
export function makeItem({ type = 'skill', name = 'Item', system = {}, id } = {}) {
  const item = new Item();
  Object.assign(item, {
    id: id ?? utils.randomID(),
    documentName: 'Item',
    type,
    name,
    system,
    parent: null,
    isOwner: true,
    uuid: `Item.${name}`,
    getFlag: () => undefined,
    async update(data) {
      for (const [k, v] of Object.entries(data)) setProperty(item, k, v);
    },
  });
  return item;
}

/**
 * An actor. `system` holds whatever the code under test reads. `owners` is a list
 * of user ids that own the actor.
 */
export function makeActor({
  type = 'crawler',
  name = 'Actor',
  system = {},
  items = [],
  effects = [],
  owners = [],
  id,
} = {}) {
  const actor = new Actor();
  Object.assign(actor, {
    id: id ?? utils.randomID(),
    documentName: 'Actor',
    type,
    name,
    system,
    isOwner: true,
    statuses: new Set(),
    updates: [],
    uuid: `Actor.${name}`,
    items: [],
    effects: [],
    testUserPermission: (user) => user.isGM || owners.includes(user.id),
    async update(data) {
      actor.updates.push(data);
      for (const [k, v] of Object.entries(data)) setProperty(actor, k, v);
    },
    async createEmbeddedDocuments(kind, docs) {
      if (kind !== 'ActiveEffect') throw new Error(`stub: cannot create ${kind}`);
      return docs.map((d) => {
        const e = makeEffect({ name: d.name, flags: d.flags?.[NS] ?? {}, disabled: !!d.disabled });
        e.changes = d.changes;
        e.parent = actor;
        actor.effects.push(e);
        return e;
      });
    },
    async deleteEmbeddedDocuments(kind, ids) {
      if (kind !== 'ActiveEffect') throw new Error(`stub: cannot delete ${kind}`);
      actor.effects = actor.effects.filter((e) => !ids.includes(e.id));
    },
    async updateEmbeddedDocuments(kind, updates) {
      for (const u of updates) {
        const doc = (kind === 'Item' ? actor.items : actor.effects).find((d) => d.id === u._id);
        for (const [k, v] of Object.entries(u)) if (k !== '_id') setProperty(doc, k, v);
      }
    },
    async toggleStatusEffect(status, { active }) {
      if (active) actor.statuses.add(status);
      else actor.statuses.delete(status);
    },
  });
  for (const item of items) {
    item.parent = actor;
    item.actor = actor;
    actor.items.push(item);
  }
  for (const effect of effects) {
    effect.parent = actor;
    actor.effects.push(effect);
  }
  return actor;
}

/** A crawler with the real derived data worked out (health boxes, mana, Evade, DR...). */
export async function makeCrawler({ abilities = {}, bonuses = {}, system: extra = {}, ...rest } = {}) {
  const { default: Crawler } = await import('../module/data/actor-crawler.mjs');
  const stats = { str: 1, int: 1, con: 1, dex: 1, cha: 1, ...abilities };
  const system = {
    abilities: Object.fromEntries(Object.entries(stats).map(([k, value]) => [k, { value }])),
    bonuses: {
      dr: 0,
      evade: 0,
      move: 0,
      actions: 0,
      mana: 0,
      hotlist: 0,
      ...Object.fromEntries(Object.keys(stats).map((k) => [k, 0])),
      ...bonuses,
    },
    attributes: { level: { value: 1 } },
    statPointsSpent: 0,
    move: { base: 20, step: 10 },
    actions: { base: 2 },
    hotlist: { size: 10 },
    mana: { value: 0 },
    health: { value: 10 },
    size: 'medium',
    gold: 0,
    ...extra,
  };
  const actor = makeActor({ ...rest, type: 'crawler', system });
  system.parent = actor;
  Crawler.prototype.prepareDerivedData.call(system);
  return actor;
}

/** A running combat, for the conditions that look at it. */
export function setCombat({ started = true, phase = 'action', combatants = [] } = {}) {
  game.combat = {
    started,
    currentPhase: { id: phase },
    combatants: Object.assign([], combatants),
  };
  return game.combat;
}

world.reset();
