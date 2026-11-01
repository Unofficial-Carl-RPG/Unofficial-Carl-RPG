/**
 * Races and classes ("origins").
 *
 * From the third floor a crawler chooses a race and then a class. Each one has
 * prerequisites (minimum stat, skill rank, level, a particular race, a race
 * category, an achievement) that must all be met. The choosing dialog shows
 * every option with what is and isn't met; the GM can pick any (override).
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

/** Whether two items are "the same" (by identifier, else name). */
function sameItem(a, b) {
  const x = a.system?.identifier?.trim();
  const y = b.system?.identifier?.trim();
  return x && y ? x === y : a.name === b.name;
}

/** A stat as it counts for prerequisites (including effects). */
const statValue = (actor, key) => actor.system.abilities?.[key]?.enhanced ?? 0;

/**
 * Check every prerequisite of a race or class against a crawler.
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

  // (The races or classes come from the sources chosen for them: see helpers/sources.mjs.)
  const options = await sourceItems(type === 'race' ? 'races' : 'classes');
  if (!options.length) {
    ui.notifications.warn(t(`CARL_RPG.Origin.None.${type}`));
    return false;
  }

  const rows = [];
  for (const item of options) {
    const results = await evaluatePrerequisites(item, actor);
    const met = results.every((r) => r.met);
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
    const reqs = results
      .map(
        (r) =>
          `<li class="${r.met ? 'met' : 'unmet'}">${r.met ? '&#10003;' : '&#10007;'} ${r.text}</li>`
      )
      .join('');
    rows.push(`<li class="origin ${met ? '' : 'unmet'}">
      <label>
        <input type="radio" name="origin" value="${item.uuid}" ${
          met || isGM ? '' : 'disabled'
        } />
        ${earthIcon}
        <strong>${esc(item.name)}</strong>
        ${tagChips}
        ${!met && isGM ? `<span class="override">${t('CARL_RPG.Origin.Override')}</span>` : ''}
      </label>
      ${summary ? `<div class="origin-desc">${esc(summary)}</div>` : ''}
      ${reqs ? `<ul class="origin-reqs">${reqs}</ul>` : ''}
    </li>`);
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
  if (!choice || choice === 'cancel') return false;

  const picked = await fromUuid(choice);
  if (!picked) return false;
  const [created] = await actor.createEmbeddedDocuments('Item', [
    game.items.fromCompendium(picked),
  ]);
  if (!created) return false;
  // Wait until its skills and effects have been granted before the class step.
  await created._grantsDone;

  if (type === 'race' && !classOf(actor)) await chooseOrigin(actor);
  return true;
}
