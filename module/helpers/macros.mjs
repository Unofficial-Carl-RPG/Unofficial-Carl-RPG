/**
 * Macros for a crawler's common actions: rest, level up, and advance a skill. Each one
 * acts on the crawler whose token is selected, else the user's own crawler. They are
 * called from macros (made from a sheet button or the compendium) as
 * game.carlRpg.macros.rest('short'), .levelUp() and .advance().
 */
import { CarlRPGDialog } from './dialog.mjs';
import { confirmRest } from './rests.mjs';
import { levelUp } from './level-up.mjs';
import { attemptAdvance } from './advancement.mjs';

/** The crawler a macro acts on: the selected token's, else the user's own. */
export function macroCrawler() {
  const selected = canvas.tokens?.controlled?.map((t) => t.actor).find((a) => a?.type === 'crawler');
  if (selected) return selected;
  if (game.user.character?.type === 'crawler') return game.user.character;
  return game.actors.find((a) => a.type === 'crawler' && a.isOwner) ?? null;
}

/** The crawler, or a warning that there isn't one. */
function crawlerOrWarn() {
  const actor = macroCrawler();
  if (!actor) ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.MacroNoCrawler'));
  return actor;
}

export function registerMacros() {
  game.carlRpg ??= {};
  game.carlRpg.macros = {
    /** Take a rest ('short', 'long' or 'full'), after the usual confirmation. */
    rest: async (kind) => {
      const actor = crawlerOrWarn();
      if (actor) await confirmRest(kind, actor);
    },

    /** Level up the crawler (the same as the Level Up button). */
    levelUp: async () => {
      const actor = crawlerOrWarn();
      if (actor) await levelUp(actor);
    },

    /** Try to advance one of the crawler's skills, picked from a list. */
    advance: async () => {
      const actor = crawlerOrWarn();
      if (!actor) return;
      const skills = actor.itemTypes.skill.filter((s) => s.system.advanceable);
      if (!skills.length) {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.MacroNoAdvanceable'));
        return;
      }
      const options = skills
        .map((s) => `<option value="${s.id}">${foundry.utils.escapeHTML(s.name)} (${s.system.rank})</option>`)
        .join('');
      const id = await CarlRPGDialog.prompt({
        window: { title: 'CARL_RPG.Combat.MacroAdvanceTitle' },
        content: `<div class="form-group"><label>${game.i18n.localize('CARL_RPG.Combat.MacroPickSkill')}</label><select name="skill">${options}</select></div>`,
        ok: {
          label: 'CARL_RPG.Combat.MacroAdvanceTitle',
          callback: (event, button) => button.form.elements.skill.value,
        },
      });
      const item = id ? actor.items.get(id) : null;
      if (item) await attemptAdvance(item);
    },
  };
}
