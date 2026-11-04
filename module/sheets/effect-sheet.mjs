import {
  buildEventRows,
  dropTarget,
  EVENT_EDITOR_ACTIONS,
  eventOptions,
  saveEventField,
} from '../helpers/event-editor.mjs';

import { damageTypeOptions } from '../helpers/damage-types.mjs';

const { HandlebarsApplicationMixin, DocumentSheetV2 } =
  foundry.applications.api;

const NS = 'carl-rpg';

/**
 * The sheet for editing a Carl RPG effect: its type, identifier, stacking,
 * how long it lasts, keep/equip options, what it modifies (picked from a menu,
 * never typed as data paths) and the events it carries (they run while it is on).
 */
export default class CarlRPGEffectSheet extends HandlebarsApplicationMixin(
  DocumentSheetV2
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['carl-rpg', 'effect'],
    position: { width: 500, height: 'auto' },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: this._onEditImage,
      addModifier: this._addModifier,
      removeModifier: this._removeModifier,
      addDamageMod: this._addDamageMod,
      removeDamageMod: this._removeDamageMod,
      addBuildMod: this._addBuildMod,
      removeBuildMod: this._removeBuildMod,
      approveEvents: this._approveEvents,
      // The events editor's buttons are shared (helpers/event-editor.mjs).
      ...EVENT_EDITOR_ACTIONS,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/carl-rpg/templates/effect/sheet.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const effect = this.document;
    const flags = effect.flags?.[NS] ?? {};

    context.effect = effect;
    context.flags = flags;
    context.kind = effect.kind;
    context.kinds = CONFIG.CARL_RPG.effectKinds;
    context.isDebuff = effect.kind === 'debuff';
    // How long it lasts: until a short, long or full rest, or until removed.
    context.durations = CONFIG.CARL_RPG.effectDurations;
    context.lastsUntil = flags.lastsUntil ?? '';
    context.isOnActor = effect.parent instanceof Actor;
    // "Only while equipped" makes sense for effects on gear (and their copies).
    context.canEquipLink = effect.parent?.type === 'gear' || !!flags.equipLinked;
    context.modifierOptions = Object.fromEntries(
      Object.entries(CONFIG.CARL_RPG.effectModifiers).map(([id, mod]) => [
        id,
        mod.label,
      ])
    );
    context.modifiers = effect.changes.map((change, index) => ({
      index,
      stat: change.key.split('.').pop(),
      value: change.value,
    }));
    // What it does to damage types: resist, immune, vulnerable.
    const { '': noType, ...typeMenu } = damageTypeOptions();
    context.damageTypeOptions = typeMenu;
    context.damageModeOptions = CONFIG.CARL_RPG.damageModes;
    context.damageMods = (flags.damageMods ?? []).map((row, index) => ({ index, ...row }));
    // Build benefits that need something picked: a check die, health stat, stat cap.
    context.buildKindOptions = CONFIG.CARL_RPG.buildKinds;
    context.buildTargetOptions = {
      evade: 'CARL_RPG.Check.Targets.evade',
      ...CONFIG.CARL_RPG.abilities,
    };
    context.buildMods = (flags.buildMods ?? []).map((row, index) => ({ index, ...row }));
    context.enrichedDescription =
      await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        effect.description ?? '',
        { relativeTo: effect, rollData: {} }
      );
    context.editable = this.isEditable;
    context.isGM = game.user.isGM;

    // How long it lasts: a number of rounds (counted once it is on), or until a
    // rest or the end of the combat (the menu above).
    context.rounds = flags.rounds ?? 0;
    context.roundsLeft = effect.roundsLeft;

    // The events it carries. Only on an actor's effect do they run; those on an
    // item's effect are copied to the actor with it.
    const cfg = CONFIG.CARL_RPG;
    const events = flags.events ?? [];
    context.eventOptions = eventOptions([
      ...cfg.eventTriggersActor,
      ...cfg.eventTriggersEffectOnly,
    ]);
    context.eventRows = await buildEventRows(events, 'events');
    context.eventsUnapproved = events.length > 0 && !flags.eventsTrusted;
    return context;
  }

  /** The document whose events these are (the editor's "run now" button uses it). */
  get eventDoc() {
    return this.document;
  }

  /** New events on an effect start with the end of the round. */
  get defaultEventTrigger() {
    return 'roundEnd';
  }

  /**
   * Change the effect's stored events with a function, then save them. (The shared
   * events editor, helpers/event-editor.mjs, saves through this.) Saving as a GM
   * approves them; see CarlRPGActiveEffect#_preUpdate.
   * @param {(system: {events: object[]}) => void} mutate
   */
  async _updateEvents(mutate) {
    if (!this.document.isOwner) return;
    const system = {
      events: foundry.utils.deepClone(this.document.getFlag(NS, 'events') ?? []),
    };
    mutate(system);
    await this.document.update({ [`flags.${NS}.events`]: system.events });
  }

  /**
   * A GM approves the effect's events as they are (events a player saved are limited
   * to what that player could do themselves).
   */
  static async _approveEvents() {
    if (!game.user.isGM) return;
    await this.document.setFlag(NS, 'eventsTrusted', true);
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Documents dropped on the events editor's drop boxes (an item, effect, macro,
    // actor or roll table) store their UUID.
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: '.drop-target',
      callbacks: { drop: (event) => this.#onDrop(event) },
    }).bind(this.element);
  }

  async #onDrop(event) {
    const zone = event.target.closest('.drop-target');
    if (!zone || !this.document.isOwner) return;
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    await dropTarget.call(this, zone, data);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // The modifier rows have no form names; changes are saved as a whole list.
    for (const el of this.element.querySelectorAll(
      '.modifier-stat, .modifier-value'
    )) {
      el.addEventListener('change', () => this.#saveModifiers());
    }
    // And the build benefit rows.
    for (const el of this.element.querySelectorAll(
      '.build-mod-row select, .build-mod-row input'
    )) {
      el.addEventListener('change', () => this.#saveBuildMods());
    }
    // So do the damage type rows; they are saved as a whole list.
    for (const el of this.element.querySelectorAll('.damage-mod-row select')) {
      el.addEventListener('change', () => this.#saveDamageMods());
    }
    // The events editor's fields have no form names; they save into the stored list.
    for (const el of this.element.querySelectorAll(
      '.effect-events input[data-path], .effect-events select[data-path], .effect-events textarea[data-path]'
    )) {
      el.addEventListener('change', () => saveEventField.call(this, el));
    }
  }

  /** Save the modifier rows as the effect's `changes`. */
  async #saveModifiers() {
    const rows = this.element.querySelectorAll('.modifier-row');
    const changes = Array.from(rows).map((row) => {
      const stat = row.querySelector('.modifier-stat').value;
      const value = Number(row.querySelector('.modifier-value').value) || 0;
      return {
        key: CONFIG.CARL_RPG.effectModifiers[stat].key,
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: String(value),
        priority: null,
      };
    });
    await this.document.update({ changes });
  }

  /** Save the build benefit rows as the effect's `buildMods` flag. */
  async #saveBuildMods() {
    const rows = this.element.querySelectorAll('.build-mod-row');
    const buildMods = Array.from(rows).map((row) => ({
      kind: row.querySelector('.build-mod-kind').value,
      target: row.querySelector('.build-mod-target').value,
      value: row.querySelector('.build-mod-value').value.trim(),
    }));
    await this.document.update({ [`flags.${NS}.buildMods`]: buildMods });
  }

  /** Add a build benefit row (a 1d4 check die against Evade to start with). */
  static async _addBuildMod(event, target) {
    event.preventDefault();
    const buildMods = foundry.utils.deepClone(this.document.getFlag(NS, 'buildMods') ?? []);
    buildMods.push({ kind: 'checkDie', target: 'evade', value: '1d4' });
    await this.document.update({ [`flags.${NS}.buildMods`]: buildMods });
  }

  /** Remove a build benefit row. */
  static async _removeBuildMod(event, target) {
    event.preventDefault();
    const index = Number(target.closest('[data-index]')?.dataset.index);
    const buildMods = foundry.utils.deepClone(this.document.getFlag(NS, 'buildMods') ?? []);
    buildMods.splice(index, 1);
    await this.document.update({ [`flags.${NS}.buildMods`]: buildMods });
  }

  /** Save the damage type rows as the effect's `damageMods` flag. */
  async #saveDamageMods() {
    const rows = this.element.querySelectorAll('.damage-mod-row');
    const damageMods = Array.from(rows).map((row) => ({
      type: row.querySelector('.damage-mod-type').value,
      mode: row.querySelector('.damage-mod-mode').value,
    }));
    await this.document.update({ [`flags.${NS}.damageMods`]: damageMods });
  }

  /** Add a damage type row (resist the first type to start with). */
  static async _addDamageMod(event, target) {
    event.preventDefault();
    const first = Object.keys(damageTypeOptions()).find((id) => id) ?? '';
    const damageMods = foundry.utils.deepClone(this.document.getFlag(NS, 'damageMods') ?? []);
    damageMods.push({ type: first, mode: 'resist' });
    await this.document.update({ [`flags.${NS}.damageMods`]: damageMods });
  }

  /** Remove a damage type row. */
  static async _removeDamageMod(event, target) {
    event.preventDefault();
    const index = Number(target.closest('[data-index]')?.dataset.index);
    const damageMods = foundry.utils.deepClone(this.document.getFlag(NS, 'damageMods') ?? []);
    damageMods.splice(index, 1);
    await this.document.update({ [`flags.${NS}.damageMods`]: damageMods });
  }

  /** Add a modifier row (a +1 Strength bonus to start with). */
  static async _addModifier(event, target) {
    event.preventDefault();
    const changes = this.document.toObject().changes;
    changes.push({
      key: CONFIG.CARL_RPG.effectModifiers.str.key,
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: '1',
      priority: null,
    });
    await this.document.update({ changes });
  }

  /** Remove a modifier row. */
  static async _removeModifier(event, target) {
    event.preventDefault();
    const index = Number(target.closest('[data-index]')?.dataset.index);
    const changes = this.document.toObject().changes;
    changes.splice(index, 1);
    await this.document.update({ changes });
  }

  /** Choose a new icon for the effect. */
  static async _onEditImage(event, target) {
    const attr = target.dataset.edit;
    const current = foundry.utils.getProperty(this.document, attr);
    const fp = new foundry.applications.apps.FilePicker.implementation({
      current,
      type: 'image',
      callback: (path) => this.document.update({ [attr]: path }),
      top: this.position.top + 40,
      left: this.position.left + 10,
    });
    return fp.browse();
  }
}
