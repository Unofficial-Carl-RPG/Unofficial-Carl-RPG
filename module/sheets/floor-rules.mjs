/**
 * The floor rules editor: a window opened from Dungeon Info where the GM edits
 * the rules that run for the whole world (see runFloorRules in helpers/events.mjs).
 * It is the same events editor as items and effects; the rules are saved as a
 * world setting. A rule for one floor uses the "Floor is exactly" condition.
 */
import {
  buildEventRows,
  dropTarget,
  EVENT_EDITOR_ACTIONS,
  eventOptions,
  saveEventField,
} from '../helpers/event-editor.mjs';
import { FLOOR_RULES_SETTING, getFloorRules } from '../helpers/floor.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } =
  foundry.applications.api;

/** The triggers a floor rule can have: the ones that belong to the world, not to an actor. */
const RULE_TRIGGERS = [
  'floorChange',
  'roundEnd',
  'combatStart',
  'combatEnd',
  'restTaken',
];

export class CarlRPGFloorRules extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'carl-rpg-floor-rules',
    classes: ['carl-rpg', 'carl-dialog', 'floor-rules-window'],
    tag: 'div',
    window: { title: 'CARL_RPG.Floor.Rules', resizable: true },
    position: { width: 520, height: 'auto' },
    actions: {
      // The events editor's buttons are shared (helpers/event-editor.mjs).
      ...EVENT_EDITOR_ACTIONS,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'systems/carl-rpg/templates/sidebar/floor-rules.hbs',
      scrollable: [''],
    },
  };

  /**
   * The rules have no document of their own, so there is none for "run now";
   * the editor's run button passes the rule's id (see runEventNow).
   */
  get eventDoc() {
    return null;
  }

  /** New rules start on a floor change. */
  get defaultEventTrigger() {
    return 'floorChange';
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.editable = game.user.isGM;
    context.isGM = game.user.isGM;
    context.eventOptions = eventOptions(RULE_TRIGGERS);
    context.rows = await buildEventRows(getFloorRules(), 'events');
    return context;
  }

  /**
   * Change the stored rules with a function, then save them (the events editor
   * saves through this). Only the GM can change them.
   * @param {(system: {events: object[]}) => void} mutate
   */
  async _updateEvents(mutate) {
    if (!game.user.isGM) return;
    const system = { events: foundry.utils.deepClone(getFloorRules()) };
    mutate(system);
    await game.settings.set('carl-rpg', FLOOR_RULES_SETTING, system.events);
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Documents dropped on the editor's drop boxes store their UUID.
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: '.drop-target',
      callbacks: { drop: (event) => this.#onDrop(event) },
    }).bind(this.element);
  }

  async #onDrop(event) {
    const zone = event.target.closest('.drop-target');
    if (!zone || !game.user.isGM) return;
    event.preventDefault();
    const data =
      foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    await dropTarget.call(this, zone, data);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // The editor's fields have no form names; each one saves on change.
    for (const el of this.element.querySelectorAll(
      'input[data-path], select[data-path], textarea[data-path]'
    )) {
      el.addEventListener('change', () => saveEventField.call(this, el));
    }
  }
}

/** The one open rules editor, if any. */
let editor = null;

/**
 * Open the floor rules editor (GM only), or bring it to the front.
 * @returns {CarlRPGFloorRules|null}
 */
export function openFloorRules() {
  if (!game.user.isGM) return null;
  editor ??= new CarlRPGFloorRules();
  editor.render({ force: true });
  return editor;
}

// The editor shows the rules as they are saved, so it is drawn again when they change.
Hooks.on('updateSetting', (setting) => {
  if (setting.key === `carl-rpg.${FLOOR_RULES_SETTING}` && editor?.rendered) {
    editor.render();
  }
});
