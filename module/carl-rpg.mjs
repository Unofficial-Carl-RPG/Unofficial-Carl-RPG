// Import document classes.
import { CarlRPGActor } from './documents/actor.mjs';
import { CarlRPGItem } from './documents/item.mjs';
import { CarlRPGCombat, refillCombatActions } from './documents/combat.mjs';
import { CarlRPGCombatant } from './documents/combatant.mjs';
import { CarlRPGActiveEffect } from './documents/active-effect.mjs';
// Import sheet classes.
import { CarlRPGActorSheet } from './sheets/actor-sheet.mjs';
import { CarlRPGItemSheet } from './sheets/item-sheet.mjs';
import CarlRPGEffectSheet from './sheets/effect-sheet.mjs';
// Import helper/utility classes and constants.
import { CARL_RPG } from './helpers/config.mjs';
import { registerCombatTracker } from './helpers/combat-tracker.mjs';
import { CarlRPGGMTab } from './sheets/gm-tab.mjs';
import { registerFloorSetting, getFloor } from './helpers/floor.mjs';
import { registerPartySetting, registerPartySocket } from './helpers/party.mjs';
import { registerAnnouncements } from './helpers/announcement.mjs';
import { registerLootBoxes } from './helpers/loot.mjs';
import { registerEvents } from './helpers/events.mjs';
import { registerDeclarations } from './helpers/declarations.mjs';
import { registerChatCards } from './helpers/chat-cards.mjs';
import { registerSystemAnnouncements } from './helpers/system-announcements.mjs';
import { registerLevelUp } from './helpers/level-up.mjs';
import { registerTags, migrateClassTags } from './helpers/tags.mjs';
import { registerCreationSetting } from './helpers/creation.mjs';
import { CarlRPGCreationSettings } from './sheets/creation-settings.mjs';
import { CarlRPGSourcesSettings } from './sheets/sources-settings.mjs';
import { registerSourcesSetting } from './helpers/sources.mjs';
import { installFromUuid, registerGMDocs } from './helpers/gm-docs.mjs';
import { CarlRPGCreationWizard } from './sheets/creation-wizard.mjs';
import { CarlRPGToken } from './canvas/token.mjs';
import { registerCrawlerNumber } from './helpers/crawler-number.mjs';
import { registerAttacks } from './helpers/attacks.mjs';
import { registerPetUpgrades } from './helpers/pet-upgrades.mjs';
import { registerRelay } from './helpers/relay.mjs';
// Import DataModel classes
import * as models from './data/_module.mjs';

const collections = foundry.documents.collections;
const sheets = foundry.appv1.sheets;

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

// Add key classes to the global scope so they can be more easily used
// by downstream developers
globalThis.carlrpg = {
  documents: {
    CarlRPGActor,
    CarlRPGItem,
  },
  applications: {
    CarlRPGActorSheet,
    CarlRPGItemSheet,
  },
  utils: {
    rollItemMacro,
    refillActions: refillCombatActions,
  },
  models,
};

Hooks.once('init', function () {
  // Add custom constants for configuration.
  CONFIG.CARL_RPG = CARL_RPG;

  // A player can use items from compendiums they can't open: the GM's client
  // supplies them (see helpers/gm-docs.mjs).
  installFromUuid();

  // Templates that other templates include (the events editor, which the Events
  // tab and every upgrade share).
  foundry.applications.handlebars.loadTemplates([
    'systems/carl-rpg/templates/item/event-cards.hbs',
    'systems/carl-rpg/templates/item/uses-fields.hbs',
    'systems/carl-rpg/templates/sidebar/party-management.hbs',
  ]);

  // Global floor, and the GM-only sidebar tab that controls it
  CONFIG.CARL_RPG.getFloor = getFloor;
  registerFloorSetting();

  registerPartySetting();
  registerAnnouncements();
  // System announcements (the full-screen banner some of them flash).
  registerSystemAnnouncements();
  registerLootBoxes();
  registerEvents();
  // What the mobs declare in the first phase, carried out when Resolve starts.
  registerDeclarations();
  // The look of each kind of chat card.
  registerChatCards();
  registerLevelUp();
  registerTags();

  // A crawler's number shows under its name on its token and on chat cards.
  CONFIG.Token.objectClass = CarlRPGToken;
  registerCrawlerNumber();
  // Attack cards: hit or miss against each target's Evade, and Apply Damage.
  registerAttacks();
  // The skills and spells a pet's upgrades give it.
  registerPetUpgrades();
  // Automatic changes an Observer's roll makes, done by the GM's client.
  registerRelay();

  // Character creation defaults: stored as a setting, edited in a dialog opened
  // from a button in the system settings.
  registerCreationSetting();
  // Whether everyday chat looks like a game's chat window (a client setting, so each
  // player chooses for themselves). The look is switched by a class on the page.
  game.settings.register('carl-rpg', 'chatLogStyle', {
    name: 'CARL_RPG.ChatLog.Name',
    hint: 'CARL_RPG.ChatLog.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: (value) => document.body.classList.toggle('carl-chat-log', value),
  });
  document.body.classList.toggle(
    'carl-chat-log',
    game.settings.get('carl-rpg', 'chatLogStyle')
  );
  // How many sponsors a crawler can hold (-1 for no limit). Only the GM changes it.
  game.settings.register('carl-rpg', 'sponsorLimit', {
    name: 'CARL_RPG.Sponsors.LimitName',
    hint: 'CARL_RPG.Sponsors.LimitHint',
    scope: 'world',
    config: true,
    type: Number,
    default: 3,
  });
  // Which compendiums the lists of achievements, races, classes, backgrounds and
  // creation skills draw from.
  registerSourcesSetting();
  game.settings.registerMenu('carl-rpg', 'compendiumSources', {
    name: 'CARL_RPG.Sources.Menu.Name',
    label: 'CARL_RPG.Sources.Menu.Label',
    hint: 'CARL_RPG.Sources.Menu.Hint',
    icon: 'fa-solid fa-book-atlas',
    type: CarlRPGSourcesSettings,
    restricted: true,
  });
  game.settings.registerMenu('carl-rpg', 'creationSetup', {
    name: 'CARL_RPG.Creation.Menu.Name',
    label: 'CARL_RPG.Creation.Menu.Label',
    hint: 'CARL_RPG.Creation.Menu.Hint',
    icon: 'fa-solid fa-user-plus',
    type: CarlRPGCreationSettings,
    restricted: true,
  });

  // The Dungeon Info tab: everyone sees it (players get the floor and the party
  // name, read-only); the GM gets the full controls.
  CONFIG.ui.carlGM = CarlRPGGMTab;
  foundry.applications.sidebar.Sidebar.TABS.carlGM = {
    tooltip: 'CARL_RPG.GMTab.Title',
    icon: 'fa-solid fa-dungeon',
  };

  /**
   * This system has no initiative: combat is phase based (see
   * documents/combat.mjs), so there is nothing to roll.
   */
  CONFIG.Combat.initiative = {
    formula: null,
    decimals: 0,
  };
  CONFIG.Combat.documentClass = CarlRPGCombat;
  CONFIG.Combatant.documentClass = CarlRPGCombatant;
  registerCombatTracker();

  // Define custom Document and DataModel classes
  CONFIG.Actor.documentClass = CarlRPGActor;

  // Note that you don't need to declare a DataModel
  // for the base actor/item classes - they are included
  // with the Crawler/Mob as part of super.defineSchema()
  CONFIG.Actor.dataModels = {
    crawler: models.CarlRPGCrawler,
    mob: models.CarlRPGMob,
    pet: models.CarlRPGPet,
    mount: models.CarlRPGMount,
  };
  CONFIG.Item.documentClass = CarlRPGItem;
  CONFIG.Item.dataModels = {
    gear: models.CarlRPGGear,
    skill: models.CarlRPGFeature,
    spell: models.CarlRPGSpell,
    item: models.CarlRPGGenericItem,
    mobAbility: models.CarlRPGMobAbility,
    lootBox: models.CarlRPGLootBox,
    achievement: models.CarlRPGAchievement,
    race: models.CarlRPGRace,
    class: models.CarlRPGClass,
    background: models.CarlRPGBackground,
    sponsor: models.CarlRPGSponsor,
    personalSpace: models.CarlRPGPersonalSpace,
    club: models.CarlRPGClub,
    deity: models.CarlRPGDeity,
  };

  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  // (Effects on items here are templates: they are copied onto the actor with
  // the item and always have transfer turned off. See active-effect.mjs.)
  CONFIG.ActiveEffect.legacyTransferral = false;
  CONFIG.ActiveEffect.documentClass = CarlRPGActiveEffect;

  // Register sheet application classes
  collections.Actors.unregisterSheet('core', sheets.ActorSheet);
  collections.Actors.registerSheet('carl-rpg', CarlRPGActorSheet, {
    makeDefault: true,
    label: 'CARL_RPG.SheetLabels.Actor',
  });
  collections.Items.unregisterSheet('core', sheets.ItemSheet);
  collections.Items.registerSheet('carl-rpg', CarlRPGItemSheet, {
    makeDefault: true,
    label: 'CARL_RPG.SheetLabels.Item',
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    ActiveEffect,
    'carl-rpg',
    CarlRPGEffectSheet,
    { makeDefault: true, label: 'CARL_RPG.SheetLabels.Effect' }
  );
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

// If you need to add Handlebars helpers, here is a useful example:
Handlebars.registerHelper('toLowerCase', function (str) {
  return str.toLowerCase();
});

/* -------------------------------------------- */
/*  Actors directory: Create Crawler            */
/* -------------------------------------------- */

// A GM-only button that creates a new crawler and opens the creation wizard.
Hooks.on('renderActorDirectory', (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actions = root?.querySelector('.header-actions');
  if (!actions || actions.querySelector('.create-crawler')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'create-crawler';
  button.innerHTML = `<i class="fa-solid fa-user-plus"></i> ${game.i18n.localize(
    'CARL_RPG.Creation.CreateCrawler'
  )}`;
  button.addEventListener('click', async () => {
    const actor = await Actor.create({
      name: game.i18n.localize('CARL_RPG.Creation.NewCrawler'),
      type: 'crawler',
    });
    if (actor) CarlRPGCreationWizard.open(actor);
  });
  actions.append(button);
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once('ready', function () {
  // Class tags were first stored as regular tags: move them to categories once.
  migrateClassTags();
  // The GM's client answers a player's requests for compendium items they can't
  // open (see helpers/gm-docs.mjs).
  registerGMDocs();
  // The party leader's changes (a rename, a title) are made by the GM's client.
  registerPartySocket();
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on('hotbarDrop', (bar, data, slot) => createDocMacro(data, slot));
});

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createDocMacro(data, slot) {
  // First, determine if this is a valid owned item.
  if (data.type !== 'Item') return;
  if (!data.uuid.includes('Actor.') && !data.uuid.includes('Token.')) {
    return ui.notifications.warn(
      'You can only create macro buttons for owned Items'
    );
  }
  // If it is, retrieve it based on the uuid.
  const item = await Item.fromDropData(data);

  // Create the macro command using the uuid.
  const command = `game.carlrpg.rollItemMacro("${data.uuid}");`;
  let macro = game.macros.find(
    (m) => m.name === item.name && m.command === command
  );
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: 'script',
      img: item.img,
      command: command,
      flags: { 'carl-rpg.itemMacro': true },
    });
  }
  game.user.assignHotbarMacro(macro, slot);
  return false;
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemUuid
 */
function rollItemMacro(itemUuid) {
  // Reconstruct the drop data so that we can load the item.
  const dropData = {
    type: 'Item',
    uuid: itemUuid,
  };
  // Load the item from the uuid.
  Item.fromDropData(dropData).then((item) => {
    // Determine if the item loaded and if it's an owned item.
    if (!item || !item.parent) {
      const itemName = item?.name ?? itemUuid;
      return ui.notifications.warn(
        `Could not find item ${itemName}. You may need to delete and recreate this macro.`
      );
    }

    // Trigger the item roll
    item.roll();
  });
}
