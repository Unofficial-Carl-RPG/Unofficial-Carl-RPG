/**
 * Rests.
 *
 * Each crawler takes their own rests from small buttons on their sheet, and the
 * GM can also rest the whole party from the Dungeon Info tab. A rest:
 *
 *  - recovers health and mana (CONFIG.CARL_RPG.restRecovery): a short rest heals
 *    5 health boxes and gives back half of the crawler's total mana (rounded
 *    down); a long or full rest restores both completely, and
 *  - ends the effects that last until that rest or a shorter one (the injuries,
 *    see helpers/attacks.mjs, last "until a short / long / full rest": a long
 *    rest ends effects that last until a short or a long rest, and a full rest
 *    ends them all). An effect's length is `flags.carl-rpg.lastsUntil`.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { runActorEvents, runFloorRules } from './events.mjs';
import { RECHARGE_BY_REST, restoreUses } from './uses.mjs';
import { passRestHours } from './damage-effects.mjs';
import { canActOutsideSafeRoom } from './floor.mjs';

const NS = 'carl-rpg';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => foundry.utils.escapeHTML(text);

/**
 * End one actor's effects that last until a rest (or a shorter one).
 * @param {Actor} actor
 * @param {'short'|'long'|'full'} rest
 * @returns {Promise<string[]>}  The names of the effects that ended
 */
async function endEffects(actor, rest) {
  const order = CONFIG.CARL_RPG.rests;
  const rank = order.indexOf(rest);
  const effects = actor.effects.filter((effect) => {
    const until = order.indexOf(effect.getFlag(NS, 'lastsUntil'));
    return until >= 0 && until <= rank;
  });
  if (!effects.length) return [];
  await actor.deleteEmbeddedDocuments(
    'ActiveEffect',
    effects.map((effect) => effect.id)
  );
  return effects.map((effect) => effect.name);
}

/**
 * Give a crawler back the health and mana a rest recovers.
 * @param {Actor} actor
 * @param {'short'|'long'|'full'} rest
 * @returns {Promise<{health: number, mana: number}>}  How much was actually recovered
 */
async function recover(actor, rest) {
  const rule = CONFIG.CARL_RPG.restRecovery[rest];
  const health = actor.system.health;
  const mana = actor.system.mana;
  if (!rule || !health || !mana) return { health: 0, mana: 0 };

  // Health boxes: a number of them, or all.
  const healthTo =
    rule.health === 'full'
      ? health.max
      : Math.min(health.max, health.value + rule.health);
  // Mana: a fraction of the total (rounded down), or all.
  const manaMax = mana.maxTotal ?? 0;
  const manaTo =
    rule.mana === 'full'
      ? manaMax
      : Math.min(manaMax, mana.value + Math.floor(manaMax * rule.mana));

  // Never lower what they already have (mana can be above its maximum).
  const newHealth = Math.max(health.value, healthTo);
  const newMana = Math.max(mana.value, manaTo);
  const gained = {
    health: newHealth - health.value,
    mana: newMana - mana.value,
  };
  if (gained.health || gained.mana) {
    await actor.update({
      'system.health.value': newHealth,
      'system.mana.value': newMana,
    });
  }
  return gained;
}

/** What a rest did for one crawler, as a line of chat text. */
function summary(gained, ended) {
  const parts = [];
  if (gained.health) {
    parts.push(t('CARL_RPG.Rest.Healed', { health: gained.health }));
  }
  if (gained.mana) {
    parts.push(t('CARL_RPG.Rest.ManaBack', { mana: gained.mana }));
  }
  if (ended.length) {
    parts.push(`${t('CARL_RPG.Rest.Ended')} ${ended.map(esc).join(', ')}`);
  }
  return parts.join(' ');
}

/**
 * A crawler takes a rest: they recover health and mana, the effects that last
 * until it (or a shorter rest) end, and chat says so. The crawler's owner (or
 * the GM) does this from the sheet.
 * @param {Actor} actor
 * @param {'short'|'long'|'full'} rest
 */
export async function restActor(actor, rest) {
  if (!actor?.isOwner || !CONFIG.CARL_RPG.rests.includes(rest)) return;
  if (!canActOutsideSafeRoom('rest')) {
    ui.notifications.warn(t('CARL_RPG.Floor.RestsBlocked'));
    return;
  }
  const gained = await recover(actor, rest);
  const ended = await endEffects(actor, rest);
  await restoreUses(actor, RECHARGE_BY_REST[rest]);
  await passRestHours(actor, rest);
  const title = t(`CARL_RPG.Rest.TakenBy.${rest}`, { name: esc(actor.name) });
  const text = summary(gained, ended);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<strong>${title}</strong>${text ? `<br>${text}` : ''}`,
  });
  await runActorEvents(actor, 'restTaken', { rest });
  await runFloorRules('restTaken', { rest });
}

/**
 * The whole party takes a rest: every crawler (GM only).
 * @param {'short'|'long'|'full'} rest
 */
export async function takeRest(rest) {
  if (!game.user.isGM) return;
  if (!CONFIG.CARL_RPG.rests.includes(rest)) return;

  const lines = [];
  for (const actor of game.actors) {
    // (Crawlers and their pets.)
    if (!['crawler', 'pet'].includes(actor.type)) continue;
    const gained = await recover(actor, rest);
    const ended = await endEffects(actor, rest);
    await restoreUses(actor, RECHARGE_BY_REST[rest]);
    await passRestHours(actor, rest);
    const text = summary(gained, ended);
    if (text) lines.push(`<br><em>${esc(actor.name)}</em>: ${text}`);
  }
  await ChatMessage.create({
    content: `<strong>${t(`CARL_RPG.Rest.Taken.${rest}`)}</strong>${lines.join('')}`,
  });
  // The rest is over: now the "a rest is taken" events (they see the recovered state).
  for (const actor of game.actors) {
    if (['crawler', 'pet'].includes(actor.type)) {
      await runActorEvents(actor, 'restTaken', { rest });
    }
  }
  await runFloorRules('restTaken', { rest });
}

/**
 * Ask first, then rest: one crawler if an actor is given, otherwise the whole
 * party (GM only).
 * @param {'short'|'long'|'full'} rest
 * @param {Actor} [actor]
 */
export async function confirmRest(rest, actor = null) {
  if (!canActOutsideSafeRoom('rest')) {
    ui.notifications.warn(t('CARL_RPG.Floor.RestsBlocked'));
    return;
  }
  const name = t(`CARL_RPG.Rest.Name.${rest}`);
  const ok = await CarlRPGDialog.confirm({
    window: { title: name },
    content: `<p>${
      actor
        ? t('CARL_RPG.Rest.ConfirmOne', { name: esc(actor.name), rest: name })
        : t('CARL_RPG.Rest.Confirm', { rest: name })
    }</p><p><em>${t(`CARL_RPG.Rest.Recovers.${rest}`)}</em></p>`,
    rejectClose: false,
  });
  if (!ok) return;
  if (actor) await restActor(actor, rest);
  else await takeRest(rest);
}
