import {
  buildEventRows,
  dropTarget,
  EVENT_EDITOR_ACTIONS,
  eventOptions,
  saveEventField,
} from '../helpers/event-editor.mjs';

import { cleanBuildRow, hasAmount, isScopedKind, kindFields, splitStats } from '../helpers/build-mods.mjs';
import { diceRowProblem, swapRowProblem } from '../helpers/build-damage.mjs';
import { damageTypeOptions } from '../helpers/damage-types.mjs';
import { whenOptionsFor } from '../helpers/roll-mods.mjs';
import { knownTags } from '../helpers/tags.mjs';

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
      clearBuildSkill: this._clearBuildSkill,
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
    context.isBuff = effect.kind === 'buff';
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
    // Build benefits that need something picked: a check die, health stat, stat cap,
    // or which skills a Skill cap covers (all, one by Identifier, or by tag).
    context.buildKindOptions = CONFIG.CARL_RPG.buildKinds;
    context.buildTargetOptions = {
      evade: 'CARL_RPG.Check.Targets.evade',
      ...CONFIG.CARL_RPG.abilities,
    };
    context.skillCapScopeOptions = CONFIG.CARL_RPG.skillCapScopes;
    // Bonus damage dice: the type menus (blank is "the attack's type" / "no second type") and
    // the conditions; Damage stat: the stats to swap.
    context.bonusTypeOptions = {
      '': game.i18n.localize('CARL_RPG.Upgrades.BonusType.None'),
      ...typeMenu,
    };
    context.bonusAlsoOptions = {
      '': game.i18n.localize('CARL_RPG.Upgrades.BonusType.NoSecond'),
      ...typeMenu,
    };
    context.diceWhenOptions = whenOptionsFor('damageDice');
    context.statOptions = CONFIG.CARL_RPG.abilities;
    // What a Player picks row can be narrowed to, and a Stat split's choices.
    context.pickStatOptions = { '': 'CARL_RPG.Picks.AnyStat', ...CONFIG.CARL_RPG.abilities };
    context.pickKindOptions = { '': 'CARL_RPG.Picks.AnyKind', ...CONFIG.CARL_RPG.pickKinds };
    context.repickOptions = CONFIG.CARL_RPG.repickRules;
    context.buildMods = (flags.buildMods ?? []).map((row, index) => ({
      index,
      ...row,
      isScoped: isScopedKind(row.kind),
      hasAmount: hasAmount(row.kind),
      scopeSkill: isScopedKind(row.kind) && row.target === 'skill',
      scopeTag: isScopedKind(row.kind) && row.target === 'tag',
      scopePick: isScopedKind(row.kind) && row.target === 'pick',
      isDice: row.kind === 'damageDice',
      isSwap: row.kind === 'damageStat',
      isWithin: row.kind === 'damageDice' && row.when === 'within',
      // (a row that cannot be used is skipped; the sheet warns)
      invalid:
        (row.kind === 'damageDice' && diceRowProblem(row)) ||
        (row.kind === 'damageStat' && swapRowProblem(row)),
      isSplit: row.kind === 'statSplit',
      // The skills already picked (on a crawler's copy), and the stats a split offers.
      pickedNames: (row.picks ?? []).map((p) => p.name || p.value).join(', '),
      statBoxes:
        row.kind === 'statSplit'
          ? Object.entries(CONFIG.CARL_RPG.abilities).map(([key, label]) => ({
              key,
              label,
              checked: !(row.stats ?? []).length || splitStats(row).includes(key),
            }))
          : [],
      splitText: Object.entries(row.split ?? {})
        .map(([key, n]) => `${key.charAt(0).toUpperCase()}${key.slice(1)} +${n}`)
        .join(', '),
    }));
    // Skill tags to suggest, looked up only when a row needs them.
    context.skillTagNames = context.buildMods.some((row) => row.scopeTag || row.scopePick)
      ? await knownTags('skill')
      : [];
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

    // The skill picked for a Skill cap build benefit is dropped on its row's box.
    // The boxes come and go as the sheet redraws, so the sheet itself listens.
    this.element.addEventListener('dragover', (event) => {
      if (event.target.closest?.('.build-drop')) event.preventDefault();
    });
    this.element.addEventListener('drop', (event) => {
      const zone = event.target.closest?.('.build-drop');
      if (zone) this.#onDropSkill(event, zone);
    });
  }

  /** A skill or spell was dropped on a Skill cap row: the row covers it by Identifier. */
  async #onDropSkill(event, zone) {
    event.preventDefault();
    if (!this.isEditable) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const item = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
    if (!['skill', 'spell'].includes(item?.type)) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Build.DropWrong'));
      return;
    }
    const identifier = item.system.identifier?.trim();
    if (!identifier) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Build.NoIdentifier'));
      return;
    }
    const buildMods = foundry.utils.deepClone(this.document.getFlag(NS, 'buildMods') ?? []);
    const row = buildMods[Number(zone.dataset.buildIndex)];
    if (!isScopedKind(row?.kind)) return;
    Object.assign(row, { target: 'skill', value: identifier, name: item.name });
    await this.document.update({ [`flags.${NS}.buildMods`]: buildMods });
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
    const before = this.document.getFlag(NS, 'buildMods') ?? [];
    const buildMods = Array.from(rows).map((row, index) =>
      cleanBuildRow(
        {
          kind: row.querySelector('.build-mod-kind').value,
          target: row.querySelector('.build-mod-target')?.value ?? '',
          value: row.querySelector('.build-mod-value')?.value ?? '',
          name: row.querySelector('.build-mod-name')?.value ?? '',
          amount: row.querySelector('.build-mod-amount')?.value,
          // Bonus damage dice and Damage stat
          dice: row.querySelector('.build-mod-dice')?.value,
          bonusType: row.querySelector('.build-mod-bonus-type')?.value,
          bonusAlso: row.querySelector('.build-mod-bonus-also')?.value,
          when: row.querySelector('.build-mod-when')?.value,
          feet: row.querySelector('.build-mod-feet')?.value,
          from: row.querySelector('.build-mod-from')?.value,
          to: row.querySelector('.build-mod-to')?.value,
          // Player picks: how many skills, from which
          count: row.querySelector('.build-mod-count')?.value,
          tag: row.querySelector('.build-mod-pick-tag')?.value,
          stat: row.querySelector('.build-mod-pick-stat')?.value,
          skillKind: row.querySelector('.build-mod-pick-kind')?.value,
          // Stat split: the points, the stats offered and whether it can be redone
          points: row.querySelector('.build-mod-points')?.value,
          stats: row.querySelector('.build-mod-points')
            ? Array.from(row.querySelectorAll('.build-mod-stat-box:checked')).map((el) => el.value)
            : undefined,
          repick: row.querySelector('.build-mod-repick')?.value,
        },
        before[index]
      )
    );
    await this.document.update({ [`flags.${NS}.buildMods`]: buildMods });
  }

  /** Forget the skill a Skill cap row covers. */
  static async _clearBuildSkill(event, target) {
    event.preventDefault();
    const index = Number(target.closest('[data-index]')?.dataset.index);
    const buildMods = foundry.utils.deepClone(this.document.getFlag(NS, 'buildMods') ?? []);
    if (!buildMods[index]) return;
    const { kind, amount } = buildMods[index];
    buildMods[index] = {
      kind,
      target: 'skill',
      value: '',
      ...(hasAmount(kind) ? { amount: amount ?? 1 } : {}),
      ...kindFields(buildMods[index]),
    };
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
