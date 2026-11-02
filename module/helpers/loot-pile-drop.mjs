/**
 * Dropping an item onto the canvas makes a loot pile at the snapped spot. The GM and
 * the item's owners can do it. An item taken from a crawler leaves it one at a time
 * (a stack gives one, a single item goes whole). An item with no compendium source is
 * copied into the world so the pile can refer to it.
 */
export function registerLootPileDrop() {
  Hooks.on('dropCanvasData', (canvas, data) => {
    if (data.type !== 'Item') return undefined;
    dropItemAsPile(canvas, data).catch((err) => {
      console.error('carl-rpg | making a loot pile from a dropped item failed', err);
    });
    // The drop is handled here; nothing else takes it.
    return false;
  });
}

async function dropItemAsPile(canvas, data) {
  const doc = await fromUuid(data.uuid);
  if (!doc || doc.documentName !== 'Item') return;
  if (!(game.user.isGM || doc.isOwner)) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.PileDropDenied'));
    return;
  }

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
  const token = await pile.getTokenDocument({}, { parent: canvas.scene });
  const position = CONFIG.Token.objectClass._getDropActorPosition(
    token,
    { x: data.x, y: data.y, elevation: data.elevation },
    { snap: true }
  );
  token.updateSource(position);
  await token.constructor.create(token, { parent: canvas.scene });
}
