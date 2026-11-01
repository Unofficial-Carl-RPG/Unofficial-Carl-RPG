import {
  CREATION_SETTING,
  getCreationDefaults,
} from '../helpers/creation.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } =
  foundry.applications.api;

const NS = 'carl-rpg';

/**
 * The character creation defaults, opened from a button in the system settings:
 * the tag that marks which skills can be picked, the free skills every new
 * crawler gets (with ranks), the starting weapons, and the starting gear with how
 * many a crawler may pick. Changes are kept until Save is clicked.
 */
export class CarlRPGCreationSettings extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'carl-rpg-creation-settings',
    classes: ['carl-rpg', 'creation-settings'],
    position: { width: 560, height: 'auto' },
    window: {
      title: 'CARL_RPG.Creation.Menu.Title',
      icon: 'fa-solid fa-user-plus',
      resizable: true,
    },
    actions: {
      removeEntry: CarlRPGCreationSettings._onRemoveEntry,
      save: CarlRPGCreationSettings._onSave,
      cancel: CarlRPGCreationSettings._onCancel,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'systems/carl-rpg/templates/settings/creation.hbs',
      scrollable: [''],
    },
  };

  /** The working copy, saved only when Save is clicked. */
  #data = foundry.utils.deepClone(getCreationDefaults());

  /** What each list accepts: the item types that can be dropped on it. */
  static LISTS = {
    freeSkills: ['skill'],
    weapons: ['gear'],
    gear: ['gear', 'item'],
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const name = async (uuid) => {
      const doc = await fromUuid(uuid);
      return { name: doc?.name ?? uuid, img: doc?.img, missing: !doc };
    };
    context.statMethod = this.#data.statMethod;
    context.statMethods = CONFIG.CARL_RPG.creation.statMethods;
    context.skillTag = this.#data.skillTag;
    context.allowAnySkill = this.#data.allowAnySkill;
    context.gearPicks = this.#data.gearPicks;
    context.freeRows = await Promise.all(
      this.#data.freeSkills.map(async (entry, index) => ({
        ...(await name(entry.uuid)),
        index,
        rank: entry.rank,
      }))
    );
    context.weaponRows = await Promise.all(
      this.#data.weapons.map(async (uuid, index) => ({
        ...(await name(uuid)),
        index,
      }))
    );
    context.gearRows = await Promise.all(
      this.#data.gear.map(async (uuid, index) => ({
        ...(await name(uuid)),
        index,
      }))
    );
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;

    el.querySelector('.stat-method-select')?.addEventListener('change', (event) => {
      this.#data.statMethod = event.currentTarget.value;
    });
    el.querySelector('.allow-any-skill')?.addEventListener('change', (event) => {
      this.#data.allowAnySkill = event.currentTarget.checked;
    });
    el.querySelector('.skill-tag-input')?.addEventListener('change', (event) => {
      this.#data.skillTag = event.currentTarget.value.trim();
    });
    el.querySelector('.gear-picks-input')?.addEventListener('change', (event) => {
      this.#data.gearPicks = Math.max(
        0,
        Math.floor(Number(event.currentTarget.value)) || 0
      );
    });
    for (const input of el.querySelectorAll('.free-rank')) {
      input.addEventListener('change', () => {
        const entry = this.#data.freeSkills[Number(input.dataset.index)];
        if (entry) {
          entry.rank = Math.max(0, Math.floor(Number(input.value)) || 0);
        }
      });
    }
    // Drop boxes: one per list.
    for (const zone of el.querySelectorAll('.drop-box[data-list]')) {
      zone.addEventListener('dragover', (event) => event.preventDefault());
      zone.addEventListener('drop', (event) => this.#onDrop(event, zone));
    }
  }

  /** An item was dropped on one of the lists. */
  async #onDrop(event, zone) {
    event.preventDefault();
    const list = zone.dataset.list;
    const getData =
      foundry.applications.ux.TextEditor.implementation?.getDragEventData ??
      TextEditor.getDragEventData;
    const data = getData.call(
      foundry.applications.ux.TextEditor.implementation ?? TextEditor,
      event
    );
    const doc =
      data?.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
    if (!doc || !CarlRPGCreationSettings.LISTS[list].includes(doc.type)) {
      ui.notifications.warn(
        game.i18n.localize(`CARL_RPG.Creation.Menu.Wrong.${list}`)
      );
      return;
    }
    const exists =
      list === 'freeSkills'
        ? this.#data.freeSkills.some((e) => e.uuid === doc.uuid)
        : this.#data[list].includes(doc.uuid);
    if (exists) return;
    if (list === 'freeSkills') {
      this.#data.freeSkills.push({ uuid: doc.uuid, rank: 3 });
    } else {
      this.#data[list].push(doc.uuid);
    }
    this.render();
  }

  /** @this CarlRPGCreationSettings */
  static _onRemoveEntry(event, target) {
    const { list, index } = target.dataset;
    this.#data[list].splice(Number(index), 1);
    this.render();
  }

  /** @this CarlRPGCreationSettings */
  static async _onSave() {
    await game.settings.set(NS, CREATION_SETTING, this.#data);
    ui.notifications.info(game.i18n.localize('CARL_RPG.Creation.Menu.Saved'));
    this.close();
  }

  /** @this CarlRPGCreationSettings */
  static _onCancel() {
    this.close();
  }
}
