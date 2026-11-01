import { SOURCES_SETTING, sourceItems } from '../helpers/sources.mjs';
import {
  SYSTEM_KINDS,
  announceSystem,
  defaultBanner,
} from '../helpers/system-announcements.mjs';
import {
  approveAllEvents,
  approveEvents,
  unapprovedEvents,
} from '../helpers/event-approval.mjs';
import {
  DAYS_SETTING,
  FLOOR_SETTING,
  FLOOR_STATE_SETTING,
  FLOOR_STATES,
  ENCOUNTER_TABLES_SETTING,
  FLOOR_NOTES_SETTING,
  getDaysLeft,
  getEncounterTables,
  getFloor,
  getFloorNotes,
  getFloorState,
  notesForFloor,
} from '../helpers/floor.mjs';
import {
  PARTY_SETTING,
  canManageParty,
  getLeader,
  getPartyName,
  partyMembers,
  setLeader,
  setPartyName,
  setTitle,
} from '../helpers/party.mjs';
import { announceBossBattle, findBosses } from '../helpers/announcement.mjs';
import { openFloorRules } from './floor-rules.mjs';
import { openEncounterBuilder } from './encounter-builder.mjs';
import { rollEncounter } from '../helpers/encounters.mjs';
import { confirmRest } from '../helpers/rests.mjs';
import { lootApprovalRequired, waitingApprovals } from '../helpers/loot.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { AbstractSidebarTab } = foundry.applications.sidebar;

/**
 * A GM-only tab in the right-hand sidebar with the game's controls: the global
 * floor, the party's name and the boss battle announcement. Right-click its
 * tab icon to pop it out into its own window.
 */
export class CarlRPGGMTab extends HandlebarsApplicationMixin(
  AbstractSidebarTab
) {
  /** @override */
  static tabName = 'carlGM';

  /** @override */
  static DEFAULT_OPTIONS = {
    actions: {
      floorUp: CarlRPGGMTab._onFloorUp,
      floorDown: CarlRPGGMTab._onFloorDown,
      daysUp: CarlRPGGMTab._onDaysUp,
      noteAdd: CarlRPGGMTab._onNoteAdd,
      openFloorRules: CarlRPGGMTab._onOpenFloorRules,
      addEncounterTable: CarlRPGGMTab._onAddEncounterTable,
      removeEncounterTable: CarlRPGGMTab._onRemoveEncounterTable,
      rollEncounter: CarlRPGGMTab._onRollEncounter,
      openEncounterBuilder: CarlRPGGMTab._onOpenEncounterBuilder,
      noteRemove: CarlRPGGMTab._onNoteRemove,
      daysDown: CarlRPGGMTab._onDaysDown,
      announceBoss: CarlRPGGMTab._onAnnounceBoss,
      toggleBossJoin: CarlRPGGMTab._onToggleBossJoin,
      rest: CarlRPGGMTab._onRest,
      awardAchievement: CarlRPGGMTab._onAwardAchievement,
      awardFavor: CarlRPGGMTab._onAwardFavor,
      approveEvents: CarlRPGGMTab._onApproveEvents,
      approveAllEvents: CarlRPGGMTab._onApproveAllEvents,
      sendSystem: CarlRPGGMTab._onSendSystem,
      revealOrigin: CarlRPGGMTab._onRevealOrigin,
    },
  };

  /** @override */
  static PARTS = {
    main: { template: 'systems/carl-rpg/templates/sidebar/gm-tab.hbs' },
  };

  /** The crawler and achievement picked for awarding, kept across redraws. */
  #awardCrawler = '';
  #awardAchievement = '';

  /** The System announcement being written, kept across redraws. */
  #sysKind = 'general';
  #sysActor = '';
  #sysText = '';
  /** Whether the full-screen banner is ticked (null: the kind's default). */
  #sysBanner = null;

  /**
   * How each boss is joined to the one before it in the announcement ("vs" or
   * "and"), by combatant or token id. The first boss always follows "vs".
   * @type {Map<string, 'vs'|'and'>}
   */
  #bossJoins = new Map();

  /** The bosses found, each with its "vs" / "and" setting. */
  #bossRows() {
    return findBosses().map((boss, i) => {
      const join = i === 0 ? 'vs' : (this.#bossJoins.get(boss.id) ?? 'vs');
      return {
        ...boss,
        join,
        first: i === 0,
        joinLabel: game.i18n.localize(
          join === 'and' ? 'CARL_RPG.GMTab.And' : 'CARL_RPG.GMTab.Vs'
        ),
      };
    });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.floor = getFloor();
    // The floor state (exploring or safe room) and the days left, for everyone.
    const state = getFloorState();
    context.floorState = state;
    context.stateChoices = {
      exploring: 'CARL_RPG.Floor.Exploring',
      safe: 'CARL_RPG.Floor.SafeRoom',
    };
    context.stateLabel = game.i18n.localize(
      state === 'safe' ? 'CARL_RPG.Floor.SafeRoom' : 'CARL_RPG.Floor.Exploring'
    );
    // The floor notes: the GM edits all of them; players see the ones for this floor.
    context.notes = getFloorNotes().map((n, index) => ({
      index,
      floor: n.floor ?? '',
      text: n.text,
    }));
    context.playerNotes = notesForFloor(getFloor());
    const days = getDaysLeft();
    context.days = days;
    context.daysLabel =
      days === null
        ? game.i18n.localize('CARL_RPG.Floor.DaysNotSet')
        : String(days);
    context.partyName = game.settings.get('carl-rpg', PARTY_SETTING) ?? '';
    context.defaultParty = getPartyName();
    // Players only see the floor and the party name (read-only); everything
    // below is for the GM. The party leader can also rename the party and set
    // titles (Party Management).
    context.isGM = game.user.isGM;
    context.canManage = canManageParty();
    // Everyone sees the members and their titles; only the GM and the leader can edit.
    const leader = getLeader();
    context.members = partyMembers().map((member) => ({
      ...member,
      leader: member.id === leader?.id,
    }));
    if (!context.isGM) return context;
    // The bosses to announce, found automatically (see helpers/announcement.mjs).
    // The encounter tables by floor, and the world's roll tables to choose from.
    context.encounterRows = getEncounterTables().map((row, index) => ({
      index,
      floor: row.floor ?? '',
      uuid: row.uuid,
    }));
    context.tableChoices = Object.fromEntries(
      game.tables.contents
        .map((table) => [table.uuid, table.name])
        .sort((a, b) => a[1].localeCompare(b[1]))
    );
    context.bosses = this.#bossRows();
    // The hidden races, classes and subclasses the GM can reveal to a crawler.
    context.revealOptions = await hiddenOptions();
    // Loot box approval is a system setting; the tab only shows its section
    // while it is on, with how many requests are waiting for this GM.
    context.lootApproval = lootApprovalRequired();
    context.waitingCount = waitingApprovals();
    // Events a player saved that no GM has approved yet.
    context.unapproved = unapprovedEvents();
    // The System announcement being written: its kind, the crawler for a death, the
    // text and whether it also flashes the banner.
    context.sysKinds = Object.fromEntries(
      Object.keys(SYSTEM_KINDS).map((kind) => [kind, `CARL_RPG.System.Kinds.${kind}`])
    );
    context.sysKind = this.#sysKind;
    context.sysIsDeath = this.#sysKind === 'died';
    context.sysText = this.#sysText;
    context.sysBanner = this.#sysBanner ?? defaultBanner(this.#sysKind);
    // For awarding achievements: the world's crawlers and achievements.
    const byName = (a, b) => a.name.localeCompare(b.name);
    context.crawlers = game.actors
      .filter((a) => a.type === 'crawler')
      .map((a) => ({
        id: a.id,
        name: a.name,
        selected: a.id === this.#awardCrawler,
      }))
      .sort(byName);
    context.sysCrawlers = context.crawlers.map((crawler) => ({
      ...crawler,
      selected: crawler.id === this.#sysActor,
    }));
    // (The achievements come from the sources chosen for them: see helpers/sources.mjs.)
    context.achievementList = (await sourceItems('achievements')).map((i) => ({
      id: i.uuid,
      name: i.name,
      selected: i.uuid === this.#awardAchievement,
    }));
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    // Each field saves when it loses focus or Enter is pressed.
    el.querySelector('.floor-input')?.addEventListener('change', (event) =>
      this.#setFloor(Number(event.currentTarget.value))
    );
    el.querySelector('.floor-state')?.addEventListener('change', (event) =>
      this.#setFloorState(event.currentTarget.value)
    );
    for (const row of el.querySelectorAll('.enc-row')) {
      const index = Number(row.dataset.index);
      row.querySelector('.enc-floor')?.addEventListener('change', (event) =>
        this.#setEncounterTable(index, { floor: event.currentTarget.value })
      );
      row.querySelector('.enc-table')?.addEventListener('change', (event) =>
        this.#setEncounterTable(index, { uuid: event.currentTarget.value })
      );
    }
    for (const row of el.querySelectorAll('.note-row')) {
      const index = Number(row.dataset.index);
      row.querySelector('.note-floor')?.addEventListener('change', (event) =>
        this.#setNote(index, { floor: event.currentTarget.value })
      );
      row.querySelector('.note-text')?.addEventListener('change', (event) =>
        this.#setNote(index, { text: event.currentTarget.value })
      );
    }
    el.querySelector('.days-input')?.addEventListener('change', (event) =>
      this.#setDays(event.currentTarget.value)
    );
    el.querySelector('.party-input')?.addEventListener('change', (event) =>
      this.#setParty(event.currentTarget.value)
    );
    // Party Management: who leads, and each member's title.
    el.querySelector('.party-leader')?.addEventListener('change', (event) =>
      setLeader(event.currentTarget.value)
    );
    for (const input of el.querySelectorAll('.member-title')) {
      input.addEventListener('change', () =>
        setTitle(input.dataset.actor, input.value)
      );
    }
    // The System announcement: what kind it is decides whether a crawler is named
    // and whether the banner starts ticked; the text is kept as it is typed.
    el.querySelector('.sys-kind')?.addEventListener('change', (event) => {
      this.#sysKind = event.currentTarget.value;
      this.#sysBanner = null;
      this.render();
    });
    el.querySelector('.sys-crawler')?.addEventListener('change', (event) => {
      this.#sysActor = event.currentTarget.value;
    });
    el.querySelector('.sys-text')?.addEventListener('input', (event) => {
      this.#sysText = event.currentTarget.value;
    });
    el.querySelector('.sys-banner')?.addEventListener('change', (event) => {
      this.#sysBanner = event.currentTarget.checked;
    });
    // Remember the award choices, so redrawing the tab keeps them.
    el.querySelector('.award-crawler')?.addEventListener('change', (event) => {
      this.#awardCrawler = event.currentTarget.value;
    });
    el.querySelector('.award-achievement')?.addEventListener(
      'change',
      (event) => {
        this.#awardAchievement = event.currentTarget.value;
      }
    );
  }

  /** Save a new floor (a whole number, 0 or more). */
  async #setFloor(floor) {
    if (!game.user.isGM) return;
    if (!Number.isFinite(floor)) return this.render();
    floor = Math.max(0, Math.floor(floor));
    if (floor === getFloor()) return this.render();
    await game.settings.set('carl-rpg', FLOOR_SETTING, floor);
  }

  /** Save the floor state (exploring or safe room). */
  async #setFloorState(state) {
    if (!game.user.isGM) return;
    if (!FLOOR_STATES.includes(state)) return this.render();
    await game.settings.set('carl-rpg', FLOOR_STATE_SETTING, state);
  }

  /** Save the days left: a whole number from 0, or null when blank (not set). */
  async #setDays(value) {
    if (!game.user.isGM) return;
    const text = String(value ?? '').trim();
    let days = null;
    if (text !== '') {
      const n = Math.trunc(Number(text));
      if (!Number.isFinite(n)) return this.render();
      days = Math.max(0, n);
    }
    if (days === getDaysLeft()) return this.render();
    await game.settings.set('carl-rpg', DAYS_SETTING, days);
  }

  /** Save an encounter table row's floor (blank means every floor) or its roll table. */
  async #setEncounterTable(index, changes) {
    if (!game.user.isGM) return;
    const tables = foundry.utils.deepClone(getEncounterTables());
    const row = tables[index];
    if (!row) return;
    if ('floor' in changes) {
      const text = String(changes.floor ?? '').trim();
      const n = text === '' ? null : Math.trunc(Number(text));
      row.floor = Number.isFinite(n) ? Math.max(0, n) : null;
    }
    if ('uuid' in changes) row.uuid = String(changes.uuid ?? '');
    await game.settings.set('carl-rpg', ENCOUNTER_TABLES_SETTING, tables);
  }

  /** Save the encounter table rows (GM only). */
  async #saveEncounterTables(tables) {
    if (!game.user.isGM) return;
    await game.settings.set('carl-rpg', ENCOUNTER_TABLES_SETTING, tables);
  }

  /** Save the floor notes list (GM only). */
  async #saveNotes(notes) {
    if (!game.user.isGM) return;
    await game.settings.set('carl-rpg', FLOOR_NOTES_SETTING, notes);
  }

  /** Change a note's floor (blank means every floor) or its text. */
  async #setNote(index, changes) {
    const notes = foundry.utils.deepClone(getFloorNotes());
    const note = notes[index];
    if (!note) return;
    if ('floor' in changes) {
      const text = String(changes.floor ?? '').trim();
      const n = text === '' ? null : Math.trunc(Number(text));
      note.floor = Number.isFinite(n) ? Math.max(0, n) : null;
    }
    if ('text' in changes) note.text = String(changes.text ?? '');
    await this.#saveNotes(notes);
  }

  /** Save the party's name. */
  async #setParty(name) {
    await setPartyName(name);
  }

  /** @this CarlRPGGMTab */
  static async _onAddEncounterTable() {
    await this.#saveEncounterTables([...getEncounterTables(), { floor: null, uuid: '' }]);
  }

  /** @this CarlRPGGMTab */
  static async _onRemoveEncounterTable(event, target) {
    const index = Number(target.dataset.index);
    await this.#saveEncounterTables(getEncounterTables().filter((_, i) => i !== index));
  }

  /** @this CarlRPGGMTab */
  static async _onRollEncounter() {
    await rollEncounter();
  }

  /** @this CarlRPGGMTab */
  static _onOpenEncounterBuilder() {
    openEncounterBuilder();
  }

  /** @this CarlRPGGMTab */
  static _onOpenFloorRules() {
    openFloorRules();
  }

  /** @this CarlRPGGMTab */
  static async _onNoteAdd() {
    if (!game.user.isGM) return;
    await this.#saveNotes([...getFloorNotes(), { floor: null, text: '' }]);
  }

  /** @this CarlRPGGMTab */
  static async _onNoteRemove(event, target) {
    if (!game.user.isGM) return;
    const index = Number(target.dataset.index);
    await this.#saveNotes(getFloorNotes().filter((_, i) => i !== index));
  }

  /** @this CarlRPGGMTab */
  static async _onDaysUp() {
    await this.#setDays((getDaysLeft() ?? 0) + 1);
  }

  /** @this CarlRPGGMTab */
  static async _onDaysDown() {
    await this.#setDays((getDaysLeft() ?? 0) - 1);
  }

  /** @this CarlRPGGMTab */
  static async _onFloorUp() {
    await this.#setFloor(getFloor() + 1);
  }

  /** @this CarlRPGGMTab */
  static async _onFloorDown() {
    await this.#setFloor(getFloor() - 1);
  }

  /**
   * Send the System announcement that has been written.
   * @this CarlRPGGMTab
   */
  static async _onSendSystem() {
    if (!game.user.isGM) return;
    const kind = this.#sysKind;
    const actor = kind === 'died' ? game.actors.get(this.#sysActor) : null;
    if (kind === 'died' && !actor) {
      return ui.notifications.warn(game.i18n.localize('CARL_RPG.System.NeedCrawler'));
    }
    if (kind !== 'died' && !this.#sysText.trim()) {
      return ui.notifications.warn(game.i18n.localize('CARL_RPG.System.NeedText'));
    }
    await announceSystem({
      kind,
      text: this.#sysText,
      actor,
      banner: this.#sysBanner ?? defaultBanner(kind),
    });
    this.#sysText = '';
    this.render();
  }

  /** @this CarlRPGGMTab */
  static async _onApproveEvents(event, target) {
    await approveEvents(target.dataset.uuid);
  }

  /** @this CarlRPGGMTab */
  static async _onApproveAllEvents() {
    await approveAllEvents();
  }

  /** @this CarlRPGGMTab */
  static async _onAwardAchievement() {
    if (!game.user.isGM) return;
    const actor = game.actors.get(
      this.element.querySelector('.award-crawler')?.value
    );
    const achievementId = this.element.querySelector('.award-achievement')?.value;
    const achievement = achievementId ? await fromUuid(achievementId) : null;
    if (!actor || !achievement) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.GMTab.NeedBoth'));
      return;
    }
    // Adding it to the crawler pays the loot box (once) and posts the card.
    await actor.createEmbeddedDocuments('Item', [
      game.items.fromCompendium(achievement),
    ]);
  }

  /**
   * The GM reveals a hidden race, class or subclass to a crawler: it is listed in
   * their chooser from then on (kept as a flag on the crawler).
   * @this CarlRPGGMTab
   */
  static async _onRevealOrigin() {
    if (!game.user.isGM) return;
    const actor = game.actors.get(this.element.querySelector('.reveal-crawler')?.value);
    const uuid = this.element.querySelector('.reveal-origin')?.value;
    if (!actor || !uuid) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.GMTab.NeedBoth'));
      return;
    }
    const revealed = actor.getFlag('carl-rpg', 'revealed') ?? [];
    if (!revealed.includes(uuid)) {
      await actor.setFlag('carl-rpg', 'revealed', [...revealed, uuid]);
    }
    const option = await fromUuid(uuid);
    ui.notifications.info(
      game.i18n.format('CARL_RPG.GMTab.Revealed', {
        name: actor.name,
        option: option?.name ?? '?',
      })
    );
  }

  /**
   * Give the chosen crawler AI favor (a negative amount takes some away; it
   * never goes below 0) and say so in chat.
   * @this CarlRPGGMTab
   */
  static async _onAwardFavor() {
    if (!game.user.isGM) return;
    const actor = game.actors.get(
      this.element.querySelector('.award-crawler')?.value
    );
    const amount = Math.trunc(
      Number(this.element.querySelector('.favor-amount')?.value)
    );
    if (!actor) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.GMTab.NeedCrawler'));
      return;
    }
    if (!Number.isFinite(amount) || amount === 0) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.GMTab.NeedAmount'));
      return;
    }
    const total = Math.max(0, actor.system.aiFavor + amount);
    await actor.update({ 'system.aiFavor': total });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="carl-level-card">${game.i18n.format(
        amount > 0 ? 'CARL_RPG.GMTab.FavorAwarded' : 'CARL_RPG.GMTab.FavorLost',
        {
          name: Handlebars.escapeExpression(actor.name),
          amount: Math.abs(amount),
          total,
        }
      )}</div>`,
    });
  }

  /** @this CarlRPGGMTab */
  static async _onAnnounceBoss() {
    if (!game.user.isGM) return;
    // The bosses are looked up again now, so the announcement is always current.
    await announceBossBattle(this.#bossRows());
  }

  /**
   * Take a short, long or full rest (the button's `data-rest`) after asking.
   * @this CarlRPGGMTab
   */
  static async _onRest(event, target) {
    if (!game.user.isGM) return;
    await confirmRest(target.dataset.rest);
  }

  /**
   * Switch how a boss is joined to the one before it: "vs" starts a new line,
   * "and" puts it on the same line.
   * @this CarlRPGGMTab
   */
  static _onToggleBossJoin(event, target) {
    const id = target.dataset.id;
    this.#bossJoins.set(id, this.#bossJoins.get(id) === 'and' ? 'vs' : 'and');
    this.render();
  }
}
/* -------------------------------------------- */
/*  Keep the award lists up to date             */
/* -------------------------------------------- */

// The crawler and achievement dropdowns are built when the tab is drawn, so it
// is drawn again when a crawler (or a world achievement) is added, removed or
// renamed. The choices already made are kept.
const redrawAwardLists = foundry.utils.debounce(() => {
  if (game.user.isGM && ui.carlGM?.rendered) ui.carlGM.render();
}, 100);

const isCrawler = (actor) => actor.type === 'crawler';
/** The hidden races, classes and subclasses the GM can reveal (from the sources). */
async function hiddenOptions() {
  const found = [];
  for (const purpose of ['races', 'classes']) {
    for (const item of await sourceItems(purpose)) {
      if (!item.system.hidden) continue;
      found.push({
        uuid: item.uuid,
        name: item.name,
        kind: game.i18n.localize(`TYPES.Item.${item.type}`),
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const isWorldAchievement = (item) => item.type === 'achievement' && !item.parent;

Hooks.on('createActor', (actor) => isCrawler(actor) && redrawAwardLists());
Hooks.on('deleteActor', (actor) => isCrawler(actor) && redrawAwardLists());
Hooks.on(
  'updateActor',
  (actor, changes) =>
    isCrawler(actor) && 'name' in changes && redrawAwardLists()
);
// The list of events waiting for approval changes as items, effects and pets are
// saved.
for (const hook of [
  'createItem',
  'updateItem',
  'deleteItem',
  'createActiveEffect',
  'updateActiveEffect',
  'deleteActiveEffect',
]) {
  Hooks.on(hook, () => redrawAwardLists());
}
Hooks.on(
  'updateActor',
  (actor, changes) =>
    actor.type === 'pet' && changes.system && redrawAwardLists()
);
// The sources chosen for achievements can change too.
Hooks.on(
  'updateSetting',
  (setting) =>
    setting.key === `carl-rpg.${SOURCES_SETTING}` && redrawAwardLists()
);
Hooks.on('createItem', (item) => isWorldAchievement(item) && redrawAwardLists());
Hooks.on('deleteItem', (item) => isWorldAchievement(item) && redrawAwardLists());
Hooks.on(
  'updateItem',
  (item, changes) =>
    isWorldAchievement(item) && 'name' in changes && redrawAwardLists()
);
// The boss list is found automatically (boss mobs in the active combat, else on
// the scene), so the tab is drawn again when combatants, tokens or a mob's kind
// change.
const isBossMob = (actor) => actor?.type === 'mob';
Hooks.on('createCombat', () => redrawAwardLists());
Hooks.on('deleteCombat', () => redrawAwardLists());
Hooks.on('createCombatant', () => redrawAwardLists());
Hooks.on('deleteCombatant', () => redrawAwardLists());
Hooks.on('canvasReady', () => redrawAwardLists());
Hooks.on('createToken', () => redrawAwardLists());
Hooks.on('deleteToken', () => redrawAwardLists());
Hooks.on(
  'updateToken',
  (token, changes) => 'name' in changes && redrawAwardLists()
);
Hooks.on(
  'updateActor',
  (actor, changes) =>
    isBossMob(actor) &&
    (changes.system?.mobType !== undefined || 'name' in changes) &&
    redrawAwardLists()
);