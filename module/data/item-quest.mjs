import CarlRPGItemBase from './base-item.mjs';

/**
 * A quest: a title (its name), a description, a giver, an optional deadline (a
 * floor or a days-left count, shown as a label only), objectives the crawler's
 * owner ticks, and a reward the GM pays when completing it: gold, a loot box
 * and an achievement. The GM gives a quest to a crawler, which copies it onto
 * the crawler's sheet (see the Quests tab).
 */
export default class CarlRPGQuest extends CarlRPGItemBase {
  static LOCALIZATION_PREFIXES = [
    'CARL_RPG.Item.base',
    'CARL_RPG.Item.Quest',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.giver = new fields.StringField({ required: true, blank: true, initial: '' });

    schema.deadline = new fields.SchemaField({
      type: new fields.StringField({
        required: true,
        blank: false,
        choices: ['none', 'floor', 'days'],
        initial: 'none',
      }),
      value: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
      }),
    });

    schema.objectives = new fields.ArrayField(
      new fields.SchemaField({
        text: new fields.StringField({ required: true, blank: true, initial: '' }),
        done: new fields.BooleanField({ initial: false }),
      })
    );

    schema.rewardGold = new fields.NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      initial: 0,
    });
    // The reward loot box and achievement (UUIDs; blank for none).
    schema.rewardBox = new fields.StringField({ required: true, blank: true, initial: '' });
    schema.rewardAchievement = new fields.StringField({ required: true, blank: true, initial: '' });

    // Set on a crawler's copy once the GM completes it.
    schema.completed = new fields.BooleanField({ initial: false });

    return schema;
  }
}
