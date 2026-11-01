/**
 * Stores: the window a crawler buys from and sells to, and the transactions.
 *
 * The GM opens a store for one crawler or the whole party (a whispered "store
 * open" message makes the window appear for each crawler's owner; the GM gets
 * the windows too). Buying is handled by the GM's client, because it changes
 * the store's stock, which players can't change. Whoever clicks Buy pays the
 * gold and gets the item. Selling only changes the seller's own crawler, so it
 * happens on their client. Restocking is a GM action.
 */
import { CarlRPGDialog } from './dialog.mjs';

const NS = 'carl-rpg';
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** Store windows that are open: "store uuid|actor uuid" -> window. */
const windows = new Map();

/** Items a crawler can sell and buy in stacks (they have a quantity). */
const STACKABLE = ['gear', 'item'];

/** The price of a listing: its own price, or the item's value when blank. */
export function listingPrice(listing, item) {
  return listing.price ?? item?.system?.value ?? 0;
}

/** What a store pays for an item: its sell percentage of the item's value. */
export function sellPrice(item, store) {
  return Math.floor(((item.system.value ?? 0) * (store.system.sellPercent ?? 0)) / 100);
}

/** The rows the window shows, one per listing. */
async function buyRowsFor(store) {
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

  /** GM: add stock to the listing on this row. */
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

/**
 * Sell one of a crawler's items to a store: one from a stack, or the whole item
 * if it's the last one. The crawler is paid the store's sell percentage of the
 * item's value. The store's stock doesn't change.
 */
export async function sellItem(store, actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item || !actor.isOwner) return;
  const price = sellPrice(item, store);
  if (price <= 0) return;

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
}

/** GM: add stock to a listing (asks how many). Unlimited stock can't be added to. */
export async function restockListing(store, index) {
  const listing = store.system.listings[index];
  if (!listing) return;
  if (listing.quantity === null) {
    ui.notifications.info(game.i18n.localize('CARL_RPG.Item.Store.AlreadyUnlimited'));
    return;
  }
  const amount = await CarlRPGDialog.prompt({
    window: { title: 'CARL_RPG.Item.Store.Restock' },
    content: `<div class="form-group"><label>${game.i18n.localize(
      'CARL_RPG.Item.Store.RestockAmount'
    )}</label><input type="number" name="amount" value="1" min="1" step="1" /></div>`,
    ok: {
      label: 'CARL_RPG.Item.Store.Restock',
      callback: (event, button) => Math.floor(Number(button.form.elements.amount.value)) || 0,
    },
  });
  if (!amount || amount < 1) return;
  const listings = store.toObject().system.listings;
  listings[index].quantity += amount;
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
