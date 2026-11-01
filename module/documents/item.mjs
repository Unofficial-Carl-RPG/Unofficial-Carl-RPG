import { CarlRPGDialog } from '../helpers/dialog.mjs';
import { CarlRPGActiveEffect } from './active-effect.mjs';
import { checkRequirements, runEvents } from '../helpers/events.mjs';
import { grantLoot } from '../helpers/loot.mjs';
import { resolveCheck } from '../helpers/attacks.mjs';
import { describeUpgrades, effectiveOf } from '../helpers/upgrades.mjs';
import { shortTextOf } from '../helpers/item-badges.mjs';
import { offerAiFavor } from '../helpers/ai-favor.mjs';
import { spendUse, usesLeft } from '../helpers/uses.mjs';
import { declareInsteadOfUsing } from '../helpers/declarations.mjs';
import { updateWithRelay } from '../helpers/relay.mjs';
import {
  promptRoll,
  buildFormula,
  optionsNote,
  statOfFormula,
} from '../helpers/roll-dialog.mjs';
import { evaluatePrerequisites, raceOf } from '../helpers/origins.mjs';

/** What identifies an achievement: its identifier, or its name if it has none. */
const achievementKey = (item) => item.system.identifier?.trim() || item.name;

/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class CarlRPGItem extends Item {
  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    // As with the actor class, items are documents that can have their data
    // preparation methods overridden (such as prepareBaseData()).
    super.prepareData();
  }

  /**
   * Prepare a data object which defines the data schema used by dice roll commands against this Item
   * @override
   */
  getRollData() {
    // Starts off by populating the roll data with a shallow copy of `this.system`
    const rollData = { ...this.system };

    // Quit early if there's no parent actor
    if (!this.actor) return rollData;

    // If present, add the actor's roll data
    rollData.actor = this.actor.getRollData();

    return rollData;
  }

  /**
   * Equip or unequip this gear. Each slot holds a limited number of equipped
   * items (CONFIG.CARL_RPG.gearSlotLimits); if the slot is full a prompt asks
   * which equipped gear to swap out, and cancelling leaves everything as it was.
   *
   * @param {boolean} [equipped]  The new state (defaults to toggling)
   * @returns {Promise<boolean>}  Whether the gear is equipped afterwards
   */
  async toggleEquipped(equipped = !this.system.equipped) {
    if (this.type !== 'gear' || !(this.parent instanceof Actor)) return false;

    if (!equipped) {
      if (this.system.equipped) {
        await this.update({ 'system.equipped': false });
        await this.syncEquipEffects();
        await runEvents(this, 'unequipped');
      }
      return false;
    }
    if (this.system.equipped) return true;

    const slot = this.system.slot;
    const limit = CONFIG.CARL_RPG.gearSlotLimits[slot] ?? 1;
    const inSlot = this.parent.itemTypes.gear.filter(
      (g) => g !== this && g.system.equipped && g.system.slot === slot
    );
    if (inSlot.length < limit) {
      await this.update({ 'system.equipped': true });
      await this.#grantRollingSkill();
      await this.syncEquipEffects();
      await runEvents(this, 'equipped');
      return true;
    }

    // The slot is full: ask which equipped gear to swap out.
    const slotName = game.i18n.localize(CONFIG.CARL_RPG.gearSlots[slot]);
    const choice = await CarlRPGDialog.wait({
      window: {
        title: game.i18n.format('CARL_RPG.Item.Gear.Equip.Title', {
          slot: slotName,
        }),
      },
      content: `<p>${game.i18n.format('CARL_RPG.Item.Gear.Equip.Full', {
        slot: slotName,
        limit,
        item: Handlebars.escapeExpression(this.name),
      })}</p>`,
      buttons: [
        ...inSlot.map((g) => ({
          action: g.id,
          label: game.i18n.format('CARL_RPG.Item.Gear.Equip.Swap', {
            name: Handlebars.escapeExpression(g.name),
          }),
        })),
        { action: 'cancel', label: game.i18n.localize('Cancel') },
      ],
      rejectClose: false,
    });
    if (!choice || choice === 'cancel') return false;

    await this.parent.updateEmbeddedDocuments('Item', [
      { _id: choice, 'system.equipped': false },
      { _id: this.id, 'system.equipped': true },
    ]);
    await this.#grantRollingSkill();
    await this.parent.items.get(choice)?.syncEquipEffects();
    await this.syncEquipEffects();
    await runEvents(this.parent.items.get(choice), 'unequipped');
    await runEvents(this, 'equipped');
    return true;
  }

  /**
   * Switch the actor's effects that are tied to this gear's equipped state on
   * (equipped) or off (not equipped).
   */
  async syncEquipEffects() {
    const actor = this.parent;
    if (this.type !== 'gear' || !(actor instanceof Actor)) return;
    const equipped = this.system.equipped;
    const updates = actor.effects
      .filter(
        (e) =>
          e.equipLinked &&
          e.sourceItems.includes(this.id) &&
          e.disabled === equipped
      )
      .map((e) => ({ _id: e.id, disabled: !equipped }));
    if (updates.length) {
      await actor.updateEmbeddedDocuments('ActiveEffect', updates);
    }
  }

  /**
   * When an item is added to an actor, the skills embedded in it and the
   * effects on it are added to the actor too (see below).
   * @override
   */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    // Only the user who added the item does the work, once.
    if (userId === game.user.id) {
      // Everything an item grants when it is added. Awaiting `_grantsDone` waits
      // until it has all been done (used when choosing a race and then a class).
      this._grantsDone = (async () => {
        try {
          await Promise.all([
            this.#grantEmbeddedSkills(),
            this.#grantRankedSkills(),
            this.#grantEffects(),
            this.#grantAchievementReward(),
            this.#applyOrigin(options),
            this.#equipOnPet(),
          ]);
          await runEvents(this, 'added');
        } catch (err) {
          console.error('carl-rpg | granting from an added item failed', err);
        }
      })();
    }
  }

  /**
   * The uses this item has left, as a row of dots for the sheet's lists: true for a use
   * that is still there, false for one that has been spent. Empty if it has no limit.
   * @returns {boolean[]}
   */
  get usesPips() {
    const max = this.system?.uses?.max ?? 0;
    if (max < 1) return [];
    const left = usesLeft(this);
    return Array.from({ length: max }, (_, i) => i < left);
  }

  /**
   * Gear given to a pet is worn right away: a pet has no inventory to carry it
   * in. (If its slot is full, the usual prompt asks what to swap out.)
   */
  async #equipOnPet() {
    if (this.type !== 'gear' || this.parent?.type !== 'pet') return;
    if (this.system.equipped) return;
    await this.toggleEquipped(true);
  }

  /**
   * A crawler can only hold each achievement once.
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    // Backgrounds are only offered in character creation, so a crawler never
    // holds one.
    if (this.type === 'background' && this.parent instanceof Actor) {
      ui.notifications.warn(
        game.i18n.localize('CARL_RPG.Item.Background.NotOnActors')
      );
      return false;
    }

    // A pet has no inventory: it can only have gear (which it wears), skills and
    // spells.
    if (
      this.parent?.type === 'pet' &&
      !['gear', 'skill', 'spell'].includes(this.type)
    ) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Pets.OnlyGearSkills'));
      return false;
    }

    // Races and classes: players can only take them from the third floor, race
    // first, with their prerequisites met. The GM can assign any (noted in
    // chat). A crawler has one of each; a new one replaces the old after asking.
    if (
      ['race', 'class'].includes(this.type) &&
      this.parent instanceof Actor &&
      this.parent.type === 'crawler'
    ) {
      const actor = this.parent;
      const results = await evaluatePrerequisites(this, actor);
      const unmet = results.filter((r) => !r.met).map((r) => r.text);
      if (!user.isGM) {
        if (actor.system.floor < CONFIG.CARL_RPG.originFloor) {
          ui.notifications.warn(
            game.i18n.format('CARL_RPG.Origin.TooEarly', {
              floor: CONFIG.CARL_RPG.originFloor,
            })
          );
          return false;
        }
        if (this.type === 'class' && !raceOf(actor)) {
          ui.notifications.warn(game.i18n.localize('CARL_RPG.Origin.RaceFirst'));
          return false;
        }
        if (unmet.length) {
          ui.notifications.warn(
            game.i18n.format('CARL_RPG.Origin.Unmet', {
              name: this.name,
              reasons: unmet.join(' '),
            })
          );
          return false;
        }
      } else if (unmet.length) {
        options.carlPrereqOverride = unmet.join(' ');
      }

      const existing = actor.itemTypes[this.type][0];
      if (existing) {
        const replace = await CarlRPGDialog.confirm({
          window: { title: game.i18n.localize('CARL_RPG.Origin.Replace.Title') },
          content: `<p>${game.i18n.format('CARL_RPG.Origin.Replace.Content', {
            name: Handlebars.escapeExpression(actor.name),
            old: Handlebars.escapeExpression(existing.name),
            new: Handlebars.escapeExpression(this.name),
          })}</p>`,
          rejectClose: false,
        });
        if (!replace) return false;
        await existing.delete();
      }
    }

    if (this.type === 'achievement' && this.parent instanceof Actor) {
      const key = achievementKey(this);
      const has = this.parent.items.some(
        (i) => i.type === 'achievement' && achievementKey(i) === key
      );
      if (has) {
        ui.notifications.warn(
          game.i18n.format('CARL_RPG.Achievement.AlreadyHas', {
            name: this.parent.name,
            achievement: this.name,
          })
        );
        return false;
      }
    }
  }

  /**
   * The first time a crawler receives an achievement they are given the loot
   * box it names. Which achievements have paid out is remembered on the actor,
   * so removing and re-adding one doesn't pay a second time.
   */
  async #grantAchievementReward() {
    const actor = this.parent;
    if (this.type !== 'achievement' || !(actor instanceof Actor)) return;
    if (actor.type !== 'crawler') return;

    const key = achievementKey(this);
    const rewarded = actor.getFlag('carl-rpg', 'achievementsRewarded') ?? [];
    if (rewarded.includes(key)) return;
    await actor.setFlag('carl-rpg', 'achievementsRewarded', [...rewarded, key]);

    let box = null;
    if (this.system.lootBox) {
      const doc = await fromUuid(this.system.lootBox);
      if (doc?.documentName === 'Item' && doc.type === 'lootBox') box = doc;
      else {
        ui.notifications.warn(
          game.i18n.format('CARL_RPG.Achievement.RewardMissing', {
            achievement: this.name,
          })
        );
      }
    }
    if (box) {
      await grantLoot(actor, {
        items: [
          {
            uuid: box.uuid,
            name: box.name,
            img: box.img,
            identifier: box.system.identifier?.trim() ?? '',
            quantity: 1,
          },
        ],
        gold: 0,
      });
    }

    const esc = Handlebars.escapeExpression;
    // A banner: the achievement's picture (if it has one), its name, who earned it and
    // the loot box it paid (styled in the stylesheet, see helpers/chat-cards.mjs).
    const hasImage = this.img && !this.img.includes('mystery-man');
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="carl-achievement-card">
        <div class="ach-ribbon"><span>${game.i18n.localize('CARL_RPG.Achievement.Unlocked')}</span></div>
        <div class="ach-body">
          ${hasImage ? `<img class="ach-img" src="${esc(this.img)}" alt="" />` : '<i class="fas fa-trophy ach-trophy"></i>'}
          <div class="ach-text">
            <div class="ach-name">${esc(this.name)}</div>
            <div class="ach-who">${game.i18n.format('CARL_RPG.Achievement.EarnedBy', { name: esc(actor.name) })}</div>
            ${box ? `<div class="ach-reward"><i class="fas fa-gift"></i> ${game.i18n.format('CARL_RPG.Achievement.RewardLine', { box: esc(box.name) })}</div>` : ''}
          </div>
        </div>
      </div>`,
      flags: { 'carl-rpg': { card: { kind: 'achievement' } } },
    });
  }

  /**
   * Only a GM saving an item's events or requirements marks them as trusted
   * (see helpers/events.mjs); anyone else editing them clears the mark.
   * @override
   */
  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if (allowed === false) return false;
    const system = changes.system;
    if (
      system &&
      ('events' in system || 'requirements' in system || 'upgrades' in system)
    ) {
      foundry.utils.setProperty(changes, 'system.eventsTrusted', user.isGM);
    }
  }

  /**
   * A race or class adds the skills it grants at their set ranks. A skill the
   * crawler already has is raised to that rank if it is lower.
   */
  async #grantRankedSkills() {
    const actor = this.parent;
    if (!['race', 'class'].includes(this.type)) return;
    if (!(actor instanceof Actor)) return;

    const toCreate = [];
    for (const entry of this.system.grantedSkills ?? []) {
      const skill = await fromUuid(entry.uuid);
      if (!skill || skill.type !== 'skill') {
        ui.notifications.warn(
          game.i18n.format('CARL_RPG.Origin.SkillMissing', { name: this.name })
        );
        continue;
      }
      const identifier = skill.system.identifier?.trim();
      const matches = (s) =>
        identifier
          ? s.system.identifier?.trim() === identifier
          : s.name === skill.name;
      const owned = actor.itemTypes.skill.find(matches);
      if (owned) {
        if (owned.system.rank < entry.rank) {
          await owned.update({ 'system.rank': entry.rank });
        }
        continue;
      }
      if (toCreate.some((d) => matches({ name: d.name, system: d.system }))) continue;
      const data = game.items.fromCompendium(skill);
      foundry.utils.setProperty(data, 'system.rank', entry.rank);
      toCreate.push(data);
    }
    if (toCreate.length) await actor.createEmbeddedDocuments('Item', toCreate);
  }

  /**
   * A race or class is shown on the crawler sheet by name, and announced in
   * chat (noting when the GM assigned it without its prerequisites met).
   * @param {object} options  The creation options
   */
  async #applyOrigin(options = {}) {
    const actor = this.parent;
    if (!['race', 'class'].includes(this.type)) return;
    if (!(actor instanceof Actor) || actor.type !== 'crawler') return;

    const field = this.type === 'race' ? 'system.race' : 'system.className';
    await actor.update({ [field]: this.name });

    const esc = Handlebars.escapeExpression;
    const note = options.carlPrereqOverride
      ? `<div class="origin-override">${game.i18n.format(
          'CARL_RPG.Origin.OverrideNote',
          { unmet: options.carlPrereqOverride }
        )}</div>`
      : '';
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="carl-origin-card">${game.i18n.format(
        `CARL_RPG.Origin.Chosen.${this.type}`,
        { name: esc(actor.name), origin: esc(this.name) }
      )}${note}</div>`,
    });
  }

  /**
   * Effects on an item are templates. When the item is added to an actor they
   * are copied onto it, unless the actor already has the same effect (then the
   * item is just recorded as another source of it). Buffs start off; debuffs
   * and passives start on; effects tied to gear start on only if it's equipped.
   */
  async #grantEffects() {
    const actor = this.parent;
    if (!(actor instanceof Actor) || !this.effects.size) return;

    const toCreate = [];
    for (const template of this.effects) {
      const existing = actor.effects.find((e) =>
        CarlRPGActiveEffect.matches(e, template)
      );
      if (existing) {
        await existing.addSource(this);
        continue;
      }
      const queued = toCreate.some((d) =>
        CarlRPGActiveEffect.matches(
          { identifier: (d.flags?.['carl-rpg']?.identifier ?? '').trim(), name: d.name },
          template
        )
      );
      if (queued) continue;

      const data = template.toObject();
      delete data._id;
      data.transfer = false;
      data.origin = this.uuid;
      const tiedToGear = template.equipLinked && this.type === 'gear';
      data.disabled = tiedToGear ? !this.system.equipped : template.kind === 'buff';
      foundry.utils.setProperty(data, 'flags.carl-rpg.sourceItems', [this.id]);
      foundry.utils.setProperty(data, 'flags.carl-rpg.stacks', 1);
      toCreate.push(data);
    }

    if (toCreate.length) {
      await actor.createEmbeddedDocuments('ActiveEffect', toCreate, {
        carlGrant: true,
      });
    }
  }

  /**
   * When an item is removed from an actor, the effects it gave go with it
   * (unless marked permanent, or still given by another item).
   * @override
   */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    if (userId === game.user.id) {
      this.#releaseEffects();
      runEvents(this, 'removed');
      // A removed race or class no longer shows on the crawler sheet.
      if (
        ['race', 'class'].includes(this.type) &&
        this.parent instanceof Actor &&
        this.parent.type === 'crawler'
      ) {
        const field = this.type === 'race' ? 'race' : 'className';
        if (this.parent.system[field] === this.name) {
          this.parent.update({ [`system.${field}`]: '' });
        }
      }
    }
  }

  async #releaseEffects() {
    const actor = this.parent;
    if (!(actor instanceof Actor)) return;
    for (const effect of actor.effects.filter((e) =>
      e.sourceItems.includes(this.id)
    )) {
      await effect.removeSource(this);
    }
  }

  /**
   * The crawler's copy of the skill this weapon rolls with: the one marked
   * "Rolls with", or the first skill when none is marked.
   * @returns {Promise<Item|null>}
   */
  async rollingSkill() {
    if (this.type !== 'gear' || !(this.parent instanceof Actor)) return null;
    const uuids = this.system.skills ?? [];
    if (!uuids.length) return null;
    const chosen = uuids.includes(this.system.rollSkill) ? this.system.rollSkill : uuids[0];
    const source = await fromUuid(chosen);
    if (!source) return null;
    const keyOf = (skill) => skill.system.identifier?.trim() || skill.name;
    return this.parent.itemTypes.skill.find((s) => keyOf(s) === keyOf(source)) ?? null;
  }

  /**
   * Set up a roll with the weapon's skill: the formula takes that skill's stat,
   * its rank and roll bonus, and its damage is added to the weapon's damage.
   * @returns {Promise<{skill: Item, restore: Function}|null>}  null if no skill
   */
  async #useRollingSkill() {
    const skill = await this.rollingSkill();
    if (!skill) return null;
    const sys = this.system;
    const saved = { formula: sys.formula, damage: sys.damage };
    const { diceNum, diceSize } = sys.roll;
    const bonus = skill.system.effective?.rollBonus ?? 0;
    const rank = skill.system.rank ?? 0;
    sys.formula =
      `${diceNum}${diceSize} + @${skill.system.stat}.mod + ${rank}` +
      (bonus ? ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}` : '');
    const skillDamage = (skill.system.effective?.damage ?? '').trim();
    sys.damage = [String(saved.damage ?? '').trim(), skillDamage].filter(Boolean).join(' + ');
    return {
      skill,
      restore: () => {
        sys.formula = saved.formula;
        sys.damage = saved.damage;
      },
    };
  }

  /**
   * A weapon's rolled skill that the crawler has lost is added again at rank 0,
   * and the GM is whispered about it.
   */
  async #grantRollingSkill() {
    if (this.type !== 'gear' || !(this.parent instanceof Actor)) return;
    if (await this.rollingSkill()) return;
    const uuids = this.system.skills ?? [];
    if (!uuids.length) return;
    const chosen = uuids.includes(this.system.rollSkill) ? this.system.rollSkill : uuids[0];
    const source = await fromUuid(chosen);
    if (source?.type !== 'skill') return;
    const skillData = game.items.fromCompendium(source);
    foundry.utils.setProperty(skillData, 'system.rank', 0);
    await this.parent.createEmbeddedDocuments('Item', [skillData]);
    await ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: game.i18n.format('CARL_RPG.Weapon.SkillAdded', {
        skill: Handlebars.escapeExpression(source.name),
        item: Handlebars.escapeExpression(this.name),
      }),
    });
  }

  async #grantEmbeddedSkills() {
    const actor = this.parent;
    const uuids = this.system?.skills ?? [];
    if (!(actor instanceof Actor) || !uuids.length) return;
    if (!['gear', 'item'].includes(this.type)) return;

    const toCreate = [];
    for (const uuid of uuids) {
      const skill = await fromUuid(uuid);
      if (!skill || skill.type !== 'skill') {
        ui.notifications.warn(
          game.i18n.format('CARL_RPG.Item.EmbeddedSkill.Missing', {
            item: this.name,
          })
        );
        continue;
      }

      // Already on the actor (or already queued from this item)? Matched by
      // identifier, or by name when the skill has no identifier.
      const identifier = skill.system.identifier?.trim();
      const matches = (s) =>
        identifier
          ? s.system.identifier?.trim() === identifier
          : s.name === skill.name;
      if (actor.itemTypes.skill.some(matches)) continue;
      if (toCreate.some((data) => matches({ name: data.name, system: data.system }))) {
        continue;
      }

      // The actor starts at rank 0 in a granted skill: rank is per character,
      // not part of the skill template.
      const skillData = game.items.fromCompendium(skill);
      foundry.utils.setProperty(skillData, 'system.rank', 0);
      toCreate.push(skillData);
    }

    if (toCreate.length) await actor.createEmbeddedDocuments('Item', toCreate);
  }

  /**
   * Handle clickable rolls. The item's description is always posted to chat.
   * Items that have a roll formula (skills, gear) also roll it, with the
   * description shown alongside the roll. Items without one (spells, plain
   * items) post just the description.
   * @param {Event} [event]   The originating click event
   * @returns {Promise<Roll|ChatMessage>}
   */
  async roll(event, { depth = 0, declared = false } = {}) {
    // During the Mobs Declare phase, using a mob's ability declares it instead (it is
    // used when the Resolve phase starts); hold Shift to use it right away. Abilities
    // used because something else used them, and the declared ones being resolved,
    // are used as usual. See helpers/declarations.mjs.
    if (depth === 0 && !declared && !event?.shiftKey) {
      if (await declareInsteadOfUsing(this)) return null;
    }

    // (Someone who only observes the actor can roll too. Anything the roll
    // changes automatically, like mana or an action, is made for them by the
    // GM's client; see helpers/relay.mjs. They still can't edit the sheet.)

    // The item can be blocked from being used (not enough mana, ...).
    if (!checkRequirements(this)) return null;
    // An item with a limit on its uses needs one left (see helpers/uses.mjs).
    if (usesLeft(this) < 1) {
      ui.notifications.warn(
        game.i18n.format('CARL_RPG.Uses.NoneLeft', {
          name: Handlebars.escapeExpression(this.name),
          recharge: game.i18n.localize(
            CONFIG.CARL_RPG.usesRecharge[this.system.uses.recharge]
          ),
        })
      );
      return null;
    }

    // A click on a rolling item opens the roll pop-up (extra bonus, a different
    // stat, advantage or disadvantage); hold Shift to skip it. Rolls an event or
    // macro makes (no click) don't ask, and neither do a mob's (it never rolls).
    let rollOptions = {};
    if (
      event &&
      !event.shiftKey &&
      depth === 0 &&
      this.system.formula &&
      this.actor?.type !== 'mob'
    ) {
      const stat =
        this.system.stat && this.system.formula.includes(`@${this.system.stat}.mod`)
          ? this.system.stat
          : statOfFormula(this.system.formula);
      const chosen = await promptRoll({ title: this.name, stat, tip: shortTextOf(this) });
      if (!chosen) return null;
      // A mistyped bonus is caught now, before any action or mana is spent.
      if (buildFormula(this.system.formula, chosen) === null) return null;
      rollOptions = chosen;
    }

    // In combat, using it takes an action (asking first if there are none left).
    const claim = await this.#claimAction(depth, declared);
    if (claim === false) return null;
    // Spells spend their mana cost (asking first if there isn't enough).
    const mana = await this.#payManaCost();
    if (mana === false) return null;
    // Both checks passed: now the action is actually spent (quietly: it isn't
    // mentioned on the chat card, only the mana is).
    await this.#spendAction(claim);
    await spendUse(this);
    const rolling = await this.#useRollingSkill();
    const result = await this._rollCore(event, {
      note: mana.note,
      options: rollOptions,
    });
    // A mistyped bonus: nothing was rolled, and nothing further happens.
    if (result === null) {
      rolling?.restore();
      return null;
    }
    const roll = result instanceof Roll ? result : null;
    // Check the roll against what the item targets (nothing, a target's Evade
    // or a target's stat), roll any damage and post the result (see
    // helpers/attacks.mjs).
    const attack = await resolveCheck(this, roll);
    rolling?.restore();
    // The rolled skill's own events run too.
    if (rolling) await runEvents(rolling.skill, 'used', { roll, depth, degrees: attack?.degrees });
    // (`degrees` are the degrees of success, for the "the roll's result is"
    // condition.)
    await runEvents(this, 'used', { roll, depth, degrees: attack?.degrees });
    // Each target that was hit runs the "an attack hits a target" events.
    for (const hit of attack?.hits ?? []) {
      await runEvents(this, 'hit', {
        roll,
        depth,
        target: hit.actor,
        degree: hit.degree,
        attackMessage: attack?.message,
      });
    }
    // Each target that was missed runs the "an attack misses a target" events.
    for (const miss of attack?.misses ?? []) {
      await runEvents(this, 'miss', {
        roll,
        depth,
        target: miss.actor,
        degree: miss.degree,
      });
    }
    return result;
  }

  /**
   * Using a skill, spell, gear or item (or a mob's ability) in combat counts as
   * a single action. If the combatant has none left, a pop-up asks whether to
   * use it anyway (nothing more is spent). Out of combat, or when an event uses
   * the item as part of another use (`depth` above 0), it costs nothing.
   * @param {number} depth
   * @returns {Promise<{combatant: Combatant|null}|false>}  false if cancelled
   */
  async #claimAction(depth, declared = false) {
    const actor = this.parent;
    const types = ['skill', 'spell', 'gear', 'item', 'mobAbility'];
    if (depth > 0 || !(actor instanceof Actor) || !types.includes(this.type)) {
      return { combatant: null };
    }
    // A passive skill never uses an action (and never asks about having none).
    if (this.system.passive) return { combatant: null };
    const combat = game.combat;
    const combatant = combat?.started
      ? combat.combatants.find((c) => c.actor === actor)
      : null;
    // Not in the fight, or an actor with no actions at all: nothing to spend.
    if (!combatant || combatant.maxActions < 1) return { combatant: null };

    // A declared use being resolved just goes ahead (there is no one to ask).
    if (combatant.actionsLeft < 1 && declared) return { combatant: null };
    if (combatant.actionsLeft < 1) {
      const proceed = await CarlRPGDialog.confirm({
        window: { title: game.i18n.localize('CARL_RPG.Combat.NoActions.Title') },
        content: `<p>${game.i18n.format('CARL_RPG.Combat.NoActions.Content', {
          name: Handlebars.escapeExpression(actor.name),
          item: Handlebars.escapeExpression(this.name),
        })}</p>`,
        yes: { label: game.i18n.localize('CARL_RPG.Combat.NoActions.Yes') },
        no: { label: game.i18n.localize('CARL_RPG.Combat.NoActions.No') },
        rejectClose: false,
      });
      if (!proceed) return false;
      return { combatant: null };
    }
    return { combatant };
  }

  /** Spend the action claimed by #claimAction (the tracker's pips show it). */
  async #spendAction({ combatant }) {
    if (!combatant) return;
    try {
      await combatant.spendAction();
    } catch (err) {
      console.warn('carl-rpg | could not spend an action', err);
    }
  }

  /**
   * A spell spends its mana cost when used. If the crawler doesn't have enough,
   * a pop-up asks whether to cast anyway; casting anyway spends all the mana
   * they have left (it never goes below 0). Cancelling stops the spell and
   * spends nothing.
   * @returns {Promise<{note: string}|false>}  false if the spell was cancelled
   */
  async #payManaCost() {
    const actor = this.parent;
    if (this.type !== 'spell' || !(actor instanceof Actor)) return { note: '' };
    // (Crawlers and pets have mana.)
    if (actor.type === 'mob') return { note: '' };
    // (An upgrade can change what a spell costs.)
    const cost = effectiveOf(this).manaCost;
    if (!cost) return { note: '' };

    const have = actor.system.mana.value;
    let spent = cost;
    if (have < cost) {
      const castAnyway = await CarlRPGDialog.confirm({
        window: { title: game.i18n.localize('CARL_RPG.Spell.NotEnoughMana.Title') },
        content: `<p>${game.i18n.format('CARL_RPG.Spell.NotEnoughMana.Content', {
          spell: Handlebars.escapeExpression(this.name),
          cost,
          name: Handlebars.escapeExpression(actor.name),
          have,
        })}</p>`,
        yes: { label: game.i18n.localize('CARL_RPG.Spell.NotEnoughMana.Yes') },
        no: { label: game.i18n.localize('CARL_RPG.Spell.NotEnoughMana.No') },
        rejectClose: false,
      });
      if (!castAnyway) return false;
      spent = have;
    }

    if (spent > 0) {
      await updateWithRelay(actor, { 'system.mana.value': have - spent });
    }
    const key = spent < cost ? 'ManaSpentPartial' : 'ManaSpent';
    return { note: game.i18n.format(`CARL_RPG.Spell.${key}`, { spent, cost }) };
  }

  /** The roll itself: posts the description and rolls the formula, if any. */
  async _rollCore(event, { note = '', options = {} } = {}) {
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    // (The kind of item is shown as a badge on the card: see helpers/chat-cards.mjs.)
    const label = this.name;
    const cardFlags = { 'carl-rpg': { card: { kind: this.type } } };

    // Enrich the description so links and inline rolls work in chat.
    const description = this.system.description
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          this.system.description,
          {
            secrets: this.isOwner,
            rollData: this.getRollData(),
            relativeTo: this,
          }
        )
      : '';
    // The upgrades it has reached are listed under the description.
    const upgrades = describeUpgrades(this, { reachedOnly: true });
    const upgradeList = upgrades.length
      ? `<div class="item-upgrades"><strong>${game.i18n.localize(
          'CARL_RPG.Upgrades.Title'
        )}</strong><ul>${upgrades
          .map(
            (u) =>
              `<li>${game.i18n.format('CARL_RPG.Upgrades.RankLine', {
                rank: u.rank,
                text: Handlebars.escapeExpression(u.text),
              })}</li>`
          )
          .join('')}</ul></div>`
      : '';
    // The card shows the Short Description, with the full one behind an expander.
    const shortText = (this.system.shortDescription ?? '').trim();
    const shortHtml = shortText
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(shortText, {
          secrets: this.isOwner,
          rollData: this.getRollData(),
          relativeTo: this,
        })
      : '';
    const descBlock = shortHtml
      ? `<div class="item-description">${shortHtml}</div>` +
        (description
          ? `<details class="item-full"><summary>${game.i18n.localize(
              'CARL_RPG.ItemDesc.FullDescription'
            )}</summary><div class="item-description">${description}</div></details>`
          : '')
      : description
        ? `<div class="item-description">${description}</div>`
        : '';
    const content =
      descBlock +
      upgradeList +
      (note ? `<div class="spell-cost">${note}</div>` : '');

    // No formula: just post the description. Mobs never roll a d20 either: a
    // crawler rolls against the mob's number (see helpers/attacks.mjs).
    if (!this.system.formula || this.actor?.type === 'mob') {
      const messageData = { speaker, flavor: label, content, flags: cardFlags };
      ChatMessage.applyRollMode(messageData, rollMode);
      return ChatMessage.create(messageData);
    }

    // Otherwise roll the formula and post the roll together with the
    // description. A message with custom content doesn't render its rolls on
    // its own, so the roll is rendered into the content here (roll first, then
    // the description) and also attached as a roll for dice animations.
    // The pop-up's choices (bonus, stat, advantage) change the formula.
    const formula = buildFormula(this.system.formula, options);
    if (formula === null) return null;
    const first = new Roll(formula, this.actor?.getRollData() ?? {});
    await first.evaluate();
    // Before anything is shown, a crawler can spend AI Favor to reroll (see
    // helpers/ai-favor.mjs). Only the roll that stands is posted.
    const favor = await offerAiFavor(this.actor, first);
    const roll = favor.roll;
    const rollHtml = await roll.render();
    const notes = [optionsNote(options), favor.note].filter(Boolean).join(' ');
    const messageData = {
      speaker,
      flavor: label,
      flags: cardFlags,
      rolls: [roll],
      content: `${rollHtml}${
        notes ? `<div class="roll-options">${notes}</div>` : ''
      }${content}`,
      sound: CONFIG.sounds.dice,
    };
    ChatMessage.applyRollMode(messageData, rollMode);
    await ChatMessage.create(messageData);
    return roll;
  }
}
