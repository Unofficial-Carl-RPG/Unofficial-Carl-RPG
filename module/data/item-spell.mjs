import CarlRPGFeature from './item-feature.mjs';
import { manaCostOf } from './costs.mjs';

/**
 * A spell is a skill (description, rank, advanceable, stat, rolled formula)
 * that also has a mana cost.
 */
export default class CarlRPGSpell extends CarlRPGFeature {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Spell',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // (The Mana a spell spends is one of its costs, see data/costs.mjs.)
    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    // The Mana its costs add up to (never stored), for the lists and badges.
    this.manaCost = manaCostOf(this.costs);
  }
}
