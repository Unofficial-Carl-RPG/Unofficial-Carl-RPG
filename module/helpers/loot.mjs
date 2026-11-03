/**
 * Opening loot boxes.
 *
 * Opening a box draws items from its reward list (weighted), rolls its gold,
 * gives both to the crawler, uses the box up and posts a chat card.
 *
 * With GM approval turned on (a system setting), a player's box
 * is not rolled by them at all: they send a request to the GM, whose client
 * does the draw, shows the result and lets the GM approve it, re-roll it or
 * discard it. If no GM is connected the box can't be opened at all, and if the
 * GM leaves while a request is open nothing is granted and the box is kept.
 * Requests travel as whispered chat messages (flagged), so no socket is needed.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { runEvents } from './events.mjs';
import { canActOutsideSafeRoom } from './floor.mjs';

const NS = 'carl-rpg';
export const LOOT_APPROVAL_SETTING = 'lootApproval';

/** Requests this client has sent and is waiting on: box id -> request id. */
const pending = new Map();

/*  Setting                                     */

export function registerLootSettings() {
  // A regular system setting (Game Settings -> Configure Settings).
  // Off by default: a per-box Open button in the inventory (Open all is the main way).
  game.settings.register(NS, 'lootPerBoxOpen', {
    name: 'CARL_RPG.Loot.PerBoxName',
    hint: 'CARL_RPG.Loot.PerBoxHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });
  game.settings.register(NS, LOOT_APPROVAL_SETTING, {
    name: 'CARL_RPG.Loot.ApprovalSetting',
    hint: 'CARL_RPG.Loot.ApprovalSettingHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    onChange: () => ui.carlGM?.render(),
  });
}

/** Whether a GM has to approve loot box openings. */
export function lootApprovalRequired() {
  try {
    return !!game.settings.get(NS, LOOT_APPROVAL_SETTING);
  } catch (err) {
    return false;
  }
}

/*  Rolling                                     */

/**
 * The reward entries that can actually be drawn: the item can be found, is not
 * a loot box (loot boxes never reward loot boxes) and has a weight above 0.
 * @param {Item} box
 */
export async function eligibleRewards(box) {
  const entries = [];
  for (const reward of box.system.rewards) {
    const doc = await fromUuid(reward.uuid);
    if (!doc || doc.documentName !== 'Item' || doc.type === 'lootBox') continue;
    if (!(reward.weight > 0)) continue;
    entries.push({ doc, quantity: reward.quantity, weight: reward.weight });
  }
  return entries;
}

/**
 * Roll a loot box: draw the items and roll the gold. Nothing is granted yet.
 * @param {Item} box
 * @returns {Promise<{tier: string, items: object[], gold: number}>}
 */
export async function rollLoot(box) {
  const entries = await eligibleRewards(box);
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  // Weighted draws (with replacement); the same item drawn twice adds up.
  const drawn = new Map();
  if (totalWeight > 0) {
    for (let i = 0; i < box.system.draws; i++) {
      let pick = CONFIG.Dice.randomUniform() * totalWeight;
      const chosen = entries.find((e) => (pick -= e.weight) < 0) ?? entries.at(-1);
      const uuid = chosen.doc.uuid;
      const existing = drawn.get(uuid);
      if (existing) existing.quantity += chosen.quantity;
      else {
        drawn.set(uuid, {
          uuid,
          name: chosen.doc.name,
          img: chosen.doc.img,
          identifier: chosen.doc.system?.identifier?.trim() ?? '',
          quantity: chosen.quantity,
        });
      }
    }
  }

  // Guaranteed items: always granted, outside the random draws. How many is a
  // number or dice formula, rolled each time the box is opened. Like rewards,
  // they can't be loot boxes.
  for (const entry of box.system.guaranteed ?? []) {
    const doc = await fromUuid(entry.uuid);
    if (!doc || doc.documentName !== 'Item' || doc.type === 'lootBox') continue;
    let quantity = 0;
    try {
      const roll = await new Roll(String(entry.quantity)).evaluate();
      quantity = Math.max(0, Math.floor(roll.total));
    } catch (err) {
      console.error(`${NS} | bad quantity formula on ${box.name}`, err);
    }
    if (quantity < 1) continue;
    const existing = drawn.get(doc.uuid);
    if (existing) existing.quantity += quantity;
    else {
      drawn.set(doc.uuid, {
        uuid: doc.uuid,
        name: doc.name,
        img: doc.img,
        identifier: doc.system?.identifier?.trim() ?? '',
        quantity,
      });
    }
  }

  let gold = 0;
  try {
    const roll = await new Roll(box.system.goldFormula).evaluate();
    gold = Math.max(0, Math.floor(roll.total));
  } catch (err) {
    console.error(`${NS} | bad gold formula on ${box.name}`, err);
  }

  return { tier: box.system.tier, items: [...drawn.values()], gold };
}

import { titheOf } from './tithe.mjs';

/*  Granting                                    */

/**
 * Give a rolled result to an actor. Items go through the normal add path (so
 * embedded skills and effects come along). An item the actor already has
 * (matched by identifier) adds to its quantity, or is skipped if it has none.
 * @param {Actor} actor
 * @param {{items: object[], gold: number}} result
 */
export async function grantLoot(actor, result) {
  for (const entry of result.items) {
    const doc = await fromUuid(entry.uuid);
    if (!doc) continue;

    const identifier = doc.system?.identifier?.trim();
    const existing = identifier
      ? actor.items.find(
          (i) =>
            i.type === doc.type && i.system.identifier?.trim() === identifier
        )
      : null;
    const stackable = 'quantity' in (doc.system ?? {});

    if (existing) {
      if (stackable) {
        await existing.update({
          'system.quantity': existing.system.quantity + entry.quantity,
        });
      }
      continue;
    }

    const data = game.items.fromCompendium(doc);
    if (stackable) data.system.quantity = entry.quantity;
    await actor.createEmbeddedDocuments('Item', [data]);
  }
  const { net } = titheOf(actor, result.gold);
  if (net) await actor.addGold(net);
}

/** Use up one box (the last one is deleted). */
async function useUpBox(box) {
  if (box.system.quantity > 1) {
    await box.update({ 'system.quantity': box.system.quantity - 1 });
  } else {
    await box.delete();
  }
}

/** The public chat card for a finished opening. */
async function postResult(actor, box, result, requestId = null) {
  const esc = Handlebars.escapeExpression;
  const tier = CONFIG.CARL_RPG.lootTiers[result.tier];
  const tierName = game.i18n.localize(tier?.label ?? result.tier);
  const items = result.items
    .map(
      (i) =>
        `<li><img src="${esc(i.img)}" width="24" height="24" /> ${esc(i.name)}${
          i.quantity > 1 ? ` &times;${i.quantity}` : ''
        }</li>`
    )
    .join('');
  const gold = result.gold
    ? `<li class="loot-gold">${game.i18n.format('CARL_RPG.Loot.GoldGained', {
        gold: result.gold.toLocaleString(),
      })}</li>`
    : '';
  // A banner in the box's tier colours (styled in the stylesheet by the tier class that
  // helpers/chat-cards.mjs adds: bronze, silver, gold, platinum, legendary, celestial).
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="carl-loot-card">
      <div class="loot-ribbon"><i class="fas fa-box-open"></i> ${game.i18n.format(
        'CARL_RPG.Loot.Banner',
        { tier: esc(tierName) }
      )}</div>
      <div class="loot-title">${game.i18n.format('CARL_RPG.Loot.Opened', {
        name: esc(actor.name),
        tier: esc(tierName),
        box: esc(box.name),
      })}</div>
      <ul class="loot-list">${items}${gold}</ul>
    </div>`,
    flags: {
      [NS]: {
        cue: 'loot',
        card: { kind: 'loot', tier: result.tier, box: box.name },
        ...(requestId ? { lootResponse: { requestId, status: 'done' } } : {}),
      },
    },
  });
}

/*  Opening                                     */

/**
 * Open one of a crawler's loot boxes.
 * @param {Item} box
 * @returns {Promise<boolean>}  Whether an opening was carried out or requested
 */
export async function openLootBox(box) {
  const actor = box.parent;
  if (!(actor instanceof Actor) || actor.type !== 'crawler') return false;
  if (box.type !== 'lootBox' || !actor.isOwner) return false;
  if (!canActOutsideSafeRoom('loot')) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Floor.LootBlocked'));
    return false;
  }
  if (box.system.quantity < 1) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Loot.NoneLeft'));
    return false;
  }
  if (pending.has(box.id)) {
    ui.notifications.info(game.i18n.localize('CARL_RPG.Loot.AlreadyWaiting'));
    return false;
  }

  // Players need a GM's approval when it is turned on; the GM never does.
  if (lootApprovalRequired() && !game.user.isGM) {
    if (!game.users.activeGM) {
      // Blocked before anything is rolled or used.
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Loot.NoGM'));
      return false;
    }
    return requestApproval(actor, box);
  }

  const result = await rollLoot(box);
  await grantLoot(actor, result);
  await useUpBox(box);
  await postResult(actor, box, result);
  // The opening succeeded: run the box's On Opened events (never on a discard).
  await runEvents(box, 'opened', { loot: result });
  return true;
}

/**
 * Open every loot box a crawler has, the lowest tier first. With GM approval off,
 * one confirmation comes first. With approval on, each box goes to the GM's approval
 * as it would alone (the GM can re-roll or discard each one). Safe-room rules apply
 * to the whole run.
 * @param {Actor} actor  The crawler
 */
export async function openAllLootBoxes(actor) {
  if (actor?.type !== 'crawler' || !actor.isOwner) return false;
  if (!canActOutsideSafeRoom('loot')) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Floor.LootBlocked'));
    return false;
  }
  const tiers = Object.keys(CONFIG.CARL_RPG.lootTiers);
  const boxes = actor.items
    .filter((i) => i.type === 'lootBox' && i.system.quantity > 0)
    .sort((a, b) => tiers.indexOf(a.system.tier) - tiers.indexOf(b.system.tier));
  if (!boxes.length) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Loot.NoneLeft'));
    return false;
  }
  if (!lootApprovalRequired()) {
    const count = boxes.reduce((sum, box) => sum + box.system.quantity, 0);
    const go = await CarlRPGDialog.confirm({
      window: { title: 'CARL_RPG.Loot.OpenAll' },
      content: `<p>${game.i18n.format('CARL_RPG.Loot.OpenAllConfirm', { count })}</p>`,
      yes: { label: 'CARL_RPG.Loot.OpenAll' },
      no: { label: 'Cancel' },
      rejectClose: false,
    });
    if (!go) return false;
  }
  for (const box of boxes) {
    // Each box is opened one at a time; a box waiting for approval stops its run.
    while (box.system.quantity > 0) {
      const opened = await openLootBox(box);
      if (!opened) break;
    }
  }
  return true;
}

/** Ask the GM to roll and approve an opening. */
async function requestApproval(actor, box) {
  const requestId = foundry.utils.randomID();
  pending.set(box.id, requestId);
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: [...new Set([...gmIds, game.user.id])],
    content: `<em>${game.i18n.format('CARL_RPG.Loot.Requesting', {
      name: Handlebars.escapeExpression(actor.name),
    })}</em>`,
    flags: {
      [NS]: {
        lootRequest: {
          requestId,
          userId: game.user.id,
          actorUuid: actor.uuid,
          boxUuid: box.uuid,
        },
      },
    },
  });
  ui.notifications.info(game.i18n.localize('CARL_RPG.Loot.Waiting'));
  return true;
}

/*  GM side                                     */

/** Handle a player's request on the GM's client. */
async function handleRequest(message, request) {
  const { requestId, userId, actorUuid, boxUuid } = request;
  const respond = (status) =>
    ChatMessage.create({
      whisper: [userId],
      content: `<em>${game.i18n.localize(`CARL_RPG.Loot.Response.${status}`)}</em>`,
      flags: { [NS]: { lootResponse: { requestId, status } } },
    });

  // Ignore stale requests (left over from an earlier session).
  if (Date.now() - message.timestamp > 10 * 60 * 1000) return;

  const actor = await fromUuid(actorUuid);
  const box = await fromUuid(boxUuid);
  const requester = game.users.get(userId);
  const valid =
    actor?.type === 'crawler' &&
    box?.type === 'lootBox' &&
    box.parent === actor &&
    box.system.quantity >= 1 &&
    requester &&
    actor.testUserPermission(requester, 'OWNER');
  if (!valid) {
    await respond('invalid');
    await message.delete();
    return;
  }

  let result = await rollLoot(box);
  for (;;) {
    const decision = await approvalDialog(actor, box, result);
    if (decision === 'reroll') {
      result = await rollLoot(box);
      continue;
    }
    if (decision === 'approve') {
      // Re-check: the box may have changed while the dialog was open.
      if (!box.parent || box.system.quantity < 1) {
        await respond('invalid');
        break;
      }
      await grantLoot(actor, result);
      await useUpBox(box);
      await postResult(actor, box, result, requestId);
      // Events run on the GM's client with the GM's permissions, so only events
      // a GM last saved are run here (see helpers/events.mjs).
      if (box.system.events?.some((e) => e.enabled && e.trigger === 'opened')) {
        if (box.system.eventsTrusted) {
          await runEvents(box, 'opened', { loot: result });
        } else {
          ui.notifications.warn(
            game.i18n.format('CARL_RPG.Loot.EventsNotRun', { name: box.name })
          );
        }
      }
    } else {
      await respond('discarded');
    }
    break;
  }
  await message.delete();
}

/**
 * The GM's approval pop-up.
 * @returns {Promise<'approve'|'reroll'|'discard'>}
 */
async function approvalDialog(actor, box, result) {
  const esc = Handlebars.escapeExpression;
  const tier = CONFIG.CARL_RPG.lootTiers[result.tier];
  const items = result.items.length
    ? result.items
        .map(
          (i) =>
            `<li><img src="${esc(i.img)}" width="24" height="24" /> ${esc(i.name)}${
              i.quantity > 1 ? ` &times;${i.quantity}` : ''
            }</li>`
        )
        .join('')
    : `<li><em>${game.i18n.localize('CARL_RPG.Loot.NoItems')}</em></li>`;
  const choice = await CarlRPGDialog.wait({
    window: { title: game.i18n.localize('CARL_RPG.Loot.Approve.Title') },
    content: `<p>${game.i18n.format('CARL_RPG.Loot.Approve.Content', {
      name: esc(actor.name),
      tier: game.i18n.localize(tier?.label ?? result.tier),
    })}</p>
      <ul class="carl-loot-approval">${items}<li>${game.i18n.format(
        'CARL_RPG.Loot.GoldGained',
        { gold: result.gold.toLocaleString() }
      )}</li></ul>`,
    buttons: [
      { action: 'approve', label: game.i18n.localize('CARL_RPG.Loot.Approve.Approve'), default: true },
      { action: 'reroll', label: game.i18n.localize('CARL_RPG.Loot.Approve.Reroll') },
      { action: 'discard', label: game.i18n.localize('CARL_RPG.Loot.Approve.Discard') },
    ],
    rejectClose: false,
  });
  return choice ?? 'discard';
}

/*  Requests waiting on this GM                 */

/** Requests this (GM) client is handling now, shown in the GM tab. */
const waiting = new Set();

/** How many loot box requests are waiting for this GM's decision. */
export const waitingApprovals = () => waiting.size;

/** Count a request as waiting until it has been handled. */
function trackWaiting(requestId, promise) {
  waiting.add(requestId);
  ui.carlGM?.render();
  promise.finally(() => {
    waiting.delete(requestId);
    ui.carlGM?.render();
  });
}

/*  Hooks                                       */

export function registerLootBoxes() {
  registerLootSettings();

  Hooks.on('createChatMessage', (message) => {
    // The GM's client (one of them) handles requests.
    const request = message.getFlag(NS, 'lootRequest');
    if (request && game.user === game.users.activeGM) {
      trackWaiting(request.requestId, handleRequest(message, request));
    }

    // The player's client clears its wait when the answer arrives.
    const response = message.getFlag(NS, 'lootResponse');
    if (response) {
      for (const [boxId, requestId] of pending) {
        if (requestId === response.requestId) pending.delete(boxId);
      }
    }
  });

  // If the GM leaves while a request is open, nothing is granted: stop waiting.
  Hooks.once('ready', () => {
    if (game.user.isGM) return;
    setInterval(() => {
      if (pending.size && !game.users.activeGM) {
        pending.clear();
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Loot.GMLeft'));
      }
    }, 5000);
  });
}
