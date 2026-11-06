import CarlRPGItemBase from './base-item.mjs';
import { upgradesField } from './upgrade-field.mjs';
import { computeEffective } from '../helpers/upgrades.mjs';
import { effectRules } from '../helpers/damage-effects.mjs';
import { modRules } from '../helpers/roll-mods.mjs';

export default class CarlRPGFeature extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Skill',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Rank of the skill (whole number, never negative).
    schema.rank = new fields.NumberField({
      ...requiredInteger,
      initial: 0,
      min: 0,
    });

    // Whether this skill is able to be advanced.
    schema.advanceable = new fields.BooleanField({
      initial: false,
      nullable: false,
      required: true
    });

    // A passive skill doesn't use an action when it is used: it just shows its
    // effects in chat (and rolls whatever dice it has). A passive spell works the
    // same but still spends its mana cost.
    schema.passive = new fields.BooleanField({
      initial: false,
      nullable: false,
      required: true,
    });

    schema.stat = new fields.StringField({
      trim: true,
      choices: Object.keys(CONFIG.CARL_RPG.abilities),
      initial: 'str',
      required: true
    });

    schema.formula = new fields.StringField({ blank: true });

    // Upgrades: what the skill gains as its rank goes up (by default at ranks 5,
    // 10, 15 and 20). Every upgrade at or below the current rank applies, and
    // the changes are worked out when the skill is used rather than written to
    // it (see helpers/upgrades.mjs).
    schema.upgrades = upgradesField();

    // A Damage Effect: a passive skill chosen before rolling to hit with one of the
    // attack skills listed here (see helpers/damage-effects.mjs). What it does comes
    // from its upgrades; the cooldown is its state (hours left, or used this round).
    schema.damageEffect = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false, nullable: false, required: true }),
      skills: new fields.StringField({ required: true, blank: true, initial: '' }),
      cooldownHours: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      cooldownRound: new fields.BooleanField({ initial: false, nullable: false, required: true }),
    });

    // A Roll Modifier: a passive skill chosen before rolling one of the skills listed here
    // (or applied to its own use when it lists "self"); see helpers/roll-mods.mjs. What it
    // does comes from its upgrades.
    schema.rollMod = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false, nullable: false, required: true }),
      skills: new fields.StringField({ required: true, blank: true, initial: '' }),
    });

    return schema;
  }

  /**
   * Skills used to store their rank as `ranks`.
   * @inheritdoc
   */
  static migrateData(source) {
    if (source.ranks !== undefined && source.rank === undefined) {
      source.rank = source.ranks;
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    // A pet's skills have no rank of their own: the current floor takes its place
    // everywhere (the roll bonus, upgrades, ...), and follows the floor as it changes.
    if (this.parent?.parent?.type === 'pet') {
      this.rank = CONFIG.CARL_RPG.getFloor();
    }

    // What this skill uses at its current rank, with its upgrades applied
    // (never stored: the skill's own fields stay as they were typed).
    this.effective = computeEffective(this);

    // What a Damage Effect does at its current rank (never stored).
    this.damageRules = this.damageEffect?.enabled ? effectRules(this) : null;

    // What a Roll Modifier does at its current rank (never stored).
    this.rollModRules = this.rollMod?.enabled ? modRules(this) : null;

    // An upgrade can add a bonus to the roll.
    const bonus = this.effective.rollBonus;
    this.formula =
      `1d20 + @${this.stat}.mod + ${this.rank}` +
      (bonus ? ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}` : '');
  }
}
