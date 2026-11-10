import CarlRPGItemBase from './base-item.mjs';
import { skillRollFormula, NO_STAT } from '../helpers/stat-term.mjs';

/**
 * A Mob Ability: the mob version of a skill or spell. It has a description, a
 * stat and a rank (a flat bonus), and rolls 1d20 + stat modifier + rank.
 */
export default class CarlRPGMobAbility extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.MobAbility',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.rank = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });

    schema.stat = new fields.StringField({
      trim: true,
      choices: Object.keys(CONFIG.CARL_RPG.skillStats),
      initial: NO_STAT,
      required: true,
    });

    schema.formula = new fields.StringField({ blank: true });

    return schema;
  }

  prepareDerivedData() {
    this.formula = skillRollFormula(this.stat, this.rank);
  }
}
