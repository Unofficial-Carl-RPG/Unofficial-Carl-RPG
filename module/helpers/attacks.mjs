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
import { rankOf } from './skill-rank.mjs';
import { applyQueuedEffect, runEvents } from './events.mjs';
import { effectiveOf } from './upgrades.mjs';
import { damageNumbers, marginOf } from './event-roll.mjs';
import { expandRankDamage } from './rank-damage.mjs';
import { damageRollData, withCost } from './cost-damage.mjs';
import { swapStat } from './build-damage.mjs';
import { damageTypeLabel, damageTypes, partsLabel, partsTotal, scaleParts } from './damage-types.mjs';
import { bonusFormula, chosenTypes, manualMultiplier } from './damage-options.mjs';
import { offerAiFavor } from './ai-favor.mjs';
import { promptRoll, promptDamage, buildFormula, optionsNote } from './roll-dialog.mjs';
import { applyBenefits, rollBenefits } from './build-mods.mjs';
import { badgeRowHtml } from './item-badges.mjs';
import { appliesTo, diceSumOf, hasFilters, healthPercentOf } from './damage-effects.mjs';
import { targetMet } from './roll-mods.mjs';
import { attackerToken, tokenDistanceFeet } from './distance.mjs';
import {
  critReplaces,
  multiplierFor,
  multiplierNote,
  targetDamage,
} from './damage-multiply.mjs';

/**
 * The top of a check or attack card: a badge saying what kind of check it is and what
 * it is against; a damage roll's heading stays bold text.
 */
function checkHeadingHtml(heading, damaging) {
  const inner = damaging
    ? `<strong>${esc(heading)}</strong>`
    : badgeRowHtml([esc(heading)]);
  return `<div class="carl-attack-card">${inner}</div>`;
}

const NS = 'carl-rpg';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => Handlebars.escapeExpression(text);

/** The degrees of success that count as a hit. */
const HITS = ['critHit', 'amazing', 'success'];

/** Whether an item has a damage formula. */
const hasDamage = (item) => !!effectiveOf(item).damage?.trim();

/** The heading of a damage roll: the damage, its type and whether it is Armor-Piercing. */
function damageHeading(item, damage, parts = null, over = null) {
  // (`over` holds the type and Armor-Piercing a damage roll used when the window changed them)
  const { damageType, armorPiercing } = over ?? effectiveOf(item);
  let text = t('CARL_RPG.Attack.Damage', { damage });
  // Typed bonus dice: the damage by type instead of the attack's one type.
  if (parts) text += ` (${partsLabel(parts)})`;
  else if (damageType) text += ` ${damageTypeLabel(damageType)}`;
  if (armorPiercing) text += ` (${t('CARL_RPG.Damage.ArmorPiercing')})`;
  return text;
}

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
 * Roll an attack's damage and put each target's numbers on the card's rows (the rows are
 * changed in place). Used when an attack resolves with its damage already rolled, and when the
 * card's Roll Damage button rolls it later (see rollAttackDamage).
 * @param {Item} item
 * @param {object} c
 * @param {Actor|null} c.owner
 * @param {{doc: TokenDocument|null, actor: Actor|null, row: object}[]} c.entries  Each target with
 *   its card row (the degree is already on it, a row only in the splash is marked `splash`)
 * @param {number|null} c.natural  The natural d20
 * @param {boolean} c.crit
 * @param {string} c.type  The kind of check ('unopposed', 'attack' or 'opposed')
 * @param {string|null} c.unopposedDegree
 * @param {{item: Item, option: boolean}|null} [c.damageEffect]
 * @param {object[]} [c.modDice]  The bonus dice (Roll Modifiers, build benefits)
 * @param {object} [c.paid]  What the use paid (damage formulas read it as @cost)
 * @param {object[]} [c.multipliers]
 * @param {{from: string, to: string}|null} [c.statSwap]
 * @param {{bonus?: {formula: string}|null, multiplier?: string|number, type?: string, also?: string,
 *   ignoreDR?: boolean}|null} [c.manual]  What the damage window changed (see damage-options.mjs)
 * @returns {Promise<object|null>}  The rolls and numbers for the card; null if the damage could
 *   not be rolled (a warning was shown)
 */
async function rollRowsDamage(item, c) {
  const {
    owner,
    entries,
    natural,
    crit,
    type,
    unopposedDegree,
    damageEffect = null,
    modDice = [],
    paid = {},
    multipliers = [],
    statSwap = null,
    manual = null,
  } = c;
  const effectItem = damageEffect?.item ?? null;
  const rules = effectItem?.system?.damageRules ?? null;
  // (what damage formulas read: the owner's stats and @cost, what this use cost)
  const rollData = damageRollData(owner?.getRollData(), paid);
  // A multiplier for a Critical Hit takes the place of the critical's x2 on the item's own dice.
  const critReplaced = crit && critReplaces(multipliers);
  // What the damage window changed: bonus dice join the Roll Modifiers' (always, untyped), a
  // multiplier multiplies the item's own, the types replace the item's, Ignore DR is Armor-Piercing.
  const dice = [
    ...modDice,
    ...(manual?.bonus?.formula
      ? [{ item: null, name: t('CARL_RPG.DamageDialog.BonusName'), formula: manual.bonus.formula, when: '', types: [] }]
      : []),
  ];
  const manualMult = manualMultiplier(manual?.multiplier);
  const { damageType: ownType, damageTypeAlso: alsoType } = chosenTypes(manual ?? {}, {
    type: effectiveOf(item).damageType ?? '',
    also: effectiveOf(item).damageTypeAlso ?? '',
  });
  const armorPiercing = manual ? !!manual.ignoreDR : !!effectiveOf(item).armorPiercing;

  // The damage is rolled once. On a natural 20 the dice are doubled; stats and
  // other flat modifiers are left alone.
  let damageRoll = null;
  let damage = null;
  // What the effect adds: the dice of the damage, and its extra dice (rolled once).
  let diceSum = 0;
  let extra = 0;
  let extraRoll = null;
  // The dice Roll Modifiers add, once rolled.
  const modRolled = [];
  // The effect's dice that carry a damage type of their own, once rolled.
  const effectTyped = [];
  try {
    damageRoll = new Roll(
      withCost(expandRankDamage(swapStat(effectiveOf(item).damage, statSwap), item)),
      rollData
    );
    if (crit && !critReplaced) damageRoll = damageRoll.alter(2, 0);
    await damageRoll.evaluate();
    damage = Math.max(0, Math.floor(damageRoll.total));
    diceSum = diceSumOf(damageRoll);
    const extraFormulas = (rules?.addDice ?? [])
      .map((formula) => withCost(expandRankDamage(formula, effectItem)))
      .filter(Boolean);
    if (extraFormulas.length) {
      extraRoll = new Roll(extraFormulas.join(' + '), rollData);
      if (crit) extraRoll = extraRoll.alter(2, 0);
      await extraRoll.evaluate();
      extra = Math.max(0, Math.floor(extraRoll.total));
    }
    // Its dice with a damage type of their own are rolled once each, apart from the base.
    for (const row of rules?.typedDice ?? []) {
      const formula = withCost(expandRankDamage(row.formula, effectItem));
      if (!formula) continue;
      let typedRoll = new Roll(formula, rollData);
      if (crit) typedRoll = typedRoll.alter(2, 0);
      await typedRoll.evaluate();
      effectTyped.push({
        types: row.types,
        roll: typedRoll,
        total: Math.max(0, Math.floor(typedRoll.total)),
      });
    }
    // Each Roll Modifier row is rolled once (a natural 20 doubles it like the damage) and
    // added to the targets its condition allows.
    for (const entry of dice) {
      const formula = withCost(expandRankDamage(entry.formula, entry.item));
      if (!formula) continue;
      let modRoll = new Roll(formula, rollData);
      if (crit) modRoll = modRoll.alter(2, 0);
      await modRoll.evaluate();
      modRolled.push({ ...entry, roll: modRoll, total: Math.max(0, Math.floor(modRoll.total)) });
    }
  } catch (err) {
    ui.notifications.warn(t('CARL_RPG.Attack.BadDamage', { name: item.name }));
    return null;
  }
  // Splash: a target only in the splash of an area takes the splash damage instead of the
  // damage (rolled once; a natural 20 doubles its dice). No formula means no damage.
  const splashEffects = !!item.system.targeting?.splashEffects;
  let splashRoll = null;
  let splashDamage = null;
  if (
    hasSplashDamage(item.system.targeting?.splashDamage) &&
    entries.some((x) => x.row.splash)
  ) {
    try {
      splashRoll = new Roll(
        withCost(expandRankDamage(item.system.targeting.splashDamage, item)),
        rollData
      );
      if (crit) splashRoll = splashRoll.alter(2, 0);
      await splashRoll.evaluate();
      splashDamage = Math.max(0, Math.floor(splashRoll.total));
    } catch (err) {
      splashRoll = null;
      ui.notifications.warn(t('CARL_RPG.Attack.BadDamage', { name: item.name }));
    }
  }
  const floor = getFloor();
  const effectRank = rankOf(effectItem?.system);

  // What the Roll Modifiers' dice add for a degree of success. The headline counts them as for
  // a hit (or the unopposed result), as there is no target yet to read a degree from.
  // (Dice with a damage type of their own are kept apart: see typedFor.)
  const untyped = (d) => !d.types?.length;
  const modTotalFor = (degree, feet) =>
    modRolled.reduce(
      (sum, d) => sum + (untyped(d) && targetMet(d, { degree, feet }) ? d.total : 0),
      0
    );
  // The typed dice that count for one target: the Damage Effect's, when it works against the
  // target (after its multiplier), and the Roll Modifiers' that its degree allows.
  const effectMultiplier = rules?.totalMultiplier ?? 1;
  const typedFor = (degree, applies, feet) => [
    ...(rules && applies
      ? effectTyped.map((d) => ({ types: d.types, amount: Math.floor(d.total * effectMultiplier) }))
      : []),
    ...modRolled
      .filter((d) => !untyped(d) && targetMet(d, { degree, feet }))
      .map((d) => ({ types: d.types, amount: d.total })),
  ];
  // The multipliers (helpers/damage-multiply.mjs) read for a degree of success; the one typed in
  // the damage window multiplies the total on top of them.
  const multFor = (degree, feet) => {
    const found = multiplierFor(multipliers, degree, feet);
    return { base: found.base, total: found.total * manualMult };
  };
  // A target's damage: the number, and the parts by type when typed dice are in it (the
  // parts are what resistances read; with none, damage works exactly as it always did). `feet`
  // is how far the target is from the attacker, for the "within" conditions.
  const damageFor = (degree, applies, { bonus = 0, multDegree = degree, feet = null } = {}) =>
    targetDamage({
      damage,
      diceSum,
      extra,
      bonus,
      rules,
      rank: effectRank,
      applies,
      modTotal: modTotalFor(degree, feet),
      typed: typedFor(degree, applies, feet),
      ownType,
      alsoType,
      mult: multFor(multDegree, feet),
    });
  // With no filters the effect works against everyone, so the card's headline shows it.
  const headlineApplies = !!rules && !hasFilters(rules);
  // (With nothing to read a degree from, the headline counts as a hit, or a Critical Hit on a
  // natural 20, for the multipliers.)
  const headlineMult = unopposedDegree ?? (crit ? 'critHit' : 'success');
  // How far each target is from the attacker (null when it can't be measured: no token). The
  // headline has no target of its own, so it counts the nearest one.
  const attackerDoc = attackerToken(owner);
  const feetTo = (doc) => (doc ? tokenDistanceFeet(attackerDoc, doc) : null);
  const reaches = entries.map(({ doc }) => feetTo(doc)).filter((feet) => feet !== null);
  const headlineFeet = reaches.length ? Math.min(...reaches) : null;
  const headlineDamage = damageFor(unopposedDegree ?? 'success', headlineApplies, {
    multDegree: headlineMult,
    feet: headlineFeet,
  });

  for (const { doc, actor, row } of entries) {
    // Whether the Damage Effect works against this target (see damage-effects.mjs).
    const applies =
      !!rules &&
      !!actor &&
      appliesTo(rules, {
        attackerSize: owner ? sizeClassOf(owner) : 0,
        targetSize: sizeClassOf(actor),
        healthPct: healthPercentOf(actor),
      });
    // An Amazing Success adds the Floor to the damage.
    const dealt = damageFor(row.degree, applies, {
      bonus: row.degree === 'amazing' ? floor : 0,
      feet: feetTo(doc),
    });
    row.damage = dealt.damage;
    // The damage by type, when typed bonus dice are in it (resistances read each part).
    if (dealt.parts) row.parts = dealt.parts;
    else delete row.parts;
    row.effectApplied = applies;
  }

  // A target in the splash takes the splash damage (no Damage Effect or Roll Modifier dice),
  // plus the Floor on an Amazing Success when there is splash damage. Its effects are not
  // worked against (see evented for the events).
  for (const { row } of entries) {
    if (!row.splash) continue;
    row.effectApplied = false;
    delete row.parts; // (splash damage takes no bonus dice)
    row.damage = splashDamage == null ? 0 : splashDamage + (row.degree === 'amazing' ? floor : 0);
  }

  const usedNames = [effectItem?.name, ...new Set(modRolled.map((d) => d.name))].filter(Boolean);
  return {
    headline: headlineDamage.damage,
    headlineDamage,
    headlineMult,
    // The multipliers the card heading names (the item's own and the one typed in the window).
    headlineMultNote: multiplierNote(multFor(headlineMult, headlineFeet)),
    base: damage,
    diceSum,
    damageType: ownType,
    armorPiercing,
    usedEffect: usedNames.length ? ` (${usedNames.join(', ')})` : '',
    rolls: [
      damageRoll,
      ...(extraRoll ? [extraRoll] : []),
      ...effectTyped.map((d) => d.roll),
      ...modRolled.map((d) => d.roll),
      ...(splashRoll ? [splashRoll] : []),
    ],
    // Whether the Damage Effect changed the attack: it worked against a target that was hit
    // (or, with no targets, it has no filters). That is what starts its cooldown.
    effectApplied:
      !!rules &&
      (entries.length
        ? entries.some(({ row }) => row.effectApplied && row.hit)
        : !hasFilters(rules)),
    splashEffects,
  };
}

/**
 * The targets an attack's events run for: the hits (with their damage) and the misses. A
 * target only in the splash of an area counts only when the item's splash applies effects.
 */
function eventLists(entries, rollTotal, splashEffects) {
  const evented = (row) => !row.splash || splashEffects;
  const marginFor = (row) => (rollTotal != null ? marginOf(rollTotal, row.dc) : undefined);
  return {
    evented,
    hits: entries.flatMap(({ actor, doc, row }) =>
      row.hit && evented(row)
        ? [
            {
              actor,
              token: doc,
              degree: row.degree,
              effect: row.effectApplied,
              margin: marginFor(row),
              damage: row.damage,
            },
          ]
        : []
    ),
    misses: entries.flatMap(({ actor, doc, row }) =>
      row.hit || !evented(row)
        ? []
        : [{ actor, token: doc, degree: row.degree, margin: marginFor(row) }]
    ),
  };
}

/**
 * Resolve an item's check: work out the degree of success against each target
 * (or against the Floor for an unopposed check), roll the damage if the item
 * has any, and post the result card.
 *
 * With `deferDamage` (a click on the item) the damage is not rolled yet: the card shows the
 * degrees and a Roll Damage button, and rollAttackDamage rolls it from the damage window.
 * @param {Item} item
 * @param {Roll|null} roll  The roll (null if the item doesn't roll: any damage simply hits)
 * @param {{damageEffect?: {item: Item, option: boolean}|null, modDice?: object[], splash?: string[],
 *   paid?: object, deferDamage?: object|null}} [options]
 *   The Damage Effect the roller chose (see helpers/damage-effects.mjs); its option trades the
 *   damage away. modDice are the damage dice Roll Modifiers add (see helpers/roll-mods.mjs).
 *   splash lists the token UUIDs that are only in the splash of an area (helpers/splash.mjs);
 *   paid is what the use cost, which damage formulas read as @cost (helpers/cost-damage.mjs).
 *   multipliers are the damage multipliers in play (helpers/damage-multiply.mjs);
 *   statSwap is {from, to}: the damage formula adds the `to` stat's modifier in place of the
 *   `from` stat's (a build benefit, helpers/build-damage.mjs).
 *   deferDamage holds what the damage roll needs to remember of this use (mode, surprise,
 *   rollModUuid, rolled: the numbers events read); null rolls the damage now.
 * @returns {Promise<{degrees: string[], margin?: number, damage: object|null, hits: Array<{actor: Actor, degree: string, margin?: number, damage: number|null}>}|null>}
 *   null if there is nothing to resolve. margin is an unopposed check's; damage the use's numbers
 *   for events (see helpers/event-roll.mjs); each hit and miss has its own margin, a hit its damage.
 *   A deferred use has `deferred: true`, no damage and no hits (they run once the damage is rolled).
 */
export async function resolveCheck(
  item,
  roll,
  {
    damageEffect = null,
    modDice = [],
    splash = [],
    paid = {},
    multipliers = [],
    statSwap = null,
    deferDamage = null,
  } = {}
) {
  // Mobs never roll a d20: a crawler rolls against the mob's number instead.
  if (item.actor?.type === 'mob') return resolveMobCheck(item, splash, { deferDamage });
  // An item whose action is No Roll has no check or damage to resolve.
  if (item.system.action?.type === 'none') return null;

  // A Damage Effect the roller chose. Its "instead of damage" option (Iron Punch's stun)
  // means no damage is rolled at all.
  const effectItem = damageEffect?.item ?? null;
  const rules = effectItem?.system?.damageRules ?? null;
  const skipDamage = !!(rules?.stunOption && damageEffect?.option);
  const damaging = hasDamage(item) && !skipDamage;
  if (!roll && !damaging) return null;
  const deferred = damaging && !!deferDamage;

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

  const floor = getFloor();
  const splashIds = new Set(splash);
  const splashEffects = !!item.system.targeting?.splashEffects;

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
      damage: null,
      effectApplied: false,
      applied: false,
      // (a token only in the splash of an area)
      ...(splashIds.has(doc.uuid) ? { splash: true } : {}),
    };
  });
  const entries = targets.map((x, i) => ({ ...x, row: rows[i] }));

  // The damage, unless it waits for the Roll Damage button.
  let dmg = null;
  if (damaging && !deferred) {
    dmg = await rollRowsDamage(item, {
      owner,
      entries,
      natural,
      crit,
      type,
      unopposedDegree,
      damageEffect,
      modDice,
      paid,
      multipliers,
      statSwap,
    });
    if (!dmg) return null;
  }

  // What an opposed check is against, in words: a stat or the Size Class.
  const targetLabel = t(CONFIG.CARL_RPG.checkTargets[targetKey] ?? '');
  const usedNames = [effectItem?.name].filter(Boolean);
  const usedEffect = dmg ? dmg.usedEffect : usedNames.length ? ` (${usedNames.join(', ')})` : '';
  const heading =
    (dmg
      ? damageHeading(item, dmg.headline, dmg.headlineDamage?.parts ?? null, dmg) + dmg.headlineMultNote
      : t(`CARL_RPG.Check.Header.${type}`, { stat: targetLabel })) + usedEffect;
  const check = {
    itemName: item.name,
    type,
    damage: dmg ? dmg.headline : null,
    ...(dmg?.headlineDamage?.parts ? { parts: dmg.headlineDamage.parts } : {}),
    damageType: dmg ? dmg.damageType : (effectiveOf(item).damageType ?? ''),
    armorPiercing: dmg ? dmg.armorPiercing : !!effectiveOf(item).armorPiercing,
    floor,
    natural,
    crit,
    dc: unopposedDC,
    degree: unopposedDegree,
    targets: rows,
    // The damage waits for the card's Roll Damage button; this is what it needs to remember.
    ...(deferred
      ? {
          damagePending: true,
          pending: {
            ...deferDamage,
            itemUuid: item.uuid,
            paid,
            splash: [...splashIds],
            natural,
            rollTotal: roll?.total ?? null,
          },
        }
      : {}),
  };
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    rolls: dmg ? dmg.rolls : [],
    content: checkHeadingHtml(heading, !!dmg),
    sound: dmg ? CONFIG.sounds.dice : undefined,
    flags: { [NS]: { attack: check } },
  });

  // The degrees of success for the events: one for each target, the one result
  // of an unopposed check, or, with nothing to compare, what the natural roll
  // alone decides.
  // (A target in the splash runs the events only when the item says its splash does.)
  const lists = eventLists(entries, roll?.total ?? null, splashEffects);
  const degrees = rows.some(lists.evented)
    ? rows.filter(lists.evented).map((row) => row.degree)
    : unopposedDegree
      ? [unopposedDegree]
      : fromNatural;
  return {
    degrees,
    // What events read as @roll.margin (unopposed) and @damage.* (see helpers/event-roll.mjs).
    margin: unopposedDC !== null && roll ? marginOf(roll.total, unopposedDC) : undefined,
    damage: dmg ? damageNumbers({ base: dmg.base, dice: dmg.diceSum }, dmg.headline) : null,
    effectApplied: !!dmg?.effectApplied,
    // The hits wait for the damage when it does (see rollAttackDamage).
    hits: deferred ? [] : lists.hits,
    // The targets it didn't hit, for the "an attack misses a target" events.
    misses: lists.misses,
    deferred,
    // The attack card, where effects the events offer are shown (see helpers/events.mjs).
    message,
  };
}

/**
 * Roll the damage of an attack whose card is waiting for it (the card's Roll Damage button, see
 * resolveCheck's deferDamage): the damage is rolled with what the damage window changed, each
 * target's damage goes on the card, and the numbers the events need are handed back.
 * @param {ChatMessage} message  The attack card
 * @param {Item} item  The item that made the attack (a weapon already set up with its skill)
 * @param {{damageEffect?: {item: Item, option: boolean}|null, modDice?: object[],
 *   multipliers?: object[], statSwap?: object|null, manual?: object|null, notes?: string[]}} [options]
 *   notes are short lines the damage roll's message mentions (the Damage stat that was used)
 * @returns {Promise<{attack: object, pending: object, hits: object[], damage: object|null,
 *   effectApplied: boolean}|null>}  null if the damage was already rolled or could not be
 */
export async function rollAttackDamage(
  message,
  item,
  { damageEffect = null, modDice = [], multipliers = [], statSwap = null, manual = null, notes = [] } = {}
) {
  const attack = foundry.utils.deepClone(message.getFlag(NS, 'attack'));
  const pending = attack?.pending;
  if (!pending || !attack.damagePending) return null;
  const owner = item.actor;
  const rules = damageEffect?.item?.system?.damageRules ?? null;
  // The Damage Effect's "instead of damage" option (a stun): nothing is rolled.
  const skipDamage = !!(rules?.stunOption && damageEffect?.option);

  const entries = attack.targets.map((row) => ({
    doc: fromUuidSync(row.tokenUuid) ?? null,
    actor: actorOfRow(row),
    row,
  }));
  const crit = pending.natural === 20;
  let dmg = null;
  if (!skipDamage) {
    dmg = await rollRowsDamage(item, {
      owner,
      entries,
      natural: pending.natural ?? null,
      crit,
      type: attack.type,
      unopposedDegree: attack.degree ?? null,
      damageEffect,
      modDice,
      paid: pending.paid ?? {},
      multipliers,
      statSwap,
      manual,
    });
    if (!dmg) return null;
  }

  // With the stun option no damage is rolled, but the effect still works against its targets.
  let stunApplied = false;
  if (skipDamage) {
    for (const { actor, row } of entries) {
      row.effectApplied =
        !!actor &&
        appliesTo(rules, {
          attackerSize: owner ? sizeClassOf(owner) : 0,
          targetSize: sizeClassOf(actor),
          healthPct: healthPercentOf(actor),
        });
    }
    stunApplied = entries.length
      ? entries.some(({ row }) => row.effectApplied && row.hit)
      : !hasFilters(rules);
  }

  // Claim the roll before anything is shown (a second click on the button finds it gone).
  const fresh = message.getFlag(NS, 'attack');
  if (!fresh?.damagePending) return null;
  attack.damagePending = false;
  if (dmg) {
    attack.damage = dmg.headline;
    if (dmg.headlineDamage?.parts) attack.parts = dmg.headlineDamage.parts;
    else attack.parts = null;
    attack.damageType = dmg.damageType;
    attack.armorPiercing = dmg.armorPiercing;
  }
  const targetLabel = t(CONFIG.CARL_RPG.checkTargets[effectiveOf(item).target] ?? '');
  const usedEffect = dmg
    ? dmg.usedEffect
    : damageEffect?.item
      ? ` (${damageEffect.item.name})`
      : '';
  const heading =
    (dmg
      ? damageHeading(item, dmg.headline, dmg.headlineDamage?.parts ?? null, dmg) + dmg.headlineMultNote
      : t(`CARL_RPG.Check.Header.${attack.type}`, { stat: targetLabel })) + usedEffect;
  await message.update({
    content: checkHeadingHtml(heading, !!dmg),
    flags: { [NS]: { attack } },
  });

  // The dice get a message of their own, so they roll on everyone's screen.
  if (dmg) {
    const rolls = dmg.rolls;
    const html = (await Promise.all(rolls.map((r) => r.render()))).join('');
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: owner }),
      flavor:
        t('CARL_RPG.DamageDialog.Flavor', { name: item.name }) +
        (notes.length ? ` (${notes.map(esc).join('; ')})` : ''),
      content: html,
      rolls,
      sound: CONFIG.sounds.dice,
    });
  }

  const lists = eventLists(entries, pending.rollTotal ?? null, !!item.system.targeting?.splashEffects);
  return {
    attack,
    pending,
    hits: lists.hits,
    damage: dmg ? damageNumbers({ base: dmg.base, dice: dmg.diceSum }, dmg.headline) : null,
    effectApplied: !!dmg?.effectApplied || stunApplied,
    skipped: skipDamage,
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

/** A splash row's damage on a mob's card: none without a splash formula, else as mobDamage. */
const splashMobDamage = (base, degree, floor) => (base == null ? 0 : mobDamage(base, degree, floor));

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
async function resolveMobCheck(item, splash = [], { deferDamage = null } = {}) {
  const targetKey = effectiveOf(item).target;
  const type = checkKind(targetKey);
  const damaging = hasDamage(item);
  // The damage waits for the card's Roll Damage button (see rollMobDamage).
  const deferred = damaging && !!deferDamage;
  const owner = item.actor;
  // A mob pinned to its own Floor uses that for its numbers (see the mob data model).
  const floor = owner?.type === 'mob' ? owner.system.floor : getFloor();
  const number = (item.system.check?.number ?? 0) + floor;

  let damageRoll = null;
  let damage = null;
  if (damaging && !deferred) {
    try {
      damageRoll = await new Roll(
        withCost(expandRankDamage(effectiveOf(item).damage, item)),
        damageRollData(owner?.getRollData())
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

  // Splash (see resolveCheck): rolled once, no crits for a mob.
  const splashIds = new Set(splash);
  const splashEffects = !!item.system.targeting?.splashEffects;
  let splashRoll = null;
  let splashDamage = null;
  if (
    damaging &&
    !deferred &&
    hasSplashDamage(item.system.targeting?.splashDamage) &&
    targets.some((x) => splashIds.has(x.doc.uuid))
  ) {
    try {
      splashRoll = await new Roll(
        withCost(expandRankDamage(item.system.targeting.splashDamage, item)),
        damageRollData(owner?.getRollData())
      ).evaluate();
      splashDamage = Math.max(0, Math.floor(splashRoll.total));
    } catch (err) {
      splashRoll = null;
      ui.notifications.warn(t('CARL_RPG.Attack.BadDamage', { name: item.name }));
    }
  }

  // Unopposed: one number to reach, whoever is targeted.
  const unopposedDC = type === 'unopposed' ? checkDC(item, null) : null;
  const unopposedDegree =
    type === 'unopposed' ? degreeOf(null, number, unopposedDC) : null;

  const rows = targets.map(({ doc, actor }) => {
    const inSplash = splashIds.has(doc.uuid);
    const base = {
      ...(inSplash ? { splash: true } : {}),
      tokenUuid: doc.uuid,
      actorUuid: actor.uuid,
      name: doc.name,
      isMob: actor.type === 'mob',
      applied: false,
    };
    // A crawler (or pet) answers a mob's attack (or stat or Size Class check) by rolling.
    if (type !== 'unopposed' && actor.type !== 'mob') {
      return {
        ...base,
        state: 'pending',
        degree: null,
        hit: null,
        damage: deferred ? null : inSplash ? (splashDamage ?? 0) : damage,
      };
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
      damage: deferred
        ? null
        : inSplash
          ? splashMobDamage(splashDamage, degree, floor)
          : mobDamage(damage, degree, floor),
    };
  });

  const check = {
    itemName: item.name,
    itemUuid: item.uuid,
    mob: true,
    targetKey,
    damageType: effectiveOf(item).damageType ?? '',
    armorPiercing: !!effectiveOf(item).armorPiercing,
    type,
    number,
    damage,
    splashDamage,
    floor,
    natural: null,
    crit: false,
    dc: unopposedDC,
    degree: unopposedDegree,
    targets: rows,
    ...(deferred
      ? { damagePending: true, pending: { itemUuid: item.uuid, splash: [...splashIds] } }
      : {}),
  };
  const heading =
    damaging && !deferred
      ? damageHeading(item, damage)
      : t(`CARL_RPG.Check.Header.${type}`, { stat: defenseLabel(targetKey) });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    rolls: [damageRoll, splashRoll].filter(Boolean),
    content: checkHeadingHtml(heading, damaging && !deferred),
    sound: damageRoll ? CONFIG.sounds.dice : undefined,
    flags: { [NS]: { attack: check } },
  });

  // Crawlers are still to roll; their hits run the events when they resolve.
  // (A target in the splash runs the events only when the item says its splash does.)
  const evented = (row) => !row.splash || splashEffects;
  const degrees = rows.filter(evented).flatMap((row) => (row.degree ? [row.degree] : []));
  return {
    degrees: degrees.length || !unopposedDegree ? degrees : [unopposedDegree],
    // (a deferred attack runs its hit events once the damage is rolled)
    hits: deferred
      ? []
      : targets.flatMap(({ actor }, i) =>
          rows[i].hit && evented(rows[i]) ? [{ actor, degree: rows[i].degree }] : []
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
    damage: attack.damagePending
      ? null
      : row.splash
        ? splashMobDamage(attack.splashDamage, degree, attack.floor)
        : mobDamage(attack.damage, degree, attack.floor),
    rolled,
    skipped,
    injury,
  });
  await message.setFlag(NS, 'attack', attack);

  const actor = actorOfRow(row);
  if (injury && actor) await markInjury(actor, injury);
  // (a hit waits for the damage when that is still to be rolled: see rollMobDamage)
  if (row.hit && !attack.damagePending) {
    const item = await fromUuid(attack.itemUuid);
    if (item && actor && (!row.splash || item.system.targeting?.splashEffects)) {
      await runEvents(item, 'hit', {
        target: actor,
        degree,
        depth: 0,
        attackMessage: message,
        // (the mob rolled no d20: only the damage the target takes)
        damage: { total: row.damage },
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
    // The crawler's build: advantage on that stat's checks, and check dice (see helpers/build-mods.mjs).
    const defendsWith = attack.targetKey in CONFIG.CARL_RPG.abilities ? attack.targetKey : null;
    options = applyBenefits(
      options,
      rollBenefits(actor, { stat: defendsWith, target: attack.targetKey })
    );
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

/**
 * Roll a mob attack's damage (the card's Roll Damage button; GM only, once every crawler has
 * answered). The damage window can add bonus damage, multiply it, change its type or make it
 * ignore DR. The dice are whispered to the GM, so players never see the numbers.
 * @param {ChatMessage} message  The mob's attack card
 * @param {{shift?: boolean}} [options]  Shift skips the window
 */
export async function rollMobDamage(message, { shift = false } = {}) {
  if (!game.user.isGM) return;
  const attack = foundry.utils.deepClone(message.getFlag(NS, 'attack'));
  if (!attack?.damagePending || !attack.pending) return;
  if (attack.targets.some((row) => row.state === 'pending')) {
    ui.notifications.warn(t('CARL_RPG.DamageDialog.WaitingForRolls'));
    return;
  }
  const item = await fromUuid(attack.pending.itemUuid);
  if (!item) {
    ui.notifications.warn(t('CARL_RPG.Attack.NotFound', { name: attack.itemName }));
    return;
  }
  const current = {
    type: effectiveOf(item).damageType ?? '',
    also: '',
    armorPiercing: !!effectiveOf(item).armorPiercing,
  };
  let manual = null;
  if (!shift) {
    const chosen = await promptDamage({
      title: item.name,
      types: damageTypes().map((d) => ({ id: d.id, label: d.label })),
      current,
      mob: true,
    });
    if (!chosen) return;
    const bonus = bonusFormula(chosen.bonus);
    if (bonus?.error) {
      ui.notifications.warn(t('CARL_RPG.DamageDialog.Invalid', { bonus: chosen.bonus }));
      return;
    }
    manual = { bonus, multiplier: chosen.multiplier, type: chosen.type, ignoreDR: chosen.ignoreDR };
  }
  const { damageType } = chosenTypes(manual ?? {}, { type: current.type, also: '' });
  const armorPiercing = manual ? !!manual.ignoreDR : current.armorPiercing;
  const multiplier = manualMultiplier(manual?.multiplier);
  const owner = item.actor;
  const floor = attack.floor;
  const rollData = damageRollData(owner?.getRollData());

  let damageRoll = null;
  let bonusRoll = null;
  let splashRoll = null;
  let splashDamage = null;
  try {
    damageRoll = await new Roll(
      withCost(expandRankDamage(effectiveOf(item).damage, item)),
      rollData
    ).evaluate();
    if (manual?.bonus) bonusRoll = await new Roll(manual.bonus.formula, rollData).evaluate();
  } catch (err) {
    ui.notifications.warn(t('CARL_RPG.Attack.BadDamage', { name: item.name }));
    return;
  }
  const base =
    Math.max(0, Math.floor(damageRoll.total)) +
    (bonusRoll ? Math.max(0, Math.floor(bonusRoll.total)) : 0);
  // Splash (see resolveMobCheck): rolled once, no crits for a mob.
  if (hasSplashDamage(item.system.targeting?.splashDamage) && attack.targets.some((row) => row.splash)) {
    try {
      splashRoll = await new Roll(
        withCost(expandRankDamage(item.system.targeting.splashDamage, item)),
        rollData
      ).evaluate();
      splashDamage = Math.max(0, Math.floor(splashRoll.total));
    } catch (err) {
      splashRoll = null;
      ui.notifications.warn(t('CARL_RPG.Attack.BadDamage', { name: item.name }));
    }
  }

  // Claim the roll before anything is shown (a second click on the button finds it gone).
  if (!message.getFlag(NS, 'attack')?.damagePending) return;
  for (const row of attack.targets) {
    // (a splash row is not multiplied, like the splash of any attack)
    row.damage = row.splash
      ? splashMobDamage(splashDamage, row.degree, floor)
      : Math.floor(mobDamage(base, row.degree, floor) * multiplier);
  }
  Object.assign(attack, { damage: base, splashDamage, damageType, armorPiercing, damagePending: false });
  const heading =
    damageHeading(item, base, null, { damageType, armorPiercing }) +
    multiplierNote({ base: 1, total: multiplier });
  await message.update({
    content: checkHeadingHtml(heading, true),
    flags: { [NS]: { attack } },
  });
  const rolls = [damageRoll, bonusRoll, splashRoll].filter(Boolean);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
    flavor: t('CARL_RPG.DamageDialog.Flavor', { name: item.name }),
    content: (await Promise.all(rolls.map((r) => r.render()))).join(''),
    rolls,
    sound: CONFIG.sounds.dice,
  });

  // The hits run the item's events now that there is damage (a splash row only when the
  // item's splash applies effects).
  for (const row of attack.targets) {
    if (!row.hit || (row.splash && !item.system.targeting?.splashEffects)) continue;
    const actor = actorOfRow(row);
    if (!actor) continue;
    await runEvents(item, 'hit', {
      target: actor,
      degree: row.degree,
      depth: 0,
      attackMessage: message,
      // (the mob rolled no d20: only the damage the target takes)
      damage: { total: row.damage },
    });
  }
}

/** The card's Roll Damage button: the mob's, or the item's own (see CarlRPGItem#rollDamage). */
async function rollDamageFromCard(message, shift) {
  const attack = message.getFlag(NS, 'attack');
  if (attack?.mob) return rollMobDamage(message, { shift });
  const item = attack?.pending?.itemUuid ? await fromUuid(attack.pending.itemUuid) : null;
  if (!item) {
    ui.notifications.warn(t('CARL_RPG.Attack.NotFound', { name: attack?.itemName ?? '' }));
    return;
  }
  return item.rollDamage(message, { shift });
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
import { hasSplashDamage } from './splash.mjs';

/** How an attack's damage is applied: Armor-Piercing skips DR, and the type is passed on. */
const hitOptions = (attack) => ({
  ignoreDR: !!attack.armorPiercing,
  damageType: attack.damageType ?? '',
});

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
    const parts = attack.parts ? scaleParts(attack.parts, multiplier) : null;
    const damage = parts ? partsTotal(parts) : scaled(attack.damage, multiplier);
    for (const token of game.user.targets) {
      await token.actor?.applyDamage(damage, { ...hitOptions(attack), parts });
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
    // (A target that evaded can still be given damage by hand: its own buttons, never "all".)
    if (!target || target.state === 'pending' || target.applied) continue;
    const doc = await fromUuid(target.tokenUuid);
    const actor = doc?.actor ?? (await fromUuid(target.actorUuid));
    if (!actor) {
      ui.notifications.warn(t('CARL_RPG.Attack.NotFound', { name: target.name }));
      continue;
    }
    // Each target has its own damage (an Amazing Success adds the Floor).
    const parts = target.parts ? scaleParts(target.parts, multiplier) : null;
    const damage = parts
      ? partsTotal(parts)
      : scaled(target.damage ?? attack.damage, multiplier);
    const undo = { before: actor.system.health.value, wasDying: !!dyingEffectOf(actor) };
    await actor.applyDamage(damage, { ...hitOptions(attack), parts });
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

/** A small note on a card row for a token that was only in the splash of the area. */
const splashTag = (target) =>
  target.splash ? ` <em class="attack-splash">${esc(t('CARL_RPG.Attack.Splash'))}</em>` : '';

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
          <span class="attack-name">${esc(target.name)}${splashTag(target)}</span>
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
        !damaging ||
        (target.splash && !target.damage) ||
        (!isGM && (target.applied || !target.hit))
          ? ''
          : target.applied
            ? `<span class="attack-applied">${esc(
                t('CARL_RPG.Attack.AppliedAmount', {
                  damage: target.appliedDamage ?? damage,
                })
              )}</span>`
            : `<span class="attack-damage">${esc(
                t('CARL_RPG.Attack.TargetDamage', { damage })
              )}</span>${
                target.parts
                  ? `<span class="attack-floor">${esc(`(${partsLabel(target.parts)})`)}</span>`
                  : ''
              }${buttons(i, damage)}`;
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
        <span class="attack-name">${esc(target.name)}${splashTag(target)}</span>
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
  // The damage waits for a click: the Roll Damage button (a mob's once every defending roll is in).
  if (attack.damagePending) {
    const waiting = attack.targets.some((row) => row.state === 'pending');
    const can = attack.mob ? isGM : isGM || message.canUserModify(game.user, 'update');
    if (can && !waiting) {
      body += `<div class="attack-roll-damage"><button type="button" class="carl-roll-damage" title="${esc(
        t('CARL_RPG.DamageDialog.ButtonTip')
      )}"><i class="fa-solid fa-burst"></i> ${esc(t('CARL_RPG.DamageDialog.Button'))}</button></div>`;
    }
  }
  // Events that fired for this attack: the GM sees them, one line each.
  if (isGM && attack.fired?.length) {
    body += attack.fired.map((line) => `<p class="attack-note attack-fired">${esc(line)}</p>`).join('');
  }
  list.innerHTML = body;
  host.append(list);

  for (const el of list.querySelectorAll('.carl-roll-damage')) {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      // Stop a second click while the window is open or the damage is being rolled.
      el.disabled = true;
      try {
        await rollDamageFromCard(message, event.shiftKey);
      } finally {
        el.disabled = false;
      }
    });
  }

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
