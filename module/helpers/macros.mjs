/**
 * Macros for a crawler's common actions: rest, level up, and advance a skill. Each one
 * acts on the crawler whose token is selected, else the user's own crawler. They are
 * called from macros (made from a sheet button or the compendium) as
 * game.carlRpg.macros.rest('short'), .levelUp() and .advance().
 */
import { CarlRPGDialog } from './dialog.mjs';
import { rankOf } from './skill-rank.mjs';
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

/**
 * Dropping a crawler's Rest or Level Up button on a hotbar slot makes a macro for it
 * in that slot (see the drag data set on the sheet).
 */
function registerHotbarDrop() {
  Hooks.on('hotbarDrop', (bar, data, slot) => {
    if (!data?.carlMacro) return true;
    createHotbarMacro(data.carlMacro, slot).catch((err) => {
      console.error('carl-rpg | making a hotbar macro failed', err);
    });
    return false;
  });
}

async function createHotbarMacro(key, slot) {
  const [kind, kindOf] = key.split(':');
  const isRest = kind === 'rest';
  const command = isRest
    ? `game.carlRpg.macros.rest('${kindOf}');`
    : 'game.carlRpg.macros.levelUp();';
  const name = isRest
    ? game.i18n.format('CARL_RPG.Combat.MacroRestName', { kind: game.i18n.localize(`CARL_RPG.Rest.Name.${kindOf}`) })
    : game.i18n.localize('CARL_RPG.Combat.MacroLevelUpName');
  const macro = await Macro.create({ name, type: 'script', command, img: 'icons/svg/aura.svg' });
  await game.user.assignHotbarMacro(macro, slot);
}

export function registerMacros() {
  registerHotbarDrop();
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
        .map((s) => `<option value="${s.id}">${foundry.utils.escapeHTML(s.name)} (${rankOf(s.system)})</option>`)
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
