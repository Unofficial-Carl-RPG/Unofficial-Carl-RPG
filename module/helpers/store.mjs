/**
 * Stores: the window a crawler buys from, and the purchases themselves.
 *
 * The GM opens a store for one crawler or the whole party (a whispered "store
 * open" message makes the window appear for each crawler's owner). A buy is
 * handled by the GM's client, because it changes the store's stock and the
 * buyer's gold and items, which players can't always change. Whoever clicks Buy
 * pays the gold and gets the item.
 */
const NS = 'carl-rpg';
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** Store windows that are open: "store uuid|actor uuid" -> window. */
const windows = new Map();

/** The price of a listing: its own price, or the item's value when blank. */
export function listingPrice(listing, item) {
  return listing.price ?? item?.system?.value ?? 0;
}

/** Items a store can give more than one of onto a sheet (they stack). */
const STACKABLE = ['gear', 'item'];

/** The rows the window shows, one per listing. */
async function rowsFor(store) {
  return Promise.all(
    store.system.listings.map(async (listing, index) => {
      const item = listing.uuid ? await fromUuid(listing.uuid) : null;
      const unlimited = listing.quantity === null;
      return {
        index,
        name: item?.name ?? listing.uuid,
        img: item?.img ?? 'icons/svg/mystery-man.svg',
        price: item ? listingPrice(listing, item) : 0,
        stockLabel: unlimited
          ? game.i18n.localize('CARL_RPG.Item.Store.Unlimited')
          : listing.quantity,
        unavailable: !item || listing.quantity === 0,
      };
    })
  );
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
    context.rows = await rowsFor(this.store);
    context.gold = this.actor.system.gold;
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
}

/** Open the window for a store and a crawler (or bring it to the front). */
export function openStoreWindow(store, actor) {
  const key = `${store.uuid}|${actor.uuid}`;
  const open = windows.get(key);
  if (open) return open.render({ force: true });
  const window = new CarlRPGStoreWindow(store, actor);
  windows.set(key, window);
  return window.render({ force: true });
}

/**
 * Buy one listing for a crawler. The GM's client makes the purchase; anyone
 * else sends it to the GM as a whispered request.
 */
export async function buyListing(store, index, actor) {
  if (!actor.isOwner) return;
  if (game.user.isGM) {
    const result = await performPurchase(store, index, actor);
    if (result !== true) ui.notifications.warn(result);
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoGM'));
    return;
  }
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    whisper: gmIds,
    content: `<em>${game.i18n.localize('CARL_RPG.Item.Store.Requesting')}</em>`,
    flags: {
      [NS]: {
        storeBuy: {
          storeUuid: store.uuid,
          index,
          actorUuid: actor.uuid,
          userId: game.user.id,
        },
      },
    },
  });
}

/**
 * Carry out a purchase (on the GM's client). Checks the listing and the gold
 * first. Returns true, or the localized reason it was refused.
 */
export async function performPurchase(store, index, buyer) {
  const listing = store.system.listings[index];
  const item = listing?.uuid ? await fromUuid(listing.uuid) : null;
  if (!listing || !item) {
    return game.i18n.localize('CARL_RPG.Item.Store.Gone');
  }
  if (listing.quantity === 0) {
    return game.i18n.localize('CARL_RPG.Item.Store.SoldOut');
  }
  const price = listingPrice(listing, item);
  if (!(await buyer.spendGold(price))) {
    return game.i18n.localize('CARL_RPG.Item.Store.NotEnough');
  }

  await grantStoreItem(buyer, item);

  if (listing.quantity !== null) {
    const listings = store.toObject().system.listings;
    listings[index].quantity = Math.max(0, listings[index].quantity - 1);
    await store.update({ 'system.listings': listings });
  }

  await ChatMessage.create({
    content: `<div class="carl-store-card">${game.i18n.format('CARL_RPG.Item.Store.Bought', {
      buyer: buyer.name,
      item: item.name,
      price,
    })}</div>`,
  });
  return true;
}

/**
 * Put one of the item on a crawler's sheet. A stackable item bought again adds
 * to the one already there (matched by the store listing it came from).
 */
async function grantStoreItem(buyer, item) {
  if (STACKABLE.includes(item.type) && 'quantity' in item.system) {
    const existing = buyer.items.find(
      (i) => i.type === item.type && i.getFlag(NS, 'storeSource') === item.uuid
    );
    if (existing) {
      return existing.update({
        'system.quantity': Number(existing.system.quantity || 0) + 1,
      });
    }
  }
  const data = item.toObject();
  delete data._id;
  data.flags = { ...data.flags, [NS]: { storeSource: item.uuid } };
  if ('quantity' in data.system) data.system.quantity = 1;
  return buyer.createEmbeddedDocuments('Item', [data]);
}

/** The GM opens a store for the whole party or one crawler (by its id). */
export async function openStoreFor(store, target) {
  const crawlers =
    target === 'party'
      ? game.actors.filter((a) => a.type === 'crawler')
      : [game.actors.get(target)].filter(Boolean);
  for (const actor of crawlers) {
    // Each crawler's players get the window; the GM doesn't (they run the shop).
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

  // On the GM's client: carry out purchases that players asked for.
  Hooks.on('createChatMessage', async (message) => {
    const request = message.getFlag(NS, 'storeBuy');
    if (!request || game.user !== game.users.activeGM) return;
    await message.delete();
    const user = game.users.get(request.userId);
    const store = await fromUuid(request.storeUuid);
    const buyer = await fromUuid(request.actorUuid);
    if (!user || !store || !buyer || !buyer.testUserPermission(user, 'OWNER')) return;
    const result = await performPurchase(store, request.index, buyer);
    if (result !== true) {
      await ChatMessage.create({
        whisper: [user.id],
        content: `<em>${result}</em>`,
      });
    }
  });

  // Stock and gold changes update the open windows.
  Hooks.on('updateItem', (item) => {
    for (const window of windows.values()) {
      if (window.store.uuid === item.uuid) window.render({ force: true });
    }
  });
  Hooks.on('updateActor', (actor) => {
    for (const window of windows.values()) {
      if (window.actor.uuid === actor.uuid) window.render({ force: true });
    }
  });
}
