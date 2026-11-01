import { SOURCES_SETTING, getSources } from '../helpers/sources.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } =
  foundry.applications.api;

const NS = 'carl-rpg';

/**
 * The compendium sources, opened from a button in the system settings: for each
 * list the system offers (achievements to award, races, classes, backgrounds,
 * character creation skills) which item compendiums it draws from, and whether
 * the world's own items count too. Changes are kept until Save is clicked.
 * See helpers/sources.mjs.
 */
export class CarlRPGSourcesSettings extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'carl-rpg-sources-settings',
    classes: ['carl-rpg', 'creation-settings'],
    position: { width: 520, height: 'auto' },
    window: {
      title: 'CARL_RPG.Sources.Menu.Title',
      icon: 'fa-solid fa-book-atlas',
      resizable: true,
    },
    actions: {
      save: CarlRPGSourcesSettings._onSave,
      cancel: CarlRPGSourcesSettings._onCancel,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'systems/carl-rpg/templates/settings/sources.hbs',
      scrollable: [''],
    },
  };

  /** The working copy, saved only when Save is clicked. */
  #data = foundry.utils.deepClone(getSources());

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const packs = game.packs
      .filter((pack) => pack.documentName === 'Item')
      .sort((a, b) => a.title.localeCompare(b.title));
    context.purposes = Object.entries(CONFIG.CARL_RPG.compendiumPurposes).map(
      ([id, purpose]) => ({
        id,
        label: purpose.label,
        world: this.#data[id].world,
        packs: packs.map((pack) => ({
          id: pack.collection,
          title: pack.title,
          package: pack.metadata.packageName,
          checked: this.#data[id].packs.includes(pack.collection),
        })),
      })
    );
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const box of this.element.querySelectorAll('.source-world')) {
      box.addEventListener('change', () => {
        this.#data[box.dataset.purpose].world = box.checked;
      });
    }
    for (const box of this.element.querySelectorAll('.source-pack')) {
      box.addEventListener('change', () => {
        const packs = this.#data[box.dataset.purpose].packs;
        const at = packs.indexOf(box.dataset.pack);
        if (box.checked && at < 0) packs.push(box.dataset.pack);
        if (!box.checked && at >= 0) packs.splice(at, 1);
      });
    }
  }

  /** @this CarlRPGSourcesSettings */
  static async _onSave() {
    await game.settings.set(NS, SOURCES_SETTING, this.#data);
    ui.notifications.info(game.i18n.localize('CARL_RPG.Sources.Menu.Saved'));
    this.close();
  }

  /** @this CarlRPGSourcesSettings */
  static _onCancel() {
    this.close();
  }
}
