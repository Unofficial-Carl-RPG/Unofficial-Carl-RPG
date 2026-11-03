/**
 * Item sheet: stores, quests and the rewards of loot boxes and achievements.
 */
import { CarlRPGDialog } from '../helpers/dialog.mjs';
import { openStoreFor, restockListing } from '../helpers/store.mjs';

export const ItemSheetStoreQuestLoot = (Base) => class ItemSheetStoreQuestLoot extends Base {
  /** @this CarlRPGItemSheet */
  static async _clearReward() {
    await this.item.update({ 'system.lootBox': '' });
  }

  /**
   * Remove an entry from a loot box's reward list.
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _removeReward(event, target) {
    const row = target.closest('[data-index]');
    const index = Number(row?.dataset.index);
    if (!Number.isInteger(index)) return;
    const list = row.dataset.list === 'guaranteed' ? 'guaranteed' : 'rewards';
    const entries = this.item.toObject().system[list];
    entries.splice(index, 1);
    await this.item.update({ [`system.${list}`]: entries });
  }

  /** Save the price and stock of the store listings (they have no form names). */
  async _saveListings() {
    const listings = this.item.toObject().system.listings;
    for (const row of this.element.querySelectorAll('.store-row')) {
      const listing = listings[Number(row.dataset.index)];
      if (!listing) continue;
      const price = row.querySelector('.store-price').value.trim();
      const quantity = row.querySelector('.store-quantity').value.trim();
      listing.price = price === '' ? null : Math.max(0, Math.floor(Number(price)) || 0);
      listing.startStock = quantity === '' ? null : Math.max(0, Math.floor(Number(quantity)) || 0);
    }
    await this.item.update({ 'system.listings': listings });
  }

  /** Quests: save the objective texts (the rows have no form names). */
  async _saveObjectives() {
    const objectives = this.item.toObject().system.objectives;
    const updated = [...this.element.querySelectorAll('.quest-obj')].map((row, index) => ({
      text: row.querySelector('.quest-obj-text').value,
      done: objectives[index]?.done ?? false,
    }));
    await this.item.update({ 'system.objectives': updated });
  }

  /** Quests: add an objective row. */
  static async _addObjective() {
    const objectives = this.item.toObject().system.objectives;
    objectives.push({ text: '', done: false });
    await this.item.update({ 'system.objectives': objectives });
  }

  /** Quests: remove an objective row. */
  static async _removeObjective(event, target) {
    const index = Number(target.closest('.quest-obj').dataset.index);
    const objectives = this.item.toObject().system.objectives;
    objectives.splice(index, 1);
    await this.item.update({ 'system.objectives': objectives });
  }

  /** GM: give this quest to a crawler (picked here). It is copied onto their sheet. */
  static async _giveQuest() {
    const crawlers = game.actors.filter((a) => a.type === 'crawler');
    if (!crawlers.length) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoCrawlers'));
      return;
    }
    const choices = crawlers
      .map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`)
      .join('');
    const id = await CarlRPGDialog.prompt({
      window: { title: 'CARL_RPG.Item.Quest.Give' },
      content: `<div class="form-group"><label>${game.i18n.localize('CARL_RPG.Item.Store.OpenFor')}</label>
        <select name="crawler">${choices}</select></div>`,
      ok: {
        label: 'CARL_RPG.Item.Quest.Give',
        callback: (event, button) => button.form.elements.crawler.value,
      },
    });
    const actor = id ? game.actors.get(id) : null;
    if (!actor) return;
    const data = this.item.toObject();
    delete data._id;
    data.system.completed = false;
    data.system.objectives = data.system.objectives.map((o) => ({ ...o, done: false }));
    data.flags = {
      ...(data.flags ?? {}),
      'carl-rpg': { ...(data.flags?.['carl-rpg'] ?? {}), questSource: this.item.uuid },
    };
    await actor.createEmbeddedDocuments('Item', [data]);
  }

  /** GM: open the store for the whole party or one crawler, picked here. */
  static async _openStore() {
    const crawlers = game.actors.filter((a) => a.type === 'crawler');
    if (!crawlers.length) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoCrawlers'));
      return;
    }
    const choices = [
      `<option value="party">${game.i18n.localize('CARL_RPG.Item.Store.Party')}</option>`,
      ...crawlers.map((a) => `<option value="${a.id}">${a.name}</option>`),
    ].join('');
    const target = await CarlRPGDialog.prompt({
      window: { title: 'CARL_RPG.Item.Store.Open' },
      content: `<div class="form-group"><label>${game.i18n.localize('CARL_RPG.Item.Store.OpenFor')}</label>
        <select name="target">${choices}</select></div>`,
      ok: {
        label: 'CARL_RPG.Item.Store.Open',
        callback: (event, button) => button.form.elements.target.value,
      },
    });
    if (target) await openStoreFor(this.item, target);
  }

  /** GM: add stock to the listing on this row (see helpers/store.mjs). */
  static async _restockListing(event, target) {
    const index = Number(target.closest('.store-row').dataset.index);
    await restockListing(this.item, index);
  }

  /** Remove one listing from the store. */
  static async _removeListing(event, target) {
    const row = target.closest('.store-row');
    const listings = this.item.toObject().system.listings;
    listings.splice(Number(row.dataset.index), 1);
    await this.item.update({ 'system.listings': listings });
  }

  /**
   * Save the weight and quantity fields of the reward rows (they have no form
   * names, so the whole list is written back).
   */
  async _saveRewards() {
    const system = this.item.toObject().system;
    const rewards = system.rewards;
    for (const row of this.element.querySelectorAll('.reward-row')) {
      const reward = rewards[Number(row.dataset.index)];
      if (!reward) continue;
      reward.weight = Math.max(0, Number(row.querySelector('.reward-weight').value) || 0);
      reward.quantity = Math.max(
        1,
        Math.floor(Number(row.querySelector('.reward-quantity').value)) || 1
      );
    }
    const guaranteed = system.guaranteed;
    for (const row of this.element.querySelectorAll('.guaranteed-row')) {
      const entry = guaranteed[Number(row.dataset.index)];
      if (!entry) continue;
      entry.quantity = row.querySelector('.guaranteed-formula').value.trim() || '1';
    }
    await this.item.update({
      'system.rewards': rewards,
      'system.guaranteed': guaranteed,
    });
  }
};
