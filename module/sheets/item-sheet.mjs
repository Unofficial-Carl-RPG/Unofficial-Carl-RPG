import { resolveListing, restockListing } from '../helpers/store.mjs';
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
} from '../helpers/tags.mjs';
import { listTemplates } from '../helpers/event-library.mjs';
import { ItemSheetEffects } from './item-sheet-effects.mjs';
import { ItemSheetEmbeddedSkills } from './item-sheet-skills.mjs';
import { ItemSheetEvents } from './item-sheet-events.mjs';
import { ItemSheetTags } from './item-sheet-tags.mjs';
import { ItemSheetCosts } from './item-sheet-costs.mjs';
import { ItemSheetUpgrades } from './item-sheet-upgrades.mjs';
import { ItemSheetStoreQuestLoot } from './item-sheet-store-quest-loot.mjs';
import { ItemSheetDrops } from './item-sheet-drops.mjs';

const { api, sheets } = foundry.applications;
const DragDrop = foundry.applications.ux.DragDrop;

// The sheet is built from one mixin per feature (see item-sheet-*.mjs).
const ItemSheetBase = [
  ItemSheetEffects,
  ItemSheetEmbeddedSkills,
  ItemSheetEvents,
  ItemSheetTags,
  ItemSheetCosts,
  ItemSheetUpgrades,
  ItemSheetStoreQuestLoot,
  ItemSheetDrops,
].reduce((Base, mixin) => mixin(Base), api.HandlebarsApplicationMixin(sheets.ItemSheetV2));

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheetV2}
 */
export class CarlRPGItemSheet extends ItemSheetBase {
  constructor(options = {}) {
    super(options);
  }

  /**
   * An item on a crawler or mob follows its actor: only the actor's Owner can change
   * it. An Observer can roll it from the actor's sheet, but not edit it.
   * @override
   */
  get isEditable() {
    if (!super.isEditable) return false;
    const actor = this.item.parent;
    return !actor || actor.isOwner;
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
      addCost: this._addCost,
      removeCost: this._removeCost,
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
    dragDrop: [{ dragSelector: '.draggable', dropSelector: null }],
  };


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
    attributesDeity: {
      template: 'systems/carl-rpg/templates/item/attribute-parts/deity.hbs',
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
        options.parts.push('attributesDeity', 'skills', 'effects');
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
      tabs: this._getTabs(options.parts),
      // Necessary for formInput and formFields helpers
      fields: this.document.schema.fields,
      systemFields: this.document.system.schema.fields,
      libraryTemplates: listTemplates(),
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
            uuid: resolved.missing ? '' : resolved.key,
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
      context.classTagNames = await knownTags('class', cfg.classCategories);
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
              this.item.system.action?.type === 'skill' &&
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
      case 'attributesDeity':
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
        context.enrichedShortDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          this.item.system.shortDescription ?? '',
          {
            secrets: this.document.isOwner,
            rollData: this.item.getRollData(),
            relativeTo: this.item,
          }
        );
        // Enrich description info for display
        // Enrichment turns text like `[[/r 1d20]]` into buttons
        context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
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
          tier: effect.getFlag('carl-rpg', 'tier') ?? 0,
        }));
        // A deity's effects are listed in one list per tier (1 to 3).
        context.effectLists = this.item.type === 'deity'
          ? [1, 2, 3].map((tier) => ({ tier, rows: context.effectRows.filter((r) => r.tier === tier) }))
          : [{ tier: 0, rows: context.effectRows }];
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
        id: '',
        icon: '',
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
      case 'attributesDeity':
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
  }

  /** Post this item to chat: its Short Description, with the full text one click away. */
  static async _showInChat() {
    const item = this.item;
    const short = (item.system.shortDescription ?? '').trim();
    const full = item.system.description ?? '';
    const options = {
      secrets: false,
      rollData: item.getRollData(),
      relativeTo: item,
    };
    const shortHtml = await foundry.applications.ux.TextEditor.implementation.enrichHTML(short || full, options);
    const fullHtml = await foundry.applications.ux.TextEditor.implementation.enrichHTML(full, options);
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
   * @returns {Promise}
   * @protected
   */
  static async _onEditImage(event, target) {
    const attr = target.dataset.edit;
    const current = foundry.utils.getProperty(this.document, attr);
    const { img } =
      this.document.constructor.getDefaultArtwork?.(this.document.toObject()) ??
      {};
    const fp = new foundry.applications.apps.FilePicker.implementation({
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
}
