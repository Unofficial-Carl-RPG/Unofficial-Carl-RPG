import { CarlRPGDialog } from '../helpers/dialog.mjs';
import { effectKey, lockedRankFor } from '../helpers/upgrades.mjs';
import { groupNameOf, slotMates, usedBuffSlots } from '../helpers/buff-slots.mjs';
import {
  clearPercentRows,
  percentChanges,
  percentRowsOf,
  settlePercentRows,
  totalOf,
} from '../helpers/percent-mods.mjs';

const NS = 'carl-rpg';

/**
 * Carl RPG effects. Every effect is the same kind of ActiveEffect; its details
 * (stored in this system's flags) decide how it behaves:
 *
 *  kind          buff | debuff | passive (see CONFIG.CARL_RPG.effectKinds)
 *  identifier    finds "the same" effect on an actor (duplicate checks)
 *  stackable     debuffs only: applying it again adds a stack
 *  maxStacks     optional cap on stacks (blank = no limit)
 *  stacks        current stacks of a stackable debuff
 *  stackBuff     buffs only: shares one buff slot with its group and switches on and off with it
 *  stackAs       the group's name (blank = this effect's identifier, else its name)
 *  permanent     keep this effect on the actor when the item that gave it is removed
 *  equipLinked   only on while the gear that gave it is equipped
 *  sourceItems   ids of the actor's items that gave this effect
 *  percentMods   [{stat, percent, flat}]: a percent of the actor's stat, worked out once when the
 *                effect lands on an actor and kept as a flat number (see helpers/percent-mods.mjs)
 *
 * What an effect changes is stored in the normal `changes` list, which the
 * system keeps pointed at `system.bonuses.*` (see CONFIG.CARL_RPG.effectModifiers).
 */
export class CarlRPGActiveEffect extends ActiveEffect {
  /*  Details                                     */

  get kind() {
    return this.getFlag(NS, 'kind') ?? 'buff';
  }

  get identifier() {
    return (this.getFlag(NS, 'identifier') ?? '').trim();
  }

  get stackable() {
    return this.kind === 'debuff' && !!this.getFlag(NS, 'stackable');
  }

  /** The most stacks allowed, or null for no limit. */
  get maxStacks() {
    return Number(this.getFlag(NS, 'maxStacks')) || null;
  }

  get stacks() {
    return Math.max(1, Number(this.getFlag(NS, 'stacks')) || 1);
  }

  /**
   * The group this buff shares a buff slot with, or null when it doesn't stack.
   * Buffs of one group switch on and off together and use a single slot.
   */
  get slotGroup() {
    return groupNameOf(
      this.kind,
      !!this.getFlag(NS, 'stackBuff'),
      this.getFlag(NS, 'stackAs'),
      effectKey(this)
    );
  }

  /** The other effects on the actor that share this buff's slot. */
  get slotMates() {
    const actor = this.actor;
    return actor ? slotMates(actor.effects, this) : [];
  }

  get permanent() {
    return !!this.getFlag(NS, 'permanent');
  }

  get equipLinked() {
    return !!this.getFlag(NS, 'equipLinked');
  }

  /** The percent modifiers, each with the flat number it was worked out to (or null). */
  get percentMods() {
    return percentRowsOf(this.flags?.[NS]);
  }

  get sourceItems() {
    return this.getFlag(NS, 'sourceItems') ?? [];
  }

  /** The actor this effect is on, if any (as opposed to an effect on an item). */
  get actor() {
    return this.parent instanceof Actor ? this.parent : null;
  }

  /** Whether the equipped state of the gear that gave this effect controls it. */
  get equipControlled() {
    const actor = this.actor;
    if (!actor || !this.equipLinked) return false;
    return this.sourceItems.some((id) => actor.items.get(id)?.type === 'gear');
  }

  /**
   * The rank at which this effect unlocks, if a skill or spell that gave it holds
   * it back through an upgrade and hasn't reached that rank; otherwise null. An
   * effect any of its sources doesn't hold back is free to use.
   * @returns {number|null}
   */
  get lockedUntilRank() {
    return this.lockedRank();
  }

  /**
   * See `lockedUntilRank`.
   * @param {{stored?: boolean}} [options]  `stored`: measure against stored ranks, not
   *   effective ones (a Skill rank bonus can't wait on itself)
   * @returns {number|null}
   */
  lockedRank({ stored = false } = {}) {
    const actor = this.actor;
    if (!actor) return null;
    const key = effectKey(this);
    // A pet's own upgrades can hold one of its effects back until a level.
    if (actor.type === 'pet') {
      const petLock = lockedRankFor(actor, key, stored);
      if (petLock !== null) return petLock;
    }
    const sources = this.sourceItems
      .map((id) => actor.items.get(id))
      .filter(Boolean);
    if (!sources.length) return null;
    let lowest = null;
    for (const source of sources) {
      const locked = lockedRankFor(source, key, stored);
      if (locked === null) return null;
      lowest = lowest === null ? locked : Math.min(lowest, locked);
    }
    return lowest;
  }

  /**
   * A locked effect has no effect on the actor until it is unlocked.
   * @override
   */
  get isSuppressed() {
    return super.isSuppressed || this.lockedUntilRank !== null;
  }

  /** Whether two effects are "the same" (by identifier, else by name). */
  static matches(a, b) {
    if (a.identifier && b.identifier) return a.identifier === b.identifier;
    return a.name === b.name;
  }

  /*  Applying                                    */

  /**
   * The flat numbers worked out from percents join the changes in memory (they are never
   * stored there, so the effect sheet's list of modifiers stays as typed).
   * @override
   */
  prepareBaseData() {
    super.prepareBaseData?.();
    // (prepared again without a reset: don't add them twice)
    const own = (this.changes ?? []).filter((change) => !change.carlPercent);
    const extra =
      this.parent instanceof Actor
        ? percentChanges(
            this.percentMods,
            CONFIG.CARL_RPG.effectModifiers,
            CONST.ACTIVE_EFFECT_MODES.ADD
          ).map((change) => ({ ...change, carlPercent: true }))
        : [];
    this.changes = [...own, ...extra];
  }

  /**
   * Stacks multiply a stackable debuff's numbers.
   * @override
   */
  apply(doc, change) {
    if (this.stackable && this.stacks > 1) {
      const value = Number(change.value);
      if (Number.isFinite(value)) {
        change = { ...change, value: String(value * this.stacks) };
      }
    }
    return super.apply(doc, change);
  }

  /** @override */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    // Effects on items are templates: they only take effect on an actor once
    // they have been copied there with the item, never directly.
    if (this.parent instanceof Item) this.updateSource({ transfer: false });

    // An effect dropped or copied onto an actor by hand has no source items
    // (granting an item's effects passes `carlGrant`, and sets its own).
    if (this.parent instanceof Actor && !options.carlGrant) {
      this.updateSource({
        [`flags.${NS}.sourceItems`]: [],
        [`flags.${NS}.stacks`]: 1,
      });
    }

    // Percent modifiers are worked out as the effect lands: on an actor from its current
    // totals, on an item (only a template) not at all.
    if (this.percentMods.length) {
      const rows =
        this.parent instanceof Actor
          ? settlePercentRows(this.percentMods, { totalOf: (stat) => totalOf(this.parent, stat) })
          : clearPercentRows(this.percentMods);
      this.updateSource({ [`flags.${NS}.percentMods`]: rows });
    }

    // An effect that lasts a number of rounds starts counting when it is on.
    if (this.parent instanceof Actor && !this.disabled && this.rounds > 0) {
      this.updateSource({ [`flags.${NS}.roundsLeft`]: this.rounds });
    }
  }

  /**
   * Switching an effect on starts its round count over. Only a GM saving an
   * effect's events marks them as approved (see helpers/events.mjs): anyone
   * else editing them clears the mark.
   * @override
   */
  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if (allowed === false) return false;
    if (changes.disabled === false && this.disabled && this.rounds > 0) {
      foundry.utils.setProperty(changes, `flags.${NS}.roundsLeft`, this.rounds);
    }
    if (foundry.utils.hasProperty(changes, `flags.${NS}.events`)) {
      foundry.utils.setProperty(changes, `flags.${NS}.eventsTrusted`, user.isGM);
    }
    // Edited percent modifiers: a row that is new or changed is worked out now from the
    // actor's total without this effect's own old number; the others keep theirs.
    const edited = foundry.utils.getProperty(changes, `flags.${NS}.percentMods`);
    if (Array.isArray(edited)) {
      const rows = this.actor
        ? settlePercentRows(edited, {
            totalOf: (stat) => totalOf(this.actor, stat),
            prev: this.percentMods,
            own: (row) => (this.disabled || this.isSuppressed ? 0 : row.flat * (this.stackable ? this.stacks : 1)),
          })
        : clearPercentRows(edited);
      foundry.utils.setProperty(changes, `flags.${NS}.percentMods`, rows);
    }
  }

  /** How many rounds this effect lasts once it is on (0 = no round limit). */
  get rounds() {
    return Math.max(0, Math.trunc(Number(this.getFlag(NS, 'rounds')) || 0));
  }

  /** How many rounds are left, for an effect that is on and counts them. */
  get roundsLeft() {
    if (this.disabled || this.rounds < 1) return 0;
    return Number(this.getFlag(NS, 'roundsLeft')) || this.rounds;
  }

  /*  Turning effects on and off                  */

  /**
   * Turn this effect on or off (toggles by default), following the rules:
   * equipment-controlled effects can't be switched by hand, only 3 buffs can
   * be active (a prompt asks which to swap out), and turning on a stackable
   * debuff that is already on adds a stack.
   *
   * @param {boolean} [active]  The wanted state (defaults to toggling)
   * @returns {Promise<boolean>}  Whether the effect is on afterwards
   */
  async setActive(active = this.disabled) {
    const actor = this.actor;
    // Effects on items are just templates: no rules, just the switch.
    if (!actor) {
      await this.update({ disabled: !active });
      return active;
    }

    if (this.equipControlled) {
      ui.notifications.warn(
        game.i18n.format('CARL_RPG.Effect.EquipControlled', { name: this.name })
      );
      return !this.disabled;
    }

    // An effect that an upgrade hasn't unlocked yet can't be switched on.
    const lockedUntil = this.lockedUntilRank;
    if (active && lockedUntil !== null) {
      ui.notifications.warn(
        game.i18n.format('CARL_RPG.Upgrades.EffectLocked', {
          name: this.name,
          rank: lockedUntil,
        })
      );
      return false;
    }

    if (!active) {
      // A stacking buff switches off together with the rest of its group.
      const off = [this, ...this.slotMates].filter((e) => !e.disabled);
      if (off.length) {
        await actor.updateEmbeddedDocuments(
          'ActiveEffect',
          off.map((e) => ({ _id: e.id, disabled: true, [`flags.${NS}.stacks`]: 1 }))
        );
      }
      return false;
    }

    // Group members that come on with this buff (the ones an upgrade has unlocked).
    const mates = this.slotMates.filter(
      (e) => e.disabled && e.lockedUntilRank === null
    );

    // Turning on a stackable debuff that is already on adds a stack instead.
    // A stacking buff that is already on just brings the rest of its group along.
    if (!this.disabled) {
      if (this.stackable) await this.changeStacks(1);
      else if (mates.length) await this.#switchOn(mates);
      return true;
    }

    if (this.kind === 'buff') {
      // A group that is already on has its slot; otherwise this needs a free one.
      const groupOn = this.slotMates.some((e) => !e.disabled);
      const activeBuffs = usedBuffSlots(actor.effects, this);
      if (!groupOn && activeBuffs.length >= CONFIG.CARL_RPG.maxActiveBuffs) {
        return this.#swapForBuff(activeBuffs, mates);
      }
    }

    await this.#switchOn([this, ...mates]);
    return true;
  }

  /** Switch these effects on (each starts with one stack). */
  async #switchOn(effects) {
    await this.actor.updateEmbeddedDocuments(
      'ActiveEffect',
      effects.map((e) => ({
        _id: e.id,
        disabled: false,
        [`flags.${NS}.stacks`]: 1,
      }))
    );
  }

  /**
   * All buff slots are in use: ask which active buff to swap out for this one.
   * @param {CarlRPGActiveEffect[]} activeBuffs  One per slot in use
   * @param {CarlRPGActiveEffect[]} turnOn  Group members that come on with this one
   * @returns {Promise<boolean>}
   */
  async #swapForBuff(activeBuffs, turnOn) {
    const esc = Handlebars.escapeExpression;
    const choice = await CarlRPGDialog.wait({
      window: { title: game.i18n.localize('CARL_RPG.Effect.Swap.Title') },
      content: `<p>${game.i18n.format('CARL_RPG.Effect.Swap.Full', {
        limit: CONFIG.CARL_RPG.maxActiveBuffs,
        name: esc(this.name),
      })}</p>`,
      buttons: [
        ...activeBuffs.map((e) => ({
          action: e.id,
          label: game.i18n.format('CARL_RPG.Effect.Swap.Button', {
            name: esc(e.name),
          }),
        })),
        { action: 'cancel', label: game.i18n.localize('Cancel') },
      ],
      rejectClose: false,
    });
    if (!choice || choice === 'cancel') return false;

    // Swapping out a group of stacking buffs switches off the whole group.
    const dropped = this.actor.effects.get(choice);
    const off = dropped
      ? [dropped, ...dropped.slotMates].filter((e) => !e.disabled)
      : [];
    await this.actor.updateEmbeddedDocuments('ActiveEffect', [
      ...off.map((e) => ({ _id: e.id, disabled: true })),
      ...[this, ...turnOn].map((e) => ({
        _id: e.id,
        disabled: false,
        [`flags.${NS}.stacks`]: 1,
      })),
    ]);
    return true;
  }

  /**
   * Add or remove stacks on a stackable debuff. Removing the last stack turns
   * the effect off. Does nothing for effects that can't stack.
   *
   * @param {number} delta  Stacks to add (positive) or remove (negative)
   * @returns {Promise<boolean>}  Whether anything changed
   */
  async changeStacks(delta) {
    if (!this.stackable || !this.actor || this.equipControlled) return false;
    if (delta > 0 && this.lockedUntilRank !== null) return false;

    // Adding a stack to a debuff that is off just turns it on with one stack.
    if (this.disabled) {
      if (delta > 0) {
        await this.update({ disabled: false, [`flags.${NS}.stacks`]: 1 });
        return true;
      }
      return false;
    }

    let stacks = this.stacks + delta;
    if (this.maxStacks) stacks = Math.min(stacks, this.maxStacks);
    if (stacks < 1) {
      await this.update({ disabled: true, [`flags.${NS}.stacks`]: 1 });
    } else {
      await this.update({ [`flags.${NS}.stacks`]: stacks });
    }
    return true;
  }

  /** Remove every stack, turning the debuff off. */
  async removeAllStacks() {
    if (!this.actor || this.equipControlled) return false;
    await this.update({ disabled: true, [`flags.${NS}.stacks`]: 1 });
    return true;
  }

  /*  Links to the items that gave this effect    */

  /**
   * Record another item as a source of this effect (the actor already had it).
   * A stackable debuff gains a stack for each source.
   * @param {Item} item
   */
  async addSource(item) {
    const sources = this.sourceItems;
    if (sources.includes(item.id)) return;
    const update = { [`flags.${NS}.sourceItems`]: [...sources, item.id] };
    if (this.stackable) {
      let stacks = this.stacks + 1;
      if (this.maxStacks) stacks = Math.min(stacks, this.maxStacks);
      update[`flags.${NS}.stacks`] = stacks;
    }
    await this.update(update);
  }

  /**
   * An item that gave this effect was removed. The effect goes with the last
   * source unless it is marked permanent, in which case it stays (and is no
   * longer controlled by any gear).
   * @param {Item} item
   */
  async removeSource(item) {
    const remaining = this.sourceItems.filter((id) => id !== item.id);
    if (remaining.length === 0 && !this.permanent) {
      await this.delete();
      return;
    }
    const update = { [`flags.${NS}.sourceItems`]: remaining };
    if (this.stackable && remaining.length > 0) {
      update[`flags.${NS}.stacks`] = Math.max(1, this.stacks - 1);
    }
    await this.update(update);
  }
}
