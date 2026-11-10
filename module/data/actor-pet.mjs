import CarlRPGCrawler from './actor-crawler.mjs';
import { upgradesField } from './upgrade-field.mjs';
import { computePetUpgrades } from '../helpers/upgrades.mjs';
import { healthSlotRowsOf } from '../helpers/build-mods.mjs';
import { capacityOf, slotCountOf, slotValues } from '../helpers/health-slots.mjs';

/**
 * A pet: a companion that belongs to a crawler (`owner`). It has the five stats,
 * a level, health, mana and the same defenses as a crawler, and it levels up the
 * same way (3 stat points per level), except that its points can be spent at any
 * floor. Its skills and spells work like a crawler's, but use the current floor in
 * place of a rank (see data/item-feature.mjs). Its health bar grows with its
 * level instead of always having 10 boxes (see prepareDerivedData). It can wear
 * gear but has no inventory.
 *
 * It is built on the crawler's data model so everything the two share (stats,
 * health, mana, Evade, Damage Resistance, Move, effects) is worked out in one
 * place. The fields that only matter to a crawler (gold, hotlist, race and class,
 * ...) are carried along but never shown or used.
 */
export default class CarlRPGPet extends CarlRPGCrawler {
  static LOCALIZATION_PREFIXES = [
    ...super.LOCALIZATION_PREFIXES,
    'CARL_RPG.Actor.Pet',
  ];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The crawler this pet belongs to: the id of a crawler actor, or blank.
    schema.owner = new fields.StringField({
      required: true,
      blank: true,
      initial: '',
    });

    // Upgrades: what the pet gains at a level (15 by default, but any level can be
    // set). Every upgrade at or below its level applies, worked out as the pet's
    // numbers are prepared rather than written to it (see helpers/upgrades.mjs).
    schema.upgrades = upgradesField();
    // Whether the upgrades (and the events they carry) were last saved by a GM.
    schema.eventsTrusted = new fields.BooleanField({ initial: false });

    return schema;
  }

  prepareDerivedData() {
    // The upgrades the pet has reached add to its stats and other numbers the way
    // active effects do (so they show up as bonuses), and can change its size.
    // Nothing here is saved: the pet's own fields stay as they were typed.
    const upgrades = computePetUpgrades(this);
    for (const [key, amount] of Object.entries(upgrades.bonuses)) {
      this.bonuses[key] = (this.bonuses[key] ?? 0) + amount;
    }
    this.effectiveSize = upgrades.size;
    this.upgradeGrants = upgrades.grants;
    this.unlockedUpgrades = upgrades.unlocked;

    super.prepareDerivedData();
    // A pet's level up points can be spent at any floor (a crawler's can only be
    // spent from the third).
    this.points.canSpend = true;

    // Health boxes: a crawler always has 10, but a pet starts at level 1 with as
    // many as its Size Class (Tiny is 1, up to Gargantuan 8) and gains one box
    // with every level, up to 10: min(10, size + (level - 1)). Each box is still
    // worth the CON modifier in damage.
    const sizeClass = Math.max(
      1,
      Object.keys(CONFIG.CARL_RPG.sizes).indexOf(this.effectiveSize) + 1
    );
    const levelsGained = Math.max(0, this.attributes.level.value - 1);
    const boxes = Math.min(10, sizeClass + levelsGained);
    this.health.max = slotCountOf(boxes, this.bonuses.healthSlots);
    this.health.value = Math.min(Math.max(this.health.value, 0), this.health.max);
    this.health.slots = slotValues(this.health.max, this.health.perBox, healthSlotRowsOf(this.parent));
    this.health.capacity = capacityOf(this.health.slots);
  }
}
