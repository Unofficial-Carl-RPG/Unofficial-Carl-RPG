/**
 * Character creation.
 *
 * The GM sets up the defaults in the system settings (a menu that opens
 * CarlRPGCreationSettings): the tag that marks which skills can be picked, the
 * free skills every new crawler gets (with their ranks), the starting weapons
 * and the starting gear on offer. A new crawler is created with a "pending"
 * flag, which shows a Create Character link on its sheet that opens
 * CarlRPGCreationWizard. When the wizard finishes, applyCreation() writes it all
 * to the crawler.
 */
import { sourceItems } from './sources.mjs';
import { itemHasTag } from './tags.mjs';
import { chooseOrigin } from './origins.mjs';

const NS = 'carl-rpg';
export const CREATION_SETTING = 'creationDefaults';
export const SPECIES_SETTING = 'speciesInCreation';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/*  Setting                                     */

export function registerCreationSetting() {
  const fields = foundry.data.fields;
  const uuid = () => new fields.StringField({ required: true, blank: false });
  game.settings.register(NS, CREATION_SETTING, {
    name: 'CARL_RPG.Creation.Setting',
    scope: 'world',
    config: false,
    type: new fields.SchemaField({
      // How a new crawler gets their stat values: the Standard Array (assign each
      // number to a stat) or Roll For Stats (1d6 per stat, re-rolling 1s).
      statMethod: new fields.StringField({
        required: true,
        blank: false,
        choices: ['standardArray', 'roll'],
        initial: 'standardArray',
      }),
      // Whether a crawler can pick any skill with the skill tag instead of a
      // background (Backgrounds are offered either way).
      allowAnySkill: new fields.BooleanField({
        required: true,
        nullable: false,
        initial: true,
      }),
      // Skills with this tag can be picked in the wizard's skill pairs.
      skillTag: new fields.StringField({
        required: true,
        blank: true,
        initial: 'Starter',
      }),
      // Skills every new crawler gets, at these ranks (e.g. Unarmed Combat).
      freeSkills: new fields.ArrayField(
        new fields.SchemaField({
          uuid: uuid(),
          rank: new fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 3,
          }),
        })
      ),
      // Gear items a crawler can choose as their weapon (they pick one).
      weapons: new fields.ArrayField(uuid()),
      // Starting gear on offer, and how many a crawler may pick.
      gear: new fields.ArrayField(uuid()),
      gearPicks: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 2,
      }),
      // Later-floor starts: a crawler made while the world is on one of these floors
      // starts at this level and gold (see laterStart).
      laterFloors: new fields.ArrayField(
        new fields.SchemaField({
          floor: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, initial: 2 }),
          level: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, initial: 1 }),
          gold: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        })
      ),
    }),
  });
  // Off by default: when on, character creation has an optional Species step for
  // animal crawlers (see loadSpecies).
  game.settings.register(NS, SPECIES_SETTING, {
    name: 'CARL_RPG.Creation.SpeciesName',
    hint: 'CARL_RPG.Creation.SpeciesHint',
    scope: 'world',
    config: true,
    type: new fields.BooleanField({ initial: false }),
  });
}

/** The current creation defaults. */
export function getCreationDefaults() {
  return game.settings.get(NS, CREATION_SETTING);
}

/**
 * The later-floor start for a floor: the row the GM set for it, or null (a normal
 * start). Only the world's exact floor counts.
 * @param {object} defaults  The creation defaults
 * @param {number} floor
 * @returns {{floor: number, level: number, gold: number}|null}
 */
export function laterStart(defaults, floor) {
  return (defaults?.laterFloors ?? []).find((row) => row.floor === floor) ?? null;
}

/** Whether the GM lets new crawlers start as a species (an optional wizard step). */
export function speciesAllowed() {
  try {
    return !!game.settings.get(NS, SPECIES_SETTING);
  } catch (err) {
    return false;
  }
}

/*  What the wizard offers                      */

/**
 * The species on offer: the items of the Species list in the compendium sources, each
 * with its size and the skills it grants.
 * @returns {Promise<Array<{uuid: string, name: string, size: string,
 *   skills: Array<{name: string, rank: number}>}>>}
 */
export async function loadSpecies() {
  const species = await sourceItems('species');
  return Promise.all(
    species.map(async (item) => ({
      uuid: item.uuid,
      name: item.name,
      size: item.system.size || 'medium',
      skills: (
        await Promise.all(
          (item.system.grantedSkills ?? []).map(async (entry) => {
            const skill = await fromUuid(entry.uuid);
            return skill ? { name: skill.name, rank: entry.rank } : null;
          })
        )
      ).filter(Boolean),
    }))
  );
}

/**
 * The skills that can be picked: skills carrying the skill tag, from the sources
 * chosen for character creation skills (see helpers/sources.mjs).
 * @returns {Promise<Item[]>}
 */
export async function skillPool() {
  const tag = getCreationDefaults().skillTag;
  if (!tag) return [];
  return (await sourceItems('skills')).filter((i) => itemHasTag(i, tag));
}

/**
 * The backgrounds offered in each creation category: world backgrounds ticked for
 * it that have at least two skills that can be found. Each comes with its skills
 * resolved, labelled like "Awesome Skill (Cha)".
 * @returns {Promise<Object<string, Array<{uuid: string, name: string,
 *   skills: Array<{uuid: string, name: string, label: string}>}>>>}
 */
export async function loadBackgrounds() {
  const result = Object.fromEntries(
    CONFIG.CARL_RPG.creation.skillGroups.map((group) => [group.id, []])
  );
  const backgrounds = await sourceItems('backgrounds');
  for (const background of backgrounds) {
    const docs = await Promise.all(
      (background.system.skills ?? []).map((uuid) => fromUuid(uuid))
    );
    const skills = docs
      .filter((doc) => doc?.type === 'skill')
      .map((skill) => {
        const stat = skillStatLabel(skill);
        return {
          uuid: skill.uuid,
          name: skill.name,
          label: stat ? `${skill.name} (${stat})` : skill.name,
        };
      });
    // The player picks two, so it needs at least two to offer.
    if (skills.length < 2) continue;
    for (const id of background.system.categories ?? []) {
      result[id]?.push({ uuid: background.uuid, name: background.name, skills });
    }
  }
  return result;
}

/** Resolve a list of UUIDs to items, dropping any that can't be found. */
export async function resolveItems(uuids) {
  const docs = await Promise.all(uuids.map((u) => fromUuid(u)));
  return docs.filter((d) => d?.documentName === 'Item');
}

/** The short label for a skill's stat, like "Cha" for a Charisma skill. */
export function skillStatLabel(skill) {
  const abbr = CONFIG.CARL_RPG.abilityAbbreviations[skill?.system?.stat];
  if (!abbr) return '';
  const text = game.i18n.localize(abbr);
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** The skill a weapon grants: the first skill embedded in it. */
export async function weaponSkill(weapon) {
  // The skill it rolls with (marked on the weapon), or the first one.
  const skills = weapon?.system?.skills ?? [];
  const uuid = skills.includes(weapon?.system?.rollSkill) ? weapon.system.rollSkill : skills[0];
  const skill = uuid ? await fromUuid(uuid) : null;
  return skill?.type === 'skill' ? skill : null;
}

/** Whether a crawler is waiting to go through the creation wizard. */
export const creationPending = (actor) =>
  actor?.type === 'crawler' && !!actor.getFlag(NS, 'creationPending');

/*  Working out what a finished wizard gives    */

/** What identifies a skill: its identifier, or its name if it has none. */
const skillKey = (skill) => skill.system.identifier?.trim() || skill.name;

/**
 * Every skill the crawler starts with and its rank: the eight picked skills at
 * their group's rank, the weapon's skill, and the free skills. If a skill comes
 * from more than one place, the highest rank wins.
 * @returns {Promise<Array<{skill: Item, rank: number}>>}
 */
export async function planSkills(state) {
  const { skillGroups, skillsPerGroup, weaponRank } = CONFIG.CARL_RPG.creation;
  const wanted = new Map();
  const want = (skill, rank) => {
    if (skill?.type !== 'skill') return;
    const key = skillKey(skill);
    if (!wanted.has(key) || wanted.get(key).rank < rank) {
      wanted.set(key, { skill, rank });
    }
  };
  for (const [i, uuid] of state.skills.entries()) {
    const group = skillGroups[Math.floor(i / skillsPerGroup)];
    if (uuid) want(await fromUuid(uuid), group.rank);
  }
  if (state.weapon) {
    want(await weaponSkill(await fromUuid(state.weapon)), weaponRank);
  }
  for (const free of getCreationDefaults().freeSkills) {
    want(await fromUuid(free.uuid), free.rank);
  }
  return [...wanted.values()];
}

/*  Applying a finished wizard                  */

/**
 * Write a finished wizard to a crawler.
 * @param {Actor} actor
 * @param {object} state
 * @param {string} state.name
 * @param {string} state.gender
 * @param {string} state.size
 * @param {Object<string, number>} state.stats        Value for each stat
 * @param {string[]} state.skills                     The 8 chosen skill UUIDs, in group order
 * @param {string} [state.species]                    UUID of the chosen species (animal crawlers)
 * @param {string} state.weapon                       UUID of the chosen weapon
 * @param {string[]} state.gear                       UUIDs of the chosen starting gear
 * @param {Object<string, string>} state.background   pastTrauma, popularity, looseEnds, regrets
 */
export async function applyCreation(actor, state) {
  const planned = await planSkills(state);
  const weapon = state.weapon ? await fromUuid(state.weapon) : null;
  const later = laterStart(getCreationDefaults(), CONFIG.CARL_RPG.getFloor());

  // The crawler itself. Mana starts full: it equals the enhanced Intelligence,
  // which is the chosen value (nothing else adds to it yet).
  const update = {
    name: state.name,
    'system.gender': state.gender,
    'system.size': state.size,
    'system.mana.value': state.stats.int,
    [`flags.${NS}.creationPending`]: false,
    [`flags.${NS}.creationComplete`]: true,
    // Stats rolled in the wizard are no longer needed once they are on the crawler.
    [`flags.${NS}.-=creationStats`]: null,
  };
  for (const [key, value] of Object.entries(state.stats)) {
    update[`system.abilities.${key}.value`] = value;
  }
  // Starting on a later floor: the level (which gives the stat points) and the gold.
  if (later) {
    update['system.attributes.level.value'] = later.level;
    update['system.gold'] = later.gold;
  }
  for (const [key, text] of Object.entries(state.background)) {
    update[`system.background.${key}`] = text;
  }
  await actor.update(update);

  // Skills first, so the weapon's own skill (added with it at rank 0 otherwise)
  // is already there at its proper rank.
  const skillData = planned.map(({ skill, rank }) => {
    const data = game.items.fromCompendium(skill);
    foundry.utils.setProperty(data, 'system.rank', rank);
    return data;
  });
  if (skillData.length) await actor.createEmbeddedDocuments('Item', skillData);

  // An animal crawler's species goes on as an item: it sets the Race box and size,
  // raises the skills it grants and copies its effects (see Item#applyOrigin).
  const species = state.species ? await fromUuid(state.species) : null;
  if (species?.type === 'species') {
    const [item] = await actor.createEmbeddedDocuments('Item', [
      game.items.fromCompendium(species),
    ]);
    await item?._grantsDone;
  }

  const gearDocs = [weapon, ...(await resolveItems(state.gear))].filter(Boolean);
  const gearData = gearDocs.map((doc) => {
    const data = game.items.fromCompendium(doc);
    if ('quantity' in (data.system ?? {})) data.system.quantity = 1;
    return data;
  });
  const created = gearData.length
    ? await actor.createEmbeddedDocuments('Item', gearData)
    : [];
  await Promise.all(created.map((item) => item._grantsDone));

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="carl-level-card">${t('CARL_RPG.Creation.Done', {
      name: Handlebars.escapeExpression(state.name),
    })}</div>`,
  });
  return { later };
}

/**
 * After creation, a crawler made on the origin floor or later picks their race and
 * class straight away (earlier floors do it when they get there).
 */
export async function offerOrigins(actor) {
  if (CONFIG.CARL_RPG.getFloor() >= CONFIG.CARL_RPG.originFloor) {
    await chooseOrigin(actor);
  }
}
