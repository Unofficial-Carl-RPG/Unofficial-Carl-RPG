/**
 * Loot from defeated mobs. The GM sets a mob's loot on its Loot tab: a junk
 * amount and a gold amount (each a number or dice, blank for none), and items
 * with a chance each (0 to 100). When a mob is defeated the GM clicks Loot (on
 * its sheet, or in the combat tracker) and picks the crawler: the system rolls
 * the junk, the gold and each item's chance, gives the crawler what comes up,
 * and posts a chat card. A mob counts as looted once its Loot has been used.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { grantStoreItem } from './store.mjs';
import { titheOf } from './tithe.mjs';

/** Whether a mob has anything to loot. */
export function hasLoot(mob) {
  const loot = mob.system.loot;
  return !!(loot?.junk?.trim() || loot?.gold?.trim() || loot?.items?.length);
}

/** Whether a defeated mob still has loot the GM hasn't given out. */
export function needsLoot(actor) {
  return (
    actor.type === 'mob' &&
    actor.statuses.has('dead') &&
    hasLoot(actor) &&
    !actor.system.loot.looted
  );
}

/** A formula (a number or dice) rolled to a whole number; 0 when blank or invalid. */
async function rollAmount(formula) {
  const text = formula?.trim();
  if (!text || !Roll.validate(text)) return 0;
  const roll = await new Roll(text).evaluate();
  return Math.max(0, Math.floor(roll.total));
}

/** Roll a mob's loot: the junk, the gold, and the items whose chance comes up. */
export async function rollMobLoot(mob) {
  const { loot } = mob.system;
  const junk = await rollAmount(loot.junk);
  const gold = await rollAmount(loot.gold);
  const items = [];
  for (const entry of loot.items) {
    if (!entry.uuid || Math.random() * 100 >= entry.chance) continue;
    const doc = await fromUuid(entry.uuid);
    if (doc?.documentName === 'Item') items.push(doc);
  }
  return { junk, gold, items };
}

/** GM: roll a mob's loot, give it to the crawler, and mark the mob looted. */
export async function giveMobLoot(mob, crawler) {
  const result = await rollMobLoot(mob);
  const { net } = titheOf(crawler, result.gold);
  if (net) await crawler.addGold(net);
  if (result.junk) {
    await crawler.update({ 'system.junk': (crawler.system.junk ?? 0) + result.junk });
  }
  // Items stack onto a matching item already on the sheet, like store purchases.
  for (const item of result.items) {
    await grantStoreItem(crawler, { item, type: item.type, key: item.uuid, name: item.name });
  }
  await mob.update({ 'system.loot.looted': true });

  const parts = [];
  if (result.gold) {
    parts.push(game.i18n.format('CARL_RPG.Loot.GoldGained', { gold: net.toLocaleString() }));
  }
  if (result.junk) {
    parts.push(game.i18n.format('CARL_RPG.Loot.JunkGained', { junk: result.junk }));
  }
  for (const item of result.items) parts.push(item.name);
  const summary = parts.length
    ? parts.join(', ')
    : game.i18n.localize('CARL_RPG.Loot.NoItems');
  await ChatMessage.create({
    content: `<div class="carl-loot-card">${game.i18n.format('CARL_RPG.Loot.MobLooted', {
      crawler: crawler.name,
      mob: mob.name,
      summary,
    })}</div>`,
  });
  return result;
}

/**
 * GM: roll a mob's loot into a new loot pile and link the mob's tokens to it. Gold
 * and junk go in, and so does each item: items at 100% chance always, the others
 * when their chance comes up. The mob keeps its image on the token.
 */
export async function makeMobPile(mob) {
  if (!game.user.isGM) return null;
  const result = await rollMobLoot(mob);
  const counts = new Map();
  for (const doc of result.items) counts.set(doc.uuid, (counts.get(doc.uuid) ?? 0) + 1);
  const pile = await Actor.create({
    name: game.i18n.format('CARL_RPG.Combat.PileName', { mob: mob.name }),
    type: 'lootPile',
    img: mob.img,
    system: {
      source: mob.uuid,
      gold: result.gold,
      junk: result.junk,
      items: [...counts].map(([uuid, quantity]) => ({ uuid, quantity })),
    },
  });
  // Every token of this mob now links to the pile.
  for (const scene of game.scenes) {
    for (const token of scene.tokens.filter((t) => t.actorId === mob.id)) {
      await token.update({ actorId: pile.id, actorLink: true });
    }
  }
  await mob.update({ 'system.loot.looted': true });
  await ChatMessage.create({
    content: `<div class="carl-loot-card">${game.i18n.format('CARL_RPG.Combat.PileCreated', {
      mob: Handlebars.escapeExpression(mob.name),
    })}</div>`,
  });
  return pile;
}

/** GM: the Loot button (kept under its old name for the existing callers). */
export async function pickCrawlerAndLoot(mob) {
  return makeMobPile(mob);
}

/**
 * The combat tracker's list of defeated mobs still to loot, with a Loot button
 * on each (GM only). Shown above the combatants during a combat.
 */
/** Only the mobs defeated in this combat (the same mobs the reminder lists). */
export function addDefeatedLoot(element, combat) {
  element.querySelector('.carl-defeated-loot')?.remove();
  if (!game.user.isGM) return;
  const mobs = game.actors.filter(
    (actor) => needsLoot(actor) && actor.getFlag('carl-rpg', 'defeatedIn') === combat.id
  );
  if (!mobs.length) return;

  const box = document.createElement('div');
  box.className = 'carl-defeated-loot';
  box.innerHTML =
    `<div class="defeated-heading">${game.i18n.localize('CARL_RPG.Loot.Defeated')}</div>` +
    mobs
      .map(
        (mob) =>
          `<div class="defeated-row" data-uuid="${mob.uuid}"><span>${foundry.utils.escapeHTML(
            mob.name
          )}</span> <button type="button" data-action="loot">${game.i18n.localize(
            'CARL_RPG.Loot.LootMob'
          )}</button></div>`
      )
      .join('');
  box.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="loot"]');
    if (!button) return;
    event.preventDefault();
    const mob = await fromUuid(button.closest('.defeated-row').dataset.uuid);
    if (mob) await pickCrawlerAndLoot(mob);
  });

  const list = element.querySelector('.combat-tracker, #combat-tracker');
  if (list) list.before(box);
  else element.append(box);
}

/** Wire the end-of-combat reminder (on the active GM's client only). */
export function registerMobLoot() {
  Hooks.on('deleteCombat', (combat) => {
    if (!game.user.isGM || game.user !== game.users.activeGM) return;
    const mobs = game.actors.filter(
      (actor) => needsLoot(actor) && actor.getFlag('carl-rpg', 'defeatedIn') === combat.id
    );
    if (!mobs.length) return;
    ChatMessage.create({
      whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
      content: `<em>${game.i18n.localize('CARL_RPG.Loot.Reminder')} ${mobs
        .map((mob) => foundry.utils.escapeHTML(mob.name))
        .join(', ')}</em>`,
    });
  });
}
