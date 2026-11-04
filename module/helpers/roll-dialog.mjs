/**
 * The roll pop-up.
 *
 * Rolling a skill, spell, gear or item, an ability from the sheet, or a
 * crawler's defending roll against a mob opens a small pop-up first (hold Shift
 * while clicking to skip it and roll with the defaults). It lets the roller:
 *
 *  - add an extra bonus (a number or dice formula typed in: +2, -1, 1d4),
 *  - change which stat the roll uses (when the roll uses one), and
 *  - roll with advantage (two d20, keep the highest) or disadvantage (two d20,
 *    keep the lowest).
 *
 * `promptRoll` asks; `buildFormula` turns the answers into the formula that is
 * rolled; `optionsNote` says what was chosen, for the chat card.
 */
import { CarlRPGDialog } from './dialog.mjs';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => Handlebars.escapeExpression(text);

/** Matches a stat modifier in a formula: @str.mod, @dex.mod, ... */
const STAT_MOD = /@(str|int|con|dex|cha)\.mod/;

/**
 * The stat a formula's modifier uses, if it has one.
 * @param {string} formula
 * @returns {string|null}  'str', 'int', ... or null
 */
export function statOfFormula(formula) {
  return STAT_MOD.exec(formula ?? '')?.[1] ?? null;
}

/**
 * Ask what to change about a roll. Resolves to null if the pop-up is cancelled.
 * @param {object} config
 * @param {string} config.title       The pop-up's title (what is being rolled)
 * @param {string|null} [config.stat] The stat the roll uses by default, or null if
 *   it doesn't use one (then the stat menu isn't shown)
 * @returns {Promise<{bonus: string, stat: string|null, mode: 'normal'|'advantage'|'disadvantage'}|null>}
 */
export async function promptRoll({ title, stat = null, tip = '' }) {
  const abilities = CONFIG.CARL_RPG.abilities;
  const statMenu = stat
    ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.Stat'))}</label>
        <select name="stat">
          <option value="">${esc(
            t('CARL_RPG.RollDialog.StatDefault', { stat: t(abilities[stat]) })
          )}</option>
          ${Object.entries(abilities)
            .filter(([key]) => key !== stat)
            .map(([key, label]) => `<option value="${key}">${esc(t(label))}</option>`)
            .join('')}
        </select>
      </div>`
    : '';

  const content = `<div class="carl-roll-dialog">
    ${tip ? `<p class="roll-tip">${esc(tip)}</p>` : ''}
    <div class="form-group">
      <label>${esc(t('CARL_RPG.RollDialog.Bonus'))}</label>
      <input type="text" name="bonus" placeholder="${esc(
        t('CARL_RPG.RollDialog.BonusPlaceholder')
      )}" autofocus>
    </div>
    ${statMenu}
    <div class="form-group">
      <label>${esc(t('CARL_RPG.RollDialog.Mode'))}</label>
      <select name="mode">
        <option value="normal">${esc(t('CARL_RPG.RollDialog.Normal'))}</option>
        <option value="advantage">${esc(t('CARL_RPG.RollDialog.Advantage'))}</option>
        <option value="disadvantage">${esc(t('CARL_RPG.RollDialog.Disadvantage'))}</option>
      </select>
    </div>
  </div>`;

  const result = await CarlRPGDialog.prompt({
    window: { title },
    content,
    ok: {
      label: t('CARL_RPG.RollDialog.Roll'),
      icon: 'fa-solid fa-dice-d20',
      callback: (event, button) =>
        new foundry.applications.ux.FormDataExtended(button.form).object,
    },
    rejectClose: false,
  });
  if (!result) return null;
  return {
    bonus: String(result.bonus ?? '').trim(),
    stat: result.stat || null,
    mode: result.mode || 'normal',
  };
}

/**
 * Turn a formula and the pop-up's answers into the formula to roll.
 *  - a different stat replaces the stat modifier (@str.mod becomes @dex.mod)
 *  - advantage / disadvantage rolls two d20 and keeps the highest / lowest
 *  - the bonus is added on the end
 * If the result isn't a valid formula (a mistyped bonus), a warning is shown and
 * null is returned.
 * @param {string} formula
 * @param {{bonus?: string, stat?: string|null, mode?: string}} [options]
 * @returns {string|null}
 */
export function buildFormula(formula, { bonus = '', stat = null, mode = 'normal' } = {}) {
  let result = formula;
  if (stat) result = result.replace(new RegExp(STAT_MOD, 'g'), `@${stat}.mod`);
  if (mode === 'advantage' || mode === 'disadvantage') {
    // The first d20 becomes two, keeping one.
    result = result.replace(
      /\d*d20/,
      mode === 'advantage' ? '2d20kh' : '2d20kl'
    );
  }
  if (bonus) {
    // "+2" and "-1" are added as they are; "1d4" or "2" after a "+".
    result += /^[+-]/.test(bonus) ? ` ${bonus}` : ` + ${bonus}`;
  }
  if (!Roll.validate(result)) {
    ui.notifications.warn(t('CARL_RPG.RollDialog.Invalid', { bonus }));
    return null;
  }
  return result;
}

/**
 * What was chosen in the pop-up, as a short line for the chat card ('' if it
 * was all left at the defaults).
 * @param {{bonus?: string, stat?: string|null, mode?: string}} [options]
 * @returns {string}
 */
export function optionsNote(options = {}) {
  return optionsParts(options).join('; ');
}

/**
 * What was chosen in the pop-up, one short phrase for each choice (for badges).
 * @param {{bonus?: string, stat?: string|null, mode?: string}} [options]
 * @returns {string[]}
 */
export function optionsParts({ bonus = '', stat = null, mode = 'normal' } = {}) {
  const parts = [];
  if (mode === 'advantage') parts.push(t('CARL_RPG.RollDialog.Advantage'));
  if (mode === 'disadvantage') parts.push(t('CARL_RPG.RollDialog.Disadvantage'));
  if (bonus) parts.push(t('CARL_RPG.RollDialog.BonusNote', { bonus: esc(bonus) }));
  if (stat) {
    parts.push(
      t('CARL_RPG.RollDialog.StatNote', { stat: t(CONFIG.CARL_RPG.abilities[stat]) })
    );
  }
  return parts;
}
