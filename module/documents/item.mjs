import { CarlRPGDialog } from '../helpers/dialog.mjs';
import { CarlRPGActiveEffect } from './active-effect.mjs';
import { checkRequirements, runEvents } from '../helpers/events.mjs';
import { castBlockedByHotlist } from '../helpers/hotlist-rule.mjs';
import { applyBenefits, rollBenefits } from '../helpers/build-mods.mjs';
import { grantLoot } from '../helpers/loot.mjs';
import { addModifier } from '../data/action.mjs';
import {
  COST_RESOURCES,
  capSpan,
  costLabel,
  costPaidData,
  costSpan,
  shiftSpan,
} from '../data/costs.mjs';
import { getFloor } from '../helpers/floor.mjs';
import { resolveCheck } from '../helpers/attacks.mjs';
import { availableEffects, startCooldown } from '../helpers/damage-effects.mjs';
import {
  addRankBonus,
  availableMods,
  drGrantsOf,
  drNotes,
  grantTempDR,
  needsSurprise,
  resolveMods,
  selfModOf,
} from '../helpers/roll-mods.mjs';
import { describeUpgrades, effectiveOf } from '../helpers/upgrades.mjs';
import { expandRankDamage } from '../helpers/rank-damage.mjs';
import { badgeRowHtml, itemCardHeader, shortTextOf } from '../helpers/item-badges.mjs';
import { offerAiFavor } from '../helpers/ai-favor.mjs';
import { isLimited, spendUse, usesLeft } from '../helpers/uses.mjs';
import { declareInsteadOfUsing } from '../helpers/declarations.mjs';
import { updateWithRelay } from '../helpers/relay.mjs';
import {
  promptRoll,
  buildFormula,
  optionsParts,
  statOfFormula,
} from '../helpers/roll-dialog.mjs';
import { chooseTargets } from '../helpers/targeting.mjs';
import { rangeInfo } from '../helpers/amounts.mjs';
import { dyingEffectOf } from '../helpers/dying.mjs';
import { logAmmo, logMana } from '../helpers/change-log.mjs';
import {
  classRoleOf,
  comboOf,
  evaluatePrerequisites,
  raceOf,
  sameItem,
  subclassFloor,
} from '../helpers/origins.mjs';
import { actsAsClass } from '../helpers/class-combo.mjs';
import { planEquip } from '../helpers/gear-slots.mjs';
import {
  ammoAmountLabel,
  ammoHave,
  ammoKey,
  ammoName,
  ammoRows,
  ammoSpan,
  ammoStacks,
  largestStack,
} from '../helpers/ammo.mjs';

/** What identifies an achievement: its identifier, or its name if it has none. */
const achievementKey = (item) => item.system.identifier?.trim() || item.name;

/** The Carl RPG item: equipping, granting skills and effects, and rolling. */
export class CarlRPGItem extends Item {
  prepareData() {
    super.prepareData();
  }

  /** The roll data for this item: its system data and its actor's. @override */
  getRollData() {
    const rollData = { ...this.system };

    if (!this.actor) return rollData;

    rollData.actor = this.actor.getRollData();

    return rollData;
  }

  /**
   * Equip or unequip this gear. Each slot holds a limited number of equipped
   * items (CONFIG.CARL_RPG.gearSlotLimits) and two-handed gear takes every hand;
   * if there isn't room a prompt asks which equipped gear to swap out, and
   * cancelling leaves everything as it was.
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
    const plan = planEquip(this, inSlot, limit);
    if (plan.fits) {
      await this.update({ 'system.equipped': true });
      await this.syncEquipEffects();
      await runEvents(this, 'equipped');
      return true;
    }

    const slotName = game.i18n.localize(CONFIG.CARL_RPG.gearSlots[slot]);
    const choice = await CarlRPGDialog.wait({
      window: {
        title: game.i18n.format('CARL_RPG.Item.Gear.Equip.Title', {
          slot: slotName,
        }),
      },
      content: `<p>${game.i18n.format('CARL_RPG.Item.Gear.Equip.Full', {
        slot: slotName,
        item: Handlebars.escapeExpression(this.name),
      })}</p>`,
      buttons: [
        ...plan.options.map((ids) => ({
          action: ids.join(','),
          label: game.i18n.format('CARL_RPG.Item.Gear.Equip.Swap', {
            name: game.i18n
              .getListFormatter()
              .format(
                ids.map((id) =>
                  Handlebars.escapeExpression(inSlot.find((g) => g.id === id).name)
                )
              ),
          }),
        })),
        { action: 'cancel', label: game.i18n.localize('Cancel') },
      ],
      rejectClose: false,
    });
    if (!choice || choice === 'cancel') return false;

    const removed = choice.split(',').map((id) => this.parent.items.get(id));
    await this.parent.updateEmbeddedDocuments('Item', [
      ...removed.map((g) => ({ _id: g.id, 'system.equipped': false })),
      { _id: this.id, 'system.equipped': true },
    ]);
    for (const g of removed) await g.syncEquipEffects();
    await this.syncEquipEffects();
    for (const g of removed) await runEvents(g, 'unequipped');
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
   * Gear gives its skills when it is added to a crawler (see _onCreate) and keeps
   * them when it comes off; they are put back if missing when it is equipped. Only
   * the user who made the change does the work.
   * @override
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (options?.carlMigration) return;
    if (userId === game.user.id && this.type === 'deity' && foundry.utils.hasProperty(changed, 'system.tier')) {
      this.syncDeityTiers();
    }
    if (userId !== game.user.id || this.type !== 'gear') return;
    if (!foundry.utils.hasProperty(changed, 'system.equipped')) return;
    (async () => {
      try {
        // Skills are given when the gear is added and kept when it comes off, so
        // equipping only has to put back any that the crawler has since lost.
        if (this.system.equipped) {
          await this.#grantEmbeddedSkills();
          await this.#grantRollingSkill();
        } else if (options?.carlAutoUnequip) {
          // Unequipped because an edit left it without room (see #keepGearFitting).
          await this.syncEquipEffects();
          await runEvents(this, 'unequipped');
        }
      } catch (err) {
        console.error('carl-rpg | changing the skills of equipped gear failed', err);
      }
    })();
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
            this.syncDeityTiers(),
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
      // A Race and Class combo already is the crawler's class, so players can't take
      // another. The GM can, after a prompt, and the class then takes over the Class box.
      const heldCombo = this.type === 'class' ? comboOf(actor) : null;
      if (heldCombo) {
        if (!user.isGM) {
          ui.notifications.warn(
            game.i18n.format('CARL_RPG.Origin.Combo.NoClass', { race: heldCombo.name })
          );
          return false;
        }
        const proceed = await CarlRPGDialog.confirm({
          window: { title: game.i18n.localize('CARL_RPG.Origin.Combo.Title') },
          content: `<p>${game.i18n.format('CARL_RPG.Origin.Combo.ClassOverride', {
            name: Handlebars.escapeExpression(actor.name),
            race: Handlebars.escapeExpression(heldCombo.name),
            newClass: Handlebars.escapeExpression(this.name),
          })}</p>`,
          rejectClose: false,
        });
        if (!proceed) return false;
      }

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
      }

      // A Race and Class combo takes the class's place: ask before replacing the class
      // they have. Both prompts come first, so declining either changes nothing.
      const heldClass =
        this.type === 'race' && actsAsClass(this) ? actor.itemTypes.class[0] : null;
      if (heldClass) {
        const replaceClass = await CarlRPGDialog.confirm({
          window: { title: game.i18n.localize('CARL_RPG.Origin.Replace.Title') },
          content: `<p>${game.i18n.format('CARL_RPG.Origin.Combo.ReplaceClass', {
            name: Handlebars.escapeExpression(actor.name),
            race: Handlebars.escapeExpression(this.name),
            old: Handlebars.escapeExpression(heldClass.name),
          })}</p>`,
          rejectClose: false,
        });
        if (!replaceClass) return false;
      }
      await existing?.delete();
      await heldClass?.delete();
    }

    // Subclasses: a crawler can hold several, each from a class it has, from the
    // Subclass floor. Each can be taken once. The GM can add any (noted in chat).
    if (
      this.type === 'subclass' &&
      this.parent instanceof Actor &&
      this.parent.type === 'crawler'
    ) {
      const actor = this.parent;
      if (actor.itemTypes.subclass.some((s) => sameItem(s, this))) {
        ui.notifications.warn(
          game.i18n.format('CARL_RPG.Origin.Subclass.AlreadyHas', {
            name: actor.name,
            subclass: this.name,
          })
        );
        return false;
      }
      const parent = classRoleOf(actor);
      const linked = this.system.classUuid
        ? await fromUuid(this.system.classUuid)
        : null;
      const unmet = (await evaluatePrerequisites(this, actor))
        .filter((r) => !r.met)
        .map((r) => r.text);
      if (!parent || !linked || !sameItem(parent, linked)) {
        unmet.unshift(game.i18n.localize('CARL_RPG.Origin.Subclass.WrongClass'));
      }
      if (!user.isGM) {
        if (actor.system.floor < subclassFloor()) {
          ui.notifications.warn(
            game.i18n.format('CARL_RPG.Origin.SubclassTooEarly', {
              floor: subclassFloor(),
            })
          );
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
   * Each time a crawler receives an achievement they are given the loot box it
   * names and its card is posted. Duplicates are blocked while they hold it, so
   * this only runs again once it has been removed.
   */
  async #grantAchievementReward() {
    const actor = this.parent;
    if (this.type !== 'achievement' || !(actor instanceof Actor)) return;
    if (actor.type !== 'crawler') return;

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
      !options?.carlMigration &&
      ('events' in system || 'requirements' in system || 'upgrades' in system)
    ) {
      foundry.utils.setProperty(changes, 'system.eventsTrusted', user.isGM);
    }
    if (this.type === 'gear' && system && !options?.carlMigration) {
      this.#keepGearFitting(changes, options);
    }
  }

  /**
   * Two-Handed only means something in the Hands slot, so moving gear to another
   * slot clears it. Equipped gear that no longer fits after an edit (Two-Handed
   * ticked, or moved into a full slot) is unequipped, with a notice.
   */
  #keepGearFitting(changes, options) {
    const system = changes.system;
    if (system.slot && system.slot !== 'hands' && this.system.twoHanded && !('twoHanded' in system)) {
      foundry.utils.setProperty(changes, 'system.twoHanded', false);
    }
    const actor = this.parent;
    if (!(actor instanceof Actor) || !this.system.equipped || 'equipped' in system) return;
    if (!('slot' in system || 'twoHanded' in system)) return;

    const slot = system.slot ?? this.system.slot;
    const next = { id: this.id, system: { slot, twoHanded: system.twoHanded ?? this.system.twoHanded } };
    const limit = CONFIG.CARL_RPG.gearSlotLimits[slot] ?? 1;
    const held = actor.itemTypes.gear.filter(
      (g) => g !== this && g.system.equipped && g.system.slot === slot
    );
    if (planEquip(next, held, limit).fits) return;

    foundry.utils.setProperty(changes, 'system.equipped', false);
    if (options) options.carlAutoUnequip = true;
    ui.notifications.warn(
      game.i18n.format('CARL_RPG.Item.Gear.Equip.NoRoom', {
        name: this.name,
        slot: game.i18n.localize(CONFIG.CARL_RPG.gearSlots[slot] ?? slot),
      })
    );
  }

  /**
   * A race or class adds the skills it grants at their set ranks. A skill the
   * crawler already has is raised to that rank if it is lower.
   */
  async #grantRankedSkills() {
    const actor = this.parent;
    if (!['race', 'class', 'subclass', 'species'].includes(this.type)) return;
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
    if (!['race', 'class', 'subclass', 'species'].includes(this.type)) return;
    if (!(actor instanceof Actor) || actor.type !== 'crawler') return;

    // A subclass isn't stored on the crawler: the sheet shows the newest one.
    if (this.type !== 'subclass') {
      const field = ['race', 'species'].includes(this.type)
        ? 'system.race'
        : 'system.className';
      const update = { [field]: this.name };
      // A species also sets the crawler's size.
      if (this.type === 'species') update['system.size'] = this.system.size;
      // A Race and Class combo is also the crawler's class.
      if (actsAsClass(this)) update['system.className'] = this.name;
      await actor.update(update);
    }

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
        `CARL_RPG.Origin.Chosen.${actsAsClass(this) ? 'combo' : this.type}`,
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
    // A deity's effects come in by tier (see syncDeityTiers), not all at once.
    if (this.type === 'deity') return;

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
      // (A stacking buff from the same item is its own effect, so it isn't skipped.)
      if (queued && !template.slotGroup) continue;

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
      this.#revokeEmbeddedSkills();
      if (this.type === 'skill') this.#warnRollingSkillGone();
      runEvents(this, 'removed');
      // A removed race or class no longer shows on the crawler sheet.
      if (
        ['race', 'class', 'species'].includes(this.type) &&
        this.parent instanceof Actor &&
        this.parent.type === 'crawler'
      ) {
        const field = ['race', 'species'].includes(this.type) ? 'race' : 'className';
        // A Race and Class combo was also their class: it leaves the Class box too.
        if (
          field === 'race' &&
          actsAsClass(this) &&
          this.parent.system.className === this.name
        ) {
          this.parent.update({ 'system.className': '' });
        }
        if (this.parent.system[field] === this.name) {
          this.parent.update({ [`system.${field}`]: '' });
        }
      }
    }
  }

  /**
   * A crawler's deity gives the effects of every tier up to the crawler's tier (the
   * tiers stack). Effects it already gave that are still wanted stay as they are
   * (so a switched-off effect or a timer isn't reset); the rest are taken away.
   */
  async syncDeityTiers() {
    const actor = this.parent;
    if (this.type !== 'deity' || !(actor instanceof Actor)) return;
    const tier = this.system.tier ?? 0;
    const wanted = this.effects.filter((t) => {
      const level = t.getFlag('carl-rpg', 'tier') ?? 0;
      return level >= 1 && level <= tier;
    });
    const mine = actor.effects.filter((e) => e.sourceItems.includes(this.id));
    const gone = mine
      .filter((e) => !wanted.some((t) => CarlRPGActiveEffect.matches(e, t)))
      .map((e) => e.id);
    if (gone.length) await actor.deleteEmbeddedDocuments('ActiveEffect', gone);
    const toCreate = [];
    for (const template of wanted) {
      if (mine.some((e) => CarlRPGActiveEffect.matches(e, template))) continue;
      const data = template.toObject();
      delete data._id;
      data.transfer = false;
      data.origin = this.uuid;
      data.disabled = template.kind === 'buff';
      foundry.utils.setProperty(data, 'flags.carl-rpg.sourceItems', [this.id]);
      foundry.utils.setProperty(data, 'flags.carl-rpg.stacks', 1);
      toCreate.push(data);
    }
    if (toCreate.length) {
      await actor.createEmbeddedDocuments('ActiveEffect', toCreate, { carlGrant: true });
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

  /** Whether this gear or item has a Skill check as its action. */
  get usesSkillAction() {
    return ['gear', 'item'].includes(this.type) && this.system.action?.type === 'skill';
  }

  /**
   * The crawler's copy of the skill a skill check rolls with: the one marked
   * "Rolls with", or the first skill when none is marked.
   * @returns {Promise<Item|null>}
   */
  async rollingSkill() {
    if (!this.usesSkillAction || !(this.parent instanceof Actor)) return null;
    const uuids = this.system.skills ?? [];
    if (!uuids.length) return null;
    const keyOf = (skill) => skill.system.identifier?.trim() || skill.name;
    // The owner's pick is any skill the crawler has (its own copy's uuid). A pick
    // from the weapon's own list (set at creation) is matched by identifier or name.
    const marked = this.system.rollSkill;
    if (marked) {
      const own = this.parent.itemTypes.skill.find((s) => s.uuid === marked);
      if (own) return own;
    }
    const source = await fromUuid(marked || uuids[0]);
    if (!source) return null;
    return this.parent.itemTypes.skill.find((s) => keyOf(s) === keyOf(source)) ?? null;
  }

  /** Whether this weapon has a skill it rolls with that the crawler no longer has. */
  async #rollingSkillMissing() {
    if (!this.usesSkillAction) return false;
    if (!this.system.rollSkill || !(this.system.skills ?? []).length) return false;
    return !(await this.rollingSkill());
  }

  /** A skill a weapon rolls with has gone from the crawler: the GM is whispered. */
  async #warnRollingSkillGone() {
    const actor = this.parent;
    if (!(actor instanceof Actor)) return;
    const key = this.system.identifier?.trim() || this.name;
    for (const gear of [...actor.itemTypes.gear, ...actor.itemTypes.item]) {
      if (!gear.usesSkillAction) continue;
      const marked = gear.system.rollSkill;
      if (!marked) continue;
      let hit = marked === this.uuid;
      if (!hit) {
        const source = await fromUuid(marked);
        hit = !!source && (source.system.identifier?.trim() || source.name) === key;
      }
      if (!hit) continue;
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: game.i18n.format('CARL_RPG.Weapon.RollSkillGone', {
          skill: Handlebars.escapeExpression(this.name),
          item: Handlebars.escapeExpression(gear.name),
        }),
      });
    }
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
    const bonus = skill.system.effective?.rollBonus ?? 0;
    const rank = skill.system.rank ?? 0;
    sys.formula = addModifier(
      `1d20 + @${skill.system.stat}.mod + ${rank}` +
        (bonus ? ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}` : ''),
      sys.action?.modifier
    );
    const skillDamage = (skill.system.effective?.damage ?? '').trim();
    // @rankDamage in the weapon's damage or in the skill's reads the skill's rank.
    sys.damage = expandRankDamage(
      [String(saved.damage ?? '').trim(), skillDamage].filter(Boolean).join(' + '),
      skill
    );
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
    if (!this.usesSkillAction || !(this.parent instanceof Actor)) return;
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

  /**
   * Record that this item gives a skill the crawler already has. A skill with ranks
   * is the crawler's own, so it isn't linked: it stays when this item comes off.
   */
  async #linkSkill(skill) {
    if (skill.system.rank > 0) return;
    const granted = skill.getFlag('carl-rpg', 'grantedBy') ?? [];
    if (granted.includes(this.id)) return;
    await skill.setFlag('carl-rpg', 'grantedBy', [...granted, this.id]);
  }

  /**
   * Take away the skills this item gave the crawler when it is removed from them.
   * A skill stays if the crawler raised it, or if another item still gives it (the
   * owner and the GM are whispered when that happens).
   */
  async #revokeEmbeddedSkills() {
    const actor = this.parent;
    if (!(actor instanceof Actor)) return;
    const givesNow = (id) => {
      const other = actor.items.get(id);
      return !!other;
    };
    const remove = [];
    for (const skill of actor.itemTypes.skill) {
      const granted = skill.getFlag('carl-rpg', 'grantedBy') ?? [];
      if (!granted.includes(this.id)) continue;
      const givers = granted.filter((id) => id !== this.id && givesNow(id));
      if (givers.length) {
        await skill.setFlag('carl-rpg', 'grantedBy', givers);
        await ChatMessage.create({
          whisper: game.users
            .filter((u) => u.isGM || actor.testUserPermission(u, 'OWNER'))
            .map((u) => u.id),
          content: game.i18n.format('CARL_RPG.Item.EmbeddedSkill.SharedKept', {
            skill: Handlebars.escapeExpression(skill.name),
            item: Handlebars.escapeExpression(this.name),
          }),
        });
      } else if (skill.getFlag('carl-rpg', 'raised')) {
        await skill.setFlag('carl-rpg', 'grantedBy', []);
      } else {
        remove.push(skill.id);
      }
    }
    if (remove.length) await actor.deleteEmbeddedDocuments('Item', remove);
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
      const existing = actor.itemTypes.skill.find(matches);
      if (existing) {
        await this.#linkSkill(existing);
        continue;
      }
      if (toCreate.some((data) => matches({ name: data.name, system: data.system }))) {
        continue;
      }

      // The actor starts at rank 0 in a granted skill: rank is per character,
      // not part of the skill template.
      const skillData = game.items.fromCompendium(skill);
      foundry.utils.setProperty(skillData, 'system.rank', 0);
      foundry.utils.setProperty(skillData, 'flags.carl-rpg.grantedBy', [this.id]);
      toCreate.push(skillData);
    }

    if (toCreate.length) await actor.createEmbeddedDocuments('Item', toCreate);
  }

  /** The stat this item's roll uses by default (null if it uses none). */
  async #defaultRollStat() {
    return this.usesSkillAction
      ? ((await this.rollingSkill())?.system.stat ?? 'str')
      : this.system.stat && this.system.formula.includes(`@${this.system.stat}.mod`)
        ? this.system.stat
        : statOfFormula(this.system.formula);
  }

  /**
   * The roll data cost and targeting formulas read: the user's stats (@str.mod ...),
   * @lvl, this item's @rank, the @floor, and @cost, what is being paid (@cost is the
   * total, @cost.mana, @cost.junk, @cost.uses and @cost.ammo each resource).
   * @param {{mana?: number, junk?: number, uses?: number, ammo?: number}} [paid]
   */
  costData(paid = {}) {
    const data = this.actor?.getRollData?.() ?? {};
    return { ...data, rank: this.system.rank ?? 0, floor: getFloor(), cost: costPaidData(paid) };
  }

  /**
   * What using this item asks for in each resource: the least and most it can cost
   * (see data/costs.mjs). A mob spends no Mana or Junk.
   * @returns {{mana: object, junk: object, uses: object}}
   */
  costSpans() {
    const none = { min: 0, max: 0, known: true, ranged: false };
    const data = this.costData();
    const costs = this.system.costs;
    const mob = this.actor?.type === 'mob';
    const effective = effectiveOf(this);
    return {
      // (An upgrade can change what a skill or spell costs in Mana.)
      mana: mob ? none : shiftSpan(costSpan(costs, 'mana', data), effective.manaDelta ?? 0),
      junk: mob ? none : shiftSpan(costSpan(costs, 'junk', data), effective.junkDelta ?? 0),
      uses: isLimited(this) ? shiftSpan(costSpan(costs, 'uses', data), effective.usesDelta ?? 0) : none,
    };
  }

  /**
   * What the item's Range comes to now (see rangeInfo in helpers/amounts.mjs): its formula
   * read over the user's roll data, with nothing paid yet unless `paid` says so.
   */
  rangeInfo(paid = {}) {
    return rangeInfo(this.system.targeting?.range, this.costData(paid));
  }

  /** What each resource costs as text: "2", "1-3", or the formula itself when it can't be worked out yet. */
  costLabels() {
    const data = this.costData();
    const costs = this.system.costs;
    const effective = effectiveOf(this);
    return {
      mana: costLabel(costs, 'mana', data, effective.manaDelta ?? 0),
      junk: costLabel(costs, 'junk', data, effective.junkDelta ?? 0),
      uses: isLimited(this) ? costLabel(costs, 'uses', data, effective.usesDelta ?? 0) : '',
    };
  }

  /**
   * What the Ammunition costs ask of the user, one entry for each: the amount (least and
   * most) and what is spent (see helpers/ammo.mjs). Only a crawler spends ammunition:
   * pets and mobs have no inventory.
   * @returns {object[]}
   */
  ammoSpans() {
    if (this.actor?.type !== 'crawler') return [];
    const data = this.costData();
    return ammoRows(this.system.costs).map(({ row, index }) => ({
      key: ammoKey(index),
      row,
      name: ammoName(row),
      ...ammoSpan(row, data),
    }));
  }

  /**
   * What each Ammunition cost spends and how much of it the crawler has (`left` is null
   * and `owned` false when the item isn't on a crawler), for lists, badges and the quick bar.
   * @returns {{name: string, need: string, left: number|null, owned: boolean}[]}
   */
  get ammoSummary() {
    const rows = ammoRows(this.system?.costs);
    if (!rows.length || this.type === 'mobAbility') return [];
    const data = this.costData();
    const items = this.actor?.type === 'crawler' ? this.actor.itemTypes.item : null;
    return rows.map(({ row }) => ({
      name: ammoName(row) || game.i18n.localize('CARL_RPG.Costs.Ammo'),
      need: ammoAmountLabel(row, data),
      left: items ? ammoStacks(row, items).reduce((sum, s) => sum + s.qty, 0) : null,
      owned: !!items,
    }));
  }

  /** The Ammunition costs with a range the user can afford more than the least of: they pick an amount. */
  #ammoChoices(spans) {
    return spans
      .map((span) => ({ span, ...capSpan(span, ammoHave(span.row, this.actor.itemTypes.item)) }))
      .filter((choice) => choice.ranged)
      .map(({ span, min, max }) => ({
        resource: 'ammo',
        key: span.key,
        label: span.name || game.i18n.localize('CARL_RPG.Costs.Ammo'),
        min,
        max,
      }));
  }

  /** The costs with a range the user can afford more than the least of: they pick an amount. */
  #costChoices(spans) {
    const have = {
      mana: this.actor?.system?.mana?.value ?? 0,
      junk: this.actor?.system?.junk ?? 0,
      uses: usesLeft(this),
    };
    return COST_RESOURCES.map((resource) => ({ resource, ...capSpan(spans[resource], have[resource]) }))
      .filter((cost) => cost.ranged)
      .map(({ resource, min, max }) => ({ resource, min, max }));
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

    // A Dying crawler can't act or roll (see helpers/dying.mjs).
    if (dyingEffectOf(this.actor)) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.DyingNoAction'));
      return null;
    }
    // With the Hotlist-only spells rule on, a spell has to be on the hotlist.
    if (depth === 0 && castBlockedByHotlist(this)) {
      ui.notifications.warn(
        game.i18n.format('CARL_RPG.Hotlist.NotOnList', {
          name: Handlebars.escapeExpression(this.name),
        })
      );
      return null;
    }
    // The item can be blocked from being used (not enough mana, ...).
    if (!checkRequirements(this)) return null;
    // An item with a limit on its uses needs one left (see helpers/uses.mjs).
    const spans = this.costSpans();
    const usesNeeded = spans.uses.min;
    if (usesNeeded && usesLeft(this) < usesNeeded) {
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

    // A click opens the roll pop-up (extra bonus, a different stat, advantage or
    // disadvantage, and how much to pay for a cost with a range); hold Shift to skip
    // it and pay the least. Rolls an event or macro makes (no click) don't ask about the
    // roll, and neither do a mob's (it never rolls), but a cost with a range still asks.
    const rolls = !!this.system.formula && this.actor?.type !== 'mob';
    const defaultStat = rolls ? await this.#defaultRollStat() : null;
    let rollOptions = {};
    const ammo = this.ammoSpans();
    const paid = Object.fromEntries(COST_RESOURCES.map((resource) => [resource, spans[resource].min]));
    for (const a of ammo) paid[a.key] = a.min;
    const asks = [...this.#costChoices(spans), ...this.#ammoChoices(ammo)];
    const rollPopup = !!event && !event.shiftKey && depth === 0 && rolls;
    // The Damage Effects that can be chosen for this attack (see helpers/damage-effects.mjs):
    // the crawler's own, listing the skill the roll uses (by name or a #tag of the skill or
    // this item), off cooldown. Shift skips the choice.
    const modSkill =
      this.actor?.type === 'mob' ? null : this.type === 'skill' ? this : await this.rollingSkill();
    const effects = rollPopup && modSkill ? availableEffects(this.actor, modSkill, this) : [];
    // The Roll Modifiers that can be chosen (see helpers/roll-mods.mjs): the crawler's own,
    // listing the skill the roll uses. A skill that lists itself modifies its own use, pop-up
    // or not.
    const mods = rollPopup && modSkill ? availableMods(this.actor, modSkill, this) : [];
    const selfMod = selfModOf(modSkill);
    const surpriseOption = [...mods, selfMod].some((mod) => mod && needsSurprise(mod));
    let chosenEffect = null;
    let effectOption = false;
    let chosenMod = null;
    let surprise = false;
    if (rollPopup || (asks.length && !event?.shiftKey)) {
      const chosen = await promptRoll({
        title: this.name,
        stat: rollPopup ? defaultStat : null,
        tip: shortTextOf(this),
        costs: asks,
        rolls: rollPopup,
        damageEffects: effects.map((effect) => ({
          id: effect.id,
          name: effect.name,
          stun: !!effect.system.damageRules?.stunOption,
        })),
        rollMods: mods.map((mod) => ({ id: mod.id, name: mod.name })),
        surpriseOption,
      });
      if (!chosen) return null;
      Object.assign(paid, chosen.costs);
      if (rollPopup) {
        // A mistyped bonus is caught now, before any action or mana is spent.
        if (buildFormula(this.system.formula, chosen) === null) return null;
        rollOptions = chosen;
        chosenEffect = effects.find((effect) => effect.id === chosen.damageEffect) ?? null;
        effectOption = !!(chosenEffect && chosen.option);
        chosenMod = mods.find((mod) => mod.id === chosen.rollMod) ?? null;
        surprise = !!chosen.surprise;
      }
    }
    // All the ammunition being spent together (what @cost.ammo reads).
    paid.ammo = ammo.reduce((sum, a) => sum + (paid[a.key] ?? 0), 0);
    // The actor's build (advantage, bonuses for a stat's skills) applies to every roll,
    // pop-up or not (see helpers/build-mods.mjs).
    if (rolls && this.actor) {
      rollOptions = applyBenefits(
        rollOptions,
        rollBenefits(this.actor, {
          stat: rollOptions.stat || defaultStat,
          skill: this.type === 'skill' || this.usesSkillAction,
        })
      );
    }
    // Roll Modifiers: the one chosen, and this skill itself when it modifies its own use. Their
    // conditions read the final mode (after the build's advantage). The Rank is added to the roll.
    const modResult = resolveMods([chosenMod, selfMod].filter(Boolean), {
      mode: rollOptions.mode ?? 'normal',
      surprise,
    });
    if (rolls) rollOptions = addRankBonus(rollOptions, modResult);

    // Targets are picked before anything is spent or rolled, once the amounts to pay are
    // known (a target count can follow them; see helpers/targeting.mjs).
    if (depth === 0 && this.actor?.type !== 'mob' && !(await chooseTargets(this, this.costData(paid)))) {
      return null;
    }

    // In combat, using it takes an action (asking first if there are none left).
    const claim = await this.#claimAction(depth, declared);
    if (claim === false) return null;
    // Spells spend their mana cost (asking first if there isn't enough).
    // A weapon whose skill it rolls with is gone from the crawler can't roll.
    if (await this.#rollingSkillMissing()) {
      const message = game.i18n.format('CARL_RPG.Weapon.RollBlocked', {
        item: Handlebars.escapeExpression(this.name),
      });
      ui.notifications.warn(message);
      await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM'), content: message });
      return null;
    }
    // Ammunition is asked about first (nothing is spent yet), so cancelling spends nothing.
    const ammoPlan = await this.#planAmmo(ammo, paid);
    if (ammoPlan === false) return null;
    const mana = await this.#payCosts(paid);
    if (mana === false) return null;
    const ammoNotes = await this.#spendAmmo(ammoPlan);
    // Both checks passed: now the action is actually spent (quietly: it isn't
    // mentioned on the chat card, only the mana is).
    await this.#spendAction(claim);
    // An Interrupt action used in the React phase marks its crawler for the round.
    if (this.system.interrupt && this.parent?.type === 'crawler' && claim.combatant) {
      const phase = CONFIG.CARL_RPG.combatPhases[claim.combatant.parent?.phase];
      if (phase?.id === 'react') {
        await updateWithRelay(claim.combatant, { 'flags.carl-rpg.interruptUsed': true });
      }
    }
    await spendUse(this, paid.uses);
    // DR the modifiers give waits for the next damage this actor takes.
    const drGrants = drGrantsOf(modResult);
    await grantTempDR(this.actor, drGrants);
    const rolling = await this.#useRollingSkill();
    const result = await this._rollCore(event, {
      costs: [...mana.notes, ...ammoNotes, ...drNotes(drGrants)],
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
    const attack = await resolveCheck(this, roll, {
      damageEffect: chosenEffect ? { item: chosenEffect, option: effectOption } : null,
      modDice: modResult.dice,
    });
    rolling?.restore();
    // Summaries of the events that fire for this roll (shown on the attack card).
    const fired = [];
    // The rolled skill's own events run too.
    if (rolling) await runEvents(rolling.skill, 'used', { roll, paid, depth, degrees: attack?.degrees });
    // (`degrees` are the degrees of success, for the "the roll's result is"
    // condition.)
    await runEvents(this, 'used', { roll, paid, depth, degrees: attack?.degrees, collect: fired });
    // A Damage Effect that changed the attack goes on cooldown, and its own events run
    // (they see whether the "instead of damage" option was ticked).
    const effectCtx = { roll, paid, depth, option: effectOption ? 1 : 0, collect: fired };
    if (chosenEffect && attack?.effectApplied) {
      await startCooldown(chosenEffect);
      await runEvents(chosenEffect, 'used', { ...effectCtx, degrees: attack?.degrees });
    }
    // Each target that was hit runs the "an attack hits a target" events.
    for (const hit of attack?.hits ?? []) {
      await runEvents(this, 'hit', {
        roll,
        paid,
        depth,
        target: hit.actor,
        degree: hit.degree,
        attackMessage: attack?.message,
        collect: fired,
      });
      if (chosenEffect && hit.effect) {
        await runEvents(chosenEffect, 'hit', {
          ...effectCtx,
          target: hit.actor,
          degree: hit.degree,
          attackMessage: attack?.message,
        });
      }
    }
    // Each target that was missed runs the "an attack misses a target" events.
    for (const miss of attack?.misses ?? []) {
      await runEvents(this, 'miss', {
        roll,
        paid,
        depth,
        target: miss.actor,
        collect: fired,
        degree: miss.degree,
      });
    }
    if (fired.length && attack?.message) {
      await attack.message.update({ 'flags.carl-rpg.attack.fired': fired });
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
   * Work out which inventory items the Ammunition costs spend, asking first (nothing is
   * spent here, so cancelling spends nothing): when several kinds have enough, which one
   * to use; when none has enough, whether to use it anyway and spend what is left of the
   * largest stack.
   * @returns {Promise<{id: string|null, name: string, cost: number, spend: number}[]|false>}  false if cancelled
   */
  async #planAmmo(spans, paid) {
    const actor = this.parent;
    const plan = [];
    if (!spans.length || actor?.type !== 'crawler') return plan;
    const esc = Handlebars.escapeExpression;
    const reserved = {};
    for (const span of spans) {
      const cost = paid[span.key] ?? 0;
      if (cost < 1) continue;
      const label = span.name || game.i18n.localize('CARL_RPG.Costs.Ammo');
      const stacks = ammoStacks(span.row, actor.itemTypes.item, reserved);
      const enough = stacks.filter((s) => s.qty >= cost);
      let pick = enough[0] ?? null;
      let spend = cost;
      if (enough.length > 1) {
        const choice = await CarlRPGDialog.wait({
          window: { title: game.i18n.localize('CARL_RPG.Costs.ChooseAmmo.Title') },
          content: `<p>${game.i18n.format('CARL_RPG.Costs.ChooseAmmo.Content', {
            item: esc(this.name),
            cost,
          })}</p>`,
          buttons: [
            ...enough.map((s) => ({
              action: s.id,
              label: game.i18n.format('CARL_RPG.Costs.ChooseAmmo.Option', {
                name: esc(s.name),
                have: s.qty,
              }),
            })),
            { action: 'cancel', label: game.i18n.localize('Cancel') },
          ],
          rejectClose: false,
        });
        if (!choice || choice === 'cancel') return false;
        pick = enough.find((s) => s.id === choice) ?? null;
      } else if (!enough.length) {
        pick = largestStack(stacks);
        spend = pick?.qty ?? 0;
        const go = await CarlRPGDialog.confirm({
          window: { title: game.i18n.localize('CARL_RPG.Costs.NotEnoughAmmo.Title') },
          content: `<p>${game.i18n.format('CARL_RPG.Costs.NotEnoughAmmo.Content', {
            item: esc(this.name),
            cost,
            ammo: esc(label),
            name: esc(actor.name),
            have: spend,
          })}</p>`,
          yes: { label: game.i18n.localize('CARL_RPG.Costs.NotEnoughAmmo.Yes') },
          no: { label: game.i18n.localize('CARL_RPG.Costs.NotEnoughAmmo.No') },
          rejectClose: false,
        });
        if (!go) return false;
      }
      if (pick && spend > 0) reserved[pick.id] = (reserved[pick.id] ?? 0) + spend;
      plan.push({ id: pick?.id ?? null, name: pick?.name ?? label, cost, spend });
    }
    return plan;
  }

  /**
   * Spend the ammunition worked out by #planAmmo (an Observer's change goes through the
   * GM's client).
   * @returns {Promise<string[]>}  one line for each cost
   */
  async #spendAmmo(plan) {
    const actor = this.parent;
    const notes = [];
    for (const entry of plan) {
      const stack = entry.id ? actor.items.get(entry.id) : null;
      if (stack && entry.spend > 0) {
        const left = Math.max(0, stack.system.quantity - entry.spend);
        await updateWithRelay(stack, { 'system.quantity': left });
        logAmmo(actor, entry.spend, entry.name, left);
      }
      const key = entry.spend < entry.cost ? 'CARL_RPG.Costs.AmmoSpentPartial' : 'CARL_RPG.Costs.AmmoSpent';
      notes.push(
        game.i18n.format(key, { spent: entry.spend, cost: entry.cost, name: entry.name })
      );
    }
    return notes;
  }

  /**
   * What the item spends from its user when used: the Mana and Misc Junk amounts picked (uses are
   * spent separately). If the user doesn't have enough of one, a pop-up asks whether
   * to use it anyway; using it anyway spends all they have left (it never goes below
   * 0). Cancelling stops the use and spends nothing.
   * @returns {Promise<{notes: string[]}|false>}  one line for each cost; false if it was cancelled
   */
  async #payCosts(paid) {
    const actor = this.parent;
    // (Crawlers and pets have mana; only crawlers have junk. Mobs spend nothing.)
    if (!(actor instanceof Actor) || actor.type === 'mob') return { notes: [] };

    const wanted = [];
    // (An upgrade can change what a skill or spell costs in Mana.)
    const mana = paid.mana;
    if (mana && actor.system.mana) {
      wanted.push({
        path: 'system.mana.value',
        have: actor.system.mana.value,
        cost: mana,
        dialog: 'CARL_RPG.Spell.NotEnoughMana',
        note: 'CARL_RPG.Spell.ManaSpent',
        log: logMana,
      });
    }
    const junk = paid.junk;
    if (junk && actor.type === 'crawler') {
      wanted.push({
        path: 'system.junk',
        have: actor.system.junk ?? 0,
        cost: junk,
        dialog: 'CARL_RPG.Costs.NotEnoughJunk',
        note: 'CARL_RPG.Costs.JunkSpent',
      });
    }

    // Ask about everything that is short first, so cancelling spends nothing.
    for (const entry of wanted) {
      entry.spent = entry.cost;
      if (entry.have >= entry.cost) continue;
      const go = await CarlRPGDialog.confirm({
        window: { title: game.i18n.localize(`${entry.dialog}.Title`) },
        content: `<p>${game.i18n.format(`${entry.dialog}.Content`, {
          spell: Handlebars.escapeExpression(this.name),
          item: Handlebars.escapeExpression(this.name),
          cost: entry.cost,
          name: Handlebars.escapeExpression(actor.name),
          have: entry.have,
        })}</p>`,
        yes: { label: game.i18n.localize(`${entry.dialog}.Yes`) },
        no: { label: game.i18n.localize(`${entry.dialog}.No`) },
        rejectClose: false,
      });
      if (!go) return false;
      entry.spent = entry.have;
    }

    const notes = [];
    for (const entry of wanted) {
      if (entry.spent > 0) {
        await updateWithRelay(actor, { [entry.path]: entry.have - entry.spent });
        entry.log?.(actor, entry.spent, entry.have - entry.spent);
      }
      const key = entry.spent < entry.cost ? `${entry.note}Partial` : entry.note;
      notes.push(game.i18n.format(key, { spent: entry.spent, cost: entry.cost }));
    }
    return { notes };
  }

  /** The roll itself: posts the description and rolls the formula, if any. */
  async _rollCore(event, { costs = [], options = {} } = {}) {
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    // Skills, spells, gear and items head their card with their image, name and badges
    // (see itemCardHeader). Other kinds put their name in the flavor line and show a badge
    // naming the kind (helpers/chat-cards.mjs).
    const headed = ['skill', 'spell', 'gear', 'item'].includes(this.type);
    const header = headed ? itemCardHeader(this) : '';
    const label = headed ? undefined : this.name;
    // The card also remembers what was used and, for a weapon, the skill it rolled
    // with, for the recap log (a natural 1 or 20 names them).
    const rolledSkill = this.usesSkillAction ? (await this.rollingSkill())?.name : null;
    const cardFlags = {
      'carl-rpg': {
        card: {
          kind: this.type,
          name: this.name,
          ...(rolledSkill ? { skill: rolledSkill } : {}),
          ...(headed ? { header: true } : {}),
        },
      },
    };

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
    // What using it cost is shown as badges (see badgeRowHtml).
    const content = descBlock + upgradeList + badgeRowHtml(costs, 'spell-cost');

    // No formula: just post the description. Mobs never roll a d20 either: a
    // crawler rolls against the mob's number (see helpers/attacks.mjs).
    if (!this.system.formula || this.actor?.type === 'mob') {
      const messageData = { speaker, flavor: label, content: header + content, flags: cardFlags };
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
    // What was chosen in the pop-up, and an AI Favor reroll, are shown as badges.
    const notes = badgeRowHtml([...optionsParts(options), favor.note], 'roll-options');
    const messageData = {
      speaker,
      flavor: label,
      flags: cardFlags,
      rolls: [roll],
      content: `${header}${rollHtml}${notes}${content}`,
      sound: CONFIG.sounds.dice,
    };
    ChatMessage.applyRollMode(messageData, rollMode);
    await ChatMessage.create(messageData);
    return roll;
  }
}
