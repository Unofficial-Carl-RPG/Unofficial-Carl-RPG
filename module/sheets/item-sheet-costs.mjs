/**
 * Item sheet: the list of costs an item spends when used (see data/costs.mjs).
 */

export const ItemSheetCosts = (Base) => class ItemSheetCosts extends Base {
  /** Add a cost row (Mana, 1 to start). */
  static async _addCost() {
    if (!this.item.isOwner) return;
    const costs = this.item.toObject().system.costs ?? [];
    await this.item.update({ 'system.costs': [...costs, { resource: 'mana', amount: 1 }] });
  }

  /** Remove the cost row of the clicked button. */
  static async _removeCost(event, target) {
    if (!this.item.isOwner) return;
    const index = Number(target.dataset.index);
    const costs = (this.item.toObject().system.costs ?? []).filter((_, i) => i !== index);
    await this.item.update({ 'system.costs': costs });
  }
};
