/**
 * Races, classes and subclasses ("origins").
 *
 * From the third floor a crawler chooses a race and then a class. Each one has
 * prerequisites (minimum stat, skill rank, level, a particular race, a race
 * category, a class tag, an achievement) that must all be met. The choosing dialog
 * shows every option with what is and isn't met; the GM can pick any (override).
 *
 * A subclass comes from a class the crawler has, from the Subclass floor. A
 * crawler can hold several; the newest one is the one the sheet's Class box shows.
 *
 * A hidden option isn't listed to a crawler until they meet its requirements or
 * the GM reveals it to them (the reveal is a flag on the crawler).
 *
 * Taking one adds it to the crawler like any item (see CarlRPGItem), so its
 * granted skills and effects come along.
 */
import { sourceItems } from './sources.mjs';
import { CarlRPGDialog } from './dialog.mjs';
import { classHasTag } from './tags.mjs';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => Handlebars.escapeExpression(text);

/** The crawler's race item, if they have one. */
export const raceOf = (actor) => actor.itemTypes.race?.[0] ?? null;
/** The crawler's class item, if they have one. */
export const classOf = (actor) => actor.itemTypes.class?.[0] ?? null;
/** The crawler's subclasses, oldest first. */
export const subclassesOf = (actor) =>
  [...(actor.itemTypes.subclass ?? [])].sort(
    (a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0)
  );
/** The subclass the sheet's Class box shows: the most recently added. */
export const latestSubclassOf = (actor) => subclassesOf(actor).at(-1) ?? null;
/** The floor from which a crawler can choose a subclass (a world setting). */
export const subclassFloor = () => game.settings.get('carl-rpg', 'subclassFloor');
/** The UUIDs of the hidden options the GM has revealed to this crawler. */
export const revealedOf = (actor) => actor?.getFlag?.('carl-rpg', 'revealed') ?? [];

/** Whether two items are "the same" (by identifier, else name). */
export function sameItem(a, b) {
  const x = a.system?.identifier?.trim();
  const y = b.system?.identifier?.trim();
  return x && y ? x === y : a.name === b.name;
}

/** A stat as it counts for prerequisites (including effects). */
const statValue = (actor, key) => actor.system.abilities?.[key]?.enhanced ?? 0;

/**
 * Check every prerequisite of a race, class or subclass against a crawler.
 * @param {Item} item
 * @param {Actor} actor
 * @returns {Promise<Array<{met: boolean, text: string}>>}
 */
export async function evaluatePrerequisites(item, actor) {
  const results = [];
  for (const p of item.system.prerequisites ?? []) {
    switch (p.type) {
      case 'stat': {
        const have = statValue(actor, p.stat);
        results.push({
          met: have >= p.value,
          text: t('CARL_RPG.Origin.Needs.stat', {
            stat: t(CONFIG.CARL_RPG.abilities[p.stat] ?? p.stat),
            value: p.value,
            have,
          }),
        });
        break;
      }
      case 'level': {
        const have = actor.system.attributes.level.value;
        results.push({
          met: have >= p.value,
          text: t('CARL_RPG.Origin.Needs.level', { value: p.value, have }),
        });
        break;
      }
      case 'skillRank': {
        const skill = p.uuid ? await fromUuid(p.uuid) : null;
        const owned = skill
          ? actor.itemTypes.skill.find((s) => sameItem(s, skill))
          : null;
        const have = owned?.system.rank ?? 0;
        results.push({
          met: !!skill && have >= p.value,
          text: t('CARL_RPG.Origin.Needs.skillRank', {
            skill: esc(skill?.name ?? '?'),
            value: p.value,
            have,
          }),
        });
        break;
      }
      case 'race': {
        const wanted = p.uuid ? await fromUuid(p.uuid) : null;
        const race = raceOf(actor);
        results.push({
          met: !!wanted && !!race && sameItem(race, wanted),
          text: t('CARL_RPG.Origin.Needs.race', { race: esc(wanted?.name ?? '?') }),
        });
        break;
      }
      case 'raceCategory': {
        // Earth-Based, or Alien (any race that isn't Earth-Based).
        const race = raceOf(actor);
        const earth = !!race?.system.earthBased;
        results.push({
          met: !!race && (p.category === 'earthBased' ? earth : !earth),
          text: t('CARL_RPG.Origin.Needs.raceCategory', {
            category: t(CONFIG.CARL_RPG.raceCategories[p.category] ?? p.category),
          }),
        });
        break;
      }
      case 'classTag': {
        // A class or any of the crawler's subclasses can carry the tag.
        results.push({
          met: classHasTag(actor, p.tag),
          text: t('CARL_RPG.Origin.Needs.classTag', { tag: esc(p.tag) }),
        });
        break;
      }
      case 'achievement': {
        const wanted = p.uuid ? await fromUuid(p.uuid) : null;
        results.push({
          met:
            !!wanted && actor.itemTypes.achievement.some((a) => sameItem(a, wanted)),
          text: t('CARL_RPG.Origin.Needs.achievement', {
            achievement: esc(wanted?.name ?? '?'),
          }),
        });
        break;
      }
    }
  }
  return results;
}

/**
 * Whether a choice is listed to the person looking at it. A hidden option shows
 * once the crawler meets it, or the GM has revealed it (the GM always sees it).
 */
function optionVisible(item, met, isGM, revealed) {
  return isGM || met || !item.system.hidden || revealed.includes(item.uuid);
}

/** One option in the choosing dialog: its name, what it needs and whether it's met. */
function originRow(item, results, met, isGM) {
  const summary = new DOMParser()
    .parseFromString(item.system.description ?? '', 'text/html')
    .body.textContent.trim()
    .slice(0, 220);
  // Earth-Based races get an earth icon beside their name.
  const earthIcon = item.system.earthBased
    ? `<i class="fas fa-earth-americas" title="${esc(t('CARL_RPG.Origin.EarthBased'))}"></i>`
    : '';
  // The categories a class has, shown as small chips after its name.
  const tagChips = (item.system.categories ?? [])
    .map((tag) => `<span class="origin-tag">${esc(tag)}</span>`)
    .join('');
  // The GM can see which options are hidden from crawlers.
  const hiddenChip =
    item.system.hidden && isGM
      ? `<span class="origin-tag">${esc(t('CARL_RPG.Origin.HiddenTag'))}</span>`
      : '';
  const reqs = results
    .map(
      (r) =>
        `<li class="${r.met ? 'met' : 'unmet'}">${r.met ? '&#10003;' : '&#10007;'} ${r.text}</li>`
    )
    .join('');
  return `<li class="origin ${met ? '' : 'unmet'}">
      <label>
        <input type="radio" name="origin" value="${item.uuid}" ${
          met || isGM ? '' : 'disabled'
        } />
        ${earthIcon}
        <strong>${esc(item.name)}</strong>
        ${tagChips}
        ${hiddenChip}
        ${!met && isGM ? `<span class="override">${t('CARL_RPG.Origin.Override')}</span>` : ''}
      </label>
      ${summary ? `<div class="origin-desc">${esc(summary)}</div>` : ''}
      ${reqs ? `<ul class="origin-reqs">${reqs}</ul>` : ''}
    </li>`;
}

/**
 * Open the choosing dialog for a list of options. Resolves with the UUID of the
 * one picked, or null.
 * @param {Actor} actor
 * @param {string} type      'race', 'class' or 'subclass' (for the wording)
 * @param {Item[]} items     The options (already filtered to the right type)
 * @returns {Promise<string|null>}
 */
async function askOrigin(actor, type, items, qualifiedOnly = false) {
  const isGM = game.user.isGM;
  const revealed = revealedOf(actor);
  const rows = [];
  for (const item of items) {
    const results = await evaluatePrerequisites(item, actor);
    const met = results.every((r) => r.met);
    if (!optionVisible(item, met, isGM, revealed)) continue;
    // Subclasses are listed only once the crawler qualifies (the GM can still see all).
    if (qualifiedOnly && !isGM && !met) continue;
    rows.push(originRow(item, results, met, isGM));
  }
  if (!rows.length) {
    ui.notifications.warn(t('CARL_RPG.Origin.NoneVisible'));
    return null;
  }

  const choice = await CarlRPGDialog.wait({
    window: { title: t(`CARL_RPG.Origin.Title.${type}`) },
    position: { width: 520 },
    content: `<p>${t(`CARL_RPG.Origin.Intro.${type}`, { name: esc(actor.name) })}</p>
      <ul class="carl-origin-list">${rows.join('')}</ul>`,
    buttons: [
      {
        action: 'choose',
        label: t('CARL_RPG.Origin.Choose'),
        default: true,
        callback: (event, button) => button.form.elements.origin?.value ?? null,
      },
      { action: 'cancel', label: t('Cancel') },
    ],
    // Choose is only available once something is selected.
    render: (event, dialog) => {
      const el = dialog.element;
      const choose = el.querySelector('button[data-action="choose"]');
      const refresh = () => {
        choose.disabled = !el.querySelector('input[name="origin"]:checked');
      };
      el.querySelectorAll('input[name="origin"]').forEach((r) =>
        r.addEventListener('change', refresh)
      );
      refresh();
    },
    rejectClose: false,
  });
  return !choice || choice === 'cancel' ? null : choice;
}

/**
 * Take a race, class or subclass: add it to the crawler (like any item) and wait
 * until its skills and effects have been granted.
 */
async function addOrigin(actor, uuid) {
  const picked = await fromUuid(uuid);
  if (!picked) return false;
  const [created] = await actor.createEmbeddedDocuments('Item', [
    game.items.fromCompendium(picked),
  ]);
  if (!created) return false;
  await created._grantsDone;
  return true;
}

/**
 * Open the choosing dialog for whatever the crawler is missing: their race
 * first, then their class (the class step opens straight after the race, and
 * its prerequisites see what the race granted).
 * @param {Actor} actor
 * @returns {Promise<boolean>}  Whether something was chosen
 */
export async function chooseOrigin(actor) {
  if (actor?.type !== 'crawler' || !actor.isOwner) return false;
  const isGM = game.user.isGM;
  if (actor.system.floor < CONFIG.CARL_RPG.originFloor && !isGM) {
    ui.notifications.warn(
      t('CARL_RPG.Origin.TooEarly', { floor: CONFIG.CARL_RPG.originFloor })
    );
    return false;
  }

  const type = !raceOf(actor) ? 'race' : !classOf(actor) ? 'class' : null;
  if (!type) {
    ui.notifications.info(t('CARL_RPG.Origin.AllChosen'));
    return false;
  }

  // The races or classes come from the sources chosen for them (see helpers/sources.mjs).
  // A class source can also hold subclasses, which have their own step.
  const options = (
    await sourceItems(type === 'race' ? 'races' : 'classes')
  ).filter((item) => item.type === type);
  if (!options.length) {
    ui.notifications.warn(t(`CARL_RPG.Origin.None.${type}`));
    return false;
  }

  const picked = await askOrigin(actor, type, options);
  if (!picked || !(await addOrigin(actor, picked))) return false;

  if (type === 'race' && !classOf(actor)) await chooseOrigin(actor);
  return true;
}

/**
 * Choose a subclass of the crawler's class, from the Subclass floor. A crawler can
 * hold several (the newest one shows on the sheet), but not the same one twice.
 * @param {Actor} actor
 * @returns {Promise<boolean>}  Whether something was chosen
 */
export async function chooseSubclass(actor) {
  if (actor?.type !== 'crawler' || !actor.isOwner) return false;
  const isGM = game.user.isGM;
  const need = subclassFloor();
  if (actor.system.floor < need && !isGM) {
    ui.notifications.warn(t('CARL_RPG.Origin.SubclassTooEarly', { floor: need }));
    return false;
  }
  const parent = classOf(actor);
  if (!parent) {
    ui.notifications.warn(t('CARL_RPG.Origin.NeedClass'));
    return false;
  }

  // Subclasses that belong to the crawler's class and that they don't hold yet.
  const held = actor.itemTypes.subclass ?? [];
  const items = [];
  for (const item of await sourceItems('classes')) {
    if (item.type !== 'subclass') continue;
    const linked = item.system.classUuid ? await fromUuid(item.system.classUuid) : null;
    if (!linked || !sameItem(linked, parent)) continue;
    if (held.some((h) => sameItem(h, item))) continue;
    items.push(item);
  }
  if (!items.length) {
    ui.notifications.warn(t('CARL_RPG.Origin.None.subclass'));
    return false;
  }

  const picked = await askOrigin(actor, 'subclass', items, true);
  return !!picked && (await addOrigin(actor, picked));
}
