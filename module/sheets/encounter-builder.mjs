/**
 * The encounter builder: a window from Dungeon Info where the GM picks several
 * mobs, and how many of each, and places them on the map in one go (see
 * placeEncounter in helpers/encounters.mjs). The mobs come from the world and
 * from the visible actor compendiums.
 */
import { placeEncounter } from '../helpers/encounters.mjs';
import { sourceActors } from '../helpers/sources.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } =
  foundry.applications.api;

/**
 * Every mob the GM can pick: the world's mobs and those in the mob compendiums
 * chosen in the compendium sources (see helpers/sources.mjs). Keyed by UUID.
 * @returns {Promise<Object<string, string>>}
 */
export async function mobChoices() {
  const mobs = await sourceActors('mobs');
  return Object.fromEntries(mobs.map((actor) => [actor.uuid, actor.name]));
}

export class CarlRPGEncounterBuilder extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'carl-rpg-encounter-builder',
    classes: ['carl-rpg', 'carl-dialog', 'encounter-builder-window'],
    tag: 'div',
    window: { title: 'CARL_RPG.Encounters.Builder', resizable: true },
    position: { width: 440, height: 'auto' },
    actions: {
      addMob: CarlRPGEncounterBuilder._onAddMob,
      removeMob: CarlRPGEncounterBuilder._onRemoveMob,
      place: CarlRPGEncounterBuilder._onPlace,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'systems/carl-rpg/templates/sidebar/encounter-builder.hbs',
      scrollable: [''],
    },
  };

  /** The rows being built: a mob (UUID) and how many. Kept across redraws. */
  rows = [{ uuid: '', count: 1 }];

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.rows = this.rows.map((row, index) => ({ ...row, index }));
    context.mobChoices = await mobChoices();
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const el of this.element.querySelectorAll('.b-mob')) {
      el.addEventListener('change', () => {
        this.rows[Number(el.dataset.index)].uuid = el.value;
      });
    }
    for (const el of this.element.querySelectorAll('.b-count')) {
      el.addEventListener('change', () => {
        const count = Math.trunc(Number(el.value));
        this.rows[Number(el.dataset.index)].count = Math.max(1, count || 1);
      });
    }
  }

  /** @this CarlRPGEncounterBuilder */
  static _onAddMob() {
    this.rows.push({ uuid: '', count: 1 });
    this.render();
  }

  /** @this CarlRPGEncounterBuilder */
  static _onRemoveMob(event, target) {
    this.rows.splice(Number(target.dataset.index), 1);
    if (!this.rows.length) this.rows.push({ uuid: '', count: 1 });
    this.render();
  }

  /** Place the chosen mobs: the GM clicks the map (see placeEncounter). */
  static async _onPlace() {
    if (!game.user.isGM) return;
    const entries = [];
    for (const row of this.rows) {
      if (!row.uuid) continue;
      const actor = await fromUuid(row.uuid);
      if (actor?.type === 'mob') entries.push({ actor, count: row.count });
    }
    await placeEncounter(entries);
  }
}

/** The one open builder, if any. */
let builder = null;

/**
 * Open the encounter builder (GM only), or bring it to the front.
 * @returns {CarlRPGEncounterBuilder|null}
 */
export function openEncounterBuilder() {
  if (!game.user.isGM) return null;
  builder ??= new CarlRPGEncounterBuilder();
  builder.render({ force: true });
  return builder;
}
