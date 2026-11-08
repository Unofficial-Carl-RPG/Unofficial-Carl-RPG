# ui

- stylePrinciples:
  - Sheets fit the default size (680x760) or scroll.
  - Drop boxes at the END of lists, visible only when editable (actor sheets: only in edit mode). Dropping onto the sheet always works.
  - Quantity lives in the item sheet header for every type that has one (gear, item, lootBox).
  - Buttons follow the theme (all caps).
  - Item hover info uses the shared tooltip: any element with data-item-tip="<item uuid>".
  - In-UI hint/tooltip text must be short; obvious settings get none.
  - Label-plus-input panels have inner padding (~4px x 6px on sheets, more in the wizard); header modifiers show no leading '+' (0 + 0 = 0; minus only when negative).
  - Players never see mob numbers (Evade, DR, health values) except where noted.

## itemListFeatures
- filterSort: helpers/item-filter.mjs: filter bar above every item list on actor sheets: search (names; toggle adds descriptions), type chips (computed: skills/spells Attack|Passive|Utility, gear slot/Equipped/Weapon|Armor/Consumable, effects Buff|Debuff|Passive + Active, mob abilities Attack|Other), tag menu with All/Any, Clear. Sort: name, type, rank, mana cost, uses, slot (equipped first), manual, Value (only with sortValue). Per-person per-list, stored in the browser. Stays usable while sheet locked.
- rowDescriptions: each row has a chevron; description collapsed by default (per person per item, localStorage); expand/collapse all in list heading; shows enriched description, upgrades with unlocked marked, key numbers line. Clicking the picture or a use button rolls; clicking the name toggles.
- tooltip: helpers/item-tooltip.mjs itemTooltipHtml: name, badges, then Short Description (or full). Used on sheet lists, hotlist, quick bar, shop listings, store window, quests, loot boxes, achievements, mob loot, granted skills, target prompt and roll pop-up.
- badges: helpers/item-badges.mjs describeBadges/badgeRowHtml: stat, type, damage at current rank, mana cost, range (worked out from its formula now; count/area items only), targets/area, weapon skill + stat, DR for armor, ammunition (name, amount, how many left), quantity/uses. Mob ability numbers hidden from players.

## quickBar
- file: helpers/quick-bar.mjs
- what: bar above the hotbar for the controlled crawler (hidden when none; hides the hotbar while shown): every hotlist slot (min 10, empty slots too, same size), shows rank (weapon shows its rolled skill's rank), mana cost, uses, ammunition left. Click uses; Shift skips the pop-up. Keys 1-9 use slots 1-9 and 0 slot 10 via Foundry keybindings quickBar<n> (rebindable); slots past 10 click-only. Re-renders on controlToken, updateActor, updateItem, createItem, deleteItem, canvasReady.
- hotlist: crawler tab: one box per slot (system.hotlist.size), pick skill, spell, gear or inventory item from the dropdown; click rolls

## chat
- cardFlag: flags.carl-rpg.card.kind: skill|spell|gear|item|mobAbility (item type), achievement, boss, check, defense, effect, event, loot, system. chat-cards.mjs adds classes as cards render; check cards coloured by degree; mob cards keep mob colour (their 'success' is not shown green).
- headers: skill/spell/gear/item cards: item image + name + badges; roll options (advantage/bonus/stat), AI Favor reroll note, what the use cost are badges; description shows Short Description with 'Full description' expander
- changeLog: helpers/change-log.mjs: each automatic change (mana, actions, use, event) is a line in a collapsed 'Changes' section on the causing card; with no card, posted shortly after as a whisper to GM + owners. GM sees all, players their own.
- diceSoNice: helpers/dice-hold.mjs: client setting holdResultCards (default on) hides result cards until Dice So Nice finishes. Nothing changes without the module.
- sounds: helpers/sounds.mjs: world settings soundBoss, soundNatural, soundDying, soundAchievement, soundLoot (audio file each, empty = silent, none shipped); client soundVolume (0-100) and soundMuted per player; plays on every client seeing the cue (flag cue, natural 20/1 by a crawler, achievement given).

## tokens
- nameplate: crawler number as second line (Crawler # N), Crawler Killer skulls (up to 5 icons then one skull + count) and boss stars beside the name; same on chat cards; sheet portrait is round with skulls upper-left and stars opposite corner. Kill counts hidden in the header while locked, editable by GM/owner in edit mode.
- bars: mob token bars on for everyone (fill only; no numbers); pet tokens linked + friendly
- overlays: Dead and defeated mobs get Foundry's skull overlay

- interfaceStyle: client setting uiStyle (default on) re-skins Foundry's own UI; chatLogStyle (client, default on) game-style chat; journalStyle (world, default on). Accent colour royal purple via --dcc-accent / --dcc-accent-bright in the palette; danger reds via --dcc-danger(-bright).
- defenseRollPopup: roll pop-up (helpers/roll-dialog.mjs promptRoll/buildFormula/optionsNote): extra bonus, stat change, advantage/disadvantage, cost amounts, and for item rolls a Damage stat menu (a build benefit's stat swap). Used by item rolls, sheet ability rolls and a crawler's defending roll. Shift-click skips.
- rollDataAccess: abilities sidebar: click a stat rolls d20 + mod vs 10 + Floor; (observer permission may roll)
