/**
 * Item sheet: the list of costs an item spends when used (see data/costs.mjs).
 */

export const ItemSheetCosts = (Base) => class ItemSheetCosts extends Base {
  /** Add a cost row (Mana, 1 to start). */
  static async _addCost() {
    if (!this.item.isOwner) return;
    const costs = this.item.toObject().system.costs ?? [];
    await this.item.update({ 'system.costs': [...costs, { resource: 'mana', amount: '1', max: '' }] });
  }

  /** Remove the cost row of the clicked button. */
  static async _removeCost(event, target) {
    if (!this.item.isOwner) return;
    const index = Number(target.dataset.index);
    const costs = (this.item.toObject().system.costs ?? []).filter((_, i) => i !== index);
    await this.item.update({ 'system.costs': costs });
  }

  /** Forget the item dropped on the clicked Ammunition row (its tag stays). */
  static async _clearAmmo(event, target) {
    if (!this.item.isOwner) return;
    const index = Number(target.dataset.index);
    const costs = this.item.toObject().system.costs ?? [];
    if (!costs[index]) return;
    costs[index].name = '';
    costs[index].identifier = '';
    await this.item.update({ 'system.costs': costs });
  }

  /** An inventory item dropped on an Ammunition row is what the row spends. */
  async _onDropAmmo(zone, data) {
    if (!this.item.isOwner) return false;
    const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
    if (dropped?.type !== 'item') {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Costs.AmmoWrongDrop'));
      return false;
    }
    const index = Number(zone.dataset.index);
    const costs = this.item.toObject().system.costs ?? [];
    if (!costs[index]) return false;
    costs[index].name = dropped.name;
    costs[index].identifier = (dropped.system.identifier ?? '').trim();
    await this.item.update({ 'system.costs': costs });
    return true;
  }
};
