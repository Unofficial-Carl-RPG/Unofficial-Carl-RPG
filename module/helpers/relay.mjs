/**
 * Automatic changes made on someone else's behalf.
 *
 * Using an item can change the actor automatically (spending mana, spending an
 * action, or spending AI Favor on a reroll). If the person using it only has Observer permission on the actor,
 * Foundry won't let their client make those changes, so the change is sent to
 * the GM's client instead (as a whispered chat message that the GM's client
 * handles and deletes, like the loot box and event requests).
 *
 * The GM's client only does what it expects: the requester must be at least an
 * Observer of the actor, and only a short list of changes is accepted, each
 * within its limits. This never lets an Observer edit the sheet by hand.
 */
const NS = 'carl-rpg';

/**
 * The changes a request may make, per document type: the field and a check on
 * the new value.
 */
const ALLOWED = {
  Actor: {
    'system.mana.value': (doc, value) =>
      Number.isInteger(value) &&
      value >= 0 &&
      value <= (doc.system.mana?.maxTotal ?? 0),
    // Spending AI Favor on a reroll: exactly one point.
    'system.aiFavor': (doc, value) =>
      Number.isInteger(value) &&
      value >= 0 &&
      value === Math.trunc(doc.system.aiFavor ?? 0) - 1,
  },
  Item: {
    // Starting a Damage Effect's cooldown (hours as its upgrades set, or used this round).
    'system.damageEffect.cooldownHours': (doc, value) =>
      !!doc.system.damageEffect?.enabled &&
      Number.isInteger(value) &&
      value > 0 &&
      value === (doc.system.damageRules?.cooldown?.hours ?? 0),
    'system.damageEffect.cooldownRound': (doc, value) =>
      !!doc.system.damageEffect?.enabled &&
      value === true &&
      doc.system.damageRules?.cooldown?.kind === 'round',
    // Spending one use of an item with a limit on its uses.
    'system.uses.spent': (doc, value) =>
      Number.isInteger(value) &&
      doc.system.uses?.max > 0 &&
      value === doc.system.uses.spent + 1 &&
      value <= doc.system.uses.max,
    // Spending ammunition: an inventory item's Quantity going down (never up).
    'system.quantity': (doc, value) =>
      doc.type === 'item' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value < doc.system.quantity,
  },
  Combatant: {
    [`flags.${NS}.actionsSpent`]: (doc, value) =>
      Number.isInteger(value) && value >= 0 && value <= doc.maxActions,
  },
};

/**
 * Update a document, handing the change to the GM's client if this user can't
 * make it themselves (an Observer using an item).
 * @param {Actor|Combatant} doc
 * @param {object} changes  Update data, e.g. {'system.mana.value': 3}
 */
export async function updateWithRelay(doc, changes) {
  if (doc.isOwner || game.user.isGM) return doc.update(changes);

  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Relay.NoGM'));
    return null;
  }
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  return ChatMessage.create({
    whisper: gmIds,
    content: `<em>${game.i18n.localize('CARL_RPG.Relay.Working')}</em>`,
    flags: {
      [NS]: { updateRelay: { uuid: doc.uuid, changes, userId: game.user.id } },
    },
  });
}

/** On the GM's client: check a request, then make the change. */
async function handleUpdateRelay(message, relay) {
  await message.delete();
  const user = game.users.get(relay.userId);
  const doc = await fromUuid(relay.uuid);
  if (!user || !doc) return;

  const actor = doc.documentName === 'Actor' ? doc : doc.actor;
  if (!actor?.testUserPermission(user, 'OBSERVER')) return;

  const rules = ALLOWED[doc.documentName];
  if (!rules) return;
  for (const [key, value] of Object.entries(relay.changes ?? {})) {
    if (!rules[key]?.(doc, value)) return;
  }
  await doc.update(relay.changes);
}

export function registerRelay() {
  Hooks.on('createChatMessage', (message) => {
    const relay = message.getFlag(NS, 'updateRelay');
    if (relay && game.user === game.users.activeGM) {
      handleUpdateRelay(message, relay);
    }
  });
}
