import { CarlRPGDialog } from '../helpers/dialog.mjs';
import { openStoreFor, resolveListing, restockListing } from '../helpers/store.mjs';
import { skillStatLabel } from '../helpers/creation.mjs';
import { describeBadges } from '../helpers/item-badges.mjs';
import {
  buildEventRows,
  eventOptions as buildEventOptions,
  EVENT_EDITOR_ACTIONS,
} from '../helpers/event-editor.mjs';
import {
  changeProblem,
  describeUpgrades,
  effectKey,
} from '../helpers/upgrades.mjs';
import {
  knownTags,
  listHasTag,
  sameTag,
  withTag,
  withoutTag,
} from '../helpers/tags.mjs';

const { api, sheets } = foundry.applications;
const DragDrop = foundry.applications.ux.DragDrop;


/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheetV2}
 */
export class CarlRPGItemSheet extends api.HandlebarsApplicationMixin(
  sheets.ItemSheetV2
) {
  constructor(options = {}) {
    super(options);
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['carl-rpg', 'item'],
    actions: {
      showInChat: this._showInChat,
      addAmenity: this._addAmenity,
      removeAmenity: this._removeAmenity,
      onEditImage: this._onEditImage,
      viewDoc: this._viewEffect,
      createDoc: this._createEffect,
      deleteDoc: this._deleteEffect,
      toggleEffect: this._toggleEffect,
      newEmbeddedSkill: this._newEmbeddedSkill,
      viewEmbeddedSkill: this._viewEmbeddedSkill,
      removeEmbeddedSkill: this._removeEmbeddedSkill,
      removeReward: this._removeReward,
    removeListing: this._removeListing,
    openStore: this._openStore,
    giveQuest: this._giveQuest,
    addObjective: this._addObjective,
    removeObjective: this._removeObjective,
    restockListing: this._restockListing,
      clearReward: this._clearReward,
      addPrerequisite: this._addPrerequisite,
      addTag: this._addTag,
      removeTag: this._removeTag,
      removePrerequisite: this._removePrerequisite,
      removeGrantedSkill: this._removeGrantedSkill,
      // The events editor's buttons are shared (helpers/event-editor.mjs).
      ...EVENT_EDITOR_ACTIONS,
      addRequirement: this._addRequirement,
      approveEvents: this._approveEvents,
      addUpgrade: this._addUpgrade,
      removeUpgrade: this._removeUpgrade,
      addChange: this._addChange,
      removeChange: this._removeChange,
      removeRequirement: this._removeRequirement,
    },
    form: {
      submitOnChange: true,
    },
    // Custom property that's merged into `this.options`
    dragDrop: [{ dragSelector: '.draggable', dropSelector: null }],
  };

  /* -------------------------------------------- */

  /** @override */
  static PARTS = {
    header: {
      template: 'systems/carl-rpg/templates/item/header.hbs',
    },
    tabs: {
      // Foundry-provided generic template
      template: 'templates/generic/tab-navigation.hbs',
    },
    description: {
      template: 'systems/carl-rpg/templates/item/description.hbs',
    },
    attributesFeature: {
      template:
        'systems/carl-rpg/templates/item/attribute-parts/feature.hbs',
    },
    attributesGear: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/gear.hbs',
    },
    attributesSpell: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/spell.hbs',
    },
    attributesItem: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/item.hbs',
    },
    attributesMobAbility: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/mob-ability.hbs',
    },
    skills: {
      template: 'systems/carl-rpg/templates/item/skills.hbs',
    },
    attributesLootBox: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/loot-box.hbs',
    },
    attributesClub: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/club.hbs',
    },
    attributesPersonalSpace: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/personal-space.hbs',
    },
    attributesSponsor: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/sponsor.hbs',
    },
    attributesStore: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/store.hbs',
    },
    attributesQuest: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/quest.hbs',
    },
    attributesAchievement: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/achievement.hbs',
    },
    attributesOrigin: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/origin.hbs',
    },
    attributesBackground: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/background.hbs',
    },
    upgrades: {
      template: 'systems/carl-rpg/templates/item/upgrades.hbs',
    },
    grantedSkills: {
      template: 'systems/carl-rpg/templates/item/granted-skills.hbs',
    },
    prerequisites: {
      template: 'systems/carl-rpg/templates/item/prerequisites.hbs',
    },
    rewards: {
      template: 'systems/carl-rpg/templates/item/rewards.hbs',
    },
    guaranteed: {
      template: 'systems/carl-rpg/templates/item/guaranteed.hbs',
    },
    events: {
      template: 'systems/carl-rpg/templates/item/events.hbs',
    },
    tags: {
      template: 'systems/carl-rpg/templates/item/tags.hbs',
    },
    effects: {
      template: 'systems/carl-rpg/templates/item/effects.hbs',
    },
  };

  /** @override */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    // Not all parts always render
    options.parts = ['header', 'tabs', 'description'];
    // Don't show the other tabs if only limited view
    if (this.document.limited) return;
    // Control which parts show based on document subtype
    switch (this.document.type) {
      case 'skill':
        // Skills carry tags (the creation wizard offers the ones with a chosen tag).
        options.parts.push('attributesFeature', 'tags', 'effects', 'upgrades');
        break;
      case 'gear':
        options.parts.push('attributesGear', 'skills', 'effects');
        break;
      case 'spell':
        options.parts.push('attributesSpell', 'effects', 'upgrades');
        break;
      case 'item':
        options.parts.push('attributesItem', 'skills', 'effects');
        break;
      case 'mobAbility':
        options.parts.push('attributesMobAbility', 'effects');
        break;
      case 'lootBox':
        options.parts.push('attributesLootBox', 'rewards', 'guaranteed');
        break;
      case 'achievement':
        options.parts.push('attributesAchievement');
        break;
      case 'sponsor':
        options.parts.push('attributesSponsor');
        break;
      case 'store':
        options.parts.push('attributesStore');
        break;
      case 'quest':
        options.parts.push('attributesQuest');
        break;
      case 'personalSpace':
        options.parts.push('attributesPersonalSpace');
        break;
      case 'club':
        options.parts.push('attributesClub', 'effects');
        break;
      case 'deity':
        options.parts.push('skills', 'effects');
        break;
      case 'race':
      case 'class':
      case 'subclass':
        options.parts.push(
          'attributesOrigin',
          'grantedSkills',
          'prerequisites',
          'effects'
        );
        break;
      case 'background':
        // Just a description, the categories it is offered in and its skills.
        options.parts.push('attributesBackground', 'skills');
        return;
    }
    // Every other item type can have requirements and events.
    options.parts.push('events');
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = {
      // Validates both permissions and compendium status
      editable: this.isEditable,
      owner: this.document.isOwner,
      limited: this.document.limited,
      // Add the item document.
      item: this.item,
      // Adding system and flags for easier access
      system: this.item.system,
      flags: this.item.flags,
      // Adding a pointer to CONFIG.CARL_RPG
      config: CONFIG.CARL_RPG,
      // You can factor out context construction to helper functions
      tabs: this._getTabs(options.parts),
      // Necessary for formInput and formFields helpers
      fields: this.document.schema.fields,
      systemFields: this.document.system.schema.fields,
    };

    // Quests: the names of the reward loot box and achievement (drop boxes show them).
    if (this.item.type === 'quest') {
      const { rewardBox, rewardAchievement } = this.item.system;
      context.rewardBoxName = rewardBox ? (await fromUuid(rewardBox))?.name ?? '' : '';
      context.rewardAchName = rewardAchievement ? (await fromUuid(rewardAchievement))?.name ?? '' : '';
      context.isGM = game.user.isGM;
    }

    // Stores: each listing's item, its value, and its price and stock as set
    // (a blank price or stock shows the placeholder).
    if (this.item.type === 'store') {
      context.listingRows = await Promise.all(
        (this.item.system.listings ?? []).map(async (listing, index) => {
          const resolved = await resolveListing(listing);
          return {
            index,
            name: resolved.name,
            img: resolved.img,
            missing: resolved.missing,
            value: resolved.value,
            price: listing.price,
            startStock: listing.startStock,
            current:
              listing.quantity === null
                ? game.i18n.localize('CARL_RPG.Item.Store.Unlimited')
                : listing.quantity,
          };
        })
      );
    }

    // Loot boxes: resolve the reward list for the Rewards tab, with each
    // entry's chance (shown to the GM) and any problems with the list.
    if (this.item.type === 'lootBox') {
      const rows = await Promise.all(
        (this.item.system.rewards ?? []).map(async (reward, index) => {
          const doc = await fromUuid(reward.uuid);
          const valid =
            !!doc && doc.documentName === 'Item' && doc.type !== 'lootBox';
          return {
            index,
            uuid: reward.uuid,
            name: doc?.name ?? reward.uuid,
            img: doc?.img ?? 'icons/svg/mystery-man.svg',
            quantity: reward.quantity,
            weight: reward.weight,
            missing: !doc,
            invalid: !!doc && !valid,
            eligible: valid && reward.weight > 0,
          };
        })
      );
      const totalWeight = rows
        .filter((r) => r.eligible)
        .reduce((sum, r) => sum + r.weight, 0);
      for (const row of rows) {
        row.odds =
          row.eligible && totalWeight
            ? Math.round((row.weight / totalWeight) * 1000) / 10
            : 0;
      }
      context.rewardRows = rows;
      // Guaranteed items (always granted; how many is a formula).
      context.guaranteedRows = await Promise.all(
        (this.item.system.guaranteed ?? []).map(async (entry, index) => {
          const doc = await fromUuid(entry.uuid);
          const valid =
            !!doc && doc.documentName === 'Item' && doc.type !== 'lootBox';
          return {
            index,
            uuid: entry.uuid,
            name: doc?.name ?? entry.uuid,
            img: doc?.img ?? 'icons/svg/mystery-man.svg',
            quantity: entry.quantity,
            missing: !doc,
            invalid: !!doc && !valid,
            badFormula: !Roll.validate(String(entry.quantity)),
          };
        })
      );
      context.rewardWarnings = [];
      context.guaranteedWarnings = [];
      context.goldWarnings = [];
      if (!rows.length && !context.guaranteedRows.length) {
        context.rewardWarnings.push('CARL_RPG.Loot.Warn.Empty');
      } else if (rows.length && !totalWeight) {
        context.rewardWarnings.push('CARL_RPG.Loot.Warn.NoneEligible');
      }
      if (context.guaranteedRows.some((g) => g.badFormula)) {
        context.guaranteedWarnings.push('CARL_RPG.Loot.Warn.BadFormula');
      }
      if (!Roll.validate(this.item.system.goldFormula)) {
        context.goldWarnings.push('CARL_RPG.Loot.Warn.BadGold');
      }
      context.isGM = game.user.isGM;
      context.tiers = Object.fromEntries(
        Object.entries(CONFIG.CARL_RPG.lootTiers).map(([key, tier]) => [
          key,
          tier.label,
        ])
      );
      context.tierGold = CONFIG.CARL_RPG.lootTiers[this.item.system.tier]?.gold;
    }

    // The automatic badges at the top of the Description tab.
    context.itemBadges = describeBadges(this.item);
    // Quantity always goes in the header, for every kind of item that has one
    // (gear, plain items and loot boxes).
    context.headerQuantity = 'quantity' in this.item.system;
    // The gold value: the GM always sees and sets it; a crawler sees it (read only)
    // only when an effect grants sight of values (effectModifiers.seeValues).
    context.isGM = game.user.isGM;
    context.showValue = game.user.isGM || !!this.item.actor?.system.bonuses?.seeValues;

    // Races and classes: categories, granted skills and prerequisites, with
    // every drop target's name resolved.
    if (['race', 'class', 'subclass'].includes(this.item.type)) {
      const cfg = CONFIG.CARL_RPG;
      const system = this.item.system;
      const isRace = this.item.type === 'race';
      context.isRace = isRace;
      context.isOrigin = true;
      context.isSubclass = this.item.type === 'subclass';
      context.classLinkName = system.classUuid
        ? ((await fromUuid(system.classUuid))?.name ?? '?')
        : '';
      // Classes: categories (the suggested ones to tick, plus custom ones) and
      // the regular tags, which are a separate list.
      if (!isRace) {
        const categories = system.categories ?? [];
        context.isClass = true;
        context.tagOptions = cfg.classCategories.map((name) => ({
          name,
          checked: listHasTag(categories, name),
        }));
        context.customCategories = categories.filter(
          (c) => !cfg.classCategories.some((name) => sameTag(name, c))
        );
        context.regularTags = system.tags ?? [];
        // The selected categories as one line for the header: the suggested ones
        // in their usual order, then any custom ones.
        context.classTagLine = [
          ...context.tagOptions.filter((o) => o.checked).map((o) => o.name),
          ...context.customCategories,
        ].join(', ');
      }
      context.grantedRows = await Promise.all(
        (system.grantedSkills ?? []).map(async (entry, index) => {
          const skill = await fromUuid(entry.uuid);
          return {
            index,
            uuid: entry.uuid,
            name: skill?.name ?? entry.uuid,
            img: skill?.img ?? 'icons/svg/mystery-man.svg',
            rank: entry.rank,
            missing: !skill || skill.type !== 'skill',
          };
        })
      );
      // A race can't require a race or race category (only classes can).
      context.prereqOptions = {
        types: Object.fromEntries(
          Object.entries(cfg.prerequisiteTypes).filter(
            ([key]) => !isRace || !['race', 'raceCategory', 'classTag'].includes(key)
          )
        ),
        stats: cfg.abilities,
        categories: cfg.raceCategories,
      };
      const dropTypes = { skillRank: 'skill', race: 'race', achievement: 'achievement' };
      context.prereqRows = await Promise.all(
        (system.prerequisites ?? []).map(async (p, index) => {
          const doc = p.uuid ? await fromUuid(p.uuid) : null;
          return {
            ...p,
            index,
            path: `prerequisites.${index}`,
            showStat: p.type === 'stat',
            showCategory: p.type === 'raceCategory',
            showTag: p.type === 'classTag',
            showValue: ['stat', 'skillRank', 'level'].includes(p.type),
            dropType: dropTypes[p.type],
            showDrop: !!dropTypes[p.type],
            dropHint: `CARL_RPG.Origin.Drop.${dropTypes[p.type] ?? 'skill'}`,
            docName: doc?.name,
            docMissing: !!p.uuid && (!doc || doc.type !== dropTypes[p.type]),
          };
        })
      );
    }

    // Achievements: the loot box they grant, with its name resolved.
    if (this.item.type === 'achievement') {
      const uuid = this.item.system.lootBox;
      const box = uuid ? await fromUuid(uuid) : null;
      context.rewardBox = {
        uuid,
        name: box?.name,
        missing: !!uuid && !(box?.type === 'lootBox'),
      };
    }

    // The Events tab: requirements and events, with every drop target's name
    // resolved. Option lists are menus from CONFIG.CARL_RPG.
    {
      const cfg = CONFIG.CARL_RPG;
      // The triggers on offer depend on the kind of item (gear, loot boxes, skills and
      // spells have some of their own); the rest of the menus are shared.
      const allowedTriggers = Object.keys(cfg.eventTriggers).filter(
        (key) =>
          !cfg.eventTriggersEffectOnly.includes(key) &&
          (this.item.type === 'gear' || !cfg.eventTriggersGearOnly.includes(key)) &&
          (this.item.type === 'lootBox' || !cfg.eventTriggersLootOnly.includes(key)) &&
          (['skill', 'spell'].includes(this.item.type) ||
            !cfg.eventTriggersSkillOnly.includes(key))
      );
      context.eventOptions = buildEventOptions(allowedTriggers);
      // (The menu for how often an item's uses recharge, on its Attributes tab.)
      context.usesRechargeOptions = cfg.usesRecharge;
      const system = this.item.system;
      // Tags known to the world, to suggest when typing a "class has tag" rule.
      context.classTagNames = knownTags('class', cfg.classCategories);
      // Regular tags (the Tags tab, used by skills).
      context.regularTags = system.tags ?? [];
      context.requirementRows = (system.requirements ?? []).map((req, index) => ({
        ...req,
        index,
        path: `requirements.${index}`,
        showStat: req.type === 'stat',
        showTag: req.type === 'classTag',
      }));
      context.eventRows = await buildEventRows(system.events ?? [], 'events');
    }

    // Skills and spells: their upgrades, for the Upgrades tab (and the lists of
    // what the skill does at its current rank on the other tabs).
    if (['skill', 'spell'].includes(this.item.type)) {
      const cfg = CONFIG.CARL_RPG;
      const system = this.item.system;
      const isSpell = this.item.type === 'spell';
      const rank = system.rank ?? 0;
      context.isFeature = true;
      // A pet's skills use the current floor as their rank, so there's no rank to edit.
      context.rankIsFloor = this.item.parent?.type === 'pet';
      context.upgradeChangeOptions = Object.fromEntries(
        Object.entries(cfg.upgrades.changes).filter(
          ([key]) => isSpell || !cfg.upgrades.spellOnly.includes(key)
        )
      );
      context.upgradeTargetOptions = cfg.checkTargets;
      // The skill's own effects an upgrade can unlock.
      context.upgradeEffects = this.item.effects.map((effect) => ({
        key: effectKey(effect),
        name: effect.name,
      }));
      context.upgradeRows = await Promise.all(
        (system.upgrades ?? []).map(async (upgrade, ui) => ({
          ...upgrade,
          index: ui,
          path: `upgrades.${ui}`,
          unlocked: upgrade.rank <= rank,
          changes: upgrade.changes.map((change, ci) => ({
            ...change,
            index: ci,
            path: `upgrades.${ui}.changes.${ci}`,
            isFormula: ['damageAdd', 'damageReplace'].includes(change.type),
            isNumber: ['dieStep', 'manaCost', 'rollBonus'].includes(change.type),
            isTarget: change.type === 'rollTarget',
            invalid: changeProblem(change),
          })),
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
      // The same warning as the Events tab: events a player saved are limited.
      context.upgradeEventsUntrusted =
        !system.eventsTrusted && (system.upgrades ?? []).some((u) => u.events?.length);
      // What the skill does at its current rank, listed under its description.
      context.upgradeList = describeUpgrades(this.item);
      const effective = this.item.system.effective;
      context.effective = {
        damage: effective?.damage ?? '',
        damageChanged: (effective?.damage ?? '') !== (system.damage ?? ''),
        manaCost: effective?.manaCost ?? 0,
        manaChanged: isSpell && (effective?.manaCost ?? 0) !== (system.manaCost ?? 0),
        targetChanged: (effective?.target ?? '') !== (system.check?.target ?? ''),
        target: cfg.checkTargets[effective?.target],
        rollBonus: effective?.rollBonus ?? 0,
      };
    }

    // Backgrounds: the creation categories they can be ticked for, and a warning
    // if they wouldn't be offered anywhere.
    if (this.item.type === 'background') {
      const system = this.item.system;
      context.isBackground = true;
      context.categoryOptions = CONFIG.CARL_RPG.creation.skillGroups.map(
        (group) => ({
          id: group.id,
          label: `CARL_RPG.Creation.Groups.${group.id}`,
          checked: (system.categories ?? []).includes(group.id),
        })
      );
      context.backgroundWarnings = [];
      if (!(system.categories ?? []).length) {
        context.backgroundWarnings.push('CARL_RPG.Item.Background.Warn.NoCategory');
      }
      if ((system.skills ?? []).length < 2) {
        context.backgroundWarnings.push('CARL_RPG.Item.Background.Warn.TooFew');
      }
    }

    // Gear, items and backgrounds can embed skills (stored as UUIDs). Resolve
    // them for the Skills tab; a skill that can no longer be found is flagged as
    // missing. A background's list also shows each skill's stat, like "(Cha)".
    if (['gear', 'item', 'background'].includes(this.item.type)) {
      const showStat = this.item.type === 'background';
      context.embeddedSkills = await Promise.all(
        (this.item.system.skills ?? []).map(async (uuid) => {
          const skill = await fromUuid(uuid);
          return {
            uuid,
            name: skill?.name ?? uuid,
            img: skill?.img ?? 'icons/svg/mystery-man.svg',
            rank: skill?.system?.rank,
            statLabel: showStat ? skillStatLabel(skill) : '',
            stat: skillStatLabel(skill),
            rollsWith:
              this.item.type === 'gear' &&
              uuid ===
                ((this.item.system.skills ?? []).includes(this.item.system.rollSkill)
                  ? this.item.system.rollSkill
                  : (this.item.system.skills ?? [])[0]),
            missing: !skill,
          };
        })
      );
    }

    return context;
  }

  /** The document whose events these are (the editor's "run now" button uses it). */
  get eventDoc() {
    return this.item;
  }

  /** @override */
  async _preparePartContext(partId, context) {
    switch (partId) {
      case 'attributesFeature':
      case 'attributesGear':
      case 'attributesSpell':
      case 'attributesItem':
      case 'attributesMobAbility':
      case 'attributesLootBox':
      case 'attributesAchievement':
      case 'attributesSponsor':
      case 'attributesStore':
      case 'attributesQuest':
      case 'attributesOrigin':
      case 'attributesBackground':
      case 'grantedSkills':
      case 'prerequisites':
      case 'rewards':
      case 'guaranteed':
      case 'events':
      case 'upgrades':
      case 'tags':
      case 'skills':
        // Necessary for preserving active tab on re-render
        context.tab = context.tabs[partId];
        break;
      case 'attributesPersonalSpace':
        context.tab = context.tabs[partId];
        context.sizeOptions = CONFIG.CARL_RPG.sizeOptions();
        break;
      case 'attributesClub':
        context.tab = context.tabs[partId];
        context.isCopy = !!this.item.parent;
        // The crawlers in this world who hold a club with this name (the world item only).
        context.clubMembers = this.item.parent
          ? []
          : game.actors
              .filter((a) => a.type === 'crawler' && a.itemTypes.club.some((c) => c.name === this.item.name))
              .map((a) => ({
                name: a.name,
                role: a.itemTypes.club.find((c) => c.name === this.item.name)?.system.role ?? '',
              }));
        break;
      case 'description':
        context.tab = context.tabs[partId];
        context.enrichedShortDescription = await TextEditor.enrichHTML(
          this.item.system.shortDescription ?? '',
          {
            secrets: this.document.isOwner,
            rollData: this.item.getRollData(),
            relativeTo: this.item,
          }
        );
        // Enrich description info for display
        // Enrichment turns text like `[[/r 1d20]]` into buttons
        context.enrichedDescription = await TextEditor.enrichHTML(
          this.item.system.description,
          {
            // Whether to show secret blocks in the finished html
            secrets: this.document.isOwner,
            // Data to fill in for inline rolls
            rollData: this.item.getRollData(),
            // Relative UUID resolution
            relativeTo: this.item,
          }
        );
        break;
      case 'effects':
        context.tab = context.tabs[partId];
        // Effects on an item are templates, copied to an actor with the item
        context.effectRows = this.item.effects.map((effect) => ({
          id: effect.id,
          name: effect.name,
          img: effect.img,
          kind: CONFIG.CARL_RPG.effectKinds[effect.kind],
          stackable: effect.stackable,
          permanent: effect.permanent,
          equipLinked: effect.equipLinked,
        }));
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
    if (!this.tabGroups[tabGroup]) this.tabGroups[tabGroup] = 'description';
    return parts.reduce((tabs, partId) => {
      const tab = {
        cssClass: '',
        group: tabGroup,
        // Matches tab property to
        id: '',
        // FontAwesome Icon, if you so choose
        icon: '',
        // Run through localization
        label: 'CARL_RPG.Item.Tabs.',
      };
      switch (partId) {
        case 'header':
        case 'tabs':
          return tabs;
        case 'description':
          tab.id = 'description';
          tab.label += 'Description';
          break;
        case 'attributesFeature':
        case 'attributesGear':
        case 'attributesSpell':
        case 'attributesItem':
        case 'attributesMobAbility':
        case 'attributesLootBox':
        case 'attributesAchievement':
      case 'attributesSponsor':
      case 'attributesClub':
      case 'attributesPersonalSpace':
        case 'attributesOrigin':
        case 'attributesBackground':
          tab.id = 'attributes';
          tab.label += 'Attributes';
          break;
        case 'grantedSkills':
          tab.id = 'grantedSkills';
          tab.label += 'GrantedSkills';
          break;
        case 'prerequisites':
          tab.id = 'prerequisites';
          tab.label += 'Prerequisites';
          break;
        case 'skills':
          tab.id = 'skills';
          tab.label += 'Skills';
          break;
        case 'rewards':
          tab.id = 'rewards';
          tab.label += 'Rewards';
          break;
        case 'guaranteed':
          tab.id = 'guaranteed';
          tab.label += 'Guaranteed';
          break;
        case 'tags':
          tab.id = 'tags';
          tab.label += 'Tags';
          break;
        case 'events':
          tab.id = 'events';
          tab.label += 'Events';
          break;
        case 'upgrades':
          tab.id = 'upgrades';
          tab.label += 'Upgrades';
          break;
        case 'effects':
          tab.id = 'effects';
          tab.label += 'Effects';
          break;
      }
      if (this.tabGroups[tabGroup] === tab.id) tab.cssClass = 'active';
      tabs[partId] = tab;
      return tabs;
    }, {});
  }

  /**
   * Actions performed after any render of the Application.
   * Post-render steps are not awaited by the render process.
   * @param {ApplicationRenderContext} context      Prepared context data
   * @param {RenderOptions} options                 Provided render options
   * @protected
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Collapsible description blocks: remember open or closed on this computer.
    for (const block of this.element.querySelectorAll('details.desc-block[data-desc-key]')) {
      const key = `carl-rpg.desc.${this.item.id}.${block.dataset.descKey}`;
      try {
        const saved = localStorage.getItem(key);
        if (saved === 'closed') block.open = false;
        if (saved === 'open') block.open = true;
      } catch (err) {
        // Storage can be blocked; the default (open) still works.
      }
      block.addEventListener('toggle', () => {
        try {
          localStorage.setItem(key, block.open ? 'open' : 'closed');
        } catch (err) {
          // Ignored: the choice just won't be remembered.
        }
      });
    }
    for (const input of this.element.querySelectorAll('.quest-obj-text')) {
      input.addEventListener('change', () => this._saveObjectives());
    }
    // Store prices and stock save the whole list when changed (no form names).
    for (const input of this.element.querySelectorAll('.store-price, .store-quantity')) {
      input.addEventListener('change', () => this._saveListings());
    }

    // Reward weights and quantities save the whole list when changed.
    for (const input of this.element.querySelectorAll(
      '.reward-weight, .reward-quantity, .guaranteed-formula'
    )) {
      input.addEventListener('change', () => this._saveRewards());
    }
    // Event and requirement fields save into the stored lists by their path.
    for (const el of this.element.querySelectorAll(
      'input[data-path], select[data-path], textarea[data-path]'
    )) {
      el.addEventListener('change', () => this._saveEventField(el));
    }
    for (const box of this.element.querySelectorAll('.tag-toggle')) {
      box.addEventListener('change', () =>
        this._toggleTag(box.dataset.tag, box.checked)
      );
    }
    // The effects an upgrade unlocks.
    for (const box of this.element.querySelectorAll('.unlock-effect')) {
      box.addEventListener('change', () =>
        this._toggleUnlockedEffect(Number(box.dataset.ui), box.dataset.key, box.checked)
      );
    }
    // A background's creation categories.
    for (const box of this.element.querySelectorAll('.category-toggle')) {
      box.addEventListener('change', () =>
        this._toggleBackgroundCategory(box.dataset.category, box.checked)
      );
    }
    // Enter in a tag box adds that tag.
    for (const input of this.element.querySelectorAll('.tag-input')) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const button = this.element.querySelector(
          `[data-action="addTag"][data-field="${input.dataset.field}"]`
        );
        this.constructor._addTag.call(this, event, button);
      });
    }
    new DragDrop.implementation({
      dragSelector: ".draggable",
      dropSelector: null,
      permissions: {
        dragstart: this._canDragStart.bind(this),
        drop: this._canDragDrop.bind(this)
      },
      callbacks: {
        dragstart: this._onDragStart.bind(this),
        dragover: this._onDragOver.bind(this),
        drop: this._onDrop.bind(this)
      }
    }).bind(this.element);
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
   * Post this item to chat: its Short Description, with the full text one click away.
   * @this CarlRPGItemSheet
   */
  static async _showInChat() {
    const item = this.item;
    const short = (item.system.shortDescription ?? '').trim();
    const full = item.system.description ?? '';
    const options = {
      secrets: false,
      rollData: item.getRollData(),
      relativeTo: item,
    };
    const shortHtml = await TextEditor.enrichHTML(short || full, options);
    const fullHtml = await TextEditor.enrichHTML(full, options);
    const more =
      short && full
        ? `<details><summary>${game.i18n.localize('CARL_RPG.ItemDesc.FullDescription')}</summary>${fullHtml}</details>`
        : '';
    const content = `<div class="carl-rpg item-chat-card"><header class="item-chat-head"><img src="${item.img}" width="36" height="36"><strong>${foundry.utils.escapeHTML(item.name)}</strong></header><div class="item-chat-short">${shortHtml}</div>${more}</div>`;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(item.parent ? { actor: item.parent } : {}),
      content,
    });
  }

  /** Add an empty amenity row to a Personal Space item. */
  static async _addAmenity() {
    const amenities = [...this.item.system.amenities, { name: '', description: '' }];
    await this.item.update({ 'system.amenities': amenities });
  }

  /** Remove the amenity row the button belongs to. */
  static async _removeAmenity(event, target) {
    const index = Number(target.dataset.index);
    const amenities = this.item.system.amenities.filter((_, i) => i !== index);
    await this.item.update({ 'system.amenities': amenities });
  }

  /**
   * Handle changing a Document's image.
   *
   * @this CarlRPGItemSheet
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
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _viewEffect(event, target) {
    const effect = this._getEffect(target);
    effect.sheet.render(true);
  }

  /**
   * Handles item deletion
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _deleteEffect(event, target) {
    const effect = this._getEffect(target);
    await effect.delete();
  }

  /**
   * Handle creating a new Owned Item or ActiveEffect for the actor using initial data defined in the HTML dataset
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _createEffect(event, target) {
    // Retrieve the configured document class for ActiveEffect
    const aeCls = getDocumentClass('ActiveEffect');
    // Prepare the document creation data by initializing it a default name.
    // As of v12, you can define custom Active Effect subtypes just like Item subtypes if you want
    const effectData = {
      name: aeCls.defaultName({
        // defaultName handles an undefined type gracefully
        type: target.dataset.type,
        parent: this.item,
      }),
    };
    // Loop through the dataset and add it to our effectData
    for (const [dataKey, value] of Object.entries(target.dataset)) {
      // These data attributes are reserved for the action handling
      if (['action', 'documentClass'].includes(dataKey)) continue;
      // Nested properties require dot notation in the HTML, e.g. anything with `system`
      // e.g. `data-system.some-field` turns into the dataKey 'system.someField'
      foundry.utils.setProperty(effectData, dataKey, value);
    }

    // Finally, create the embedded document and open it for editing.
    const effect = await aeCls.create(effectData, { parent: this.item });
    effect?.sheet.render(true);
  }

  /**
   * Determines effect parent to pass to helper
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _toggleEffect(event, target) {
    const effect = this._getEffect(target);
    await effect.update({ disabled: !effect.disabled });
  }

  /**
   * Create a brand new Skill (in the world's Items directory), embed it in this
   * gear or item, and open it for editing.
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _newEmbeddedSkill(event, target) {
    event.preventDefault();
    const skill = await Item.create({
      name: Item.defaultName({ type: 'skill' }),
      type: 'skill',
    });
    if (!skill) return;
    await this._addEmbeddedSkill(skill.uuid);
    skill.sheet.render(true);
  }

  /**
   * Open an embedded skill's own sheet.
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _viewEmbeddedSkill(event, target) {
    const uuid = target.closest('[data-skill-uuid]')?.dataset.skillUuid;
    const skill = uuid ? await fromUuid(uuid) : null;
    skill?.sheet.render(true);
  }

  /**
   * Remove a skill from this gear or item (the skill itself is not deleted).
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _removeEmbeddedSkill(event, target) {
    const uuid = target.closest('[data-skill-uuid]')?.dataset.skillUuid;
    if (!uuid) return;
    const skills = (this.item.system.skills ?? []).filter((u) => u !== uuid);
    await this.item.update({ 'system.skills': skills });
  }

  /* -------------------------------------------- */
  /*  Events tab                                  */
  /* -------------------------------------------- */

  /**
   * Change the stored requirements/events with a function, then save them.
   * Always writes both lists, so a GM saving marks the events as trusted.
   * @param {(system: object) => void} mutate
   */
  async _updateEvents(mutate) {
    if (!this.item.isOwner) return;
    const system = this.item.toObject().system;
    mutate(system);
    const update = {
      'system.events': system.events,
      'system.requirements': system.requirements,
    };
    // Races and classes keep their prerequisites and granted skills here too.
    if ('prerequisites' in system) update['system.prerequisites'] = system.prerequisites;
    if ('grantedSkills' in system) update['system.grantedSkills'] = system.grantedSkills;
    // Skills and spells keep their upgrades (and the events those carry) here too.
    if ('upgrades' in system) update['system.upgrades'] = system.upgrades;
    await this.item.update(update);
  }

  /** Save one field of an event, condition, action or requirement. */
  async _saveEventField(el) {
    const value =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? Number(el.value) || 0
          : el.value;
    const path = el.dataset.path;
    await this._updateEvents((system) => {
      foundry.utils.setProperty(system, path, value);
      // Upgrades are kept in rank order.
      if (/^upgrades\.\d+\.rank$/.test(path)) {
        system.upgrades.sort((a, b) => a.rank - b.rank);
      }
      // A different kind of change starts with a value that suits it.
      if (/^upgrades\.\d+\.changes\.\d+\.type$/.test(path)) {
        const starts = {
          damageAdd: '',
          damageReplace: '',
          dieStep: '1',
          manaCost: '-1',
          rollBonus: '1',
          rollTarget: 'evade',
        };
        foundry.utils.setProperty(
          system,
          path.replace(/\.type$/, '.value'),
          starts[value] ?? ''
        );
      }
    });
  }

  /** A drop box was dropped on: store the dropped document's UUID. */
  async _onDropTarget(zone, data) {
    // A quest's reward achievement, or an achievement's reward box (below, by field).
    if (zone.dataset.accept === 'achievement') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (dropped?.type !== 'achievement') {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Quest.WrongAchievement'));
        return false;
      }
      await this.item.update({ ['system.' + zone.dataset.field]: dropped.uuid });
      return true;
    }

    // A subclass's class: a class item dropped on the box.
    if (zone.dataset.accept === 'classLink') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (dropped?.type !== 'class') {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Origin.Drop.Wrong.class'));
        return false;
      }
      await this.item.update({ 'system.classUuid': dropped.uuid });
      return true;
    }

    // The reward loot box of an achievement or a quest.
    if (zone.dataset.accept === 'lootBox') {
      const dropped =
        data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (dropped?.type !== 'lootBox') {
        ui.notifications.warn(
          game.i18n.localize('CARL_RPG.Achievement.WrongDrop')
        );
        return false;
      }
      await this.item.update({ ['system.' + (zone.dataset.field || 'lootBox')]: dropped.uuid });
      return true;
    }

    const accepts = { item: 'Item', macro: 'Macro', effect: 'ActiveEffect', actor: 'Actor' };
    if (data.type !== accepts[zone.dataset.accept] || !data.uuid) {
      ui.notifications.warn(
        game.i18n.localize(`CARL_RPG.Events.Drop.Wrong.${zone.dataset.accept}`)
      );
      return false;
    }
    // Some drop boxes only take a particular kind of item (a skill, a race...).
    if (zone.dataset.itemType) {
      const doc = await fromUuid(data.uuid);
      if (doc?.type !== zone.dataset.itemType) {
        ui.notifications.warn(
          game.i18n.localize(`CARL_RPG.Origin.Drop.Wrong.${zone.dataset.itemType}`)
        );
        return false;
      }
    }
    await this._updateEvents((system) =>
      foundry.utils.setProperty(
        system,
        `${zone.dataset.path}.${zone.dataset.field}`,
        data.uuid
      )
    );
    return true;
  }

  /** Save a new list for a tag field: 'tags' or 'categories'. */
  async _setTagList(field, list) {
    if (!this.item.isOwner || !['tags', 'categories'].includes(field)) return;
    await this.item.update({ [`system.${field}`]: list });
  }

  /**
   * Tick or untick a creation category (Childhood, Hobby...) a background is
   * offered in. The list keeps the order the creation config gives.
   */
  async _toggleBackgroundCategory(id, on) {
    if (!this.item.isOwner) return;
    const current = this.item.toObject().system.categories ?? [];
    const next = on
      ? [...new Set([...current, id])]
      : current.filter((c) => c !== id);
    const order = CONFIG.CARL_RPG.creation.skillGroups.map((g) => g.id);
    next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    await this.item.update({ 'system.categories': next });
  }

  /** Tick or untick one of the suggested class categories. */
  async _toggleTag(tag, on) {
    const list = this.item.toObject().system.categories;
    await this._setTagList(
      'categories',
      on ? withTag(list, tag) : withoutTag(list, tag)
    );
  }

  /**
   * Add what was typed in the box next to the button (ignoring case, so it
   * can't be added twice). `data-field` says which list: tags or categories.
   * @this CarlRPGItemSheet
   */
  static async _addTag(event, target) {
    const field = target?.dataset.field;
    const input = this.element.querySelector(`.tag-input[data-field="${field}"]`);
    const text = input?.value.trim();
    if (!text) return;
    await this._setTagList(
      field,
      withTag(this.item.toObject().system[field], text)
    );
  }

  /** @this CarlRPGItemSheet */
  static async _removeTag(event, target) {
    const field = target.dataset.field;
    await this._setTagList(
      field,
      withoutTag(this.item.toObject().system[field], target.dataset.tag)
    );
  }

  /** @this CarlRPGItemSheet */
  static async _addPrerequisite() {
    await this._updateEvents((system) => {
      system.prerequisites.push({
        type: 'stat',
        stat: 'str',
        value: 1,
        category: 'earthBased',
        uuid: '',
      });
    });
  }

  /** @this CarlRPGItemSheet */
  static async _removePrerequisite(event, target) {
    const pi = Number(target.dataset.pi);
    await this._updateEvents((system) => system.prerequisites.splice(pi, 1));
  }

  /** @this CarlRPGItemSheet */
  static async _removeGrantedSkill(event, target) {
    const gi = Number(target.dataset.gi);
    await this._updateEvents((system) => system.grantedSkills.splice(gi, 1));
  }

  /** @this CarlRPGItemSheet */
  static async _clearReward() {
    await this.item.update({ 'system.lootBox': '' });
  }

  /**
   * A GM approves the item's events as they are (events a player saved are limited
   * to what that player could do themselves).
   * @this CarlRPGItemSheet
   */
  static async _approveEvents() {
    if (!game.user.isGM) return;
    await this.item.update({ 'system.eventsTrusted': true });
  }

  /**
   * Add an upgrade, at the next default rank that isn't used yet (5, 10, 15,
   * 20, then every 5). The list is kept in rank order.
   * @this CarlRPGItemSheet
   */
  static async _addUpgrade() {
    const { defaultRanks, rankStep } = CONFIG.CARL_RPG.upgrades;
    await this._updateEvents((system) => {
      const used = new Set(system.upgrades.map((u) => u.rank));
      const rank =
        defaultRanks.find((r) => !used.has(r)) ??
        Math.max(0, ...used, ...defaultRanks) + rankStep;
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

  /** @this CarlRPGItemSheet */
  static async _removeUpgrade(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => system.upgrades.splice(ui, 1));
  }

  /** @this CarlRPGItemSheet */
  static async _addChange(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => {
      system.upgrades[ui].changes.push({ type: 'damageAdd', value: '', stat: 'str' });
    });
  }

  /** @this CarlRPGItemSheet */
  static async _removeChange(event, target) {
    const ui = Number(target.dataset.ui);
    const ci = Number(target.dataset.ci);
    await this._updateEvents((system) => system.upgrades[ui].changes.splice(ci, 1));
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

  /** @this CarlRPGItemSheet */
  static async _addRequirement() {
    await this._updateEvents((system) => {
      system.requirements.push({ type: 'mana', stat: 'str', value: 1 });
    });
  }

  /** @this CarlRPGItemSheet */
  static async _removeRequirement(event, target) {
    const ri = Number(target.dataset.ri);
    await this._updateEvents((system) => system.requirements.splice(ri, 1));
  }

  /** Helper Functions */

  /**
   * Remove an entry from a loot box's reward list.
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _removeReward(event, target) {
    const row = target.closest('[data-index]');
    const index = Number(row?.dataset.index);
    if (!Number.isInteger(index)) return;
    const list = row.dataset.list === 'guaranteed' ? 'guaranteed' : 'rewards';
    const entries = this.item.toObject().system[list];
    entries.splice(index, 1);
    await this.item.update({ [`system.${list}`]: entries });
  }

  /** Save the price and stock of the store listings (they have no form names). */
  async _saveListings() {
    const listings = this.item.toObject().system.listings;
    for (const row of this.element.querySelectorAll('.store-row')) {
      const listing = listings[Number(row.dataset.index)];
      if (!listing) continue;
      const price = row.querySelector('.store-price').value.trim();
      const quantity = row.querySelector('.store-quantity').value.trim();
      listing.price = price === '' ? null : Math.max(0, Math.floor(Number(price)) || 0);
      listing.startStock = quantity === '' ? null : Math.max(0, Math.floor(Number(quantity)) || 0);
    }
    await this.item.update({ 'system.listings': listings });
  }

  /** Quests: save the objective texts (the rows have no form names). */
  async _saveObjectives() {
    const objectives = this.item.toObject().system.objectives;
    const updated = [...this.element.querySelectorAll('.quest-obj')].map((row, index) => ({
      text: row.querySelector('.quest-obj-text').value,
      done: objectives[index]?.done ?? false,
    }));
    await this.item.update({ 'system.objectives': updated });
  }

  /** Quests: add an objective row. */
  static async _addObjective() {
    const objectives = this.item.toObject().system.objectives;
    objectives.push({ text: '', done: false });
    await this.item.update({ 'system.objectives': objectives });
  }

  /** Quests: remove an objective row. */
  static async _removeObjective(event, target) {
    const index = Number(target.closest('.quest-obj').dataset.index);
    const objectives = this.item.toObject().system.objectives;
    objectives.splice(index, 1);
    await this.item.update({ 'system.objectives': objectives });
  }

  /** GM: give this quest to a crawler (picked here). It is copied onto their sheet. */
  static async _giveQuest() {
    const crawlers = game.actors.filter((a) => a.type === 'crawler');
    if (!crawlers.length) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoCrawlers'));
      return;
    }
    const choices = crawlers
      .map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`)
      .join('');
    const id = await CarlRPGDialog.prompt({
      window: { title: 'CARL_RPG.Item.Quest.Give' },
      content: `<div class="form-group"><label>${game.i18n.localize('CARL_RPG.Item.Store.OpenFor')}</label>
        <select name="crawler">${choices}</select></div>`,
      ok: {
        label: 'CARL_RPG.Item.Quest.Give',
        callback: (event, button) => button.form.elements.crawler.value,
      },
    });
    const actor = id ? game.actors.get(id) : null;
    if (!actor) return;
    const data = this.item.toObject();
    delete data._id;
    data.system.completed = false;
    data.system.objectives = data.system.objectives.map((o) => ({ ...o, done: false }));
    data.flags = {
      ...(data.flags ?? {}),
      'carl-rpg': { ...(data.flags?.['carl-rpg'] ?? {}), questSource: this.item.uuid },
    };
    await actor.createEmbeddedDocuments('Item', [data]);
  }

  /** GM: open the store for the whole party or one crawler, picked here. */
  static async _openStore() {
    const crawlers = game.actors.filter((a) => a.type === 'crawler');
    if (!crawlers.length) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoCrawlers'));
      return;
    }
    const choices = [
      `<option value="party">${game.i18n.localize('CARL_RPG.Item.Store.Party')}</option>`,
      ...crawlers.map((a) => `<option value="${a.id}">${a.name}</option>`),
    ].join('');
    const target = await CarlRPGDialog.prompt({
      window: { title: 'CARL_RPG.Item.Store.Open' },
      content: `<div class="form-group"><label>${game.i18n.localize('CARL_RPG.Item.Store.OpenFor')}</label>
        <select name="target">${choices}</select></div>`,
      ok: {
        label: 'CARL_RPG.Item.Store.Open',
        callback: (event, button) => button.form.elements.target.value,
      },
    });
    if (target) await openStoreFor(this.item, target);
  }

  /** GM: add stock to the listing on this row (see helpers/store.mjs). */
  static async _restockListing(event, target) {
    const index = Number(target.closest('.store-row').dataset.index);
    await restockListing(this.item, index);
  }

  /** Remove one listing from the store. */
  static async _removeListing(event, target) {
    const row = target.closest('.store-row');
    const listings = this.item.toObject().system.listings;
    listings.splice(Number(row.dataset.index), 1);
    await this.item.update({ 'system.listings': listings });
  }

  /**
   * Save the weight and quantity fields of the reward rows (they have no form
   * names, so the whole list is written back).
   */
  async _saveRewards() {
    const system = this.item.toObject().system;
    const rewards = system.rewards;
    for (const row of this.element.querySelectorAll('.reward-row')) {
      const reward = rewards[Number(row.dataset.index)];
      if (!reward) continue;
      reward.weight = Math.max(0, Number(row.querySelector('.reward-weight').value) || 0);
      reward.quantity = Math.max(
        1,
        Math.floor(Number(row.querySelector('.reward-quantity').value)) || 1
      );
    }
    const guaranteed = system.guaranteed;
    for (const row of this.element.querySelectorAll('.guaranteed-row')) {
      const entry = guaranteed[Number(row.dataset.index)];
      if (!entry) continue;
      entry.quantity = row.querySelector('.guaranteed-formula').value.trim() || '1';
    }
    await this.item.update({
      'system.rewards': rewards,
      'system.guaranteed': guaranteed,
    });
  }

  /**
   * Add a skill (by UUID) to this gear or item's embedded skills, unless it is
   * already there.
   * @param {string} uuid
   */
  async _addEmbeddedSkill(uuid) {
    const current = this.item.system.skills ?? [];
    if (current.includes(uuid)) return;
    await this.item.update({ 'system.skills': [...current, uuid] });
  }

  /**
   * Fetches the row with the data for the rendered embedded document
   *
   * @param {HTMLElement} target  The element with the action
   * @returns {HTMLLIElement} The document's row
   */
  _getEffect(target) {
    const li = target.closest('.effect');
    return this.item.effects.get(li?.dataset?.effectId);
  }

  /**
   *
   * DragDrop
   *
   */

  /**
   * Define whether a user is able to begin a dragstart workflow for a given drag selector
   * @param {string} selector       The candidate HTML selector for dragging
   * @returns {boolean}             Can the current user drag this selector?
   * @protected
   */
  _canDragStart(selector) {
    // game.user fetches the current user
    return this.isEditable;
  }

  /**
   * Define whether a user is able to conclude a drag-and-drop workflow for a given drop selector
   * @param {string} selector       The candidate HTML selector for the drop target
   * @returns {boolean}             Can the current user drop on this selector?
   * @protected
   */
  _canDragDrop(selector) {
    // game.user fetches the current user
    return this.isEditable;
  }

  /**
   * Callback actions which occur at the beginning of a drag start workflow.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  _onDragStart(event) {
    const li = event.currentTarget;
    if ('link' in event.target.dataset) return;

    let dragData = null;

    // Active Effect
    if (li.dataset.effectId) {
      const effect = this.item.effects.get(li.dataset.effectId);
      dragData = effect.toDragData();
    }

    if (!dragData) return;

    // Set data transfer
    event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
  }

  /**
   * Callback actions which occur when a dragged element is over a drop target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  _onDragOver(event) { }

  /**
   * Callback actions which occur when a dragged element is dropped on a target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    const item = this.item;
    const allowed = Hooks.call('dropItemSheetData', item, this, data);
    if (allowed === false) return;

    // A drop box on the Events tab (item, macro, effect or actor).
    const zone = event.target.closest('.drop-target');
    if (zone) {
      event.preventDefault();
      return this._onDropTarget(zone, data);
    }

    // Although you will find implmentations to all doc types here, it is important to keep 
    // in mind that only Active Effects are "valid" for items.
    // Actors have items, but items do not have actors.
    // Items in items is not implemented on Foudry per default. If you need an implementation with that,
    // try to search how other systems do. Basically they will use the drag and drop, but they will store
    // the UUID of the item.
    // Folders can only contain Actors or Items. So, fall on the cases above.
    // We left them here so you can have an idea of how that would work, if you want to do some kind of
    // implementation for that.
    switch (data.type) {
      case 'ActiveEffect':
        return this._onDropActiveEffect(event, data);
      case 'Actor':
        return this._onDropActor(event, data);
      case 'Item':
        return this._onDropItem(event, data);
      case 'Folder':
        return this._onDropFolder(event, data);
    }
  }

  /* -------------------------------------------- */

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
    if (!this.item.isOwner || !effect) return false;

    if (this.item.uuid === effect.parent?.uuid)
      return this._onEffectSort(event, effect);
    return aeCls.create(effect, { parent: this.item });
  }

  /**
   * Sorts an Active Effect based on its surrounding attributes
   *
   * @param {DragEvent} event
   * @param {ActiveEffect} effect
   */
  _onEffectSort(event, effect) {
    const effects = this.item.effects;
    const dropTarget = event.target.closest('[data-effect-id]');
    if (!dropTarget) return;
    const target = effects.get(dropTarget.dataset.effectId);

    // Don't sort on yourself
    if (effect.id === target.id) return;

    // Identify sibling items based on adjacent HTML elements
    const siblings = [];
    for (let el of dropTarget.parentElement.children) {
      const siblingId = el.dataset.effectId;
      if (siblingId && siblingId !== effect.id)
        siblings.push(effects.get(el.dataset.effectId));
    }

    // Perform the sort
    const sortUpdates = SortingHelpers.performIntegerSort(effect, {
      target,
      siblings,
    });
    const updateData = sortUpdates.map((u) => {
      const update = u.update;
      update._id = u.target._id;
      return update;
    });

    // Perform the update
    return this.item.updateEmbeddedDocuments('ActiveEffect', updateData);
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping of an Actor data onto another Actor sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<object|boolean>}  A data object which describes the result of the drop, or false if the drop was
   *                                     not permitted.
   * @protected
   */
  async _onDropActor(event, data) {
    if (!this.item.isOwner) return false;
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping of an item reference or item data onto an Actor Sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<Item[]|boolean>}  The created or updated Item instances, or false if the drop was not permitted.
   * @protected
   */
  async _onDropItem(event, data) {
    if (!this.item.isOwner) return false;

    // Races and classes: skills dropped on the Skills tab are granted at rank 1.
    if (['race', 'class', 'subclass'].includes(this.item.type)) {
      if (!event.target.closest('.tab.grantedSkills')) return false;
      const dropped = await Item.fromDropData(data);
      if (dropped?.type !== 'skill' || !dropped.uuid) {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Origin.Drop.Wrong.skill'));
        return false;
      }
      await this._updateEvents((system) => {
        if (system.grantedSkills.some((g) => g.uuid === dropped.uuid)) return;
        system.grantedSkills.push({ uuid: dropped.uuid, rank: 1 });
      });
      return dropped;
    }

    // Stores: an item dropped on the store joins its listings once.
    if (this.item.type === 'store') {
      const dropped = await Item.fromDropData(data);
      if (!dropped?.uuid) return false;
      if (dropped.type === 'store') {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoStores'));
        return false;
      }
      const listings = this.item.toObject().system.listings;
      if (listings.some((l) => l.uuid === dropped.uuid)) return false;
      listings.push({ uuid: dropped.uuid, price: null, quantity: null });
      await this.item.update({ 'system.listings': listings });
      return dropped;
    }

    // Loot boxes: items dropped on the Random Rewards tab join the reward
    // list; items dropped on the Guaranteed tab join the guaranteed items.
    if (this.item.type === 'lootBox') {
      const onGuaranteed = !!event.target.closest('.tab.guaranteed');
      if (!onGuaranteed && !event.target.closest('.tab.rewards')) return false;
      const dropped = await Item.fromDropData(data);
      if (!dropped?.uuid) return false;
      if (dropped.type === 'lootBox') {
        // Loot boxes never reward loot boxes.
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Loot.NoLootBoxes'));
        return false;
      }
      const list = onGuaranteed ? 'guaranteed' : 'rewards';
      const entries = this.item.toObject().system[list];
      if (entries.some((r) => r.uuid === dropped.uuid)) return false;
      entries.push(
        list === 'guaranteed'
          ? { uuid: dropped.uuid, quantity: '1' }
          : { uuid: dropped.uuid, quantity: 1, weight: 1 }
      );
      await this.item.update({ [`system.${list}`]: entries });
      return dropped;
    }
    // Skills can be dropped onto the Skills tab of gear, items and backgrounds.
    if (!['gear', 'item', 'background'].includes(this.item.type)) return false;
    if (!event.target.closest('.tab.skills')) return false;

    const dropped = await Item.fromDropData(data);
    if (!dropped?.uuid || dropped.type !== 'skill') {
      ui.notifications.warn(
        game.i18n.localize('CARL_RPG.Item.EmbeddedSkill.OnlySkills')
      );
      return false;
    }
    await this._addEmbeddedSkill(dropped.uuid);
    return dropped;
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
    if (!this.item.isOwner) return [];
  }
}
