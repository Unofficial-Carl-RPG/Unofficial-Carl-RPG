import { eventsField } from './base-item.mjs';

/**
 * The upgrades field, shared by skills, spells and pets (see helpers/upgrades.mjs).
 * Each upgrade is reached at a rank (a pet's level) and holds:
 *  - a description (blank shows a summary of its changes)
 *  - changes picked from a menu (`type`, a `value` and, for a stat bonus, a `stat`; a Roll
 *    Modifier's changes also have an optional `when` condition; their bonus dice can name a
 *    damage type: `bonusType` and an optional second one, `bonusAlso`; an extra area shape's change
 *    can have a `size` of its own (an amount) and `keep`: also place the area's own shape)
 *  - the skills and spells it gives (`grants`, a pet's upgrades only)
 *  - the effects it unlocks (`unlocksEffects`, by identifier or name)
 *  - the events it carries, which only run once it has been reached
 */
export function upgradesField() {
  const fields = foundry.data.fields;
  const requiredString = (initial = '') =>
    new fields.StringField({ required: true, blank: true, initial });
  return new fields.ArrayField(
    new fields.SchemaField({
      id: requiredString(),
      rank: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 5,
        min: 0,
      }),
      description: requiredString(),
      changes: new fields.ArrayField(
        new fields.SchemaField({
          type: requiredString('damageAdd'),
          value: requiredString(),
          stat: requiredString('str'),
          when: requiredString(''),
          bonusType: requiredString(''),
          bonusAlso: requiredString(''),
          size: requiredString(''),
          keep: new fields.BooleanField({ initial: false }),
        })
      ),
      grants: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false })
      ),
      unlocksEffects: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false })
      ),
      events: eventsField(),
    })
  );
}
