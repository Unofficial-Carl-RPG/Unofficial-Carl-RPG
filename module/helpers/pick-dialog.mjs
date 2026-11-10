
/**
 * The player's choices: the dialog, and writing the answers (see helpers/picks.mjs for what
 * can be chosen). Used right after a race, class or subclass is chosen, from the sheet's
 * Make Choices button, from Reassign Points, and by the GM's Reset picks.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { sourceItems } from './sources.mjs';
import {
  checkSplit,
  filterParts,
  grantPicksOf,
  matchesFilter,
  pendingSlots,
  poolFor,
  reassignSlots,
  tidyChoices,
  withBuildPicks,
  withoutAnswers,
  withSplit,
} from './picks.mjs';

import { hasStat } from './stat-term.mjs';

const NS = 'carl-rpg';
const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => Handlebars.escapeExpression(text);
const floorNow = () => CONFIG.CARL_RPG.getFloor();
const statName = (key) => t(CONFIG.CARL_RPG.abilities[key] ?? key);
const statShort = (key) => key.charAt(0).toUpperCase() + key.slice(1);

/** What a filter asks for in words: "crafting Charisma-based skills", "spells", ... */
export function filterText(filter) {
  const parts = filterParts(filter);
  return [
    parts.tag,
    parts.stat ? t('CARL_RPG.Picks.StatBased', { stat: statName(parts.stat) }) : '',
    t(`CARL_RPG.Picks.Plural.${parts.kind}`),
  ]
    .filter(Boolean)
    .join(' ');
}

/** One line saying what a slot asks for. */
function slotLine(slot) {
  switch (slot.type) {
    case 'grant':
      return t('CARL_RPG.Picks.Grant', {
        need: slot.need,
        what: esc(filterText(slot.filter)),
        rank: slot.rank,
      });
    case 'cap':
      return t('CARL_RPG.Picks.Cap', {
        need: slot.need,
        what: esc(filterText(slot.filter)),
        benefit: esc(t(CONFIG.CARL_RPG.buildKinds[slot.row.kind] ?? slot.row.kind)),
      });
    default:
      return t('CARL_RPG.Picks.Split', {
        points: slot.points,
        stats: slot.stats.map(statName).join(', '),
      });
  }
}

/** The skills a slot picks from. A Skill cap pick needs an Identifier to cover a skill by. */
const poolOf = (all, slot) =>
  poolFor(all, slot.filter, { identified: slot.type === 'cap' });

/** The value a pick stores for a skill: its UUID (granted skills) or Identifier (caps). */
const valueOf = (slot, item) =>
  slot.type === 'cap' ? String(item.system.identifier).trim() : item.uuid;

/** The HTML of one slot. */
function slotHtml(slot, all, redo) {
  const head = `<h4>${esc(slot.sourceName)}</h4><p class="pick-line">${slotLine(slot)}</p>`;
  if (slot.type === 'split') {
    const boxes = slot.stats
      .map(
        (key) => `<label class="pick-stat"><span>${esc(statShort(key))}</span>
          <input type="number" min="0" max="${slot.points}" step="1"
            data-split="${esc(slot.key)}" data-stat="${key}"
            value="${redo ? (slot.split[key] ?? 0) : 0}" /></label>`
      )
      .join('');
    return `<section class="pick-slot" data-split-box="${esc(slot.key)}" data-points="${slot.points}" data-redo="${redo ? 1 : 0}">
      ${head}<div class="pick-stats">${boxes}</div>
      <p class="pick-left-line">${t('CARL_RPG.Picks.Left')}: <strong class="pick-left">${slot.points}</strong></p>
    </section>`;
  }
  const pool = poolOf(all, slot);
  const options = pool
    .map(
      (item) =>
        `<option value="${esc(valueOf(slot, item))}">${esc(item.name)}${
          hasStat(item.system.stat) ? ` (${esc(statShort(item.system.stat))})` : ''
        }</option>`
    )
    .join('');
  const selects = Array.from(
    { length: slot.need },
    () => `<select data-slot="${esc(slot.key)}"><option value="">&mdash;</option>${options}</select>`
  ).join('');
  const none = pool.length ? '' : `<p class="pick-none">${t('CARL_RPG.Picks.NoneFound')}</p>`;
  return `<section class="pick-slot">${head}${selects}${none}</section>`;
}

/**
 * Ask the player to make the choices in a list of slots.
 * @param {Actor} actor
 * @param {object[]} slots
 * @param {Item[]} all     The skills and spells that can be picked from
 * @param {boolean} redo   Whether these are splits being redone (they start at their answer)
 * @returns {Promise<{chosen: Object<string, string[]>, splits: Object<string, object>}|null>}
 */
async function askPicks(actor, slots, all, redo) {
  const result = await CarlRPGDialog.wait({
    window: { title: t(redo ? 'CARL_RPG.Picks.RedoTitle' : 'CARL_RPG.Picks.Title') },
    position: { width: 520 },
    content: `<div class="carl-picks">
      <p>${t(redo ? 'CARL_RPG.Picks.RedoIntro' : 'CARL_RPG.Picks.Intro', { name: esc(actor.name) })}</p>
      ${slots.map((slot) => slotHtml(slot, all, redo)).join('')}
    </div>`,
    buttons: [
      {
        action: 'confirm',
        label: t('CARL_RPG.Picks.Confirm'),
        default: true,
        callback: (event, button) => {
          const form = button.form;
          const chosen = {};
          for (const select of form.querySelectorAll('select[data-slot]')) {
            (chosen[select.dataset.slot] ??= []).push(select.value);
          }
          const splits = {};
          for (const input of form.querySelectorAll('input[data-split]')) {
            (splits[input.dataset.split] ??= {})[input.dataset.stat] = Number(input.value) || 0;
          }
          return { chosen, splits };
        },
      },
      { action: 'cancel', label: t('Cancel') },
    ],
    render: (event, dialog) => {
      const el = dialog.element;
      const confirm = el.querySelector('button[data-action="confirm"]');
      const refresh = () => {
        // The same skill can't be picked twice in one slot.
        const bySlot = new Map();
        for (const select of el.querySelectorAll('select[data-slot]')) {
          const list = bySlot.get(select.dataset.slot) ?? [];
          list.push(select);
          bySlot.set(select.dataset.slot, list);
        }
        for (const selects of bySlot.values()) {
          for (const select of selects) {
            const taken = selects.filter((s) => s !== select).map((s) => s.value);
            for (const option of select.options) {
              option.disabled = !!option.value && taken.includes(option.value);
            }
          }
        }
        // Points: a split must hand out every point (one not touched yet can wait).
        let valid = true;
        for (const box of el.querySelectorAll('[data-split-box]')) {
          const points = Number(box.dataset.points);
          const total = Array.from(box.querySelectorAll('input[data-split]')).reduce(
            (sum, input) => sum + Math.max(0, Math.trunc(Number(input.value)) || 0),
            0
          );
          box.querySelector('.pick-left').textContent = String(points - total);
          if ((box.dataset.redo === '1' || total > 0) && total !== points) valid = false;
        }
        confirm.disabled = !valid;
      };
      el.addEventListener('change', refresh);
      el.addEventListener('input', refresh);
      refresh();
    },
    rejectClose: false,
  });
  return result && typeof result === 'object' ? result : null;
}

/**
 * Give an actor skills or spells at a rank: ones it lacks are added, ones it has below the
 * rank are raised to it.
 * @param {Actor} actor
 * @param {Array<{skill: Item, rank: number}>} entries
 */
async function grantRanked(actor, entries) {
  const toCreate = [];
  for (const { skill, rank } of entries) {
    const identifier = skill.system.identifier?.trim();
    const matches = (s) =>
      identifier ? s.system.identifier?.trim() === identifier : s.name === skill.name;
    const owned = [...actor.items].find((s) => s.type === skill.type && matches(s));
    if (owned) {
      if (owned.system.rank < rank) await owned.update({ 'system.rank': rank });
      continue;
    }
    if (toCreate.some((d) => d.type === skill.type && matches({ name: d.name, system: d.system }))) {
      continue;
    }
    const data = game.items.fromCompendium(skill);
    foundry.utils.setProperty(data, 'system.rank', rank);
    toCreate.push(data);
  }
  if (toCreate.length) await actor.createEmbeddedDocuments('Item', toCreate);
}

/**
 * Write what the player chose, and say so in chat.
 * @returns {Promise<boolean>}  Whether anything was saved
 */
async function applyAnswers(actor, slots, all, answers, redo) {
  const lines = [];
  for (const slot of slots) {
    if (slot.type === 'split') {
      const raw = answers.splits[slot.key];
      if (!raw) continue;
      const { ok, split, total } = checkSplit(slot.row, raw);
      if (!total) continue;
      if (!ok) {
        ui.notifications.warn(t('CARL_RPG.Picks.BadSplit', { name: slot.sourceName }));
        continue;
      }
      // Putting the same points back is not a redo, so it doesn't use the floor.
      if (redo && JSON.stringify(split) === JSON.stringify(slot.split)) continue;
      const rows = foundry.utils.deepClone(slot.effect.getFlag(NS, 'buildMods') ?? []);
      await slot.effect.update({
        [`flags.${NS}.buildMods`]: withSplit(rows, slot.index, split, redo ? floorNow() : null),
      });
      lines.push(
        t('CARL_RPG.Picks.SplitDone', {
          source: esc(slot.sourceName),
          split: Object.entries(split)
            .map(([key, n]) => `${esc(statShort(key))} +${n}`)
            .join(', '),
        })
      );
      continue;
    }

    // Skills: only ones that are really on offer count (whatever the form said).
    const pool = poolOf(all, slot);
    const wanted = tidyChoices(answers.chosen[slot.key] ?? [], [], slot.need, (v) => v);
    const items = wanted
      .map((value) => pool.find((item) => valueOf(slot, item) === value))
      .filter((item) => item && matchesFilter(item, slot.filter));
    if (!items.length) continue;

    if (slot.type === 'grant') {
      await grantRanked(actor, items.map((skill) => ({ skill, rank: slot.rank })));
      await slot.item.setFlag(NS, 'picks', {
        ...grantPicksOf(slot.item),
        [slot.index]: [...slot.picked, ...items.map((item) => item.uuid)],
      });
    } else {
      const rows = foundry.utils.deepClone(slot.effect.getFlag(NS, 'buildMods') ?? []);
      const picks = [
        ...slot.picked,
        ...items.map((item) => ({ value: valueOf(slot, item), name: item.name })),
      ];
      await slot.effect.update({
        [`flags.${NS}.buildMods`]: withBuildPicks(rows, slot.index, picks),
      });
    }
    lines.push(
      t('CARL_RPG.Picks.Done', {
        source: esc(slot.sourceName),
        picks: items.map((item) => esc(item.name)).join(', '),
      })
    );
  }

  if (!lines.length) return false;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="carl-origin-card">${t('CARL_RPG.Picks.Chosen', {
      name: esc(actor.name),
    })}<br>${lines.join('<br>')}</div>`,
  });
  return true;
}

/**
 * Open the dialog for every choice the crawler still has to make (skills to pick, points to
 * split). Choices left blank stay pending. Called right after a race, class or subclass is
 * chosen, and from the sheet's Make Choices button.
 * @param {Actor} actor
 * @returns {Promise<boolean>}  Whether anything was chosen
 */
export async function choosePicks(actor) {
  if (actor?.type !== 'crawler' || !actor.isOwner) return false;
  const slots = pendingSlots(actor);
  if (!slots.length) return false;
  const all = slots.some((slot) => slot.type !== 'split') ? await sourceItems('skills') : [];
  const answers = await askPicks(actor, slots, all, false);
  return answers ? applyAnswers(actor, slots, all, answers, false) : false;
}

/**
 * Open the dialog to redo the Stat splits that allow it (once per floor).
 * @param {Actor} actor
 * @returns {Promise<boolean>}  Whether the points were changed
 */
export async function reassignPoints(actor) {
  if (actor?.type !== 'crawler' || !actor.isOwner) return false;
  const slots = reassignSlots(actor, floorNow());
  if (!slots.length) {
    ui.notifications.info(t('CARL_RPG.Picks.NothingToRedo'));
    return false;
  }
  const answers = await askPicks(actor, slots, [], true);
  return answers ? applyAnswers(actor, slots, [], answers, true) : false;
}

/**
 * GM only: forget what the player picked for a race, class or subclass the crawler holds, so
 * they can pick again. Skills that were already granted stay.
 * @param {Item} item  The crawler's copy of the race, class or subclass
 * @returns {Promise<boolean>}
 */
export async function resetPicks(item) {
  const actor = item?.actor;
  if (!game.user.isGM || !actor) return false;
  const ok = await CarlRPGDialog.confirm({
    window: { title: t('CARL_RPG.Picks.ResetTitle') },
    content: `<p>${t('CARL_RPG.Picks.ResetConfirm', { name: esc(item.name), actor: esc(actor.name) })}</p>`,
  });
  if (!ok) return false;
  if (item.getFlag(NS, 'picks')) await item.unsetFlag(NS, 'picks');
  for (const effect of actor.effects) {
    if (!(effect.getFlag(NS, 'sourceItems') ?? []).includes(item.id)) continue;
    const rows = effect.getFlag(NS, 'buildMods') ?? [];
    const next = withoutAnswers(rows);
    if (JSON.stringify(next) !== JSON.stringify(rows)) {
      await effect.update({ [`flags.${NS}.buildMods`]: next });
    }
  }
  ui.notifications.info(t('CARL_RPG.Picks.ResetDone', { name: item.name }));
  return true;
}
