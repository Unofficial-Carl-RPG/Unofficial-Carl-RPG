/**
 * The sheet for a loot pile: what is in it, and the crawler that takes it. Items are
 * claimed one at a time; gold and junk are taken all at once or shared (see
 * helpers/loot-pile.mjs).
 */
import { claimItem, openersFor, takeGold } from '../helpers/loot-pile.mjs';

const { api, sheets } = foundry.applications;

export class CarlRPGLootPileSheet extends api.HandlebarsApplicationMixin(sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ['carl-rpg', 'loot-pile'],
    position: { width: 360, height: 'auto' },
    actions: {
      claimItem: CarlRPGLootPileSheet._claimItem,
      takeGold: CarlRPGLootPileSheet._takeGold,
    },
  };

  static PARTS = {
    body: { template: 'systems/carl-rpg/templates/actor/loot-pile.hbs' },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const pile = this.actor.system;
    context.gold = pile.gold;
    context.junk = pile.junk;
    context.items = await Promise.all(
      pile.items.map(async (row, index) => {
        const doc = await fromUuid(row.uuid);
        return {
          index,
          name: doc?.name ?? row.uuid,
          img: doc?.img ?? '',
          quantity: row.quantity,
        };
      })
    );
    context.openers = openersFor().map((c) => ({ id: c.id, name: c.name }));
    context.empty = !pile.gold && !pile.junk && !pile.items.length;
    return context;
  }

  /** The crawler the user picked to take from the pile. */
  _chosenOpener() {
    const id = this.element?.querySelector('select.pile-opener')?.value;
    return id ? game.actors.get(id) : null;
  }

  /** Claim one item from the pile for the chosen crawler. */
  static async _claimItem(event, target) {
    const crawler = this._chosenOpener();
    if (!crawler) return ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.PileNoCrawler'));
    await claimItem(this.actor, Number(target.dataset.index), crawler);
  }

  /** Take the gold and junk: all of it, or shared among the combat's crawlers. */
  static async _takeGold(event, target) {
    const crawler = this._chosenOpener();
    if (!crawler) return ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.PileNoCrawler'));
    await takeGold(this.actor, crawler, target.dataset.mode);
  }
}
