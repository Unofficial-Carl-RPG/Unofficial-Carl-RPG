/**
 * Item sheet: the Upgrades tab of a skill or spell.
 */
import { resetCooldown } from '../helpers/damage-effects.mjs';

export const ItemSheetUpgrades = (Base) => class ItemSheetUpgrades extends Base {
  /**
   * Add an upgrade, at the next default rank that isn't used yet (5, 10, 15,
   * 20, then every 5). The list is kept in rank order.
   */
  static async _addUpgrade() {
    const { defaultRanks, rankStep } = CONFIG.CARL_RPG.upgrades;
    await this._updateEvents((system) => {
      const used = new Set(system.upgrades.map((u) => u.rank));
      const rank =
        defaultRanks.find((r) => !used.has(r)) ??
        Math.max(0, ...used, ...defaultRanks) + rankStep;
      system.upgrades.push({
        id: foundry.utils.randomID(),
        rank,
        description: '',
        changes: [],
        grants: [],
        unlocksEffects: [],
        events: [],
      });
      system.upgrades.sort((a, b) => a.rank - b.rank);
    });
  }

  /** @this CarlRPGItemSheet */
  static async _removeUpgrade(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => system.upgrades.splice(ui, 1));
  }

  /** Clear a Damage Effect's cooldown by hand (the owner can). @this CarlRPGItemSheet */
  static async _resetCooldown() {
    if (this.isEditable) await resetCooldown(this.item);
  }

  /** @this CarlRPGItemSheet */
  static async _addChange(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => {
      system.upgrades[ui].changes.push({ type: 'damageAdd', value: '', stat: 'str' });
    });
  }

  /** @this CarlRPGItemSheet */
  static async _removeChange(event, target) {
    const ui = Number(target.dataset.ui);
    const ci = Number(target.dataset.ci);
    await this._updateEvents((system) => system.upgrades[ui].changes.splice(ci, 1));
  }
};
