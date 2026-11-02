import { plainText } from '../helpers/store.mjs';
import { hasLoot, pickCrawlerAndLoot } from '../helpers/mob-loot.mjs';
import { openLootBox } from '../helpers/loot.mjs';
import { levelUp, spendPoints, canLevelUp } from '../helpers/level-up.mjs';
import {
  chooseOrigin,
  chooseSubclass,
  classOf,
  latestSubclassOf,
  raceOf,
} from '../helpers/origins.mjs';
import { dyingEffectOf } from '../helpers/dying.mjs';
import { creationPending } from '../helpers/creation.mjs';
import { killSkulls } from '../helpers/crawler-number.mjs';
import { confirmRest } from '../helpers/rests.mjs';
import {
  promptRoll,
  buildFormula,
  optionsNote,
  statOfFormula,
} from '../helpers/roll-dialog.mjs';
import { CarlRPGCreationWizard } from './creation-wizard.mjs';
import {
  buildEventRows,
  dropTarget,
  EVENT_EDITOR_ACTIONS,
  eventOptions,
  saveEventField,
} from '../helpers/event-editor.mjs';
import { changeProblem, describeUpgrades, effectKey } from '../helpers/upgrades.mjs';
import { degreeOf, naturalD20 } from '../helpers/attacks.mjs';
import { attemptAdvance, triedThisFloor } from '../helpers/advancement.mjs';
import { offerAiFavor } from '../helpers/ai-favor.mjs';
import { CarlRPGDialog } from '../helpers/dialog.mjs';
import { setupItemFilters } from '../helpers/item-filter.mjs';
import { describeBadges } from '../helpers/item-badges.mjs';

const { api, sheets } = foundry.applications;

/**
 * Wrap a sheet action so it only does anything when the user can edit the
 * sheet (an Owner). Someone with Limited or Observer permission sees the sheet
 * as if it were locked and can't toggle or change anything on it.
 */
const editOnly = (action) =>
  function (event, target) {
    if (!this.isEditable) {
      event?.preventDefault();
      return;
    }
    return action.call(this, event, target);
  };

/**
 * Wrap a sheet action so it works for anyone with at least Observer
 * permission: they can roll from the sheet, but not change it. (Limited users
 * can look at the sheet but can't roll.)
 */
const observerOnly = (action) =>
  function (event, target) {
    if (!this.document.testUserPermission(game.user, 'OBSERVER')) {
      event?.preventDefault();
      return;
    }
    return action.call(this, event, target);
  };

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheetV2}
 */
export class CarlRPGActorSheet extends api.HandlebarsApplicationMixin(
  sheets.ActorSheetV2
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['carl-rpg', 'actor'],
    position: {
      width: 680,
      height: 760,
    },
    window: {
      resizable: true,
    },
    // Anyone with at least Limited permission can open the sheet (Foundry's
    // default), as a locked, read-only sheet. Observers can also roll from it.
    // Everything else below does nothing unless the user can edit the sheet.
    actions: {
      onEditImage: editOnly(this._onEditImage),
      clearReward: editOnly(this._clearReward),
      giveReward: this._giveReward,
    lootMob: this._lootMob,
    completeQuest: this._completeQuest,
    removeQuest: this._removeQuest,
    removeLoot: this._removeLoot,
      viewDoc: this._viewDoc,
      createDoc: editOnly(this._createDoc),
      deleteDoc: editOnly(this._deleteDoc),
      toggleEffect: editOnly(this._toggleEffect),
      createEffect: editOnly(this._createEffect),
      effectStacks: editOnly(this._effectStacks),
      openLootBox: editOnly(this._openLootBox),
      levelUp: editOnly(this._levelUp),
      spendPoints: editOnly(this._spendPoints),
      chooseOrigin: editOnly(this._chooseOrigin),
      chooseSubclass: editOnly(this._chooseSubclass),
      createCharacter: editOnly(this._createCharacter),
      toggleEditMode: editOnly(this._toggleEditMode),
      toggleEquipped: editOnly(this._toggleEquipped),
      toggleAdvanceable: editOnly(this._toggleAdvanceable),
      advanceSkill: editOnly(this._advanceSkill),
      rest: editOnly(this._rest),
      roll: observerOnly(this._onRoll),
      setHealth: editOnly(this._setHealth),
      // Opening a pet's sheet from its crawler's sheet (anyone who can see the pet).
      openPet: this._openPet,
      // A pet's Upgrades tab: its upgrades, their changes and the events they carry.
      approveEvents: this._approveEvents,
      addKill: editOnly(this._addKill),
      addMountRow: editOnly(this._addMountRow),
      removeMountRow: editOnly(this._removeMountRow),
      sendGift: this._sendGift,
      removeKill: editOnly(this._removeKill),
      addUpgrade: editOnly(this._addUpgrade),
      removeUpgrade: editOnly(this._removeUpgrade),
      addChange: editOnly(this._addChange),
      removeChange: editOnly(this._removeChange),
      removeGrant: editOnly(this._removeGrant),
      ...Object.fromEntries(
        Object.entries(EVENT_EDITOR_ACTIONS).map(([name, fn]) => [name, editOnly(fn)])
      ),
    },
    // Custom property that's merged into `this.options`
    // dragDrop: [{ dragSelector: '.draggable', dropSelector: null }],
    form: {
      submitOnChange: true,
    },
  };

  /** @override */
  static PARTS = {
    mount: {
      template: 'systems/carl-rpg/templates/actor/mount.hbs',
      scrollable: [""],
    },
    personal: {
      template: 'systems/carl-rpg/templates/actor/personal.hbs',
      scrollable: [""],
    },
    header: {
      template: 'systems/carl-rpg/templates/actor/header.hbs',
    },
    tabs: {
      // Foundry-provided generic template
      template: 'templates/generic/tab-navigation.hbs',
    },
    features: {
      template: 'systems/carl-rpg/templates/actor/features.hbs',
      scrollable: [""],
    },
    biography: {
      template: 'systems/carl-rpg/templates/actor/biography.hbs',
      scrollable: [""],
    },
    abilities: {
      template: 'systems/carl-rpg/templates/actor/abilities.hbs',
      scrollable: [""],
    },
    spells: {
      template: 'systems/carl-rpg/templates/actor/spells.hbs',
      scrollable: [""],
    },
    inventory: {
      template: 'systems/carl-rpg/templates/actor/inventory.hbs',
      scrollable: [""],
    },
    achievements: {
      template: 'systems/carl-rpg/templates/actor/achievements.hbs',
      scrollable: [""],
    },
    mobAbilities: {
      template: 'systems/carl-rpg/templates/actor/mob-abilities.hbs',
      scrollable: [""],
    },
    quests: {
      template: 'systems/carl-rpg/templates/actor/quests.hbs',
      scrollable: [""],
    },
    loot: {
      template: 'systems/carl-rpg/templates/actor/mob-loot.hbs',
      scrollable: [""],
    },
    hotlist: {
      template: 'systems/carl-rpg/templates/actor/hotlist.hbs',
      scrollable: [""],
    },
    gear: {
      template: 'systems/carl-rpg/templates/actor/gear.hbs',
      scrollable: [""],
    },
    effects: {
      template: 'systems/carl-rpg/templates/actor/effects.hbs',
      scrollable: [""],
    },
    upgrades: {
      template: 'systems/carl-rpg/templates/actor/upgrades.hbs',
      scrollable: [""],
    },
  };

  /** @override */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    // Not all parts always render. The Notes (biography) tab always comes last.
    options.parts = ['header', 'tabs'];
    // Don't show the other tabs if only limited view
    if (this.document.limited) {
      options.parts.push('biography');
      return;
    }
    // Control which parts show based on document subtype
    switch (this.document.type) {
      case 'crawler':
        options.parts.push('abilities', 'hotlist', 'features', 'spells', 'gear', 'inventory', 'achievements', 'quests', 'effects', 'personal');
        break;
      case 'mob':
        options.parts.push('abilities', 'mobAbilities', 'loot', 'effects');
        break;
      case 'mount':
        options.parts.push('mount');
        break;
      case 'pet':
        // No hotlist or inventory: a pet only wears gear.
        options.parts.push('abilities', 'features', 'spells', 'gear', 'effects', 'upgrades');
        break;
    }
    // Players who don't own the sheet don't see the hotlist or the notes (gold is
    // hidden in the Inventory template). Limited viewers keep their Notes.
    if (!this.document.isOwner) {
      options.parts = options.parts.filter((part) => part !== 'hotlist');
      // Quests are shown to the owner (and the GM) only.
      if (!this.actor.isOwner) options.parts = options.parts.filter((part) => part !== 'quests');
    } else {
      options.parts.push('biography');
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    // Output initialization
    const context = {
      // Validates both permissions and compendium status
      editable: this.isEditable,
      owner: this.document.isOwner,
      limited: this.document.limited,
      // Add the actor document.
      actor: this.actor,
      // Add the actor's data to context.data for easier access, as well as flags.
      system: this.actor.system,
      flags: this.actor.flags,
      // Adding a pointer to CONFIG.CARL_RPG
      config: CONFIG.CARL_RPG,
      tabs: this._getTabs(options.parts),
      // Necessary for formInput and formFields helpers
      fields: this.document.schema.fields,
      systemFields: this.document.system.schema.fields,
    };

    // Item descriptions for the collapsible rows (kept for the render hook).
    this._itemDescriptions = await this._describeItems();

    // Offloading context prep to a helper function
    await this._prepareLootRows(context);
    await this._prepareQuests(context);
    this._prepareItems(context);

    // The crawler's hotlist: one box per slot (`hotlist.size`), each showing the
    // skill, spell or inventory item picked for it, with a dropdown to pick one.
    if (this.actor.type === 'crawler') {
      const { size, items } = this.actor.system.hotlist;
      const esc = Handlebars.escapeExpression;
      const groups = [
        ['skill', 'CARL_RPG.Actor.Tabs.Features'],
        ['spell', 'CARL_RPG.Actor.Tabs.Spells'],
        ['item', 'CARL_RPG.Actor.Tabs.Inventory'],
      ].map(([type, label]) => ({
        label: game.i18n.localize(label),
        items: [...this.actor.itemTypes[type]].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      }));
      const buildOptions = (selectedId) =>
        `<option value="">${esc(
          game.i18n.localize('CARL_RPG.Actor.Crawler.Hotlist.Choose')
        )}</option>` +
        groups
          .filter((g) => g.items.length)
          .map(
            (g) =>
              `<optgroup label="${esc(g.label)}">${g.items
                .map(
                  (i) =>
                    `<option value="${i.id}"${
                      i.id === selectedId ? ' selected' : ''
                    }>${esc(i.name)}</option>`
                )
                .join('')}</optgroup>`
          )
          .join('');
      context.hotlistSlots = Array.from({ length: size }, (_, i) => {
        const item = this.actor.items.get(items[i] ?? '') ?? null;
        return {
          index: i,
          number: i + 1,
          item,
          options: buildOptions(item?.id ?? ''),
        };
      });
    }

    // A crawler's pets, listed on its Notes tab (the ones this user can see).
    if (this.actor.type === 'crawler') {
      context.pets = game.actors
        .filter(
          (a) =>
            a.type === 'pet' &&
            a.system.owner === this.actor.id &&
            a.testUserPermission(game.user, 'LIMITED')
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({
          id: a.id,
          name: a.name,
          img: a.img,
          level: a.system.attributes.level.value,
        }));
    }

    // Pets: their owner (a crawler picked from a menu), and the flags the header
    // and the skill lists use. A pet is shown like a crawler without AI Favor.
    context.isPet = this.actor.type === 'pet';
    if (context.isPet) {
      const owner = this.actor.system.owner;
      const crawlers = game.actors.filter(
        (a) =>
          a.type === 'crawler' &&
          (a.id === owner || a.testUserPermission(game.user, 'LIMITED'))
      );
      context.ownerOptions = Object.fromEntries(
        crawlers
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((a) => [a.id, a.name])
      );
      context.resourceGrid = 'grid-3col';

      // Upgrades: each with its changes, the skills and spells it gives, the
      // effects it unlocks and the events it carries.
      const cfg = CONFIG.CARL_RPG;
      const system = this.actor.system;
      const level = system.attributes.level.value;
      context.eventOptions = eventOptions(cfg.petUpgrades.triggers);
      context.upgradeChangeOptions = cfg.petUpgrades.changes;
      context.upgradeStatOptions = cfg.abilities;
      context.upgradeEffects = this.actor.effects.map((effect) => ({
        key: effectKey(effect),
        name: effect.name,
      }));
      const grantNames = {};
      context.upgradeRows = await Promise.all(
        (system.upgrades ?? []).map(async (upgrade, ui) => ({
          ...upgrade,
          index: ui,
          path: `upgrades.${ui}`,
          unlocked: upgrade.rank <= level,
          changes: upgrade.changes.map((change, ci) => ({
            ...change,
            index: ci,
            path: `upgrades.${ui}.changes.${ci}`,
            isStat: change.type === 'statBonus',
            invalid: changeProblem(change),
          })),
          grants: await Promise.all(
            (upgrade.grants ?? []).map(async (uuid, gi) => {
              const doc = await fromUuid(uuid);
              grantNames[uuid] = doc?.name;
              return {
                uuid,
                index: gi,
                name: doc?.name ?? uuid,
                img: doc?.img,
                missing: !doc,
              };
            })
          ),
          effects: context.upgradeEffects.map((effect) => ({
            ...effect,
            checked: upgrade.unlocksEffects.includes(effect.key),
          })),
          eventsList: `upgrades.${ui}.events`,
          eventRows: await buildEventRows(
            upgrade.events ?? [],
            `upgrades.${ui}.events`
          ),
        }))
      );
      context.upgradeEventsUntrusted =
        !system.eventsTrusted && (system.upgrades ?? []).some((u) => u.events?.length);
      // Every upgrade, listed on the Notes tab (the ones not reached are dimmed).
      context.upgradeList = describeUpgrades(this.actor, { grantNames });
      // The size an upgrade has moved the pet to, if it has.
      context.sizeNow =
        system.effectiveSize && system.effectiveSize !== system.size
          ? cfg.sizeOptions()[system.effectiveSize]
          : '';
    }

    // A mount's owner (a crawler picked from a menu), and the crawler's health line
    // it shows on the owner's sheet.
    context.isMount = this.actor.type === 'mount';
    if (context.isMount) {
      const owner = this.actor.system.owner;
      context.ownerOptions = Object.fromEntries(
        game.actors
          .filter((a) => a.type === 'crawler' && (a.id === owner || a.testUserPermission(game.user, 'LIMITED')))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((a) => [a.id, a.name])
      );
    }

    // The Personal tab's sponsors (crawlers only), with the loot boxes the GM can send.
    if (this.actor.type === 'crawler') {
      context.sponsors = this.actor.itemTypes.sponsor.map((s) => ({
        id: s.id,
        name: s.name,
        img: s.img,
      }));
      context.isGM = game.user.isGM;
      // The deity this crawler worships (one per crawler), with its description.
      const deity = this.actor.itemTypes.deity[0] ?? null;
      context.deity = deity
        ? {
            name: deity.name,
            description: await TextEditor.enrichHTML(deity.system.description ?? '', {
              async: true,
              relativeTo: deity,
            }),
          }
        : null;
      // The mounts this crawler owns (the ones this user can see), with their health.
      context.mounts = game.actors
        .filter((a) => a.type === 'mount' && a.system.owner === this.actor.id && a.testUserPermission(game.user, 'LIMITED'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ id: a.id, name: a.name, img: a.img, health: `${a.system.health.value} / ${a.system.health.max}` }));
      // The clubs this crawler belongs to, with its rank or role in each.
      context.clubs = this.actor.itemTypes.club.map((c) => ({
        id: c.id,
        name: c.name,
        img: c.img,
        role: c.system.role,
      }));
      // The Personal Space (one per crawler), with its amenities shown read-only.
      const space = this.actor.itemTypes.personalSpace[0] ?? null;
      context.personalSpace = space
        ? {
            name: space.name,
            tier: space.system.tier,
            size: CONFIG.CARL_RPG.sizeOptions()[space.system.size] ?? space.system.size,
            amenities: space.system.amenities,
          }
        : null;
    }

    // Rank 5+ skills and spells that have already had their advancement try this
    // floor (their button is dimmed).
    context.advanceTried = Object.fromEntries(
      this.actor.items
        .filter((i) => ['skill', 'spell'].includes(i.type) && triedThisFloor(i))
        .map((i) => [i.id, true])
    );

    // The Size menu shows each size with its Size Class number, like "Medium (4)".
    context.sizeOptions = CONFIG.CARL_RPG.sizeOptions();

    // Edit mode: off (locked) until toggled with the lock button in the header.
    this.editMode ??= false;
    context.editMode = this.editMode;
    // Some things (a mob's Evade) are only for the GM to see.
    context.isGM = game.user.isGM;
    // Whether the Level Up button shows (GM, or players if the setting allows).
    context.canLevelUp =
      this.isEditable && canLevelUp(game.user, this.actor);
    // A new crawler gets a Create Character link that opens the wizard.
    context.creationPending = this.isEditable && creationPending(this.actor);
    if (this.actor.type === 'crawler') {
      context.raceEarthBased = !!raceOf(this.actor)?.system.earthBased;
      // Outside edit mode the Race and Class boxes are hidden while empty, and
      // the identity row has as many columns as it has boxes.
      const { race, className } = this.actor.system;
      context.showRace = this.editMode || !!race?.trim();
      // The Class box shows the newest subclass (if any), else the class.
      context.subclassName = latestSubclassOf(this.actor)?.name ?? '';
      context.classDisplay = context.subclassName || className || '';
      context.showClass = this.editMode || !!context.classDisplay.trim();
      // The Deity box shows the deity item's name (blank and hidden until one is dropped).
      context.deityName = this.actor.itemTypes.deity[0]?.name ?? '';
      context.showDeity = this.editMode || !!context.deityName;
      const columns =
        (context.showRace ? 1 : 0) +
        (context.showClass ? 1 : 0) +
        (this.editMode ? 1 : 0) + // Crawler kills
        (context.showDeity ? 1 : 0);
      // With no boxes at all the row is left out (the floor isn't shown here).
      context.identityCount = columns;
      context.identityGrid = columns > 1 ? `grid-${columns}col` : '';
      context.resourceGrid = 'grid-4col';
      context.classEarthBased = !!classOf(this.actor)?.system.earthBased;
    }
    if (this.actor.type === 'mob') {
      // The reward box shows as set or empty; its name is looked up when it is given.
      context.hasReward = !!this.actor.system.rewardBox;
      context.canGiveReward = game.user.isGM && context.hasReward && this.actor.statuses.has('dead');
    context.canLoot =
      game.user.isGM &&
      this.actor.type === 'mob' &&
      this.actor.statuses.has('dead') &&
      hasLoot(this.actor) &&
      !this.actor.system.loot.looted;
      // Level, Actions and Size, plus Crawler kills for crawler mobs in edit mode.
      const killsBox = this.actor.system.mobType === 'crawler' && this.editMode;
      const columns = 3 + (killsBox ? 1 : 0) + (game.user.isGM ? 1 : 0);
      context.resourceGrid = `grid-${columns}col`;
      // The pin box starts at the current floor until the GM sets a number.
      context.floorPinValue = this.actor.system.floorPin ?? CONFIG.CARL_RPG.getFloor();
    }
    // Crawler Killer skulls shown beside the name (crawlers and crawler mobs).
    context.skulls = killSkulls(this.actor);
    // From the third floor a crawler without a race (then a class) gets a
    // button to choose one. This applies to the GM too: below that floor the GM
    // can still give a race or class by dropping it on the sheet.
    if (
      this.actor.type === 'crawler' &&
      this.isEditable &&
      this.actor.system.floor >= CONFIG.CARL_RPG.originFloor
    ) {
      context.originAction = 'chooseOrigin';
      if (!raceOf(this.actor)) context.originPrompt = 'CARL_RPG.Origin.ChooseRace';
      else if (!classOf(this.actor)) {
        context.originPrompt = 'CARL_RPG.Origin.ChooseClass';
      } else if (game.settings.get('carl-rpg', 'subclassFloor') <= this.actor.system.floor) {
        // Subclasses can be added from the Subclass floor on, several allowed.
        context.originPrompt = 'CARL_RPG.Origin.ChooseSubclass';
        context.originAction = 'chooseSubclass';
      }
    }
    // The Create Character and Choose Race / Class buttons share a line of their
    // own under the name row, which is only there while one of them is.
    context.hasHeaderActions = !!(context.creationPending || context.originPrompt);

    // Crawlers (10 boxes) and mobs (a settable number of boxes) have a health
    // bar. Remaining boxes are "filled"; clicking a box sets health to that many
    // boxes. Each box shows the CON modifier (the damage one box is worth) with
    // the percentage of health it represents underneath, and carries its slice
    // of the red-to-green gradient spread across the whole bar.
    if (['crawler', 'mob', 'pet'].includes(this.actor.type)) {
      const { value: remaining, max, perBox } = this.actor.system.health;
      const total = Math.max(1, Math.floor(max));
      context.healthColumns = Math.min(total, 20);
      context.healthBoxes = Array.from({ length: total }, (_, i) => ({
        value: i + 1,
        label: `${perBox}`,
        percent: `${Math.round(((i + 1) / total) * 100)}%`,
        filled: i + 1 <= remaining,
        bgSize: total * 100,
        bgPos: total > 1 ? Number(((i / (total - 1)) * 100).toFixed(3)) : 0,
      }));
    }

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context) {
    switch (partId) {
      case 'features':
      case 'spells':
      case 'inventory':
      case 'achievements':
      case 'mobAbilities':
      case 'loot':
      case 'quests':
      case 'hotlist':
      case 'personal':
      case 'mount':
      case 'upgrades':
        context.tab = context.tabs[partId];
        break;
      case 'gear':
        context.tab = context.tabs[partId];
        // Weapons with more than one skill: the owner picks which one they roll with.
        context.rollChoices = await this._rollChoices();
        break;
      case 'biography':
        context.tab = context.tabs[partId];
        // Enrich biography info for display
        // Enrichment turns text like `[[/r 1d20]]` into buttons
        context.originGroups = await this._describeOrigins();
        context.enrichedBiography = await TextEditor.enrichHTML(
          this.actor.system.biography,
          {
            // Whether to show secret blocks in the finished html
            secrets: this.document.isOwner,
            // Data to fill in for inline rolls
            rollData: this.actor.getRollData(),
            // Relative UUID resolution
            relativeTo: this.actor,
          }
        );
        break;
      case 'effects':
        context.tab = context.tabs[partId];
        // Buffs, debuffs and passives, grouped for the tab
        context.effectGroups = this.#buildEffectGroups();
        break;
    }
    return context;
  }

  /**
   * Generates the data for the generic tab navigation template
   * @param {string[]} parts An array of named template parts to render
   * @returns {Record<string, Partial<ApplicationTab>>}
   * @protected
   */
  _getTabs(parts) {
    // If you have sub-tabs this is necessary to change
    const tabGroup = 'primary';
    // Default tab for first time it's rendered this session
    if (!this.tabGroups[tabGroup]) {
        // The tab open by default: Hotlist for crawlers, Mob Abilities for mobs
        // (limited viewers only have Notes).
        const defaults = { crawler: 'hotlist', mob: 'mobAbilities', pet: 'features' };
        this.tabGroups[tabGroup] = this.document.limited
          ? 'biography'
          : defaults[this.document.type] ?? 'biography';
      }
    return parts.reduce((tabs, partId) => {
      const tab = {
        cssClass: '',
        group: tabGroup,
        // Matches tab property to
        id: '',
        // FontAwesome Icon, if you so choose
        icon: '',
        // Run through localization
        label: 'CARL_RPG.Actor.Tabs.',
      };
      switch (partId) {
        case 'header':
        case 'tabs':
        case 'abilities':
          return tabs;
        case 'biography':
          tab.id = 'biography';
          tab.label += 'Biography';
          break;
        case 'features':
          tab.id = 'features';
          tab.label += 'Features';
          break;
        case 'personal':
          tab.id = 'personal';
          tab.label += 'Personal';
          break;
        case 'mount':
          tab.id = 'mount';
          tab.label += 'Mount';
          break;
        case 'spells':
          tab.id = 'spells';
          tab.label += 'Spells';
          break;
        case 'inventory':
          tab.id = 'inventory';
          tab.label += 'Inventory';
          break;
        case 'achievements':
          tab.id = 'achievements';
          tab.label += 'Achievements';
          break;
        case 'quests':
          tab.id = 'quests';
          tab.label += 'Quests';
          break;
        case 'loot':
          tab.id = 'loot';
          tab.label += 'Loot';
          break;
        case 'mobAbilities':
          tab.id = 'mobAbilities';
          tab.label += 'MobAbilities';
          break;
        case 'hotlist':
          tab.id = 'hotlist';
          tab.label += 'Hotlist';
          break;
        case 'gear':
          tab.id = 'gear';
          tab.label += 'Gear';
          break;
        case 'effects':
          tab.id = 'effects';
          tab.label += 'Effects';
          break;
        case 'upgrades':
          tab.id = 'upgrades';
          tab.label += 'Upgrades';
          break;
      }
      if (this.tabGroups[tabGroup] === tab.id) tab.cssClass = 'active';
      tabs[partId] = tab;
      return tabs;
    }, {});
  }

  /**
   * Organize and classify Items for Actor sheets.
   *
   * @param {object} context The context object to mutate
   */
  /** A mob's loot list: each item with its name and its chance. */
  async _prepareLootRows(context) {
    context.lootRows = await Promise.all(
      (this.actor.system.loot?.items ?? []).map(async (entry, index) => {
        const doc = entry.uuid ? await fromUuid(entry.uuid) : null;
        return {
          index,
          chance: entry.chance,
          name: doc?.name ?? entry.uuid,
          img: doc?.img ?? 'icons/svg/mystery-man.svg',
          missing: !doc,
        };
      })
    );
  }

  _prepareItems(context) {
    // Initialize containers.
    // You can just use `this.document.itemTypes` instead
    // if you don't need to subdivide a given type
    // (e.g. into groups)
    const gear = [];
    const features = [];
    const spells = [];
    const inventory = [];
    const mobAbilities = [];
    const lootBoxes = [];
    const achievements = [];

    // Iterate through items, allocating to containers
    for (let i of this.document.items) {
      // Append to gear.
      if (i.type === 'gear') {
        gear.push(i);
      }
      // Append to features.
      else if (i.type === 'skill') {
        features.push(i);
      }
      // Append to spells.
      else if (i.type === 'spell') {
        spells.push(i);
      }
      // Append to inventory.
      else if (i.type === 'item') {
        inventory.push(i);
      }
      // Append to mob abilities.
      else if (i.type === 'mobAbility') {
        mobAbilities.push(i);
      }
      // Append to loot boxes.
      else if (i.type === 'lootBox') {
        lootBoxes.push({
          id: i.id,
          name: i.name,
          img: i.img,
          quantity: i.system.quantity,
          tierName: CONFIG.CARL_RPG.lootTiers[i.system.tier]?.label,
          tierColor: CONFIG.CARL_RPG.lootTiers[i.system.tier]?.color,
        });
      }
      // Append to achievements.
      else if (i.type === 'achievement') {
        // Plain text for the tooltip (parsed in an inert document, so nothing in
        // the description can load or run).
        const summary = new DOMParser()
          .parseFromString(i.system.description ?? '', 'text/html')
          .body.textContent.trim();
        achievements.push({
          id: i.id,
          name: i.name,
          img: i.img,
          summary,
        });
      }
    }

    // Sort then assign
    const bySort = (a, b) => (a.sort || 0) - (b.sort || 0);
    context.gear = gear.sort(bySort);
    context.features = features.sort(bySort);
    context.spells = spells.sort(bySort);
    context.inventory = inventory.sort(bySort);
    context.mobAbilities = mobAbilities.sort(bySort);
    context.lootBoxes = lootBoxes.sort((a, b) => a.name.localeCompare(b.name));
    context.achievements = achievements.sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * For each weapon with a skill: every skill the crawler has, with the one it
   * rolls with marked. Keyed by the item's id.
   * @returns {Promise<Object<string, {uuid: string, name: string, selected: boolean}[]>>}
   */
  async _rollChoices() {
    const out = {};
    const skills = [...this.actor.itemTypes.skill].sort((a, b) => a.name.localeCompare(b.name));
    for (const gear of this.actor.itemTypes.gear) {
      if (!(gear.system.skills ?? []).length) continue;
      const rolling = await gear.rollingSkill();
      out[gear.id] = skills.map((s) => ({ uuid: s.uuid, name: s.name, selected: s.id === rolling?.id }));
    }
    return out;
  }

  /**
   * The race and class abilities a crawler has: each origin item and the skills
   * it grants, for the read-only list on the Notes tab.
   * @returns {Promise<{name: string, kind: string, skills: {name: string, rank: number}[]}[]>}
   */
  async _describeOrigins() {
    const groups = [];
    for (const item of this.actor.items) {
      if (!['race', 'class', 'subclass'].includes(item.type)) continue;
      const skills = [];
      for (const entry of item.system.grantedSkills ?? []) {
        const skill = await fromUuid(entry.uuid);
        skills.push({ name: skill?.name ?? entry.uuid, rank: entry.rank });
      }
      groups.push({
        name: item.name,
        kind: game.i18n.localize(`TYPES.Item.${item.type}`),
        skills,
      });
    }
    return groups;
  }

  /**
   * Each item's description, enriched, for the collapsible rows on the lists.
   * @returns {Promise<Object<string, string>>}  Item id to HTML
   */
  async _describeItems() {
    const out = {};
    for (const item of this.actor.items) {
      const desc = item.system.description ?? '';
      const body = desc
        ? await TextEditor.enrichHTML(desc, { async: true, relativeTo: item })
        : '';
      out[item.id] = body + this._itemRowExtras(item);
    }
    return out;
  }

  /**
   * The key numbers line and the upgrades of an item, under its description in
   * the expanded row. Upgrades are shown for skills and spells only.
   * @param {Item} item
   * @returns {string} HTML
   */
  _itemRowExtras(item) {
    const esc = (value) => foundry.utils.escapeHTML(String(value ?? ''));
    let html = '';
    const keys = describeBadges(item);
    if (keys.length) {
      html += `<div class="row-keys">${keys.map(esc).join(' · ')}</div>`;
    }
    if (['skill', 'spell'].includes(item.type)) {
      const upgrades = describeUpgrades(item);
      if (upgrades.length) {
        const level = game.i18n.localize('CARL_RPG.Upgrades.Level');
        html += '<ul class="row-upgrades">';
        for (const up of upgrades) {
          html += `<li class="${up.unlocked ? '' : 'locked'}">${esc(level)} ${esc(up.rank)}: ${esc(up.text)}</li>`;
        }
        html += '</ul>';
      }
    }
    return html;
  }

  /**
   * Add a collapsible description under each item row, and an expand / collapse
   * control above each list. Open rows are remembered per item on this computer.
   */
  _setupItemDescriptions() {
    const descs = this._itemDescriptions ?? {};
    const key = (id) => `carl-rpg.desc.${id}`;
    const setOpen = (li, body, open) => {
      body.hidden = !open;
      const icon = li.querySelector('.item-desc-toggle i');
      icon?.classList.toggle('fa-chevron-down', open);
      icon?.classList.toggle('fa-chevron-right', !open);
      if (open) localStorage.setItem(key(li.dataset.itemId), '1');
      else localStorage.removeItem(key(li.dataset.itemId));
    };
    for (const li of this.element.querySelectorAll('li.item[data-item-id]')) {
      if (li.dataset.descReady) continue;
      li.dataset.descReady = '1';
      const html = descs[li.dataset.itemId];
      if (!html) continue;
      const body = document.createElement('li');
      body.className = 'item-desc';
      body.innerHTML = html;
      li.after(body);
      const name = li.querySelector('.item-name');
      const toggle = document.createElement('a');
      toggle.className = 'item-desc-toggle';
      toggle.dataset.tooltip = game.i18n.localize('CARL_RPG.ItemDesc.Toggle');
      toggle.innerHTML = '<i class="fas fa-chevron-right"></i>';
      name?.prepend(toggle);
      setOpen(li, body, localStorage.getItem(key(li.dataset.itemId)) === '1');
      // Clicking the name opens the row; the picture still rolls the item.
      name?.addEventListener('click', (ev) => {
        if (ev.target.closest('.rollable')) return;
        ev.preventDefault();
        setOpen(li, body, body.hidden);
      });
    }
    for (const list of this.element.querySelectorAll('ol.items-list')) {
      if (list.previousElementSibling?.classList.contains('item-desc-all')) continue;
      const bar = document.createElement('div');
      bar.className = 'item-desc-all';
      bar.innerHTML =
        `<a data-act="open">${game.i18n.localize('CARL_RPG.ItemDesc.ExpandAll')}</a>` +
        ` <a data-act="close">${game.i18n.localize('CARL_RPG.ItemDesc.CollapseAll')}</a>`;
      list.before(bar);
      bar.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        for (const li of list.querySelectorAll('li.item[data-item-id]')) {
          const body = li.nextElementSibling;
          if (body?.classList.contains('item-desc')) setOpen(li, body, act === 'open');
        }
      });
    }
  }

  /**
   * Actions performed after any render of the Application.
   * Post-render steps are not awaited by the render process.
   * @param {ApplicationRenderContext} context      Prepared context data
   * @param {RenderOptions} options                 Provided render options
   * @protected
   * @override
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this._setupItemDescriptions();
    setupItemFilters(this);
    // A read-only sheet (anyone who isn't an Owner): the links that change
    // something look inactive. Limited users also can't roll.
    this.element.classList.toggle('sheet-readonly', !this.isEditable);
    this.element.classList.toggle(
      'sheet-norolls',
      !this.document.testUserPermission(game.user, 'OBSERVER')
    );
    this.#disableOverrides();
    // A weapon's "rolls with" skill, picked on the crawler's own copy.
    for (const select of this.element.querySelectorAll('select.roll-skill')) {
      select.addEventListener('change', () =>
        this.actor.items.get(select.dataset.itemId)?.update({ 'system.rollSkill': select.value })
      );
    }
    // Hotlist slot dropdowns save the picked item (they have no form name).
    for (const box of this.element.querySelectorAll('.quest-objective')) {
      box.addEventListener('change', (event) => this._saveQuestObjectives(event));
    }
    for (const input of this.element.querySelectorAll('.loot-chance')) {
      input.addEventListener('change', () => this._saveLootChances());
    }
    for (const select of this.element.querySelectorAll('.hotlist-select')) {
      select.addEventListener('change', (event) => this.#onHotlistChange(event));
    }
    // A pet's upgrade fields save into its stored list by their path.
    if (this.actor.type === 'pet') {
      for (const el of this.element.querySelectorAll(
        '.tab.upgrades input[data-path], .tab.upgrades select[data-path], .tab.upgrades textarea[data-path]'
      )) {
        el.addEventListener('change', () => this._saveUpgradeField(el));
      }
      for (const box of this.element.querySelectorAll('.unlock-effect')) {
        box.addEventListener('change', () =>
          this._toggleUnlockedEffect(Number(box.dataset.ui), box.dataset.key, box.checked)
        );
      }
    }
    this.#applyEditMode();
    // You may want to add other special handling here
    // Foundry comes with a large number of utility classes, e.g. SearchFilter
    // That you may want to implement yourself.
  }

  /**************
   *
   *   ACTIONS
   *
   **************/

  /**
   * Handle changing a Document's image.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @returns {Promise}
   * @protected
   */
  static async _onEditImage(event, target) {
    const attr = target.dataset.edit;
    const current = foundry.utils.getProperty(this.document, attr);
    const { img } =
      this.document.constructor.getDefaultArtwork?.(this.document.toObject()) ??
      {};
    const fp = new FilePicker({
      current,
      type: 'image',
      redirectToRoot: img ? [img] : [],
      callback: (path) => {
        this.document.update({ [attr]: path });
      },
      top: this.position.top + 40,
      left: this.position.left + 10,
    });
    return fp.browse();
  }

  /**
   * Renders an embedded document's sheet
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _viewDoc(event, target) {
    const doc = this._getEmbeddedDocument(target);
    doc.sheet.render(true);
  }

  /**
   * Handles item deletion
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _deleteDoc(event, target) {
    const doc = this._getEmbeddedDocument(target);
    await doc.delete();
  }

  /**
   * Handle creating a new Owned Item or ActiveEffect for the actor using initial data defined in the HTML dataset
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _createDoc(event, target) {
    // Retrieve the configured document class for Item or ActiveEffect
    const docCls = getDocumentClass(target.dataset.documentClass);
    // Prepare the document creation data by initializing it a default name.
    const docData = {
      name: docCls.defaultName({
        // defaultName handles an undefined type gracefully
        type: target.dataset.type,
        parent: this.actor,
      }),
    };
    // Loop through the dataset and add it to our docData
    for (const [dataKey, value] of Object.entries(target.dataset)) {
      // These data attributes are reserved for the action handling
      if (['action', 'documentClass'].includes(dataKey)) continue;
      // Nested properties require dot notation in the HTML, e.g. anything with `system`
      // e.g. `data-system.some-field` turns into the dataKey 'system.someField'
      foundry.utils.setProperty(docData, dataKey, value);
    }

    // Finally, create the embedded document!
    await docCls.create(docData, { parent: this.actor });
  }

  /**
   * Determines effect parent to pass to helper
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _toggleEffect(event, target) {
    event.preventDefault();
    const effect = this._getEmbeddedDocument(target);
    // Applies the rules: 3 buff limit with a swap prompt, equipment-controlled
    // effects, adding a stack to stackable debuffs (see CarlRPGActiveEffect).
    await effect?.setActive();
  }

  /**
   * Create a new effect directly on the actor (not from an item) and open it.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _createEffect(event, target) {
    event.preventDefault();
    const kind = target.dataset.kind ?? 'buff';
    const [effect] = await this.actor.createEmbeddedDocuments('ActiveEffect', [
      {
        name: game.i18n.format('CARL_RPG.Effect.NewName', {
          type: game.i18n.localize(CONFIG.CARL_RPG.effectKinds[kind]),
        }),
        img: 'icons/svg/aura.svg',
        origin: this.actor.uuid,
        // New buffs start off until used; debuffs and passives start on.
        disabled: kind === 'buff',
        flags: { 'carl-rpg': { kind, sourceItems: [], stacks: 1 } },
      },
    ]);
    effect?.sheet.render(true);
  }

  /**
   * Add a stack, remove a stack, or remove all stacks of a stackable debuff.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _effectStacks(event, target) {
    event.preventDefault();
    const effect = this._getEmbeddedDocument(target);
    if (!effect) return;
    switch (target.dataset.mode) {
      case 'add':
        await effect.changeStacks(1);
        break;
      case 'remove':
        await effect.changeStacks(-1);
        break;
      case 'all':
        await effect.removeAllStacks();
        break;
    }
  }

  /**
   * The actor's effects as the three sections of the Buffs/Debuffs tab.
   * @returns {object[]}
   */
  #buildEffectGroups() {
    const rows = this.actor.effects.map((effect) => ({
      id: effect.id,
      name: effect.name,
      img: effect.img,
      kind: effect.kind,
      active: !effect.disabled,
      stackable: effect.stackable,
      stacks: effect.stacks,
      maxStacks: effect.maxStacks,
      equipControlled: effect.equipControlled,
      // The rank a skill upgrade unlocks it at, if it hasn't been reached.
      lockedUntil: effect.lockedUntilRank,
      // Rounds left, for an effect that counts them.
      roundsLeft: effect.roundsLeft,
      permanent: effect.permanent,
      sources: effect.sourceItems
        .map((id) => this.actor.items.get(id)?.name)
        .filter(Boolean)
        .join(', '),
    }));
    return Object.keys(CONFIG.CARL_RPG.effectKinds).map((kind) => {
      const label = `CARL_RPG.Effect.Groups.${kind}`;
      const effects = rows
        .filter((row) => row.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        kind,
        label,
        effects,
        isBuff: kind === 'buff',
        limit: CONFIG.CARL_RPG.maxActiveBuffs,
        // Equipment-controlled effects don't use up buff slots.
        activeCount: effects.filter((e) => e.active && !e.equipControlled).length,
      };
    });
  }

  /**
   * Handle clickable rolls.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _onRoll(event, target) {
    event.preventDefault();
    const dataset = target.dataset;
    // A Dying crawler can't act or roll (see helpers/dying.mjs).
    if (dyingEffectOf(this.actor)) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.DyingNoAction'));
      return;
    }

    // Handle item rolls.
    switch (dataset.rollType) {
      case 'item':
        const item = this._getEmbeddedDocument(target);
        // (The click is passed on so the item can open the roll pop-up.)
        if (item) return item.roll(event);
    }

    // Handle rolls that supply the formula directly (an ability). These open the
    // roll pop-up too (hold Shift to skip it).
    if (dataset.roll) {
      let label = dataset.label ? `[ability] ${dataset.label}` : '';
      let options = {};
      if (!event.shiftKey) {
        options =
          (await promptRoll({
            title: dataset.label || label,
            stat: statOfFormula(dataset.roll),
          })) ?? null;
        if (!options) return null;
      }
      const formula = buildFormula(dataset.roll, options);
      if (formula === null) return null;
      const chosen = optionsNote(options);
      const first = new Roll(formula, this.actor.getRollData());
      await first.evaluate();
      // Before the result is shown, a crawler can spend AI Favor to reroll.
      const favor = await offerAiFavor(this.actor, first);
      const roll = favor.roll;
      // A plain stat check needs 10 + the Floor; the usual degrees of success apply.
      const rules = CONFIG.CARL_RPG.checks;
      const needed =
        rules.base + CONFIG.CARL_RPG.getFloor() * rules.statCheckFloorFactor;
      const degree = degreeOf(naturalD20(roll), roll.total, needed);
      const result = game.i18n.format('CARL_RPG.Check.StatResult', {
        needed,
        result: game.i18n.localize(CONFIG.CARL_RPG.attackDegrees[degree]),
      });
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: `${chosen ? `${label} (${chosen})` : label}<br>${result}${
          favor.note ? `<br><em>${favor.note}</em>` : ''
        }`,
        // (A stat check is coloured by how well it went: see helpers/chat-cards.mjs.)
        flags: { 'carl-rpg': { card: { kind: 'check', degree } } },
        rollMode: game.settings.get('core', 'rollMode'),
      });
      return roll;
    }
  }

  /**
   * Set the health bar by clicking a box. Clicking the box that is already the
   * last filled one removes it, so the bar can also be lowered to zero.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _setHealth(event, target) {
    event.preventDefault();
    const clicked = Number(target.dataset.value);
    const current = this.actor.system.health.value;
    const value = clicked === current ? clicked - 1 : clicked;
    await this.actor.update({
      'system.health.value': Math.min(
        Math.max(value, 0),
        this.actor.system.health.max
      ),
    });
  }

  /**
   * Try to advance a skill or spell: a d20 against its rank (see
   * helpers/advancement.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _advanceSkill(event, target) {
    event.preventDefault();
    const item = this._getEmbeddedDocument(target);
    if (item) await attemptAdvance(item);
  }

  /**
   * Mark a skill or spell as one the crawler can try to raise the rank of (or not).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _toggleAdvanceable(event, target) {
    event.preventDefault();
    const item = this._getEmbeddedDocument(target);
    if (!item) return;
    await item.update({ 'system.advanceable': !item.system.advanceable });
  }

  /**
   * Equip or unequip a piece of gear. Equipping into a full slot prompts for
   * which equipped gear to swap out (see CarlRPGItem#toggleEquipped).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _toggleEquipped(event, target) {
    event.preventDefault();
    const item = this._getEmbeddedDocument(target);
    await item?.toggleEquipped();
  }

  /**
   * This crawler takes a short, long or full rest (the button's `data-rest`),
   * after asking. Effects that last until that rest (or a shorter one) end.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  /** The crawler's quests, with their reward and deadline, for the Quests tab. */
  async _prepareQuests(context) {
    context.isGM = game.user.isGM;
    context.quests = await Promise.all(
      (this.actor.itemTypes?.quest ?? []).map(async (quest) => {
        const s = quest.system;
        const box = s.rewardBox ? await fromUuid(s.rewardBox) : null;
        const ach = s.rewardAchievement ? await fromUuid(s.rewardAchievement) : null;
        let deadlineLabel = '';
        if (s.deadline.type === 'floor') {
          deadlineLabel = game.i18n.format('CARL_RPG.Item.Quest.DeadlineFloor', { floor: s.deadline.value });
        } else if (s.deadline.type === 'days') {
          deadlineLabel = game.i18n.format('CARL_RPG.Item.Quest.DeadlineDays', { days: s.deadline.value });
        }
        return {
          id: quest.id,
          name: quest.name,
          img: quest.img,
          giver: s.giver,
          completed: s.completed,
          canComplete: game.user.isGM && !s.completed,
          tooltip: plainText(s.shortDescription),
          deadlineLabel,
          objectives: s.objectives.map((o, index) => ({ index, text: o.text, done: o.done })),
          gold: s.rewardGold,
          box: box?.name ?? '',
          achievement: ach?.name ?? '',
        };
      })
    );
  }

  /** A quest's objectives: its checkboxes save together. */
  async _saveQuestObjectives(event) {
    const questEl = event.currentTarget.closest('.quest');
    const quest = this.actor.items.get(questEl?.dataset.id);
    if (!quest) return;
    const objectives = quest.toObject().system.objectives.map((o, index) => ({
      ...o,
      done: !!questEl.querySelector(`.quest-objective[data-index="${index}"]`)?.checked,
    }));
    await quest.update({ 'system.objectives': objectives });
  }

  /** GM: complete a quest on this crawler: pay its gold, give its loot box and achievement. */
  static async _completeQuest(event, target) {
    if (!game.user.isGM) return;
    const quest = this.actor.items.get(target.closest('.quest').dataset.id);
    if (!quest || quest.system.completed) return;
    const { rewardGold, rewardBox, rewardAchievement } = quest.system;
    if (rewardGold) await this.actor.addGold(rewardGold);
    for (const uuid of [rewardBox, rewardAchievement]) {
      const doc = uuid ? await fromUuid(uuid) : null;
      if (doc?.documentName === 'Item') {
        await this.actor.createEmbeddedDocuments('Item', [game.items.fromCompendium(doc)]);
      }
    }
    await quest.update({ 'system.completed': true });
    await ChatMessage.create({
      content: `<div class="carl-quest-card">${game.i18n.format('CARL_RPG.Item.Quest.Done', {
        crawler: this.actor.name,
        quest: quest.name,
      })}</div>`,
    });
  }

  /** GM: remove a quest from this crawler. */
  static async _removeQuest(event, target) {
    if (!game.user.isGM) return;
    const quest = this.actor.items.get(target.closest('.quest').dataset.id);
    await quest?.delete();
  }

  /** GM: loot this defeated mob, giving its loot to the crawler picked. */
  static async _lootMob() {
    await pickCrawlerAndLoot(this.actor);
  }

  /** GM: take one item off the mob's loot list. */
  static async _removeLoot(event, target) {
    const index = Number(target.closest('.loot-row').dataset.index);
    const items = this.actor.toObject().system.loot.items;
    items.splice(index, 1);
    await this.actor.update({ 'system.loot.items': items });
  }

  /** Save the chances of the loot rows (they have no form names). */
  async _saveLootChances() {
    const items = this.actor.toObject().system.loot.items;
    for (const row of this.element.querySelectorAll('.loot-row')) {
      const entry = items[Number(row.dataset.index)];
      if (!entry) continue;
      const value = Math.floor(Number(row.querySelector('.loot-chance').value)) || 0;
      entry.chance = Math.min(100, Math.max(0, value));
    }
    await this.actor.update({ 'system.loot.items': items });
  }

  /** GM: take the mob's reward box off it. */
  static async _clearReward() {
    await this.actor.update({ 'system.rewardBox': '' });
  }

  /** GM: after a mob is defeated, give its reward loot box to the crawlers picked. */
  static async _giveReward() {
    if (!game.user.isGM) return;
    const box = await fromUuid(this.actor.system.rewardBox);
    if (!box || box.type !== 'lootBox') return;
    const crawlers = game.actors.filter((a) => a.type === 'crawler');
    if (!crawlers.length) return;
    const rows = crawlers
      .map(
        (c) =>
          `<label class="reward-pick"><input type="checkbox" name="crawler" value="${c.id}" checked> ${foundry.utils.escapeHTML(c.name)}</label>`
      )
      .join('');
    const ids = await CarlRPGDialog.prompt({
      window: { title: game.i18n.localize('CARL_RPG.Combat.RewardTitle') },
      content: `<p>${game.i18n.localize('CARL_RPG.Combat.RewardPick')}</p>${rows}`,
      ok: {
        label: game.i18n.localize('CARL_RPG.Combat.GiveReward'),
        callback: (event, button) =>
          [...button.form.querySelectorAll('input[name="crawler"]:checked')].map((i) => i.value),
      },
    });
    if (!ids?.length) return;
    for (const id of ids) {
      const crawler = game.actors.get(id);
      if (crawler) await crawler.createEmbeddedDocuments('Item', [game.items.fromCompendium(box)]);
    }
  }

  static async _rest(event, target) {
    event.preventDefault();
    await confirmRest(target.dataset.rest, this.actor);
  }

  /**
   * Change a pet's stored upgrades with a function, then save them. (The shared
   * events editor, helpers/event-editor.mjs, saves through this.) Saving as a GM
   * marks the events the upgrades carry as trusted; see CarlRPGActor#_preUpdate.
   * @param {(system: object) => void} mutate
   */
  async _updateEvents(mutate) {
    if (!this.actor.isOwner) return;
    const system = this.actor.toObject().system;
    mutate(system);
    await this.actor.update({ 'system.upgrades': system.upgrades });
  }

  /** The document whose events these are (the editor's "run now" button uses it). */
  get eventDoc() {
    return this.actor;
  }

  /**
   * A GM approves a pet's upgrade events as they are.
   * @this CarlRPGActorSheet
   */
  static async _approveEvents() {
    if (!game.user.isGM) return;
    await this.actor.update({ 'system.eventsTrusted': true });
  }

  /** New events on a pet start with a trigger that makes sense for a pet. */
  get defaultEventTrigger() {
    return CONFIG.CARL_RPG.petUpgrades.triggers[0];
  }

  /** Save one field of an upgrade (a level, description, change or event field). */
  async _saveUpgradeField(el) {
    const path = el.dataset.path;
    const value =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? Number(el.value) || 0
          : el.value;
    await this._updateEvents((system) => {
      foundry.utils.setProperty(system, path, value);
      // Upgrades are kept in level order.
      if (/^upgrades\.\d+\.rank$/.test(path)) {
        system.upgrades.sort((a, b) => a.rank - b.rank);
      }
      // A different kind of change starts with a value that suits it.
      if (/^upgrades\.\d+\.changes\.\d+\.type$/.test(path)) {
        foundry.utils.setProperty(system, path.replace(/\.type$/, '.value'), '1');
      }
    });
  }

  /** Tick or untick an effect an upgrade unlocks. */
  async _toggleUnlockedEffect(ui, key, on) {
    await this._updateEvents((system) => {
      const list = system.upgrades[ui].unlocksEffects;
      const at = list.indexOf(key);
      if (on && at < 0) list.push(key);
      if (!on && at >= 0) list.splice(at, 1);
    });
  }

  /**
   * Add a row to the kills list.
   * @this CarlRPGActorSheet
   */
  static async _addKill() {
    const kills = [...this.document.system.killLog, { name: '', note: '' }];
    await this.document.update({ 'system.killLog': kills });
  }

  /**
   * Add a row to a mount list (occupants, accessories or attacks). The button's
   * data-path names the list; attacks get a blank attack row.
   * @this CarlRPGActorSheet
   */
  static async _addMountRow(event, target) {
    const path = target.dataset.path;
    const list = foundry.utils.getProperty(this.document, path) ?? [];
    const blank = path === 'system.attacks' ? { name: '', roll: '', damage: '' } : '';
    await this.document.update({ [path]: [...list, blank] });
  }

  /** @this CarlRPGActorSheet */
  static async _removeMountRow(event, target) {
    const path = target.dataset.path;
    const index = Number(target.dataset.index);
    const list = foundry.utils.getProperty(this.document, path) ?? [];
    await this.document.update({ [path]: list.filter((_, i) => i !== index) });
  }

  /**
   * GM only: a sponsor sends the crawler a loot box. The GM picks a world loot box,
   * a copy goes onto the crawler and the sponsor posts a card about it.
   * @this CarlRPGActorSheet
   */
  static async _sendGift(event, target) {
    if (!game.user.isGM) return;
    const sponsor = this.document.items.get(target.dataset.sponsor);
    if (!sponsor) return;
    const boxes = game.items
      .filter((i) => i.type === 'lootBox')
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!boxes.length) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Sponsors.NoBoxes'));
      return;
    }
    const options = boxes
      .map((b) => `<option value="${b.uuid}">${foundry.utils.escapeHTML(b.name)}</option>`)
      .join('');
    const picked = await CarlRPGDialog.wait({
      window: { title: game.i18n.localize('CARL_RPG.Sponsors.SendGift') },
      content: `<p class="hint">${game.i18n.localize('CARL_RPG.Sponsors.GiftHint')}</p><select name="box">${options}</select>`,
      buttons: [
        {
          action: 'send',
          label: game.i18n.localize('CARL_RPG.Sponsors.SendGift'),
          default: true,
          callback: (event, button) => button.form.elements.box.value,
        },
        { action: 'cancel', label: game.i18n.localize('CARL_RPG.Sponsors.Cancel') },
      ],
    });
    if (!picked || picked === 'cancel') return;
    const box = await fromUuid(picked);
    if (!box) return;
    await this.document.createEmbeddedDocuments('Item', [box.toObject()]);
    await ChatMessage.create({
      content: game.i18n.format('CARL_RPG.Sponsors.GiftCard', {
        sponsor: sponsor.name,
        name: this.document.name,
        box: box.name,
      }),
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
    });
  }

  /** @this CarlRPGActorSheet */
  static async _removeKill(event, target) {
    const index = Number(target.dataset.index);
    const kills = this.document.system.killLog.filter((_, i) => i !== index);
    await this.document.update({ 'system.killLog': kills });
  }

  /**
   * Add an upgrade, at level 15 (or the next level after the ones already used).
   * The list is kept in level order.
   * @this CarlRPGActorSheet
   */
  static async _addUpgrade() {
    const { defaultLevel, levelStep } = CONFIG.CARL_RPG.petUpgrades;
    await this._updateEvents((system) => {
      const used = system.upgrades.map((u) => u.rank);
      const rank = used.includes(defaultLevel)
        ? Math.max(...used) + levelStep
        : defaultLevel;
      system.upgrades.push({
        id: foundry.utils.randomID(),
        rank,
        description: '',
        changes: [],
        grants: [],
        unlocksEffects: [],
        events: [],
      });
      system.upgrades.sort((a, b) => a.rank - b.rank);
    });
  }

  /** @this CarlRPGActorSheet */
  static async _removeUpgrade(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => system.upgrades.splice(ui, 1));
  }

  /** @this CarlRPGActorSheet */
  static async _addChange(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => {
      system.upgrades[ui].changes.push({ type: 'statBonus', value: '1', stat: 'str' });
    });
  }

  /** @this CarlRPGActorSheet */
  static async _removeChange(event, target) {
    const ui = Number(target.dataset.ui);
    const ci = Number(target.dataset.ci);
    await this._updateEvents((system) => system.upgrades[ui].changes.splice(ci, 1));
  }

  /** @this CarlRPGActorSheet */
  static async _removeGrant(event, target) {
    const ui = Number(target.dataset.ui);
    const gi = Number(target.dataset.gi);
    await this._updateEvents((system) => system.upgrades[ui].grants.splice(gi, 1));
  }

  /**
   * Drops on a pet's Upgrades tab: a document on one of the events editor's drop
   * boxes, or a skill or spell on an upgrade's list of what it gives. Anything
   * else is handled as usual.
   * @override
   */
  async _onDrop(event) {
    const zone = ['pet', 'mob'].includes(this.actor.type) ? event.target.closest('.drop-target') : null;
    if (!zone) return super._onDrop(event);
    event.preventDefault();
    if (!this.actor.isOwner) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);

    if (zone.dataset.accept === 'grant') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (!dropped || !['skill', 'spell'].includes(dropped.type)) {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Upgrades.OnlySkillsSpells'));
        return;
      }
      const ui_ = Number(zone.dataset.ui);
      await this._updateEvents((system) => {
        const list = system.upgrades[ui_].grants;
        if (!list.includes(dropped.uuid)) list.push(dropped.uuid);
      });
      return;
    }
    if (zone.dataset.accept === 'mobLoot') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (!dropped || dropped.documentName !== 'Item') return;
      const items = this.actor.toObject().system.loot.items;
      if (items.some((entry) => entry.uuid === dropped.uuid)) return;
      items.push({ uuid: dropped.uuid, chance: 100 });
      await this.actor.update({ 'system.loot.items': items });
      return;
    }
    if (zone.dataset.accept === 'lootBox') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (!dropped || dropped.type !== 'lootBox') {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.RewardOnlyBox'));
        return;
      }
      await this.actor.update({ 'system.rewardBox': dropped.uuid });
      return;
    }
    return dropTarget.call(this, zone, data);
  }

  /**
   * Open a pet's sheet from the Pets list on its crawler's sheet.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static _openPet(event, target) {
    event.preventDefault();
    game.actors.get(target.dataset.actorId)?.sheet.render(true);
  }

  /**
   * Level the crawler up (see helpers/level-up.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _levelUp(event, target) {
    event.preventDefault();
    await levelUp(this.actor);
  }

  /**
   * Open the character creation wizard (see sheets/creation-wizard.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _createCharacter(event, target) {
    event.preventDefault();
    CarlRPGCreationWizard.open(this.actor);
  }

  /**
   * Choose a subclass (see helpers/origins.mjs).
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The element that was clicked
   */
  static async _chooseSubclass(event, target) {
    await chooseSubclass(this.actor);
  }

  /**
   * Choose a race, then a class (see helpers/origins.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _chooseOrigin(event, target) {
    event.preventDefault();
    await chooseOrigin(this.actor);
  }

  /**
   * Open the Spend Points dialog.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _spendPoints(event, target) {
    event.preventDefault();
    await spendPoints(this.actor);
  }

  /**
   * Open one of the crawler's loot boxes (see helpers/loot.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _openLootBox(event, target) {
    event.preventDefault();
    const item = this._getEmbeddedDocument(target);
    if (item) await openLootBox(item);
  }

  /**
   * Toggle the sheet between locked and edit mode.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _toggleEditMode(event, target) {
    event.preventDefault();
    this.editMode = !this.editMode;
    await this.render();
  }

  /**
   * Lock the sheet unless edit mode is on. A locked sheet disables every form
   * control except the ones below and everything on the Notes tab. Buttons and
   * links for creating items, rolling and clicking health boxes are not form
   * controls, so they keep working; delete buttons and the portrait are hidden
   * from use by CSS (see `.edit-locked` in components/_theme.scss).
   */
  #applyEditMode() {
    const locked = !this.editMode;
    this.element.classList.toggle('edit-locked', locked);
    if (!locked) return;

    const alwaysEditable = new Set([
      'name',
      'system.aiFavor',
      'system.gold',
      'system.junk',
      'system.mana.value',
      'system.health.value',
    ]);
    for (const el of this.element.querySelectorAll('input, select, textarea')) {
      if (el.closest('.tab.biography')) continue;
      // Hotlist dropdowns stay usable while the sheet is locked.
      if (el.classList.contains('hotlist-select')) continue;
      if (alwaysEditable.has(el.getAttribute('name'))) continue;
      el.disabled = true;
    }
  }

  /**
   * Save the item picked in a hotlist slot. The whole `items` array is
   * replaced so the slots stay in order.
   * @param {Event} event
   */
  async #onHotlistChange(event) {
    const slot = Number(event.currentTarget.dataset.slot);
    const { size, items } = this.actor.system.hotlist;
    const updated = Array.from({ length: size }, (_, i) => items[i] ?? '');
    updated[slot] = event.currentTarget.value;
    await this.actor.update({ 'system.hotlist.items': updated });
  }

  /** Helper Functions */

  /**
   * Fetches the embedded document representing the containing HTML element
   *
   * @param {HTMLElement} target    The element subject to search
   * @returns {Item | ActiveEffect} The embedded Item or ActiveEffect
   */
  _getEmbeddedDocument(target) {
    // Any element can be the row (list items, hotlist boxes, ...) as long as
    // it carries data-document-class and the document's id.
    const docRow = target.closest('[data-document-class]');
    if (!docRow) return null;
    if (docRow.dataset.documentClass === 'Item') {
      return this.actor.items.get(docRow.dataset.itemId);
    } else if (docRow.dataset.documentClass === 'ActiveEffect') {
      const parent =
        docRow.dataset.parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(docRow?.dataset.parentId);
      return parent.effects.get(docRow?.dataset.effectId);
    } else return console.warn('Could not find document class');
  }

  /***************
   *
   * Drag and Drop
   *
   ***************/

  /**
   * Handle the dropping of ActiveEffect data onto an Actor Sheet
   * @param {DragEvent} event                  The concluding DragEvent which contains drop data
   * @param {object} data                      The data transfer extracted from the event
   * @returns {Promise<ActiveEffect|boolean>}  The created ActiveEffect object or false if it couldn't be created.
   * @protected
   */
  async _onDropActiveEffect(event, data) {
    const aeCls = getDocumentClass('ActiveEffect');
    const effect = await aeCls.fromDropData(data);
    if (!this.actor.isOwner || !effect) return false;
    if (effect.target === this.actor)
      return this._onSortActiveEffect(event, effect);
    return aeCls.create(effect, { parent: this.actor });
  }

  /**
   * Handle a drop event for an existing embedded Active Effect to sort that Active Effect relative to its siblings
   *
   * @param {DragEvent} event
   * @param {ActiveEffect} effect
   */
  async _onSortActiveEffect(event, effect) {
    /** @type {HTMLElement} */
    const dropTarget = event.target.closest('[data-effect-id]');
    if (!dropTarget) return;
    const target = this._getEmbeddedDocument(dropTarget);

    // Don't sort on yourself
    if (effect.uuid === target.uuid) return;

    // Identify sibling items based on adjacent HTML elements
    const siblings = [];
    for (const el of dropTarget.parentElement.children) {
      const siblingId = el.dataset.effectId;
      const parentId = el.dataset.parentId;
      if (
        siblingId &&
        parentId &&
        (siblingId !== effect.id || parentId !== effect.parent.id)
      )
        siblings.push(this._getEmbeddedDocument(el));
    }

    // Perform the sort
    const sortUpdates = SortingHelpers.performIntegerSort(effect, {
      target,
      siblings,
    });

    // Split the updates up by parent document
    const directUpdates = [];

    const grandchildUpdateData = sortUpdates.reduce((items, u) => {
      const parentId = u.target.parent.id;
      const update = { _id: u.target.id, ...u.update };
      if (parentId === this.actor.id) {
        directUpdates.push(update);
        return items;
      }
      if (items[parentId]) items[parentId].push(update);
      else items[parentId] = [update];
      return items;
    }, {});

    // Effects-on-items updates
    for (const [itemId, updates] of Object.entries(grandchildUpdateData)) {
      await this.actor.items
        .get(itemId)
        .updateEmbeddedDocuments('ActiveEffect', updates);
    }

    // Update on the main actor
    return this.actor.updateEmbeddedDocuments('ActiveEffect', directUpdates);
  }

  /**
   * Handle dropping of an Actor data onto another Actor sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<object|boolean>}  A data object which describes the result of the drop, or false if the drop was
   *                                     not permitted.
   * @protected
   */
  async _onDropActor(event, data) {
    if (!this.actor.isOwner) return false;
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping of a Folder on an Actor Sheet.
   * The core sheet currently supports dropping a Folder of Items to create all items as owned items.
   * @param {DragEvent} event     The concluding DragEvent which contains drop data
   * @param {object} data         The data transfer extracted from the event
   * @returns {Promise<Item[]>}
   * @protected
   */
  async _onDropFolder(event, data) {
    if (!this.actor.isOwner) return [];
    const folder = await Folder.implementation.fromDropData(data);
    if (folder.type !== 'Item') return [];
    const droppedItemData = await Promise.all(
      folder.contents.map(async (item) => {
        if (!(document instanceof Item)) item = await fromUuid(item.uuid);
        return item;
      })
    );
    return this._onDropItemCreate(droppedItemData, event);
  }

  /**
   * Handle the final creation of dropped Item data on the Actor.
   * This method is factored out to allow downstream classes the opportunity to override item creation behavior.
   * @param {object[]|object} itemData      The item data requested for creation
   * @param {DragEvent} event               The concluding DragEvent which provided the drop data
   * @returns {Promise<Item[]>}
   * @private
   */
  async _onDropItemCreate(itemData, event) {
    itemData = itemData instanceof Array ? itemData : [itemData];
    // A crawler has one deity: a new one replaces the old.
    if (itemData.some((d) => d.type === 'deity')) {
      const old = this.actor.itemTypes.deity.map((i) => i.id);
      if (old.length) await this.actor.deleteEmbeddedDocuments('Item', old);
    }
    // A crawler has one Personal Space: a new one replaces the old.
    if (itemData.some((d) => d.type === 'personalSpace')) {
      const old = this.actor.itemTypes.personalSpace.map((i) => i.id);
      if (old.length) await this.actor.deleteEmbeddedDocuments('Item', old);
    }
    // A crawler can hold up to the sponsor limit (-1 means no limit).
    const limit = game.settings.get('carl-rpg', 'sponsorLimit');
    const incoming = itemData.filter((d) => d.type === 'sponsor');
    if (incoming.length && limit >= 0) {
      const held = this.actor.itemTypes.sponsor.length;
      if (held + incoming.length > limit) {
        ui.notifications.warn(game.i18n.format('CARL_RPG.Sponsors.Full', { limit }));
        itemData = itemData.filter((d) => d.type !== 'sponsor');
        if (!itemData.length) return [];
      }
    }
    return this.actor.createEmbeddedDocuments('Item', itemData);
  }

  /********************
   *
   * Actor Override Handling
   *
   ********************/

  /**
   * Submit a document update based on the processed form data.
   * @param {SubmitEvent} event                   The originating form submission event
   * @param {HTMLFormElement} form                The form element that was submitted
   * @param {object} submitData                   Processed and validated form data to be used for a document update
   * @returns {Promise<void>}
   * @protected
   * @override
   */
  async _processSubmitData(event, form, submitData) {
    const overrides = foundry.utils.flattenObject(this.actor.overrides);
    for (let k of Object.keys(overrides)) delete submitData[k];
    await this.document.update(submitData);
  }

  /**
   * Disables inputs subject to active effects
   */
  #disableOverrides() {
    const flatOverrides = foundry.utils.flattenObject(this.actor.overrides);
    for (const override of Object.keys(flatOverrides)) {
      const input = this.element.querySelector(`[name="${override}"]`);
      if (input) {
        input.disabled = true;
      }
    }
  }
}

// A crawler's sheet lists its pets (and their levels), so open crawler sheets
// redraw when a pet is created, changed (its owner or level) or deleted.
for (const hook of ['createActor', 'updateActor', 'deleteActor']) {
  Hooks.on(hook, (actor) => {
    if (actor.type !== 'pet') return;
    for (const app of foundry.applications.instances.values()) {
      if (app.document?.type === 'crawler' && app.rendered) app.render(false);
    }
  });
}