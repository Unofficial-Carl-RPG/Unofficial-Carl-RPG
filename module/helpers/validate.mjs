/**
 * The GM's Validate button: looks for broken links in the world and lists what it
 * finds. It changes nothing. Checks: a background's skills that can't be found, a
 * loot box's rewards and guaranteed items that can't be found, an event's actions that
 * point at something that can't be found, and an actor's effects whose source item is
 * gone.
 */
import { CarlRPGDialog } from './dialog.mjs';

const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

async function isMissing(uuid) {
  return !(await fromUuid(uuid));
}

/** Every problem in the world, as a line of text each. */
export async function findProblems() {
  const problems = [];

  for (const item of game.items) {
    if (item.type === 'background') {
      for (const uuid of item.system.skills ?? []) {
        if (uuid && (await isMissing(uuid))) {
          problems.push(`${item.name}: a skill it names can't be found (${uuid})`);
        }
      }
    }

    if (item.type === 'lootBox') {
      const rows = [...(item.system.rewards ?? []), ...(item.system.guaranteed ?? [])];
      for (const row of rows) {
        if (row.uuid && (await isMissing(row.uuid))) {
          problems.push(`${item.name}: a reward can't be found (${row.uuid})`);
        }
      }
    }

    for (const event of item.system.events ?? []) {
      for (const action of event.actions ?? []) {
        if (action.uuid && (await isMissing(action.uuid))) {
          problems.push(`${item.name}: an event action can't find its target (${action.uuid})`);
        }
      }
    }
  }

  for (const actor of game.actors) {
    const ids = new Set(actor.items.map((i) => i.id));
    for (const effect of actor.effects) {
      const sources = effect.sourceItems ?? [];
      if (sources.length && !sources.some((id) => ids.has(id))) {
        problems.push(`${actor.name}: the effect "${effect.name}" has no source item`);
      }
    }
  }

  return problems;
}

/** The GM's Validate button: show what was found, or that nothing was. */
export async function onValidateClick() {
  if (!game.user.isGM) return;
  const problems = await findProblems();
  if (!problems.length) {
    ui.notifications.info(game.i18n.localize('CARL_RPG.Combat.ValidateNone'));
    return;
  }
  const list = problems.map((p) => `<li>${esc(p)}</li>`).join('');
  await CarlRPGDialog.confirm({
    window: { title: 'CARL_RPG.Combat.ValidateTitle' },
    content: `<ul class="carl-validate">${list}</ul>`,
    yes: { label: 'CARL_RPG.Combat.ValidateClose' },
    no: { label: 'CARL_RPG.Combat.ValidateClose' },
    rejectClose: false,
  });
}

/**
 * A system settings menu that runs the check. It has no window of its own: opening it
 * runs the check and shows the result.
 */
class CarlRPGValidateMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    await onValidateClick();
    return this;
  }
}

/** Register the Validate World Items button in the system settings (GM only). */
export function registerValidateMenu() {
  game.settings.registerMenu('carl-rpg', 'validateWorld', {
    name: 'CARL_RPG.Combat.ValidateWorldItems',
    label: 'CARL_RPG.Combat.ValidateWorldItems',
    hint: 'CARL_RPG.Combat.ValidateSetting',
    icon: 'fas fa-check',
    type: CarlRPGValidateMenu,
    restricted: true,
  });
}
