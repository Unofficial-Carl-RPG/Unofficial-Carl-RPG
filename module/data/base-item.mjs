/**
 * The events field: a list of events (trigger, conditions, actions). Items hold one,
 * and each upgrade of a skill or spell holds its own (see helpers/upgrades.mjs).
 */
export function eventsField() {
  const fields = foundry.data.fields;
  const requiredString = (initial = '') =>
    new fields.StringField({ required: true, blank: true, initial });
  const number = (initial = 0) =>
    new fields.NumberField({ required: true, nullable: false, initial });
  return new fields.ArrayField(
      new fields.SchemaField({
        id: requiredString(),
        // A label for the event (shown in its summary and in "run another event").
        name: requiredString(),
        enabled: new fields.BooleanField({ initial: true }),
        trigger: requiredString('used'),
        phase: requiredString('any'),
        // Whether all of the conditions have to be true ('all') or any one ('any').
        match: requiredString('all'),
        conditions: new fields.ArrayField(
          new fields.SchemaField({
            type: requiredString('mana'),
            // True for "NOT": the condition has to be false.
            negate: new fields.BooleanField({ initial: false }),
            stat: requiredString('str'),
            value: number(1),
            phase: requiredString('any'),
            // For the "the attack's result is" condition (see helpers/attacks.mjs).
            degree: requiredString('success'),
            uuid: requiredString(),
            tag: requiredString(),
            // A choice from a menu (the kind of target, the kind of rest).
            text: requiredString(),
          })
        ),
        actions: new fields.ArrayField(
          new fields.SchemaField({
            type: requiredString('useItem'),
            mode: requiredString(),
            uuid: requiredString(),
            amount: requiredString('1'),
            targetActor: requiredString(),
            runOn: requiredString('user'),
            selfItem: new fields.BooleanField({ initial: false }),
            skipIfHas: new fields.BooleanField({ initial: true }),
            ignoreDR: new fields.BooleanField({ initial: false }),
            // Ask the player first, and skip the action if they say no.
            ask: new fields.BooleanField({ initial: false }),
            // The text of a chat message.
            text: requiredString(),
            // A group the action affects instead of one actor (see
            // CONFIG.CARL_RPG.eventTargetGroups); blank is the owner.
            targetGroup: requiredString(),
          })
        ),
      })
    );
}

export default class CarlRPGItemBase extends foundry.abstract
  .TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = {};

    schema.description = new fields.HTMLField();

    // A unique-ish key for the item (used for things like duplicate checks).
    schema.identifier = new fields.StringField({
      required: true,
      blank: true,
      trim: true,
      initial: '',
    });

    // What the item's roll is checked against (see helpers/attacks.mjs): nothing
    // (unopposed: 10 + 2 x the Floor), a target's Evade (an attack), one of a
    // target's stats or its Size Class (10 + that + the Floor). Unopposed by
    // default.
    schema.check = new fields.SchemaField({
      target: new fields.StringField({
        required: true,
        blank: false,
        choices: Object.keys(CONFIG.CARL_RPG.checkTargets),
        initial: 'unopposed',
      }),
      // For items used by a mob. Mobs never roll a d20: a crawler rolls against
      // this number + the Floor instead (see helpers/attacks.mjs).
      number: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0,
      }),
    });

    // Damage: a number or dice formula (e.g. "1d6+@str.mod"). Rolled when the
    // item's check succeeds against a target (doubled dice on a natural 20), and
    // the GM can apply it from the chat card (see helpers/attacks.mjs). Blank
    // for items that don't deal damage.
    schema.damage = new fields.StringField({
      required: true,
      blank: true,
      initial: '',
    });

    // Tags: plain text labels that rules can ask for (see helpers/tags.mjs).
    schema.tags = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false })
    );

    // The event system (see helpers/events.mjs). Requirements must be met for
    // the item to be used at all; events run when their trigger fires.
    const requiredString = (initial = '') =>
      new fields.StringField({ required: true, blank: true, initial });
    const number = (initial = 0) =>
      new fields.NumberField({ required: true, nullable: false, initial });

    schema.requirements = new fields.ArrayField(
      new fields.SchemaField({
        type: requiredString('mana'),
        stat: requiredString('str'),
        value: number(1),
        tag: requiredString(),
      })
    );

    schema.events = eventsField();

    // Usage limits: how many times the item can be used before it has to recharge
    // (0 = no limit), and how often it recharges. `spent` counts the uses so far.
    // See helpers/uses.mjs.
    schema.uses = new fields.SchemaField({
      max: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
      }),
      spent: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
      }),
      recharge: new fields.StringField({
        required: true,
        blank: false,
        choices: Object.keys(CONFIG.CARL_RPG.usesRecharge),
        initial: 'never',
      }),
    });

    // Whether the events were last saved by a GM. Only events saved by a GM may
    // be carried out by the GM's client for a player (macros run on the GM's
    // client, changes to actors the player doesn't own). See helpers/events.mjs.
    schema.eventsTrusted = new fields.BooleanField({ initial: false });

    return schema;
  }

  /**
   * Gear and items used to embed a single skill in `embeddedSkill`; they now
   * hold a list in `skills`.
   * @inheritdoc
   */
  static migrateData(source) {
    if (source.embeddedSkill && !source.skills) {
      source.skills = [source.embeddedSkill];
    }
    // The check used to be a type (unopposed, attack, opposed) and a stat; it is
    // now a single target. Items with a damage formula used to attack against
    // Evade automatically.
    if (source.check?.type && source.check.target === undefined) {
      const { type, stat } = source.check;
      source.check = {
        target:
          type === 'attack' ? 'evade' : type === 'opposed' ? (stat ?? 'dex') : 'unopposed',
      };
    } else if (!source.check && source.damage?.trim()) {
      source.check = { target: 'evade' };
    }
    return super.migrateData(source);
  }
}
