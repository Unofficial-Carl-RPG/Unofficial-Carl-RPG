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
  if (result.gold) await crawler.addGold(result.gold);
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
    parts.push(game.i18n.format('CARL_RPG.Loot.GoldGained', { gold: result.gold.toLocaleString() }));
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

/** GM: ask which crawler gets the mob's loot, then give it. */
export async function pickCrawlerAndLoot(mob) {
  if (!game.user.isGM) return;
  const crawlers = game.actors.filter((a) => a.type === 'crawler');
  if (!crawlers.length) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoCrawlers'));
    return;
  }
  const choices = crawlers
    .map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`)
    .join('');
  const id = await CarlRPGDialog.prompt({
    window: { title: 'CARL_RPG.Loot.LootMob' },
    content: `<div class="form-group"><label>${game.i18n.localize(
      'CARL_RPG.Loot.PickCrawler'
    )}</label><select name="crawler">${choices}</select></div>`,
    ok: {
      label: 'CARL_RPG.Loot.LootMob',
      callback: (event, button) => button.form.elements.crawler.value,
    },
  });
  const crawler = id ? game.actors.get(id) : null;
  if (crawler) await giveMobLoot(mob, crawler);
}

/**
 * The combat tracker's list of defeated mobs still to loot, with a Loot button
 * on each (GM only). Shown above the combatants during a combat.
 */
export function addDefeatedLoot(element) {
  element.querySelector('.carl-defeated-loot')?.remove();
  if (!game.user.isGM) return;
  const mobs = game.actors.filter(needsLoot);
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
  Hooks.on('deleteCombat', () => {
    if (!game.user.isGM || game.user !== game.users.activeGM) return;
    const mobs = game.actors.filter(needsLoot);
    if (!mobs.length) return;
    ChatMessage.create({
      whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
      content: `<em>${game.i18n.localize('CARL_RPG.Loot.Reminder')} ${mobs
        .map((mob) => foundry.utils.escapeHTML(mob.name))
        .join(', ')}</em>`,
    });
  });
}
