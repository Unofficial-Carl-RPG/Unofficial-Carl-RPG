/**
 * Stores: the window a crawler buys from and sells to, and the transactions.
 *
 * The GM opens a store for one crawler or the whole party (a whispered "store
 * open" message makes the window appear for each crawler's owner; the GM gets
 * the windows too). Buying and selling change the store's stock, which players
 * can't change, so the GM's client carries them out. Whoever clicks Buy pays
 * the gold and gets the item. A sale pays the seller and adds the item to the
 * store (see performSale). Restocking is a GM action.
 */
const NS = 'carl-rpg';
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** Store windows that are open: "store uuid|actor uuid" -> window. */
const windows = new Map();

/** Items a crawler can buy and sell in stacks (they have a quantity). */
const STACKABLE = ['gear', 'item'];

/** The price of a listing: its own price, or the item's value when blank. */
function listingPrice(listing, value) {
  return listing.price ?? value;
}

/** What a store pays for an item: its sell percentage of the item's value. */
export function sellPrice(item, store) {
  return Math.floor(((item.system.value ?? 0) * (store.system.sellPercent ?? 0)) / 100);
}

/**
 * What a listing is: the world item it points at, or the copy taken from a sale.
 * `key` identifies the listing's item, so bought stacks join the right sheet item.
 */
export async function resolveListing(listing) {
  if (listing.snapshot) {
    const snap = listing.snapshot;
    return {
      snapshot: snap,
      name: snap.name,
      img: snap.img,
      type: snap.type,
      value: snap.system?.value ?? 0,
      missing: false,
      key: `snap:${snap.name}|${snap.type}|${listing.price}`,
    };
  }
  const item = listing.uuid ? await fromUuid(listing.uuid) : null;
  if (!item) {
    return {
      missing: true,
      name: listing.uuid,
      img: 'icons/svg/mystery-man.svg',
      type: '',
      value: 0,
      key: listing.uuid,
    };
  }
  return {
    item,
    name: item.name,
    img: item.img,
    type: item.type,
    value: item.system.value ?? 0,
    missing: false,
    key: item.uuid,
  };
}

/** The rows the window shows, one per listing. */
async function buyRowsFor(store) {
  return Promise.all(
    store.system.listings.map(async (listing, index) => {
      const resolved = await resolveListing(listing);
      return {
        index,
        name: resolved.name,
        img: resolved.img,
        price: resolved.missing ? 0 : listingPrice(listing, resolved.value),
        stockLabel:
          listing.quantity === null
            ? game.i18n.localize('CARL_RPG.Item.Store.Unlimited')
            : listing.quantity,
        unavailable: resolved.missing || listing.quantity === 0,
      };
    })
  );
}

/** The crawler's items the store will buy (only ones that are worth something). */
function sellRowsFor(store, actor) {
  return actor.items
    .filter((i) => STACKABLE.includes(i.type))
    .map((i) => ({
      id: i.id,
      name: i.name,
      img: i.img,
      price: sellPrice(i, store),
    }))
    .filter((row) => row.price > 0);
}

class CarlRPGStoreWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['carl-rpg', 'carl-dialog', 'store-window'],
    tag: 'div',
    window: { resizable: false },
    position: { width: 380, height: 'auto' },
    actions: {
      buy: CarlRPGStoreWindow._onBuy,
      sell: CarlRPGStoreWindow._onSell,
      restock: CarlRPGStoreWindow._onRestock,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'systems/carl-rpg/templates/sidebar/store-window.hbs',
    },
  };

  constructor(store, actor) {
    super({ id: `carl-rpg-store-${store.id}-${actor.id}` });
    this.store = store;
    this.actor = actor;
  }

  /** @override */
  get title() {
    return this.store.name;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.rows = await buyRowsFor(this.store);
    context.sellRows = sellRowsFor(this.store, this.actor);
    context.gold = this.actor.system.gold;
    context.isGM = game.user.isGM;
    return context;
  }

  /** @override */
  async close(options = {}) {
    windows.delete(`${this.store.uuid}|${this.actor.uuid}`);
    return super.close(options);
  }

  /** Buy the listing on this row. */
  static async _onBuy(event, target) {
    const index = Number(target.closest('.store-row').dataset.index);
    await buyListing(this.store, index, this.actor);
  }

  /** Sell the item on this row to the store. */
  static async _onSell(event, target) {
    await sellItem(this.store, this.actor, target.closest('.sell-row').dataset.id);
  }

  /** GM: reset the stock on this row to its starting stock. */
  static async _onRestock(event, target) {
    const index = Number(target.closest('.store-row').dataset.index);
    await restockListing(this.store, index);
  }
}

/** Open the window for a store and a crawler (or bring it to the front). */
export function openStoreWindow(store, actor) {
  const key = `${store.uuid}|${actor.uuid}`;
  const open = windows.get(key);
  if (open) return open.render({ force: true });
  const win = new CarlRPGStoreWindow(store, actor);
  windows.set(key, win);
  return win.render({ force: true });
}

/** Post a request to the GM's client, whispered to the GM. */
async function requestFromGM(kind, data) {
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoGM'));
    return;
  }
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    whisper: gmIds,
    content: `<em>${game.i18n.localize('CARL_RPG.Item.Store.Requesting')}</em>`,
    flags: { [NS]: { [kind]: { ...data, userId: game.user.id } } },
  });
}

/**
 * Buy one listing for a crawler. The GM's client makes the purchase; anyone
 * else sends it to the GM as a request.
 */
export async function buyListing(store, index, actor) {
  if (!actor.isOwner) return;
  if (game.user.isGM) {
    const result = await performPurchase(store, index, actor);
    if (result !== true) ui.notifications.warn(result);
    return;
  }
  await requestFromGM('storeBuy', {
    storeUuid: store.uuid,
    index,
    actorUuid: actor.uuid,
  });
}

/**
 * Carry out a purchase (on the GM's client). Checks the listing and the gold
 * first. Returns true, or the localized reason it was refused.
 */
export async function performPurchase(store, index, buyer) {
  const listing = store.system.listings[index];
  if (!listing) return game.i18n.localize('CARL_RPG.Item.Store.Gone');
  const resolved = await resolveListing(listing);
  if (resolved.missing) return game.i18n.localize('CARL_RPG.Item.Store.Gone');
  if (listing.quantity === 0) return game.i18n.localize('CARL_RPG.Item.Store.SoldOut');

  const price = listingPrice(listing, resolved.value);
  if (!(await buyer.spendGold(price))) {
    return game.i18n.localize('CARL_RPG.Item.Store.NotEnough');
  }

  await grantStoreItem(buyer, resolved);

  if (listing.quantity !== null) {
    const listings = store.toObject().system.listings;
    listings[index].quantity = Math.max(0, listings[index].quantity - 1);
    await store.update({ 'system.listings': listings });
  }

  await ChatMessage.create({
    content: `<div class="carl-store-card">${game.i18n.format('CARL_RPG.Item.Store.Bought', {
      buyer: buyer.name,
      item: resolved.name,
      price,
    })}</div>`,
  });
  return true;
}

/**
 * Put one of the item on a crawler's sheet. A stackable item bought again adds
 * to the one already there (matched by where it was listed).
 */
export async function grantStoreItem(buyer, resolved) {
  if (STACKABLE.includes(resolved.type)) {
    const existing = buyer.items.find(
      (i) => i.type === resolved.type && i.getFlag(NS, 'storeSource') === resolved.key
    );
    if (existing && 'quantity' in existing.system) {
      return existing.update({
        'system.quantity': Number(existing.system.quantity || 0) + 1,
      });
    }
  }
  const data = resolved.snapshot
    ? foundry.utils.deepClone(resolved.snapshot)
    : resolved.item.toObject();
  delete data._id;
  data.flags = {
    ...(data.flags ?? {}),
    [NS]: { ...(data.flags?.[NS] ?? {}), storeSource: resolved.key },
  };
  if ('quantity' in data.system) data.system.quantity = 1;
  if ('equipped' in data.system) data.system.equipped = false;
  return buyer.createEmbeddedDocuments('Item', [data]);
}

/**
 * A crawler sells one of their items to a store. The GM's client makes the
 * sale; anyone else sends it to the GM as a request.
 */
export async function sellItem(store, actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item || !actor.isOwner || sellPrice(item, store) <= 0) return;
  if (game.user.isGM) return performSale(store, actor, itemId);
  await requestFromGM('storeSell', {
    storeUuid: store.uuid,
    actorUuid: actor.uuid,
    itemId,
  });
}

/**
 * Carry out a sale (on the GM's client): one unit leaves the seller's sheet and
 * they are paid the store's sell percentage of its value. The store gets the
 * item back as a listing with the same buy-back price: a listing with the same
 * name, type and price gains one in stock, otherwise a new listing is made with
 * a copy of the item (starting stock 0, so restocking doesn't bring it back).
 */
export async function performSale(store, actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item) return false;
  const price = sellPrice(item, store);
  if (price <= 0) return false;

  const data = item.toObject();
  const snapshot = {
    name: item.name,
    img: item.img,
    type: item.type,
    system: { ...data.system, quantity: 1 },
    effects: data.effects ?? [],
    flags: data.flags ?? {},
  };

  const listings = store.toObject().system.listings;
  const resolved = await Promise.all(store.system.listings.map(resolveListing));
  const match = resolved.findIndex(
    (r, i) =>
      !r.missing &&
      r.name === item.name &&
      r.type === item.type &&
      listingPrice(store.system.listings[i], r.value) === price
  );
  if (match >= 0) {
    if (listings[match].quantity !== null) listings[match].quantity += 1;
  } else {
    listings.push({ uuid: '', price, quantity: 1, startStock: 0, snapshot });
  }
  await store.update({ 'system.listings': listings });

  const quantity = Number(item.system.quantity || 0);
  if ('quantity' in item.system && quantity > 1) {
    await item.update({ 'system.quantity': quantity - 1 });
  } else {
    await item.delete();
  }
  await actor.addGold(price);

  await ChatMessage.create({
    content: `<div class="carl-store-card">${game.i18n.format('CARL_RPG.Item.Store.Sold', {
      seller: actor.name,
      item: item.name,
      price,
    })}</div>`,
  });
  return true;
}

/** GM: set a listing's stock back to its starting stock (blank: unlimited). */
export async function restockListing(store, index) {
  const listing = store.system.listings[index];
  if (!listing) return;
  const listings = store.toObject().system.listings;
  listings[index].quantity = listing.startStock ?? null;
  await store.update({ 'system.listings': listings });
}

/**
 * The GM opens a store for the whole party or one crawler (by its id). Each
 * crawler's owners get a window; the GM gets one for each crawler too.
 */
export async function openStoreFor(store, target) {
  const crawlers =
    target === 'party'
      ? game.actors.filter((a) => a.type === 'crawler')
      : [game.actors.get(target)].filter(Boolean);
  for (const actor of crawlers) {
    if (game.user.isGM) openStoreWindow(store, actor);
    const whisper = game.users
      .filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER'))
      .map((u) => u.id);
    if (!whisper.length) continue;
    await ChatMessage.create({
      whisper,
      content: `<em>${game.i18n.format('CARL_RPG.Item.Store.Opened', {
        store: store.name,
        actor: actor.name,
      })}</em>`,
      flags: {
        [NS]: { storeOpen: { storeUuid: store.uuid, actorUuid: actor.uuid } },
      },
    });
  }
}

/** Wire the store messages and keep open windows up to date. */
export function registerStores() {
  // The store window opens on each crawler owner's client.
  Hooks.on('createChatMessage', async (message) => {
    const open = message.getFlag(NS, 'storeOpen');
    if (open && message.whisper?.includes(game.user.id)) {
      const store = await fromUuid(open.storeUuid);
      const actor = await fromUuid(open.actorUuid);
      if (store && actor?.isOwner) openStoreWindow(store, actor);
    }
  });

  // On the GM's client: carry out the purchases and sales players asked for.
  Hooks.on('createChatMessage', async (message) => {
    const request = message.getFlag(NS, 'storeBuy') ?? message.getFlag(NS, 'storeSell');
    if (!request || game.user !== game.users.activeGM) return;
    const isSale = !!message.getFlag(NS, 'storeSell');
    await message.delete();
    const user = game.users.get(request.userId);
    const store = await fromUuid(request.storeUuid);
    const actor = await fromUuid(request.actorUuid);
    if (!user || !store || !actor || !actor.testUserPermission(user, 'OWNER')) return;
    const result = isSale
      ? await performSale(store, actor, request.itemId)
      : await performPurchase(store, request.index, actor);
    if (result !== true) {
      await ChatMessage.create({
        whisper: [user.id],
        content: `<em>${result}</em>`,
      });
    }
  });

  // Stock, gold and items changes update the open windows.
  Hooks.on('updateItem', (item) => {
    for (const win of windows.values()) {
      if (win.store.uuid === item.uuid) win.render({ force: true });
    }
  });
  Hooks.on('updateActor', (actor) => {
    for (const win of windows.values()) {
      if (win.actor.uuid === actor.uuid) win.render({ force: true });
    }
  });
}
