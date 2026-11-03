/**
 * Checks, targeting and degrees of success.
 *
 * Every item that rolls (skills, spells, gear, mob abilities) has something it
 * targets, set on the item (`system.check.target`):
 *
 *   Unopposed (the default)  the roll must reach 10 + 2 x the Floor. No target
 *                            is needed.
 *   Evade (an attack)        the roll is compared with each targeted token's
 *                            Evade.
 *   A stat (opposed)         the roll is compared with 10 + the targeted token's
 *                            modifier for that stat + the Floor.
 *   Size Class (opposed)     the roll is compared with 10 + the targeted token's
 *                            Size Class + the Floor (Tiny is 1 up to Gargantuan 8).
 *
 * The roll gets a degree of success against each number it is compared with:
 *
 *   Critical Hit     a natural 20: always succeeds, and the damage dice are
 *                    doubled (before stats and buffs are added)
 *   Amazing Success  beat it by 10 or more: extra damage equal to the Floor
 *   Success          met or beat it by 0 to 9: normal damage
 *   Near Miss        missed by 1 or 2
 *   Fail             missed by 3 to 9
 *   Major Fail       missed by 10 or more
 *   Critical Fail    a natural 1: always fails
 *
 * An item with a Damage formula rolls it once (doubled dice on a natural 20) and
 * the card lists each target with its degree. The GM applies the damage from
 * buttons on the card (x2, x1 or x1/2). Each target that is hit also runs the
 * item's "a roll succeeds against a target" events (for example, applying an
 * effect to it).
 *
 * With no targets, an unopposed check still shows its result, and damage can be
 * applied to whatever the GM has targeted at that moment.
 */
import { getFloor } from './floor.mjs';
import { applyQueuedEffect, runEvents } from './events.mjs';
import { effectiveOf } from './upgrades.mjs';
import { offerAiFavor } from './ai-favor.mjs';
import { promptRoll, buildFormula, optionsNote } from './roll-dialog.mjs';

const NS = 'carl-rpg';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => Handlebars.escapeExpression(text);

/** The degrees of success that count as a hit. */
const HITS = ['critHit', 'amazing', 'success'];

/** Whether an item has a damage formula. */
const hasDamage = (item) => !!effectiveOf(item).damage?.trim();

/** A target's Evade total. */
export function evadeOf(actor) {
  // (Crawlers and pets work Evade out from Dexterity; mobs have a set value.)
  return actor.type !== 'mob'
    ? (actor.system.evade?.total ?? 0)
    : (actor.system.evadeTotal ?? 0);
}

/**
 * The number a roll has to reach for an item's check.
 * @param {Item} item
 * @param {Actor|null} target  The targeted actor (not needed for an unopposed check)
 * @returns {number|null}  null if the check needs a target and there isn't one
 */
export function checkDC(item, target) {
  const key = effectiveOf(item).target;
  const rules = CONFIG.CARL_RPG.checks;
  if (key === 'unopposed') return rules.base + getFloor() * rules.unopposedFloorFactor;
  if (!target) return null;
  if (key === 'evade') return evadeOf(target);
  // A mob target counts with its own pinned Floor, as its numbers do.
  const floor = target.type === 'mob' ? target.system.floor : getFloor();
  if (key === 'size') return rules.base + sizeClassOf(target) + floor;
  // One of the five stats: its modifier.
  return rules.base + (target.system.abilities?.[key]?.mod ?? 0) + floor;
}

/** An actor's Size Class: Tiny is 1, going up one for each size to Gargantuan (8). */
export function sizeClassOf(actor) {
  // (A pet's upgrades can have moved it to another size.)
  const index = Object.keys(CONFIG.CARL_RPG.sizes).indexOf(
    actor.system.effectiveSize ?? actor.system.size
  );
  return index < 0 ? 1 : index + 1;
}

/**
 * The kind of check an item's target makes: 'unopposed', 'attack' (against
 * Evade) or 'opposed' (against a stat or the Size Class).
 */
const checkKind = (key) =>
  key === 'unopposed' ? 'unopposed' : key === 'evade' ? 'attack' : 'opposed';

/**
 * The natural result of the d20 in a roll, or null if it has none.
 * @param {Roll|null} roll
 */
export function naturalD20(roll) {
  const die = roll?.dice?.find((d) => d.faces === 20);
  return die?.results?.find((r) => r.active)?.result ?? null;
}

/**
 * The degree of success of a roll against one number.
 * @param {number|null} natural  The natural d20 result (null if there is none)
 * @param {number} total         The roll total
 * @param {number} dc            What it has to reach
 * @returns {'critHit'|'amazing'|'success'|'nearMiss'|'fail'|'majorFail'|'critFail'}
 */
export function degreeOf(natural, total, dc) {
  if (natural === 20) return 'critHit';
  if (natural === 1) return 'critFail';
  const margin = total - dc;
  if (margin >= 10) return 'amazing';
  if (margin >= 0) return 'success';
  if (margin >= -2) return 'nearMiss';
  if (margin >= -9) return 'fail';
  return 'majorFail';
}

/**
 * Resolve an item's check: work out the degree of success against each target
 * (or against the Floor for an unopposed check), roll the damage if the item
 * has any, and post the result card.
 * @param {Item} item
 * @param {Roll|null} roll  The roll (null if the item doesn't roll: any damage simply hits)
 * @returns {Promise<{degrees: string[], hits: Array<{actor: Actor, degree: string}>}|null>}
 *   null if there is nothing to resolve
 */
export async function resolveCheck(item, roll) {
  // Mobs never roll a d20: a crawler rolls against the mob's number instead.
  if (item.actor?.type === 'mob') return resolveMobCheck(item);
  // An item whose action is No Roll has no check or damage to resolve.
  if (item.system.action?.type === 'none') return null;

  const damaging = hasDamage(item);
  if (!roll && !damaging) return null;

  const owner = item.actor;
  const targetKey = effectiveOf(item).target;
  const type = checkKind(targetKey);
  const natural = naturalD20(roll);
  const crit = natural === 20;

  // The targets as they are right now.
  const targets = [...game.user.targets]
    .map((token) => ({ doc: token.document, actor: token.actor }))
    .filter((x) => x.actor);

  // An attack or an opposed check needs a target to compare with; without one
  // there is nothing to show unless it has damage to apply.
  const noResult = (degrees) => ({ degrees, hits: [], misses: [] });
  const fromNatural = crit ? ['critHit'] : natural === 1 ? ['critFail'] : [];
  if (type !== 'unopposed' && !targets.length && !damaging) {
    return noResult(fromNatural);
  }

  // The damage is rolled once. On a natural 20 the dice are doubled; stats and
  // other flat modifiers are left alone.
  let damageRoll = null;
  let damage = null;
  if (damaging) {
    try {
      damageRoll = new Roll(effectiveOf(item).damage, owner?.getRollData() ?? {});
      if (crit) damageRoll = damageRoll.alter(2, 0);
      await damageRoll.evaluate();
      damage = Math.max(0, Math.floor(damageRoll.total));
    } catch (err) {
      ui.notifications.warn(t('CARL_RPG.Attack.BadDamage', { name: item.name }));
      return null;
    }
  }
  const floor = getFloor();

  // An unopposed check has one number to reach, whoever is targeted.
  const unopposedDC = type === 'unopposed' ? checkDC(item, null) : null;
  const unopposedDegree =
    type === 'unopposed' && roll
      ? degreeOf(natural, roll.total, unopposedDC)
      : null;

  const rows = targets.map(({ doc, actor }) => {
    const dc = type === 'unopposed' ? unopposedDC : checkDC(item, actor);
    // With no roll every target is simply hit.
    const degree = roll ? degreeOf(natural, roll.total, dc) : 'success';
    return {
      tokenUuid: doc.uuid,
      actorUuid: actor.uuid,
      name: doc.name,
      dc,
      // A mob's numbers are hidden from players (they still see the result).
      isMob: actor.type === 'mob',
      degree,
      hit: HITS.includes(degree),
      // An Amazing Success adds the Floor to the damage.
      damage: damaging ? damage + (degree === 'amazing' ? floor : 0) : null,
      applied: false,
    };
  });

  // What an opposed check is against, in words: a stat or the Size Class.
  const targetLabel = t(CONFIG.CARL_RPG.checkTargets[targetKey] ?? '');
  const heading = damaging
    ? t('CARL_RPG.Attack.Damage', { damage })
    : t(`CARL_RPG.Check.Header.${type}`, { stat: targetLabel });
  const check = {
    itemName: item.name,
    type,
    damage,
    floor,
    natural,
    crit,
    dc: unopposedDC,
    degree: unopposedDegree,
    targets: rows,
  };
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    rolls: damageRoll ? [damageRoll] : [],
    content: `<div class="carl-attack-card"><strong>${esc(heading)}</strong></div>`,
    sound: damageRoll ? CONFIG.sounds.dice : undefined,
    flags: { [NS]: { attack: check } },
  });

  // The degrees of success for the events: one for each target, the one result
  // of an unopposed check, or, with nothing to compare, what the natural roll
  // alone decides.
  const degrees = rows.length
    ? rows.map((row) => row.degree)
    : unopposedDegree
      ? [unopposedDegree]
      : fromNatural;
  return {
    degrees,
    hits: targets.flatMap(({ actor }, i) =>
      rows[i].hit ? [{ actor, degree: rows[i].degree }] : []
    ),
    // The targets it didn't hit, for the "an attack misses a target" events.
    misses: targets.flatMap(({ actor }, i) =>
      rows[i].hit ? [] : [{ actor, degree: rows[i].degree }]
    ),
    // The attack card, where effects the events offer are shown (see helpers/events.mjs).
    message,
  };
}

/*  A mob's checks                              */

/**
 * What a crawler adds to their d20 when defending against a mob's check: their
 * Evade, a stat modifier or their Size Class, whatever the check targets.
 */
function defenseModifier(targetKey, actor) {
  if (targetKey === 'evade') return actor.system.evade?.total ?? 0;
  if (targetKey === 'size') return sizeClassOf(actor);
  return actor.system.abilities?.[targetKey]?.mod ?? 0;
}

/** What the crawler's defending roll is called: "Evade", "Strength", ... */
function defenseLabel(targetKey) {
  if (targetKey === 'evade') return t('CARL_RPG.Actor.Crawler.Combat.Evade');
  if (targetKey === 'size') return t('CARL_RPG.Check.Targets.size');
  return t(CONFIG.CARL_RPG.abilities[targetKey] ?? '');
}

/** The actor a card row points at. */
const actorOfRow = (row) =>
  fromUuidSync(row.tokenUuid)?.actor ?? fromUuidSync(row.actorUuid) ?? null;

/**
 * What a crawler's defending roll means for the mob's attack. The roll is made
 * against the mob's number, so the crawler's degree is turned around:
 *   a crawler Critical Fail (natural 1)  -> the attack is a Critical Hit: double
 *                                           damage, and a Minor Injury after the
 *                                           combat
 *   a crawler Major Fail (missed by 10+)  -> the attack is an Amazing Success:
 *                                           extra damage equal to the Floor
 *   a crawler Fail or Near Miss           -> the attack is a Success
 *   a crawler Success, Amazing Success or Critical Hit -> the attack fails
 */
const MOB_DEGREE = {
  critFail: 'critHit',
  majorFail: 'amazing',
  fail: 'success',
  nearMiss: 'success',
  success: 'fail',
  amazing: 'fail',
  critHit: 'fail',
};

/**
 * The damage a mob's attack does at a degree of success: double on a Critical
 * Hit, plus the Floor on an Amazing Success, otherwise as rolled.
 */
function mobDamage(base, degree, floor) {
  if (base == null) return null;
  if (degree === 'critHit') return base * 2;
  if (degree === 'amazing') return base + floor;
  return base;
}

/**
 * A mob uses an item. The GM never rolls a d20, so a mob's check is a fixed
 * number (the number set on the item + the Floor).
 *
 *  - Against a crawler, the crawler rolls d20 + their Evade (or the stat or Size
 *    Class the check targets) against it. The card waits for each crawler to roll,
 *    or to choose not to (the attack then hits). See MOB_DEGREE for what the
 *    crawler's result means for the attack.
 *  - Against another mob, nobody rolls: the mob's number is compared with the
 *    same number a crawler would have to reach (the target's Evade, or 10 + a stat
 *    or Size Class + the Floor), with the usual degrees but no natural 20 or 1.
 *  - Unopposed: the mob's number is compared with 10 + (Floor x 2).
 * @param {Item} item
 */
async function resolveMobCheck(item) {
  const targetKey = effectiveOf(item).target;
  const type = checkKind(targetKey);
  const damaging = hasDamage(item);
  const owner = item.actor;
  // A mob pinned to its own Floor uses that for its numbers (see the mob data model).
  const floor = owner?.type === 'mob' ? owner.system.floor : getFloor();
  const number = (item.system.check?.number ?? 0) + floor;

  let damageRoll = null;
  let damage = null;
  if (damaging) {
    try {
      damageRoll = await new Roll(
        effectiveOf(item).damage,
        owner?.getRollData() ?? {}
      ).evaluate();
      damage = Math.max(0, Math.floor(damageRoll.total));
    } catch (err) {
      ui.notifications.warn(t('CARL_RPG.Attack.BadDamage', { name: item.name }));
      return null;
    }
  }

  const targets = [...game.user.targets]
    .map((token) => ({ doc: token.document, actor: token.actor }))
    .filter((x) => x.actor);

  // Unopposed: one number to reach, whoever is targeted.
  const unopposedDC = type === 'unopposed' ? checkDC(item, null) : null;
  const unopposedDegree =
    type === 'unopposed' ? degreeOf(null, number, unopposedDC) : null;

  const rows = targets.map(({ doc, actor }) => {
    const base = {
      tokenUuid: doc.uuid,
      actorUuid: actor.uuid,
      name: doc.name,
      isMob: actor.type === 'mob',
      applied: false,
    };
    // A crawler (or pet) answers a mob's attack (or stat or Size Class check) by rolling.
    if (type !== 'unopposed' && actor.type !== 'mob') {
      return { ...base, state: 'pending', degree: null, hit: null, damage };
    }
    // Everyone else: the numbers are simply compared.
    const dc = type === 'unopposed' ? unopposedDC : checkDC(item, actor);
    const degree = degreeOf(null, number, dc);
    return {
      ...base,
      state: 'resolved',
      dc,
      degree,
      hit: HITS.includes(degree),
      damage: mobDamage(damage, degree, floor),
    };
  });

  const check = {
    itemName: item.name,
    itemUuid: item.uuid,
    mob: true,
    targetKey,
    type,
    number,
    damage,
    floor,
    natural: null,
    crit: false,
    dc: unopposedDC,
    degree: unopposedDegree,
    targets: rows,
  };
  const heading = damaging
    ? t('CARL_RPG.Attack.Damage', { damage })
    : t(`CARL_RPG.Check.Header.${type}`, { stat: defenseLabel(targetKey) });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    rolls: damageRoll ? [damageRoll] : [],
    content: `<div class="carl-attack-card"><strong>${esc(heading)}</strong></div>`,
    sound: damageRoll ? CONFIG.sounds.dice : undefined,
    flags: { [NS]: { attack: check } },
  });

  // Crawlers are still to roll; their hits run the events when they resolve.
  const degrees = rows.flatMap((row) => (row.degree ? [row.degree] : []));
  return {
    degrees: degrees.length || !unopposedDegree ? degrees : [unopposedDegree],
    hits: targets.flatMap(({ actor }, i) =>
      rows[i].hit ? [{ actor, degree: rows[i].degree }] : []
    ),
  };
}

/**
 * Record a crawler's defending roll on a mob's card (GM only), work out how the
 * attack went, and run the item's "a roll succeeds against a target" events if it
 * hit. A Critical Hit also marks the crawler for a Minor Injury.
 * @param {ChatMessage} message
 * @param {number} index  The target's row
 * @param {{rolled: number|null, natural: number|null, skipped: boolean}} outcome
 *   `skipped` if they chose not to roll (the attack then hits)
 */
async function applyMobResult(
  message,
  index,
  { rolled = null, natural = null, skipped = false }
) {
  if (!game.user.isGM) return;
  const attack = foundry.utils.deepClone(message.getFlag(NS, 'attack'));
  const row = attack?.targets?.[index];
  if (!row || row.state !== 'pending') return;

  // The crawler's degree against the mob's number, turned around for the attack.
  // Not rolling means a standard Success.
  const degree = skipped
    ? 'success'
    : MOB_DEGREE[degreeOf(natural, rolled, attack.number)];
  // An Evade roll that goes badly also hurts: missing by 10 or more (an Amazing
  // Success for the attack) leaves a Minor Injury, and a natural 1 (a Critical
  // Hit) a Major Injury, once the combat is over. Other kinds of check don't.
  const injury =
    attack.targetKey !== 'evade'
      ? null
      : degree === 'critHit'
        ? 'major'
        : degree === 'amazing'
          ? 'minor'
          : null;
  Object.assign(row, {
    state: 'resolved',
    degree,
    hit: HITS.includes(degree),
    damage: mobDamage(attack.damage, degree, attack.floor),
    rolled,
    skipped,
    injury,
  });
  await message.setFlag(NS, 'attack', attack);

  const actor = actorOfRow(row);
  if (injury && actor) await markInjury(actor, injury);
  if (row.hit) {
    const item = await fromUuid(attack.itemUuid);
    if (item && actor) {
      await runEvents(item, 'hit', {
        target: actor,
        degree,
        depth: 0,
        attackMessage: message,
      });
    }
  }
}

/**
 * A crawler's owner (or the GM) rolls a defending check against a mob's card, or
 * chooses not to. A player's result is handed to the GM's client to record.
 * @param {ChatMessage} message
 * @param {number} index
 * @param {boolean} skip  Don't roll: the attack just hits
 */
async function resolveMobTarget(message, index, skip, shift = false) {
  // A Dying crawler can't roll: it counts as not rolling (the mob's attack is a
  // standard success).
  if (!skip) {
    const row = message.getFlag(NS, 'attack')?.targets?.[index];
    const actor = row?.actorUuid ? await fromUuid(row.actorUuid) : null;
    if (dyingEffectOf(actor)) skip = true;
  }
  const attack = message.getFlag(NS, 'attack');
  const row = attack?.targets?.[index];
  if (!row || row.state !== 'pending') return;
  const actor = actorOfRow(row);
  if (!actor?.isOwner) return;

  let rolled = null;
  let natural = null;
  if (!skip) {
    // The roll pop-up (extra bonus, advantage or disadvantage; there's no stat to
    // change here, since Evade is added as a whole). Shift skips it.
    const label = defenseLabel(attack.targetKey);
    let options = {};
    if (!shift) {
      options = await promptRoll({
        title: t('CARL_RPG.Attack.DefenseRoll', { label }),
      });
      if (!options) return;
    }
    const formula = buildFormula('1d20 + @mod', options);
    if (formula === null) return;
    const chosen = optionsNote(options);
    const first = await new Roll(formula, {
      mod: defenseModifier(attack.targetKey, actor),
    }).evaluate();
    // Before the result is shown, they can spend AI Favor to reroll.
    const favor = await offerAiFavor(actor, first);
    const roll = favor.roll;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor:
        t('CARL_RPG.Attack.DefenseRoll', { label }) +
        (chosen ? ` (${chosen})` : '') +
        (favor.note ? `<br><em>${favor.note}</em>` : ''),
      rollMode: game.settings.get('core', 'rollMode'),
      flags: { 'carl-rpg': { card: { kind: 'defense' } } },
    });
    rolled = roll.total;
    natural = naturalD20(roll);
  }

  if (game.user.isGM) {
    return applyMobResult(message, index, { rolled, natural, skipped: skip });
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(t('CARL_RPG.Relay.NoGM'));
    return;
  }
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    whisper: gmIds,
    content: `<em>${t('CARL_RPG.Relay.Working')}</em>`,
    flags: {
      [NS]: {
        mobCheckRelay: {
          messageId: message.id,
          index,
          rolled,
          natural,
          skipped: skip,
          userId: game.user.id,
        },
      },
    },
  });
}

/** On the GM's client: check a crawler's relayed roll, then record it. */
async function handleMobRelay(relayMessage, relay) {
  await relayMessage.delete();
  const message = game.messages.get(relay.messageId);
  const user = game.users.get(relay.userId);
  const row = message?.getFlag(NS, 'attack')?.targets?.[relay.index];
  const actor = row ? actorOfRow(row) : null;
  // Only the crawler's owner can answer for it.
  if (!user || !actor?.testUserPermission(user, 'OWNER')) return;
  if (!relay.skipped && !Number.isFinite(relay.rolled)) return;
  await applyMobResult(message, relay.index, {
    rolled: relay.skipped ? null : relay.rolled,
    natural: relay.skipped ? null : (relay.natural ?? null),
    skipped: !!relay.skipped,
  });
}

/*  Injuries                                    */

/** How long a kind of rest is, for comparing how long effects last. */
const restRank = (rest) => CONFIG.CARL_RPG.rests.indexOf(rest);

/**
 * Give a crawler an injury (CONFIG.CARL_RPG.injuries): a debuff that takes a
 * number off all five stats and lasts until a rest.
 *
 * Injuries of the same kind don't stack. Getting another while the first is
 * still on only makes it last longer (a Minor Injury from a short rest to a long
 * rest, a Major Injury from a long rest to a full rest). A Minor and a Major
 * Injury are separate effects, so a crawler can have both.
 * @param {Actor} actor
 * @param {'minor'|'major'} severity
 */
export async function applyInjury(actor, severity) {
  const injury = CONFIG.CARL_RPG.injuries[severity];
  if (!injury) return;
  const name = t(injury.name);

  const existing = actor.effects.find((e) => e.name === name);
  if (existing) {
    // Already injured: no second copy, but it lasts longer.
    const current = existing.getFlag(NS, 'lastsUntil');
    if (restRank(current) < restRank(injury.upgradedDuration)) {
      await existing.setFlag(NS, 'lastsUntil', injury.upgradedDuration);
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: t('CARL_RPG.Attack.InjuryLonger', {
          name: actor.name,
          injury: name,
          until: t(`CARL_RPG.Rest.Until.${injury.upgradedDuration}`),
        }),
      });
    }
    return;
  }

  await actor.createEmbeddedDocuments('ActiveEffect', [
    {
      name,
      img: injury.img,
      description: t(injury.description),
      origin: actor.uuid,
      disabled: false,
      // The penalty goes on all five stats.
      changes: Object.keys(CONFIG.CARL_RPG.abilities).map((stat) => ({
        key: CONFIG.CARL_RPG.effectModifiers[stat].key,
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: String(injury.penalty),
        priority: null,
      })),
      flags: {
        [NS]: {
          kind: 'debuff',
          sourceItems: [],
          stacks: 1,
          lastsUntil: injury.duration,
        },
      },
    },
  ]);
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: t('CARL_RPG.Attack.InjuryGained', {
      name: actor.name,
      injury: name,
      until: t(`CARL_RPG.Rest.Until.${injury.duration}`),
    }),
  });
}

/**
 * A crawler was badly hurt by a mob's attack: they get the injury once the combat
 * ends. Being hurt the same way twice in one combat counts twice (the injury then
 * lasts longer). Outside a combat it is given straight away.
 * @param {Actor} actor
 * @param {'minor'|'major'} severity
 */
async function markInjury(actor, severity) {
  const combat = game.combat;
  const combatant = combat?.started
    ? combat.combatants.find((c) => c.actor === actor)
    : null;
  if (!combatant) return applyInjury(actor, severity);
  const counts = foundry.utils.deepClone(combatant.getFlag(NS, 'injuries') ?? {});
  counts[severity] = (counts[severity] ?? 0) + 1;
  await combatant.setFlag(NS, 'injuries', counts);
}
/*  The chat card                               */

/** The damage multipliers the GM can apply, in the order their buttons show. */
const MULTIPLIERS = [
  { value: 2, label: '\u00D72' },
  { value: 1, label: '\u00D71' },
  { value: 0.5, label: '\u00D7\u00BD' },
];

import { cancelDying, dyingEffectOf } from './dying.mjs';

/** The damage an attack does at a multiplier (halves round down). */
const scaled = (damage, multiplier) => Math.floor(damage * multiplier);

/**
 * Apply an attack's damage to its targets (GM only).
 * @param {ChatMessage} message  The attack card
 * @param {number|'all'|'current'} which  A target's index, all unapplied hits,
 *   or whatever the GM has targeted now (for a card made with no targets)
 * @param {number} multiplier  2, 1 or 0.5 times the damage
 */
async function applyAttackDamage(message, which, multiplier = 1) {
  if (!game.user.isGM) return;
  const attack = foundry.utils.deepClone(message.getFlag(NS, 'attack'));
  if (!attack || attack.damage == null) return;

  if (which === 'current') {
    const damage = scaled(attack.damage, multiplier);
    for (const token of game.user.targets) {
      await token.actor?.applyDamage(damage);
    }
    return;
  }

  const indexes =
    which === 'all'
      ? attack.targets.flatMap((target, i) =>
          target.hit && !target.applied ? [i] : []
        )
      : [Number(which)];

  for (const i of indexes) {
    const target = attack.targets[i];
    if (!target?.hit || target.applied) continue;
    const doc = await fromUuid(target.tokenUuid);
    const actor = doc?.actor ?? (await fromUuid(target.actorUuid));
    if (!actor) {
      ui.notifications.warn(t('CARL_RPG.Attack.NotFound', { name: target.name }));
      continue;
    }
    // Each target has its own damage (an Amazing Success adds the Floor).
    const damage = scaled(target.damage ?? attack.damage, multiplier);
    const undo = { before: actor.system.health.value, wasDying: !!dyingEffectOf(actor) };
    await actor.applyDamage(damage);
    // Remember what was applied, so the card can say so, and what Undo puts back.
    target.applied = true;
    target.undo = undo;
    target.appliedDamage = damage;
    target.appliedMultiplier = multiplier;
  }
  await message.setFlag(NS, 'attack', attack);
}

/**
 * Undo the last damage applied to a target (GM only, once): puts back the health
 * it took, and clears a Dying state that the hit caused.
 */
async function undoAttackDamage(message, index) {
  if (!game.user.isGM) return;
  const attack = foundry.utils.deepClone(message.getFlag(NS, 'attack'));
  const target = attack?.targets[index];
  if (!target?.undo) return;
  const doc = await fromUuid(target.tokenUuid);
  const actor = doc?.actor ?? (await fromUuid(target.actorUuid));
  if (actor) {
    await actor.update({ 'system.health.value': target.undo.before });
    if (!target.undo.wasDying) await cancelDying(actor);
  }
  target.applied = false;
  target.undo = null;
  await message.setFlag(NS, 'attack', attack);
}

/** The result of a roll as a coloured word, e.g. "Success". */
function resultHtml(degree, hit) {
  return `<span class="attack-result ${degree} ${hit ? 'hit' : 'miss'}">${esc(
    t(`CARL_RPG.Attack.Degrees.${degree}`)
  )}</span>`;
}

/** Add the target list and buttons to an attack card as it is drawn. */
function renderAttackCard(message, html) {
  const attack = message.getFlag(NS, 'attack');
  if (!attack) return;
  const host = html.querySelector('.carl-attack-card');
  if (!host || host.querySelector('.attack-targets')) return;

  const list = document.createElement('div');
  list.className = 'attack-targets';
  const isGM = game.user.isGM;
  // Whether this card is for one of this player's own attacks (they made it, or
  // they own whoever it is for), as opposed to a mob's or another player's.
  const ownCard =
    message.isAuthor || !!game.actors.get(message.speaker?.actor)?.isOwner;
  const damaging = attack.damage != null;
  const type = attack.type ?? 'attack';

  // A row of Apply buttons for the GM: x2, x1 and x1/2 of the damage.
  const buttons = (which, baseDamage, prefix = '') =>
    isGM && damaging
      ? `<span class="apply-buttons">${prefix ? `<span class="apply-prefix">${esc(prefix)}</span>` : ''}${MULTIPLIERS.map(
          ({ value, label }) =>
            `<button type="button" class="carl-apply-damage" data-which="${which}" data-multiplier="${value}" title="${esc(
              t('CARL_RPG.Attack.ApplyTip', { damage: scaled(baseDamage, value) })
            )}">${label}</button>`
        ).join('')}</span>`
      : '';

  // A natural 20 or 1 is called out at the top of the card.
  let body = '';
  if (attack.crit) {
    body += `<p class="attack-note crit">${esc(t('CARL_RPG.Attack.CritNote'))}</p>`;
  } else if (attack.natural === 1) {
    body += `<p class="attack-note critfail">${esc(t('CARL_RPG.Attack.CritFailNote'))}</p>`;
  }

  // An unopposed check has one number and one result, shown once.
  if (type === 'unopposed' && attack.degree) {
    body += `<div class="attack-target${attack.mob ? '' : ` degree-${attack.degree}`}"><span class="attack-evade">${esc(
      t('CARL_RPG.Check.DC', { dc: attack.dc })
    )}</span>${resultHtml(attack.degree, HITS.includes(attack.degree))}</div>`;
  }

  // A mob's number is for the GM's eyes; crawlers just roll against it.
  if (attack.mob && isGM) {
    body += `<p class="attack-note">${esc(
      t('CARL_RPG.Attack.MobNumber', { number: attack.number })
    )}</p>`;
  }

  if (!attack.targets.length) {
    // Nothing was targeted: the GM can apply any damage to whatever is
    // targeted now.
    if (damaging) {
      body += `<p class="attack-note">${esc(t('CARL_RPG.Attack.NoTargets'))}</p>${buttons(
        'current',
        attack.damage,
        t('CARL_RPG.Attack.ApplyTargeted')
      )}`;
    }
  } else {
    for (const [i, target] of attack.targets.entries()) {
      // A crawler hasn't answered a mob's check yet: their owner (or the GM) can
      // roll or choose not to.
      if (attack.mob && target.state === 'pending') {
        const label = defenseLabel(attack.targetKey);
        const mine = isGM || actorOfRow(target)?.isOwner;
        const answer = mine
          ? `<span class="apply-buttons"><button type="button" class="carl-mob-roll" data-index="${i}" data-skip="0">${esc(
              t('CARL_RPG.Attack.RollDefense', { label })
            )}</button><button type="button" class="carl-mob-roll" data-index="${i}" data-skip="1">${esc(
              t('CARL_RPG.Attack.DontRoll')
            )}</button></span>`
          : '';
        body += `<div class="attack-target">
          <span class="attack-name">${esc(target.name)}</span>
          <span class="attack-waiting">${esc(t('CARL_RPG.Attack.Waiting', { label }))}</span>
          ${answer}
        </div>`;
        continue;
      }
      const degree = target.degree ?? (target.hit ? 'success' : 'fail');
      let result = resultHtml(degree, target.hit);
      // What the crawler rolled, if they answered a mob's check.
      if (attack.mob && target.state === 'resolved' && target.rolled !== undefined) {
        result += `<span class="attack-evade">${esc(
          target.skipped
            ? t('CARL_RPG.Attack.Skipped')
            : t('CARL_RPG.Attack.Rolled', { total: target.rolled })
        )}</span>`;
      }
      // An Amazing Success shows the Floor it added.
      if (damaging && degree === 'amazing' && attack.floor) {
        result += `<span class="attack-floor">${esc(
          t('CARL_RPG.Attack.FloorBonus', { floor: attack.floor })
        )}</span>`;
      }
      // A mob's Critical Hit doubles the damage (and, on an Evade roll, leaves an
      // injury, shown below).
      if (damaging && attack.mob && degree === 'critHit') {
        result += `<span class="attack-floor">${esc(t('CARL_RPG.Attack.DoubleDamage'))}</span>`;
      }
      if (target.injury) {
        result += `<span class="attack-floor">${esc(
          t(`CARL_RPG.Attack.InjuryNote.${target.injury}`)
        )}</span>`;
      }
      if (isGM && target.applied && target.undo) {
        result += `<button type="button" class="carl-undo-damage" data-index="${i}">${esc(
          t('CARL_RPG.Attack.Undo')
        )}</button>`;
      }
      const damage = target.damage ?? attack.damage;
      const action =
        !damaging || !target.hit
          ? ''
          : target.applied
            ? `<span class="attack-applied">${esc(
                t('CARL_RPG.Attack.AppliedAmount', {
                  damage: target.appliedDamage ?? damage,
                })
              )}</span>`
            : `<span class="attack-damage">${esc(
                t('CARL_RPG.Attack.TargetDamage', { damage })
              )}</span>${buttons(i, damage)}`;
      // Players don't see a mob's numbers, only how the roll went. (An
      // unopposed check's number is shown once at the top instead.)
      const dc = target.dc ?? target.evade;
      const showNumber =
        !attack.mob && type !== 'unopposed' && (isGM || !target.isMob);
      const number = showNumber
        ? `<span class="attack-evade">${esc(
            type === 'opposed'
              ? t('CARL_RPG.Check.DC', { dc })
              : t('CARL_RPG.Attack.Evade', { evade: dc })
          )}</span>`
        : '';
      // Effects the item's events offer for this target: the GM applies them.
      // A player only sees a pending one on their own attack cards, never a
      // mob's or someone else's; once it has been applied everyone sees it.
      const effects = (target.effects ?? [])
        .filter((effect) => effect.applied || isGM || ownCard)
        .map((effect) =>
          effect.applied
            ? `<span class="attack-applied">${esc(
                t('CARL_RPG.Attack.EffectApplied', { name: effect.name })
              )}</span>`
            : isGM
              ? `<button type="button" class="carl-apply-effect" data-index="${i}" data-effect="${effect.id}">${esc(
                  t('CARL_RPG.Attack.ApplyEffect', { name: effect.name })
                )}</button>`
              : `<span class="attack-damage">${esc(
                  t('CARL_RPG.Attack.EffectPending', { name: effect.name })
                )}</span>`
        )
        .join('');
      // (A row is tinted by its degree, except on a mob's card: there a "success" is
      // bad news for the crawler.)
      body += `<div class="attack-target${attack.mob ? '' : ` degree-${degree}`}">
        <span class="attack-name">${esc(target.name)}</span>
        ${number}
        ${result}${action}${effects}
      </div>`;
    }
    if (damaging) {
      const waiting = attack.targets.filter((x) => x.hit && !x.applied);
      // "All hits" applies each target's own damage, so the tooltip shows the base.
      if (waiting.length > 1) {
        body += buttons('all', attack.damage, t('CARL_RPG.Attack.ApplyAll'));
      }
    }
  }
  // Events that fired for this attack: the GM sees them, one line each.
  if (isGM && attack.fired?.length) {
    body += attack.fired.map((line) => `<p class="attack-note attack-fired">${esc(line)}</p>`).join('');
  }
  list.innerHTML = body;
  host.append(list);

  for (const el of list.querySelectorAll('.carl-mob-roll')) {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      // Stop a second click while this one is being answered.
      list.querySelectorAll('.carl-mob-roll').forEach((b) => (b.disabled = true));
      await resolveMobTarget(
        message,
        Number(el.dataset.index),
        el.dataset.skip === '1',
        event.shiftKey
      );
      // (If the pop-up was cancelled nothing was answered, so allow another try.)
      list.querySelectorAll('.carl-mob-roll').forEach((b) => (b.disabled = false));
    });
  }

  for (const el of list.querySelectorAll('.carl-apply-effect')) {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      el.disabled = true;
      const attack = foundry.utils.deepClone(message.getFlag(NS, 'attack'));
      const row = attack.targets[Number(el.dataset.index)];
      const entry = row?.effects?.find((e) => e.id === el.dataset.effect);
      if (!entry || entry.applied) return;
      if (await applyQueuedEffect(entry, actorOfRow(row))) {
        entry.applied = true;
        await message.setFlag(NS, 'attack', attack);
      } else {
        el.disabled = false;
      }
    });
  }

  for (const el of list.querySelectorAll('.carl-undo-damage')) {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      el.disabled = true;
      await undoAttackDamage(message, Number(el.dataset.index));
    });
  }

  for (const el of list.querySelectorAll('.carl-apply-damage')) {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      // Stop a second click while this one is being applied.
      list.querySelectorAll('.carl-apply-damage').forEach((b) => (b.disabled = true));
      await applyAttackDamage(
        message,
        el.dataset.which,
        Number(el.dataset.multiplier)
      );
    });
  }
}

export function registerAttacks() {
  Hooks.on('renderChatMessageHTML', renderAttackCard);

  // When a combat ends, the crawlers who were badly hurt by a mob get their
  // injuries (one GM client does it).
  Hooks.on('deleteCombat', async (combat) => {
    if (game.user !== game.users.activeGM) return;
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      const counts = combatant.getFlag(NS, 'injuries');
      if (!actor || !counts) continue;
      for (const [severity, times] of Object.entries(counts)) {
        // Each time counts: a second one lengthens the first.
        for (let i = 0; i < times; i++) await applyInjury(actor, severity);
      }
    }
  });
  // A player's answer to a mob's check, recorded by the GM's client.
  Hooks.on('createChatMessage', (message) => {
    const relay = message.getFlag(NS, 'mobCheckRelay');
    if (relay && game.user === game.users.activeGM) {
      handleMobRelay(message, relay);
    }
  });
}
