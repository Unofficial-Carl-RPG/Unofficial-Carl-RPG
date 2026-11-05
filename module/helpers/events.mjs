/**
 * The event system.
 *
 * Items, effects (and, for a pet, its upgrades) hold EVENTS. An event has a
 * trigger, optional conditions and an ordered list of actions. Items also hold
 * REQUIREMENTS (things that must be true for the item to be used at all).
 * Everything is picked from menus, see CONFIG.CARL_RPG.eventTriggers /
 * eventConditions / eventActions.
 *
 * Triggers: used, hit, miss, advanced, added, removed, equipped, unequipped (run for
 * whoever caused them), opened (loot boxes, after a successful opening), and the
 * triggers that belong to the actor (CONFIG.CARL_RPG.eventTriggersActor: phase
 * start/end, the round ending, an action being spent, taking damage, a rest, a
 * combat starting or ending, the floor changing, levelling up). An effect's own
 * events run while it is on, and it also has "the effect is turned on / ends".
 * The phase, round, combat, floor and similar triggers run on the owning player's
 * client, or the GM's for actors with no player owner connected.
 *
 * "Apply effect to the target that was hit" is never carried out automatically: it
 * adds an Apply button for that target to the attack card, and the GM clicks it
 * (see queueEffect and applyQueuedEffect).
 *
 * Conditions all have to be true (or, if the event says so, any of them), and each
 * can be turned into "NOT". Actions can affect the owner, a chosen actor or a group
 * (allies, enemies, the targeted tokens, the owner's pets, a pet's owner), and can
 * ask the player first.
 *
 * Safety: an action runs with the permissions of whoever triggered it. Actions
 * that would need more (changing an actor the user doesn't own, or a macro set
 * to run on the GM's client) are only carried out when the events were last saved
 * by a GM (they are "approved": `system.eventsTrusted`, or the same flag on an
 * effect), by sending the GM's client a request that names the stored action. The
 * GM's client re-checks everything against the stored data before doing anything.
 */
import { CarlRPGActiveEffect } from '../documents/active-effect.mjs';
import { CarlRPGDialog } from './dialog.mjs';
import { classHasTag } from './tags.mjs';
import { allEvents, effectKey, lockedRankFor } from './upgrades.mjs';
import { summarizeAction } from './event-summary.mjs';
import { endCombatEffects, tickDurations } from './effect-duration.mjs';
import { restoreUses, tickCooldowns } from './uses.mjs';
import { skillCapOf } from './skill-cap.mjs';
import { getFloorRules } from './floor.mjs';
import { logEvent } from './change-log.mjs';
import { revive } from './dying.mjs';
import { findAnchor, canPlaceDirectly, placeTokens } from './summon.mjs';

const NS = 'carl-rpg';

/*  Small helpers                               */

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const warn = (key, data) => ui.notifications.warn(t(key, data));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

/** Roll an amount (a number or dice formula) to a whole number, 0 or more. */
async function rollAmount(formula, rollData = {}) {
  const text = String(formula ?? '').trim();
  if (!text) return 0;
  const roll = await new Roll(text, rollData).evaluate();
  return Math.max(0, Math.floor(roll.total));
}

/** A stat as it counts for requirements and conditions (including effects). */
function statValue(actor, key) {
  const stat = actor?.system?.abilities?.[key];
  if (!stat) return 0;
  return stat.enhanced ?? stat.value + (actor.system.bonuses?.[key] ?? 0);
}

/** The first d20 result of a roll, for natural 20 / natural 1 conditions. */
function firstDie(roll) {
  return roll?.dice?.[0]?.results?.[0]?.result;
}

/**
 * The actor whose events these are: an item's owner, an effect's actor, or the
 * actor itself (a pet's upgrades carry events that belong to the pet).
 */
const ownerOf = (doc) =>
  doc instanceof Actor ? doc : doc.parent instanceof Actor ? doc.parent : null;

/** Whether the events on an item, effect or pet were last saved by a GM. */
export function isTrusted(doc) {
  if (doc.documentName === 'ActiveEffect') return !!doc.getFlag(NS, 'eventsTrusted');
  return !!doc.system?.eventsTrusted;
}

/** Find the actor's own copy of an item a UUID points to (by identifier, else name). */
async function findOwnedItem(actor, uuid) {
  const template = await fromUuid(uuid);
  if (!template || template.documentName !== 'Item') return null;
  if (template.parent === actor) return template;
  const identifier = template.system?.identifier?.trim();
  return (
    actor.items.find((i) =>
      identifier
        ? i.system.identifier?.trim() === identifier
        : i.type === template.type && i.name === template.name
    ) ?? null
  );
}

/** The combatant an actor is in the running combat as, if it is. */
function combatantOf(actor) {
  if (!actor) return null;
  return game.combat?.started
    ? (game.combat.combatants.find((c) => c.actor === actor) ?? null)
    : null;
}

/** The size class of an actor, 1 (Tiny) to 8 (Gargantuan). */
function sizeClass(actor) {
  const size = actor?.system?.effectiveSize ?? actor?.system?.size;
  return Object.keys(CONFIG.CARL_RPG.sizes).indexOf(size) + 1;
}

/** Whether a target is a kind of thing ("crawler", "pet", "mob", "elite"...). */
function isKind(actor, kind) {
  if (!actor) return false;
  switch (kind) {
    case 'crawler':
    case 'pet':
    case 'mob':
      return actor.type === kind;
    default:
      return actor.type === 'mob' && actor.system.mobType === kind;
  }
}

/** The actors in a group, from the point of view of the one whose event it is. */
function groupActors(group, owner, ctx) {
  // Floor rules have no owner: they only reach the crawlers.
  if (group === 'crawlers') return game.actors.filter((a) => a.type === 'crawler');
  if (!owner) return [];
  const side = (a) => (a.type === 'mob' ? 'mob' : 'crawler');
  const inPlay = () => {
    const combat = game.combat;
    if (combat?.started) {
      return combat.combatants.map((c) => c.actor).filter(Boolean);
    }
    return (canvas?.tokens?.placeables ?? []).map((tk) => tk.actor).filter(Boolean);
  };
  switch (group) {
    case 'allies':
      return inPlay().filter((a) => side(a) === side(owner));
    case 'enemies':
      return inPlay().filter((a) => side(a) !== side(owner));
    case 'targeted':
      // (The targets of the user who triggered this; they travel with a relayed request.)
      return ctx.targeted ?? [...game.user.targets].map((tk) => tk.actor).filter(Boolean);
    case 'pets':
      return owner.type === 'crawler'
        ? game.actors.filter((a) => a.type === 'pet' && a.system.owner === owner.id)
        : [];
    case 'master': {
      const master = owner.type === 'pet' ? game.actors.get(owner.system.owner) : null;
      return master ? [master] : [];
    }
    default:
      return [];
  }
}

/**
 * Who an action affects: the owner, a chosen actor, a group, or (for "apply
 * effect") the target that was hit. Always a list without repeats.
 */
async function resolveTargets(action, owner, ctx = {}) {
  let actors;
  // A floor rule with no target affects every crawler.
  if (ctx.world && !action.targetGroup && !action.targetActor && !['applyEffect', 'macro', 'addToken'].includes(action.type)) {
    actors = groupActors('crawlers', owner, ctx);
  } else if (action.type === 'applyEffect') actors = [ctx.target].filter(Boolean);
  else if (action.type === 'macro' || action.type === 'addToken') actors = [owner];
  else if (action.targetGroup) actors = groupActors(action.targetGroup, owner, ctx);
  else if (action.targetActor) {
    const doc = await fromUuid(action.targetActor);
    actors = [doc?.documentName === 'Actor' ? doc : (doc?.actor ?? null)].filter(Boolean);
  } else actors = [owner];
  return [...new Set(actors)].filter(Boolean);
}

/*  Requirements (block using an item)          */

/**
 * Check an item's requirements. Warns about each one that isn't met.
 * @param {Item} item
 * @returns {boolean} Whether the item can be used
 */
export function checkRequirements(item) {
  const actor = item.parent instanceof Actor ? item.parent : null;
  if (!actor) return true;

  const problems = [];
  for (const req of item.system.requirements ?? []) {
    switch (req.type) {
      case 'mana': {
        const have = actor.system.mana?.value ?? 0;
        if (have < req.value) {
          problems.push(t('CARL_RPG.Events.Needs.mana', { value: req.value, have }));
        }
        break;
      }
      case 'stat': {
        const have = statValue(actor, req.stat);
        if (have < req.value) {
          problems.push(
            t('CARL_RPG.Events.Needs.stat', {
              stat: t(CONFIG.CARL_RPG.abilities[req.stat] ?? req.stat),
              value: req.value,
              have,
            })
          );
        }
        break;
      }
      case 'gold': {
        const have = actor.system.gold ?? 0;
        if (have < req.value) {
          problems.push(t('CARL_RPG.Events.Needs.gold', { value: req.value, have }));
        }
        break;
      }
      case 'classTag': {
        if (!classHasTag(actor, req.tag)) {
          problems.push(t('CARL_RPG.Events.Needs.classTag', { tag: req.tag }));
        }
        break;
      }
      case 'actions': {
        // Only matters in combat; outside it there are no actions to count.
        const combatant = combatantOf(actor);
        if (combatant && combatant.actionsLeft < req.value) {
          problems.push(
            t('CARL_RPG.Events.Needs.actions', {
              value: req.value,
              have: combatant.actionsLeft,
            })
          );
        }
        break;
      }
    }
  }

  if (problems.length) {
    ui.notifications.warn(
      t('CARL_RPG.Events.CantUse', {
        name: Handlebars.escapeExpression(item.name),
        reasons: problems.join(' '),
      })
    );
    return false;
  }
  return true;
}

/*  Conditions                                  */

const REST_ORDER = ['short', 'long', 'full'];

async function checkCondition(condition, ctx) {
  const { actor, roll, loot } = ctx;
  switch (condition.type) {
    case 'stat':
      return statValue(actor, condition.stat) >= condition.value;
    case 'mana':
      return (actor?.system?.mana?.value ?? 0) >= condition.value;
    case 'phase': {
      const combat = game.combat;
      if (!combat?.started) return false;
      return (
        condition.phase === 'any' || combat.currentPhase?.id === condition.phase
      );
    }
    case 'rollMin':
      return roll ? roll.total >= condition.value : false;
    case 'rollMax':
      return roll ? roll.total <= condition.value : false;
    case 'nat20':
      return firstDie(roll) === 20;
    case 'nat1':
      return firstDie(roll) === 1;
    case 'degree':
      // The attack's degree of success. For "an attack hits a target" it is that
      // target's; for "the item is used" it is true if any target got it.
      return ctx.degree
        ? ctx.degree === condition.degree
        : (ctx.degrees ?? []).includes(condition.degree);
    case 'lootItem': {
      // Did the opening include this item? (matched by identifier, else name)
      if (!loot || !condition.uuid) return false;
      const wanted = await fromUuid(condition.uuid);
      if (!wanted) return false;
      const identifier = wanted.system?.identifier?.trim();
      return loot.items.some((i) =>
        identifier ? i.identifier === identifier : i.name === wanted.name
      );
    }
    case 'lootGold':
      return loot ? loot.gold >= condition.value : false;
    case 'classTag':
      return actor ? classHasTag(actor, condition.tag) : false;
    case 'effect': {
      // Does the actor have this effect switched on? (matched like effects always are)
      const template = condition.uuid ? await fromUuid(condition.uuid) : null;
      if (!template || !actor) return false;
      return actor.effects.some(
        (e) => !e.disabled && CarlRPGActiveEffect.matches(e, template)
      );
    }
    case 'inCombat':
      return !!combatantOf(actor);
    case 'floor':
      return CONFIG.CARL_RPG.getFloor() >= condition.value;
    case 'floorExact':
      return CONFIG.CARL_RPG.getFloor() === condition.value;
    case 'health':
      return (actor?.system?.health?.value ?? Infinity) <= condition.value;
    case 'chance':
      return Math.random() * 100 < condition.value;
    case 'targetSize':
      return ctx.target ? sizeClass(ctx.target) >= condition.value : false;
    case 'targetKind':
      return isKind(ctx.target, condition.text);
    case 'restKind':
      // "At least": a long rest counts as a short one too.
      return ctx.rest
        ? REST_ORDER.indexOf(ctx.rest) >= REST_ORDER.indexOf(condition.text)
        : false;
    default:
      return false;
  }
}

/** Whether an event's conditions are met (all of them, or any if it says so). */
async function conditionsMet(event, ctx) {
  if (!event.conditions.length) return true;
  const results = [];
  for (const condition of event.conditions) {
    const result = await checkCondition(condition, ctx);
    results.push(condition.negate ? !result : result);
  }
  return event.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/*  Action handlers                             */

const HANDLERS = {
  /** Use another item the owner has, as if they had used it. */
  async useItem({ action, actor, ctx }) {
    const owned = await findOwnedItem(actor, action.uuid);
    if (!owned) return warn('CARL_RPG.Events.Warn.ItemMissing');
    await owned.roll(null, { depth: ctx.depth + 1 });
  },

  /** Run a macro (as this user, or on the GM's client: see performAction). */
  async macro({ item, action, actor, ctx }) {
    const macro = await fromUuid(action.uuid);
    if (!macro || macro.documentName !== 'Macro') {
      return warn('CARL_RPG.Events.Warn.MacroMissing');
    }
    if (!macro.canExecute) {
      return warn('CARL_RPG.Events.Warn.MacroPermission', { name: macro.name });
    }
    await macro.execute({ actor, item, trigger: ctx.trigger });
  },

  /** Toggle, turn on/off or remove stacks of an effect on the target. */
  async toggleEffect({ item, action, actor }) {
    const template = await fromUuid(action.uuid);
    if (!template || template.documentName !== 'ActiveEffect') {
      return warn('CARL_RPG.Events.Warn.EffectMissing');
    }
    // An effect an upgrade unlocks can't be used before that rank.
    if (item.system?.upgrades) {
      const lockedUntil = lockedRankFor(item, effectKey(template));
      if (lockedUntil !== null) {
        return warn('CARL_RPG.Upgrades.EffectLocked', {
          name: template.name,
          rank: lockedUntil,
        });
      }
    }
    // Stacking buffs can share a name: use one an upgrade has unlocked.
    const found = actor.effects.filter((e) =>
      CarlRPGActiveEffect.matches(e, template)
    );
    let effect = found.find((e) => e.lockedUntilRank === null) ?? found[0];
    if (!effect) {
      // The actor doesn't have it yet: add it from the source, then apply.
      const data = template.toObject();
      delete data._id;
      data.transfer = false;
      data.disabled = true;
      foundry.utils.setProperty(data, `flags.${NS}.sourceItems`, []);
      foundry.utils.setProperty(data, `flags.${NS}.stacks`, 1);
      [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [data], {
        carlGrant: true,
      });
    }
    switch (action.mode) {
      case 'on':
        return effect.setActive(true);
      case 'off':
        return effect.setActive(false);
      case 'removeStack':
        return effect.changeStacks(-1);
      case 'removeAll':
        return effect.removeAllStacks();
      default:
        return effect.setActive();
    }
  },

  /** Add an item to the target. */
  async addItem({ action, actor }) {
    const doc = await fromUuid(action.uuid);
    if (!doc || doc.documentName !== 'Item') {
      return warn('CARL_RPG.Events.Warn.ItemMissing');
    }
    const quantity = await rollAmount(action.amount || '1');
    if (quantity < 1) return;

    const identifier = doc.system?.identifier?.trim();
    const existing = actor.items.find((i) =>
      identifier
        ? i.system.identifier?.trim() === identifier
        : i.type === doc.type && i.name === doc.name
    );
    const stackable = 'quantity' in (doc.system ?? {});
    if (existing && action.skipIfHas) return;
    if (existing && stackable) {
      await existing.update({
        'system.quantity': existing.system.quantity + quantity,
      });
      return;
    }
    const data = game.items.fromCompendium(doc);
    if (stackable) data.system.quantity = quantity;
    await actor.createEmbeddedDocuments('Item', [data]);
  },

  /**
   * Place tokens of an actor next to the anchor token (see performAddToken). The
   * anchor travels in the context, so a request relayed to the GM brings its own.
   */
  async addToken({ action, ctx }) {
    const source = action.uuid ? await fromUuid(action.uuid) : null;
    if (!source || source.documentName !== 'Actor') return warn('CARL_RPG.Events.Warn.ActorMissing');
    const anchor = ctx.anchorUuid ? await fromUuid(ctx.anchorUuid) : null;
    if (anchor?.documentName !== 'Token' || !anchor.parent) return warn('CARL_RPG.Events.Warn.NoAnchor');
    const count = await rollAmount(action.amount || '1');
    if (count < 1) return;
    await placeTokens({ source, anchor, count, hidden: !!action.hidden, joinCombat: !!action.joinCombat });
  },

  /** Give the target an achievement, once. A new one pays its loot box (see items). */
  async awardAchievement({ action, actor }) {
    const doc = await fromUuid(action.uuid);
    if (!doc || doc.documentName !== 'Item' || doc.type !== 'achievement') {
      return warn('CARL_RPG.Events.Warn.ItemMissing');
    }
    const identifier = doc.system?.identifier?.trim();
    const held = actor.items.some(
      (i) => i.type === 'achievement' && (identifier ? i.system.identifier?.trim() === identifier : i.name === doc.name)
    );
    if (held) return;
    await actor.createEmbeddedDocuments('Item', [game.items.fromCompendium(doc)]);
  },

  /**
 * Give the target a skill at a rank, or raise one it has by a number of ranks.
 * Permanent: nothing takes it back. It stops at the skill rank cap (see
 * skill-cap.mjs). The owner and the GM get a whisper.
 */
  async grantSkill({ action, actor }) {
    const doc = await fromUuid(action.uuid);
    if (!doc || doc.documentName !== 'Item' || doc.type !== 'skill') {
      return warn('CARL_RPG.Events.Warn.ItemMissing');
    }
    const ranks = await rollAmount(action.amount || '1');
    if (ranks < 1) return;
    const cap = skillCapOf(actor, doc);
    const identifier = doc.system?.identifier?.trim();
    const existing = actor.items.find(
      (i) => i.type === 'skill' && (identifier ? i.system.identifier?.trim() === identifier : i.name === doc.name)
    );
    let rank;
    if (existing) {
      rank = Math.min(cap, existing.system.rank + ranks);
      if (rank === existing.system.rank) return;
      await existing.update({ 'system.rank': rank, 'flags.carl-rpg.raised': true });
    } else {
      rank = Math.min(cap, ranks);
      const data = game.items.fromCompendium(doc);
      data.system.rank = rank;
      await actor.createEmbeddedDocuments('Item', [data]);
    }
    const whisper = new Set(
      game.users.filter((u) => u.isGM || actor.testUserPermission(u, 'OWNER')).map((u) => u.id)
    );
    await ChatMessage.create({
      whisper: [...whisper],
      content: game.i18n.format('CARL_RPG.Events.Actions.grantSkillNotice', {
        name: actor.name,
        skill: doc.name,
        rank,
      }),
    });
  },

  /** Remove an item from the target (this item, or another by identifier). */
  async removeItem({ item, action, actor }) {
    const target = action.selfItem
      ? item
      : await findOwnedItem(actor, action.uuid);
    if (!target || target.parent !== actor || target.documentName !== 'Item') {
      return warn('CARL_RPG.Events.Warn.ItemMissing');
    }
    const reduceBy = String(action.amount ?? '').trim();
    // No amount (or nothing to count): remove the whole item.
    if (!reduceBy || !('quantity' in target.system)) {
      await target.delete();
      return;
    }
    const left = target.system.quantity - (await rollAmount(reduceBy));
    if (left <= 0) await target.delete();
    else await target.update({ 'system.quantity': left });
  },

  /** Spend or restore mana. */
  async mana({ action, actor }) {
    // (Crawlers and pets have mana.)
    if (actor.type === 'mob') return;
    const amount = await rollAmount(action.amount);
    const { value, maxTotal } = actor.system.mana;
    if (action.mode === 'restore') {
      await actor.update({
        'system.mana.value': Math.min(maxTotal, value + amount),
      });
      return;
    }
    if (value < amount) {
      return warn('CARL_RPG.Events.Warn.NotEnoughMana', {
        name: actor.name,
        value: amount,
      });
    }
    await actor.update({ 'system.mana.value': value - amount });
  },

  /** Damage (through DR and the CON modifier) or heal health boxes. */
  async health({ action, actor }) {
    const amount = await rollAmount(action.amount);
    if (action.mode === 'heal') {
      const { value, max } = actor.system.health;
      await actor.update({
        'system.health.value': Math.min(max, value + amount),
      });
      return;
    }
    await actor.applyDamage(amount, { ignoreDR: !!action.ignoreDR });
  },

  /** Bring a dead crawler back with 1 health box. */
  async revive({ actor }) {
    await revive(actor);
  },

  /** Say something in chat, as the one it affects. {name} and {item} are filled in. */
  async message({ item, action, actor }) {
    const text = esc(action.text)
      .replaceAll('{name}', esc(actor.name))
      .replaceAll('{item}', esc(item.name))
      .replaceAll('\n', '<br>');
    if (!text.trim()) return;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="carl-event-message">${text}</div>`,
      flags: { 'carl-rpg': { card: { kind: 'event' } } },
    });
  },

  /** Spend or give back actions (in combat). */
  async actions({ action, actor }) {
    const combatant = combatantOf(actor);
    if (!combatant) return;
    const amount = await rollAmount(action.amount);
    const spent = combatant.getFlag(NS, 'actionsSpent') ?? 0;
    const next =
      action.mode === 'restore'
        ? Math.max(0, spent - amount)
        : Math.min(combatant.maxActions, spent + amount);
    await combatant.setFlag(NS, 'actionsSpent', next);
  },

  /** Add or take away gold (a crawler's). */
  async gold({ action, actor }) {
    const amount = await rollAmount(action.amount);
    if (actor.type !== 'crawler' || amount < 1) return;
    if (action.mode === 'remove') await actor.spendGold(amount);
    else await actor.addGold(amount);
  },

  /** Award or spend AI Favor (a crawler's; it never goes below 0). */
  async aiFavor({ action, actor }) {
    if (actor.type !== 'crawler') return;
    const amount = await rollAmount(action.amount);
    const have = Math.trunc(actor.system.aiFavor ?? 0);
    const next = action.mode === 'spend' ? Math.max(0, have - amount) : have + amount;
    if (next !== have) await actor.update({ 'system.aiFavor': next });
  },

  /** Roll on a roll table (the result goes to chat). */
  async rollTable({ action }) {
    const table = await fromUuid(action.uuid);
    if (!table || table.documentName !== 'RollTable') {
      return warn('CARL_RPG.Events.Warn.TableMissing');
    }
    await table.draw();
  },

  /** Carry out another event of the same item (its actions, without its trigger or conditions). */
  async runEvent({ item, event, action, ctx }) {
    const other = allEvents(item).find((e) => e.id === action.mode);
    if (!other || other.id === event.id) {
      return warn('CARL_RPG.Events.Warn.EventMissing');
    }
    if (ctx.depth >= CONFIG.CARL_RPG.maxEventDepth) {
      return warn('CARL_RPG.Events.Warn.TooDeep', { name: item.name });
    }
    await runActions(item, other, { ...ctx, depth: ctx.depth + 1 });
  },
};

// "Apply effect to the target that was hit" works like the buff / debuff
// action; the difference is who it affects (see resolveTargets).
HANDLERS.applyEffect = HANDLERS.toggleEffect;

/*  Running events                              */

/**
 * Run an item's (or effect's, or pet's) events for a trigger.
 * @param {Item|ActiveEffect|Actor} item
 * @param {string} trigger   One of CONFIG.CARL_RPG.eventTriggers
 * @param {object} [ctx]     { roll, phase, depth, target, degree, rest, ... }
 */
export async function runEvents(item, trigger, ctx = {}) {
  const actor = ownerOf(item);
  // The events themselves, including those of the upgrades it has reached.
  const events = allEvents(item);
  if (!actor || !events.length) return;
  await runEventList(item, actor, events, trigger, ctx);
}

/** Run the events in a list (see allEvents) that answer a trigger. */
async function runEventList(item, actor, events, trigger, ctx) {
  const depth = ctx.depth ?? 0;
  const full = { ...ctx, actor, trigger, depth };
  const withPhase = CONFIG.CARL_RPG.eventTriggersWithPhase.includes(trigger);

  for (const event of events) {
    if (!event.enabled || event.trigger !== trigger) continue;
    if (withPhase && event.phase !== 'any' && event.phase !== ctx.phase) continue;
    if (!(await conditionsMet(event, full))) continue;
    if (depth >= CONFIG.CARL_RPG.maxEventDepth) {
      warn('CARL_RPG.Events.Warn.TooDeep', { name: item.name });
      return;
    }
    logEvent(actor, item.name);
    // A caller that wants the summaries (an attack card) collects one line per event.
    if (ctx.collect) {
      const lines = await Promise.all(event.actions.map((a) => summarizeAction(a)));
      ctx.collect.push(`${item.name}: ${lines.join('; ')}`);
    }
    await runActions(item, event, full);
  }
}

/** Carry out every action of an event, one after the other. */
async function runActions(item, event, ctx) {
  for (let i = 0; i < event.actions.length; i++) {
    try {
      await performAction(item, event, i, ctx);
    } catch (err) {
      console.error(`${NS} | event action failed on ${item.name}`, err);
      warn('CARL_RPG.Events.Warn.ActionFailed', { name: item.name });
    }
  }
}

/**
 * Run one event now (GM only): its actions, without its trigger or conditions. For
 * trying an event out from its card.
 * @param {Item|ActiveEffect|Actor} doc
 * @param {string} eventId
 */
export async function runEventNow(doc, eventId) {
  if (!game.user.isGM) return;
  // No document: a floor rule (see the floor rules editor).
  if (doc === null) return runFloorRuleNow(eventId);
  const event = allEvents(doc).find((e) => e.id === eventId);
  const actor = ownerOf(doc);
  if (!event) return;
  if (!actor) return warn('CARL_RPG.Events.Warn.NeedsActor');
  await runActions(doc, event, { actor, trigger: 'manual', depth: 0 });
}

/** The stand-in "item" that floor rules run as: it has no events of its own. */
function floorRuleSource() {
  return {
    documentName: 'Item',
    name: game.i18n.localize('CARL_RPG.Floor.Rules'),
    system: { events: [], upgrades: [] },
  };
}

/**
 * Run the floor rules for a trigger (the GM's client only). A rule with no target
 * affects every crawler. Its floor is set with a "Floor is exactly" condition.
 * @param {string} trigger
 * @param {object} [ctx]
 */
export async function runFloorRules(trigger, ctx = {}) {
  if (!game.user.isGM) return;
  const source = floorRuleSource();
  for (const rule of getFloorRules()) {
    if (!rule.enabled || rule.trigger !== trigger) continue;
    const full = { ...ctx, actor: null, trigger, depth: 0, world: true };
    if (!(await conditionsMet(rule, full))) continue;
    await runActions(source, rule, full);
  }
}

/** Try a floor rule out (the GM only): run its actions now. */
export async function runFloorRuleNow(ruleId) {
  if (!game.user.isGM) return;
  const rule = getFloorRules().find((r) => r.id === ruleId);
  if (!rule) return;
  await runActions(floorRuleSource(), rule, {
    actor: null,
    trigger: 'manual',
    depth: 0,
    world: true,
  });
}

/** Ask the player whether to do an action (the action is skipped if they say no). */
async function askFirst(item, action, ctx) {
  return CarlRPGDialog.confirm({
    window: { title: item.name },
    content: `<p>${t('CARL_RPG.Events.Ask', {
      name: esc(ctx.actor.name),
      what: esc(await summarizeAction(action)),
    })}</p>`,
    yes: { label: t('CARL_RPG.Events.AskYes') },
    no: { label: t('CARL_RPG.Events.AskNo') },
    rejectClose: false,
  });
}

/**
 * "Apply effect to the target that was hit": never applied automatically. The
 * effect is offered on the attack card, on the hit target's row, as an Apply button
 * for the GM (see helpers/attacks.mjs).
 */
async function queueEffect(item, event, index, ctx) {
  const message = ctx.attackMessage;
  const target = ctx.target;
  if (!message?.getFlag(NS, 'attack') || !target) {
    return warn('CARL_RPG.Events.Warn.NoCard', { name: item.name });
  }
  const template = await fromUuid(event.actions[index].uuid);
  // (Read the card again: several events can add effects to the same card.)
  const attack = foundry.utils.deepClone(message.getFlag(NS, 'attack'));
  const row = attack.targets.find((r) => r.actorUuid === target.uuid);
  if (!row) return;
  row.effects ??= [];
  if (row.effects.some((e) => e.eventId === event.id && e.actionIndex === index)) return;
  row.effects.push({
    id: foundry.utils.randomID(),
    itemUuid: item.uuid,
    eventId: event.id,
    actionIndex: index,
    name: template?.name ?? t('CARL_RPG.Events.Missing'),
    applied: false,
  });
  await message.setFlag(NS, 'attack', attack);
}

/**
 * The GM clicked Apply on an attack card: carry out the effect action that was
 * offered, on the target. The action is read from the item as it is now.
 * @param {{itemUuid: string, eventId: string, actionIndex: number}} entry
 * @param {Actor} actor  The target
 * @returns {Promise<boolean>}  Whether it was applied
 */
export async function applyQueuedEffect(entry, actor) {
  if (!game.user.isGM || !actor) return false;
  const item = await fromUuid(entry.itemUuid);
  const event = item ? allEvents(item).find((e) => e.id === entry.eventId) : null;
  const action = event?.actions?.[entry.actionIndex];
  if (!action || action.type !== 'applyEffect') {
    warn('CARL_RPG.Events.Warn.EffectMissing');
    return false;
  }
  await executeAction(
    item,
    event,
    entry.actionIndex,
    { actor: ownerOf(item), depth: 0, trigger: 'hit', target: actor },
    actor
  );
  return true;
}

/** Do one stored action, handing it to the GM's client when it needs more than the user may do. */
async function performAction(item, event, index, ctx) {
  const action = event.actions[index];
  if (action.type === 'applyEffect') return queueEffect(item, event, index, ctx);
  if (action.ask && !ctx.world && !(await askFirst(item, action, ctx))) return;
  if (action.type === 'addToken') return performAddToken(item, event, index, ctx);

  // The targeted tokens belong to whoever triggered this, so they are worked out
  // here and travel with the request if it goes to the GM.
  const targets = await resolveTargets(action, ctx.actor, ctx);
  if (!targets.length) return warn('CARL_RPG.Events.Warn.TargetMissing');

  const mine = [];
  const forGM = [];
  for (const target of targets) {
    const needsGM = action.type === 'macro' ? action.runOn === 'gm' : !target.isOwner;
    (needsGM && !game.user.isGM ? forGM : mine).push(target);
  }
  for (const target of mine) await executeAction(item, event, index, ctx, target);
  if (forGM.length) await relayToGM(item, event, index, ctx, forGM);
}

/**
 * "Add a token to the scene": it goes next to the first token this user has
 * targeted, else the owner's token. It is done here when the user may create
 * tokens (and owns the actor and the combat it joins), otherwise on the GM's
 * client, which needs the events to be approved like other actions that do more
 * than the user may.
 */
async function performAddToken(item, event, index, ctx) {
  const action = event.actions[index];
  const source = action.uuid ? await fromUuid(action.uuid) : null;
  if (!source || source.documentName !== 'Actor') return warn('CARL_RPG.Events.Warn.ActorMissing');
  const anchor = findAnchor(ctx.actor);
  if (!anchor) return warn('CARL_RPG.Events.Warn.NoAnchor');
  const full = { ...ctx, anchorUuid: anchor.uuid };
  if (canPlaceDirectly(source, anchor, !!action.joinCombat)) {
    return HANDLERS.addToken({ item, event, action, actor: ctx.actor, ctx: full });
  }
  await relayToGM(item, event, index, full, []);
}

/** Carry out a stored action on this client, on one actor. */
async function executeAction(item, event, index, ctx, actor) {
  const action = event.actions[index];
  const handler = HANDLERS[action.type];
  if (!handler || !actor) return;
  await handler({ item, event, action, actor, ctx });
}

/*  Handing actions to the GM's client          */

async function relayToGM(item, event, index, ctx, targets) {
  if (!isTrusted(item)) {
    return warn('CARL_RPG.Events.Warn.NotTrusted', { name: item.name });
  }
  if (!game.users.activeGM) return warn('CARL_RPG.Events.Warn.NoGM');
  const action = event.actions[index];
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    whisper: gmIds,
    content: `<em>${t('CARL_RPG.Events.Relaying')}</em>`,
    flags: {
      [NS]: {
        eventRelay: {
          itemUuid: item.uuid,
          eventId: event.id,
          actionIndex: index,
          userId: game.user.id,
          depth: ctx.depth ?? 0,
          trigger: ctx.trigger,
          phase: ctx.phase,
          // Where "add a token" places it: next to this token.
          anchorUuid: ctx.anchorUuid ?? '',
          // Who the action is for: the hit target, or the targeted tokens (both depend
          // on who did this, so the GM's client can't work them out itself).
          targetUuids:
            action.type === 'applyEffect' || action.targetGroup === 'targeted'
              ? targets.map((a) => a.uuid)
              : [],
        },
      },
    },
  });
}

/** On the GM's client: re-check a relayed request against the stored data, then run it. */
async function handleRelay(message, relay) {
  const item = await fromUuid(relay.itemUuid);
  const user = game.users.get(relay.userId);
  const event = item ? allEvents(item).find((e) => e.id === relay.eventId) : null;
  const action = event?.actions?.[relay.actionIndex];
  await message.delete();

  const allowed =
    item &&
    user &&
    event?.enabled &&
    action &&
    ownerOf(item) &&
    isTrusted(item) &&
    // An Observer using the item counts: its events may change the actor
    // automatically, but only events a GM saved are carried out.
    (item.testUserPermission?.(user, 'OBSERVER') ||
      ownerOf(item).testUserPermission(user, 'OBSERVER'));
  if (!allowed) return;

  try {
    const owner = ownerOf(item);
    const given = [];
    for (const uuid of relay.targetUuids ?? []) {
      const doc = await fromUuid(uuid);
      const actor = doc?.documentName === 'Actor' ? doc : (doc?.actor ?? null);
      if (actor) given.push(actor);
    }
    const ctx = {
      actor: owner,
      depth: relay.depth ?? 0,
      trigger: relay.trigger,
      phase: relay.phase,
      anchorUuid: relay.anchorUuid,
      target: action.type === 'applyEffect' ? (given[0] ?? null) : undefined,
      targeted: given,
    };
    const targets = await resolveTargets(action, owner, ctx);
    for (const target of targets) {
      await executeAction(item, event, relay.actionIndex, ctx, target);
    }
  } catch (err) {
    console.error(`${NS} | relayed event action failed`, err);
  }
}

/*  Triggers that belong to the actor           */

/**
 * Whether this client should run phase, round, combat and floor events for an
 * actor: the first connected non-GM owner's client, or the GM's if none is
 * connected.
 */
export function isPhaseExecutor(
  actor,
  players = game.users.filter((u) => u.active && !u.isGM)
) {
  const owners = players.filter((u) => actor.testUserPermission(u, 'OWNER'));
  if (owners.length) return game.user === owners[0];
  return game.user === game.users.activeGM;
}

/** Whether a player owns the actor (connected or not). */
function hasPlayerOwner(actor) {
  return game.users.some(
    (u) => !u.isGM && actor.testUserPermission(u, 'OWNER')
  );
}

/**
 * Run a trigger's events on everything an actor has: its items, its effects that
 * are switched on and, for a pet, its upgrades. The GM covering for a player's
 * actor only runs events a GM has approved.
 * @param {Actor} actor
 * @param {string} trigger
 * @param {object} [ctx]  See runEvents
 */
export async function runActorEvents(actor, trigger, ctx = {}) {
  const owners = [
    ...actor.items,
    // (An effect's own events run while it is on, not while it is switched off or locked.)
    ...actor.effects.filter((effect) => effect.active),
  ];
  // Looked at one after the other, since an event can change what the next has.
  // Whether the GM is covering is only worked out once something has an event
  // for this trigger, so an actor with none costs almost nothing.
  let gmCovering = null;
  const run = async (owner) => {
    const events = allEvents(owner);
    if (!events.some((e) => e.enabled && e.trigger === trigger)) return;
    gmCovering ??= game.user.isGM && hasPlayerOwner(actor);
    if (gmCovering && !isTrusted(owner)) return;
    await runEventList(owner, actor, events, trigger, ctx);
  };
  for (const owner of owners) await run(owner);
  // A pet's own upgrades carry events too.
  if (actor.type === 'pet') await run(actor);
}

/** Run a trigger on every actor in a combat that this client is responsible for. */
async function fireForCombat(combat, trigger, ctx, after) {
  const players = game.users.filter((u) => u.active && !u.isGM);
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || !isPhaseExecutor(actor, players)) continue;
    await runActorEvents(actor, trigger, ctx);
    if (after) await after(actor);
  }
}

/** Run a trigger on every actor in the world this client is responsible for. */
async function fireForWorld(trigger, ctx, after) {
  const players = game.users.filter((u) => u.active && !u.isGM);
  for (const actor of game.actors) {
    if (!isPhaseExecutor(actor, players)) continue;
    await runActorEvents(actor, trigger, ctx);
    if (after) await after(actor);
  }
}

/*  Setup                                       */

export function registerEvents() {
  // Phase events run when the combat moves to a new phase: the one it left ends,
  // the new one starts and, when that is Cleanup, the round ends (effects that
  // last a number of rounds count down, and uses that recharge each round come
  // back). The combat says which phase it came from (see CarlRPGCombat#setPhase),
  // so this doesn't depend on what this client has seen before. Stepping back
  // through the phases doesn't run any events again.
  Hooks.on('updateCombat', (combat, changed, options) => {
    if (!foundry.utils.hasProperty(changed, `flags.${NS}.phase`)) return;
    if (options?.carlDirection === 'back') return;
    const phases = CONFIG.CARL_RPG.combatPhases;
    const next = combat.phase;
    const prev = options?.carlPrevPhase;
    (async () => {
      if (prev !== undefined && prev !== next && phases[prev]) {
        await fireForCombat(combat, 'phaseEnd', { phase: phases[prev].id });
      }
      if (!phases[next]) return;
      await fireForCombat(combat, 'phaseStart', { phase: phases[next].id });
      if (phases[next].id === 'cleanup') {
        await fireForCombat(combat, 'roundEnd', { phase: phases[next].id }, async (actor) => {
          await tickDurations(actor);
          await restoreUses(actor, ['round']);
          await tickCooldowns(actor);
        });
        await runFloorRules('roundEnd', {});
      }
    })();
  });

  // A combat starting and ending.
  Hooks.on('combatStart', (combat) => fireForCombat(combat, 'combatStart', {}));
  Hooks.on('deleteCombat', (combat) =>
    fireForCombat(combat, 'combatEnd', {}, async (actor) => {
      await endCombatEffects(actor);
      await restoreUses(actor, ['round', 'rounds', 'combat']);
    })
  );

  // Floor rules that run when a combat starts or ends, or the floor changes.
  Hooks.on('combatStart', () => runFloorRules('combatStart', {}));
  Hooks.on('deleteCombat', () => runFloorRules('combatEnd', {}));
  Hooks.on('updateSetting', (setting) => {
    if (setting.key === `${NS}.floor`) runFloorRules('floorChange', {});
  });

  // The floor changing: uses that recharge each floor come back.
  Hooks.on('updateSetting', (setting) => {
    if (setting.key !== `${NS}.floor`) return;
    fireForWorld('floorChange', { floor: CONFIG.CARL_RPG.getFloor() }, (actor) =>
      restoreUses(actor, ['floor'])
    );
  });

  // "Action spent": when a combatant's spent actions go up (by using an item or
  // clicking a pip), the actor's items run their Action Spent events. Only the
  // client that spent the action runs them.
  Hooks.on('updateCombatant', (combatant, changes, options, userId) => {
    if (userId !== game.user.id) return;
    const spent = changes.flags?.[NS]?.actionsSpent;
    if (spent === undefined || !(spent > (options.carlPrevSpent ?? 0))) return;
    const actor = combatant.actor;
    if (!actor) return;
    runActorEvents(actor, 'actionSpent', {
      actionsLeft: combatant.actionsLeft,
    });
  });

  // An effect being switched on, or ending. Only the client that did it runs them.
  Hooks.on('updateActiveEffect', (effect, changes, options, userId) => {
    if (userId !== game.user.id || !(effect.parent instanceof Actor)) return;
    if (changes.disabled === undefined || !allEvents(effect).length) return;
    runEvents(effect, changes.disabled ? 'effectEnded' : 'effectGained', {});
  });
  Hooks.on('createActiveEffect', (effect, options, userId) => {
    if (userId !== game.user.id || !(effect.parent instanceof Actor)) return;
    if (effect.disabled || !allEvents(effect).length) return;
    runEvents(effect, 'effectGained', {});
  });

  Hooks.on('createChatMessage', (message) => {
    const relay = message.getFlag(NS, 'eventRelay');
    if (relay && game.user === game.users.activeGM) handleRelay(message, relay);
  });
}
