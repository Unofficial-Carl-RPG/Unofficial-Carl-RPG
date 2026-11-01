import CarlRPGActorBase from './base-actor.mjs';

/**
 * A mount or vehicle, owned by a crawler (`owner`). Its health boxes equal its Size
 * Class (Tiny 1 up to Gargantuan 8), capped at 10. Its Damage Resistance and Move
 * are typed in by the GM. Moving does not cost an action. It has up to two attack
 * rows and an optional Trample attack, plus lists of occupants and accessories.
 */
export default class CarlRPGMount extends CarlRPGActorBase {
  static LOCALIZATION_PREFIXES = [
    ...super.LOCALIZATION_PREFIXES,
    'CARL_RPG.Actor.Mount',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // The crawler this mount belongs to: the id of a crawler actor, or blank.
    schema.owner = new fields.StringField({ required: true, blank: true, initial: '' });

    schema.dr = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.move = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Two attack rows: a name, a roll and a damage formula.
    const attackRow = () =>
      new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: '' }),
        roll: new fields.StringField({ required: true, blank: true, initial: '' }),
        damage: new fields.StringField({ required: true, blank: true, initial: '' }),
      });
    schema.attacks = new fields.ArrayField(attackRow(), { max: 2 });

    // An optional Trample attack, with its own damage formula.
    schema.trample = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      damage: new fields.StringField({ required: true, blank: true, initial: '' }),
    });

    schema.specialNotes = new fields.StringField({ required: true, blank: true, initial: '' });
    schema.occupants = new fields.ArrayField(
      new fields.StringField({ required: true, blank: true, initial: '' })
    );
    schema.accessories = new fields.ArrayField(
      new fields.StringField({ required: true, blank: true, initial: '' })
    );

    return schema;
  }

  prepareDerivedData() {
    // Health boxes: the Size Class (Tiny 1 up to Gargantuan 8), never more than 10.
    const sizeClass = Math.max(1, Object.keys(CONFIG.CARL_RPG.sizes).indexOf(this.size) + 1);
    this.health.max = Math.min(10, sizeClass);
    this.health.value = Math.min(Math.max(this.health.value, 0), this.health.max);
  }
}
