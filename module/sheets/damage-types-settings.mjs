import { CarlRPGDialog } from '../helpers/dialog.mjs';
import {
  DAMAGE_TYPE_CONFIG_SETTING,
  allDamageTypes,
  damageTypeId,
  damageTypeListProblem,
  damageTypeRegistry,
  defaultDamageTypeList,
  normalizeDamageType,
  resolveDamageTypes,
  saveDamageTypes,
} from '../helpers/damage-types.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const NS = 'carl-rpg';

/**
 * The damage types form, opened from a button in the system settings. The GM's own types
 * (the starter ones and any added) can be renamed, re-iconed, recoloured, reordered, deleted
 * and added; their ids can be edited too (an item keeps the old id, so changing one orphans
 * what used it). Types that modules registered are listed below, locked to their id: the GM can
 * hide one or override its label, icon, colour and description. Changes are kept until Save is
 * clicked. See helpers/damage-types.mjs.
 */
export class CarlRPGDamageTypesSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'carl-rpg-damage-types-settings',
    classes: ['carl-rpg', 'creation-settings'],
    position: { width: 640, height: 'auto' },
    window: {
      title: 'CARL_RPG.Damage.Menu.Title',
      icon: 'fa-solid fa-burst',
      resizable: true,
    },
    actions: {
      addType: CarlRPGDamageTypesSettings._onAddType,
      moveType: CarlRPGDamageTypesSettings._onMoveType,
      removeType: CarlRPGDamageTypesSettings._onRemoveType,
      resetDefaults: CarlRPGDamageTypesSettings._onResetDefaults,
      clearOverride: CarlRPGDamageTypesSettings._onClearOverride,
      save: CarlRPGDamageTypesSettings._onSave,
      cancel: CarlRPGDamageTypesSettings._onCancel,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'systems/carl-rpg/templates/settings/damage-types.hbs',
      scrollable: [''],
    },
  };

  /**
   * The working copy, saved only when Save is clicked. A row's `auto` flag (not saved) means its
   * id still follows its label, as it does for a type that was just added.
   */
  #data = {
    list: allDamageTypes()
      .filter((d) => !d.module)
      .map((d) => ({ ...normalizeDamageType(d), auto: false })),
    modules: foundry.utils.deepClone(game.settings.get(NS, DAMAGE_TYPE_CONFIG_SETTING)?.modules ?? {}),
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const list = this.#data.list;
    context.rows = list.map((row, index) => ({
      ...row,
      index,
      first: index === 0,
      last: index === list.length - 1,
      colorValue: row.color || '#808080',
    }));
    const modules = resolveDamageTypes({ config: this.#data }).filter((d) => d.module);
    context.moduleRows = modules.map((type) => {
      const base = damageTypeRegistry.get(type.id) ?? {};
      return {
        ...type,
        colorValue: type.color || '#808080',
        sourceTitle: game.modules?.get(type.source)?.title ?? type.source,
        baseLabel: base.label ?? type.id,
        changed: !!Object.keys(this.#data.modules[type.id] ?? {}).length,
      };
    });
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    for (const input of el.querySelectorAll('.dt-input')) {
      input.addEventListener('change', () => this.#onOwnField(input));
    }
    for (const input of el.querySelectorAll('.dt-mod-input')) {
      input.addEventListener('change', () => this.#onModuleField(input));
    }
  }

  /** A field of one of the GM's own types changed. */
  #onOwnField(input) {
    const row = this.#data.list[Number(input.dataset.index)];
    if (!row) return;
    const { field } = input.dataset;
    if (field === 'id') {
      row.id = damageTypeId(input.value);
      row.auto = false;
      input.value = row.id;
    } else if (field === 'label') {
      row.label = input.value.trim();
      if (row.auto) {
        row.id = this.#uniqueId(damageTypeId(row.label) || 'type', row);
        const idInput = this.element.querySelector(`.dt-input[data-field="id"][data-index="${input.dataset.index}"]`);
        if (idInput) idInput.value = row.id;
      }
    } else {
      row[field] = input.value;
      if (field === 'icon' || field === 'color') this.render();
    }
  }

  /** A field of a module's type changed: kept as an override of what the module gave. */
  #onModuleField(input) {
    const { id, field } = input.dataset;
    const over = (this.#data.modules[id] ??= {});
    over[field] = field === 'hidden' ? input.checked : input.value;
    if (['hidden', 'icon', 'color'].includes(field)) this.render();
  }

  /** An id no other type in the list uses (`name`, `name-2`, ...). */
  #uniqueId(base, except) {
    const taken = new Set(this.#data.list.filter((r) => r !== except).map((r) => r.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /** @this CarlRPGDamageTypesSettings */
  static _onAddType() {
    const label = game.i18n.localize('CARL_RPG.Damage.Menu.NewType');
    const row = { ...normalizeDamageType({ label, icon: 'fa-solid fa-burst' }), auto: true };
    row.id = this.#uniqueId(row.id || 'new-type', row);
    this.#data.list.push(row);
    this.render();
  }

  /** @this CarlRPGDamageTypesSettings */
  static _onMoveType(event, target) {
    const list = this.#data.list;
    const from = Number(target.dataset.index);
    const to = from + (target.dataset.dir === 'up' ? -1 : 1);
    if (to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    this.render();
  }

  /** @this CarlRPGDamageTypesSettings */
  static _onRemoveType(event, target) {
    this.#data.list.splice(Number(target.dataset.index), 1);
    this.render();
  }

  /** Put the starter list back (the module types' overrides are left alone). */
  static async _onResetDefaults() {
    const proceed = await CarlRPGDialog.confirm({
      window: { title: game.i18n.localize('CARL_RPG.Damage.Menu.Reset') },
      content: `<p>${game.i18n.localize('CARL_RPG.Damage.Menu.ResetConfirm')}</p>`,
    });
    if (!proceed) return;
    this.#data.list = defaultDamageTypeList().map((d) => ({ ...d, auto: false }));
    this.render();
  }

  /** @this CarlRPGDamageTypesSettings */
  static _onClearOverride(event, target) {
    delete this.#data.modules[target.dataset.id];
    this.render();
  }

  /** @this CarlRPGDamageTypesSettings */
  static async _onSave() {
    const problem = damageTypeListProblem(this.#data.list);
    if (problem) {
      ui.notifications.error(game.i18n.localize(`CARL_RPG.Damage.Menu.Problem.${problem}`));
      return;
    }
    await saveDamageTypes(this.#data);
    ui.notifications.info(game.i18n.localize('CARL_RPG.Damage.Menu.Saved'));
    this.close();
  }

  /** @this CarlRPGDamageTypesSettings */
  static _onCancel() {
    this.close();
  }
}
