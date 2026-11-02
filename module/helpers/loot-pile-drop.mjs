/**
 * Dropping an item onto the canvas makes a loot pile at the snapped spot. The GM can
 * do it; an item's owner asks the GM's client to do it (players can't create actors).
 * The GM's client only makes a pile for a player who owns the item. An item taken from
 * a crawler leaves it one at a time (a stack gives one, a single item goes whole). An
 * item with no compendium source is copied into the world so the pile can refer to it.
 */
const NS = 'carl-rpg';

export function registerLootPileDrop() {
  Hooks.on('dropCanvasData', (canvas, data) => {
    if (data.type !== 'Item') return undefined;
    requestPile(canvas.scene, data).catch((err) => {
      console.error('carl-rpg | making a loot pile from a dropped item failed', err);
    });
    // The drop is handled here; nothing else takes it.
    return false;
  });

  // The GM's client makes the piles players ask for.
  Hooks.on('createChatMessage', (message) => {
    const relay = message.getFlag(NS, 'pileRelay');
    if (relay && game.user === game.users.activeGM) {
      handlePileRelay(message, relay).catch((err) => {
        console.error('carl-rpg | making a loot pile for a player failed', err);
      });
    }
  });
}

/** Make the pile now (the GM), or ask the GM's client to (an item's owner). */
async function requestPile(scene, data) {
  const doc = await fromUuid(data.uuid);
  if (!doc || doc.documentName !== 'Item') return;
  if (!(game.user.isGM || doc.isOwner)) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.PileDropDenied'));
    return;
  }
  if (game.user.isGM) return makePile(scene, data);

  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Relay.NoGM'));
    return;
  }
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    whisper: gmIds,
    content: `<em>${game.i18n.localize('CARL_RPG.Relay.Working')}</em>`,
    flags: {
      [NS]: {
        pileRelay: {
          uuid: data.uuid,
          sceneId: scene.id,
          x: data.x,
          y: data.y,
          elevation: data.elevation ?? 0,
          userId: game.user.id,
        },
      },
    },
  });
}

/** On the GM's client: check a request is from an owner of the item, then make the pile. */
async function handlePileRelay(message, relay) {
  await message.delete();
  const user = game.users.get(relay.userId);
  const doc = await fromUuid(relay.uuid);
  const scene = game.scenes.get(relay.sceneId);
  if (!user || !scene || !doc || doc.documentName !== 'Item') return;
  if (!doc.testUserPermission(user, 'OWNER')) return;
  await makePile(scene, relay);
}

/** Make the pile on the scene, taking one from the crawler's copy when there is one. */
async function makePile(scene, data) {
  const doc = await fromUuid(data.uuid);
  if (!doc || doc.documentName !== 'Item') return;

  const crawler = doc.parent instanceof Actor ? doc.parent : null;
  let uuid = crawler ? (doc._stats?.compendiumSource ?? null) : doc.uuid;
  if (!uuid) {
    const worldData = doc.toObject();
    delete worldData._id;
    uuid = (await Item.create(worldData)).uuid;
  }

  // A crawler's item leaves one at a time.
  if (crawler) {
    const quantity = doc.system?.quantity;
    if (typeof quantity === 'number' && quantity > 1) {
      await doc.update({ 'system.quantity': quantity - 1 });
    } else {
      await doc.delete();
    }
  }

  const pile = await Actor.create({
    name: game.i18n.format('CARL_RPG.Combat.PileDropName', { item: doc.name }),
    type: 'lootPile',
    img: doc.img,
    system: { items: [{ uuid, quantity: 1 }] },
  });
  const token = await pile.getTokenDocument({}, { parent: scene });
  const position = CONFIG.Token.objectClass._getDropActorPosition(
    token,
    { x: data.x, y: data.y, elevation: data.elevation },
    { snap: true }
  );
  token.updateSource(position);
  await token.constructor.create(token, { parent: scene });
}
