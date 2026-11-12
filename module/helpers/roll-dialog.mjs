
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
 * An item with a ranged cost (see data/costs.mjs) also asks how much to pay, in the same
 * pop-up; an item that doesn't roll gets the pop-up with just those amounts.
 *
 * `promptRoll` asks; `buildFormula` turns the answers into the formula that is
 * rolled; `optionsNote` says what was chosen, for the chat card.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { NO_ALSO_TYPE } from './damage-options.mjs';

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
 * @param {boolean} [config.rolls]    False for an item that doesn't roll: only the
 *   cost amounts are asked
 * @param {{resource: string, min: number, max: number, key?: string, label?: string}[]} [config.costs]
 *   The costs the roller picks an amount for (`key` is what the answer is filed under, `label`
 *   what the amount is called, for ammunition)
 * @param {{id: string, name: string}[]} [config.rollMods]  The Roll Modifiers that can be chosen
 * @param {boolean} [config.surpriseOption]  Whether to offer the Surprise attack tick
 * @param {{id: string, label: string}[]} [config.shapes]  The shapes an area can be placed as
 *   (offered when there is more than one; the first is the default)
 * The damage has a pop-up of its own once the roll is made (see promptDamage).
 * @returns {Promise<{bonus: string, stat: string|null, mode: 'normal'|'advantage'|'disadvantage',
 *   costs: Object<string, number>, rollMod: string, surprise: boolean, shape: string}|null>}
 */
export async function promptRoll({
  title,
  stat = null,
  tip = '',
  costs = [],
  rolls = true,
  rollMods = [],
  surpriseOption = false,
  shapes = [],
}) {
  const abilities = CONFIG.CARL_RPG.abilities;
  const statMenu = stat
    ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.Stat'))}</label>
        <select name="stat">
          <option value="">${esc(
            t('CARL_RPG.RollDialog.StatDefault', {
              stat: t(CONFIG.CARL_RPG.skillStats[stat] ?? abilities[stat]),
            })
          )}</option>
          ${Object.entries(abilities)
            .filter(([key]) => key !== stat)
            .map(([key, label]) => `<option value="${key}">${esc(t(label))}</option>`)
            .join('')}
        </select>
      </div>`
    : '';

  const costFields = costs
    .map(
      (cost, index) => `<div class="form-group">
        <label>${esc(
          t('CARL_RPG.RollDialog.Pay', {
            resource:
              cost.label ??
              t(`CARL_RPG.Costs.${cost.resource === 'junk' ? 'Junk' : cost.resource === 'uses' ? 'Uses' : 'Mana'}`),
            min: cost.min,
            max: cost.max,
          })
        )}</label>
        <input type="number" name="cost_${cost.key ?? cost.resource}" value="${cost.min}" min="${cost.min}" max="${cost.max}" step="1"${
          !rolls && index === 0 ? ' autofocus' : ''
        }>
      </div>`
    )
    .join('');

  // One Roll Modifier at most, and a tick for a Surprise attack when one of them cares.
  const modFields =
    (rollMods.length
      ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.RollMod'))}</label>
        <select name="rollMod">
          <option value="">${esc(t('CARL_RPG.RollDialog.NoRollMod'))}</option>
          ${rollMods.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
        </select>
      </div>`
      : '') +
    (surpriseOption
      ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.Surprise'))}</label>
        <input type="checkbox" name="surprise">
      </div>`
      : '');

  // An area item with several shapes (upgrades can add them) asks which one to place.
  const shapeFields =
    shapes.length > 1
      ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.Shape'))}</label>
        <select name="shape">
          ${shapes.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}
        </select>
      </div>`
      : '';

  const rollFields = rolls
    ? `<div class="form-group">
      <label>${esc(t('CARL_RPG.RollDialog.Bonus'))}</label>
      <input type="text" name="bonus" placeholder="${esc(
        t('CARL_RPG.RollDialog.BonusPlaceholder')
      )}"${costs.length ? '' : ' autofocus'}>
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
    ${modFields}`
    : '';

  const content = `<div class="carl-roll-dialog">
    ${tip ? `<p class="roll-tip">${esc(tip)}</p>` : ''}
    ${costFields}
    ${shapeFields}
    ${rollFields}
  </div>`;

  const result = await CarlRPGDialog.prompt({
    window: { title },
    content,
    ok: {
      label: rolls ? t('CARL_RPG.RollDialog.Roll') : t('CARL_RPG.RollDialog.Use'),
      icon: rolls ? 'fa-solid fa-dice-d20' : 'fa-solid fa-wand-sparkles',
      callback: (event, button) =>
        new foundry.applications.ux.FormDataExtended(button.form).object,
    },
    rejectClose: false,
  });
  if (!result) return null;

  // Each amount is held to its range (a blank or mistyped one pays the least).
  const paid = {};
  for (const cost of costs) {
    const id = cost.key ?? cost.resource;
    const typed = Math.floor(Number(result[`cost_${id}`]));
    paid[id] = Number.isFinite(typed)
      ? Math.min(cost.max, Math.max(cost.min, typed))
      : cost.min;
  }
  return {
    bonus: String(result.bonus ?? '').trim(),
    stat: result.stat || null,
    mode: result.mode || 'normal',
    costs: paid,
    rollMod: rollMods.find((m) => m.id === result.rollMod)?.id ?? '',
    surprise: !!result.surprise,
    shape: shapes.find((s) => s.id === result.shape)?.id ?? '',
  };
}

/**
 * Ask what to change about a damage roll (the card's Roll Damage button). Shift skips it.
 * Resolves to null if the pop-up is cancelled.
 * @param {object} config
 * @param {string} config.title
 * @param {string} [config.tip]
 * @param {{id: string, name: string, stun: boolean}[]} [config.damageEffects]  The Damage
 *   Effects that can be chosen (`stun`: the effect offers an "instead of damage" option)
 * @param {{id: string, from: string, to: string}[]} [config.damageStats]  The stat swaps the
 *   damage can use (a build benefit's, Cha for Str); "As written" is always the first choice
 * @param {boolean} [config.meleeOption]  Whether to offer the melee range tick (a damage multiplier needs it)
 * @param {{id: string, label: string}[]} [config.types]  The damage types to pick from
 * @param {{type: string, also: string, armorPiercing: boolean}} [config.current]  What the
 *   item's damage uses now ("As written")
 * @returns {Promise<{bonus: string, multiplier: string, type: string, also: string, ignoreDR: boolean,
 *   damageEffect: string, option: boolean, damageStat: string, melee: boolean}|null>}
 */
export async function promptDamage({
  title,
  tip = '',
  damageEffects = [],
  damageStats = [],
  meleeOption = false,
  types = [],
  current = { type: '', also: '', armorPiercing: false },
  mob = false,
}) {
  const abilities = CONFIG.CARL_RPG.abilities;
  const asWritten = (id) => {
    const name = types.find((x) => x.id === id)?.label;
    return name
      ? t('CARL_RPG.DamageDialog.AsWrittenType', { type: name })
      : t('CARL_RPG.DamageDialog.AsWritten');
  };
  const typeOptions = types.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
  const typeFields = types.length
    ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.DamageDialog.Type'))}</label>
        <select name="type">
          <option value="">${esc(asWritten(current.type))}</option>
          ${typeOptions}
        </select>
      </div>
      ${
        mob
          ? ''
          : `<div class="form-group">
        <label>${esc(t('CARL_RPG.DamageDialog.Also'))}</label>
        <select name="also">
          <option value="">${esc(asWritten(current.also))}</option>
          <option value="${NO_ALSO_TYPE}">${esc(t('CARL_RPG.DamageDialog.NoAlso'))}</option>
          ${typeOptions}
        </select>
      </div>`
      }`
    : '';

  // A mob's attack has no Damage Effects, stat swaps or melee ticks.
  const extras = mob
    ? ''
    : damageStatField(damageStats, abilities) + damageEffectFields(damageEffects) + meleeField(meleeOption);

  const content = `<div class="carl-roll-dialog">
    ${tip ? `<p class="roll-tip">${esc(tip)}</p>` : ''}
    <div class="form-group">
      <label>${esc(t('CARL_RPG.DamageDialog.Bonus'))}</label>
      <input type="text" name="bonus" placeholder="${esc(t('CARL_RPG.DamageDialog.BonusPlaceholder'))}" autofocus>
    </div>
    <div class="form-group">
      <label>${esc(t('CARL_RPG.DamageDialog.Multiplier'))}</label>
      <input type="number" name="multiplier" min="0" step="0.5" placeholder="${esc(t('CARL_RPG.DamageDialog.MultiplierPlaceholder'))}">
    </div>
    ${typeFields}
    <div class="form-group">
      <label>${esc(t('CARL_RPG.DamageDialog.IgnoreDR'))}</label>
      <input type="checkbox" name="ignoreDR"${current.armorPiercing ? ' checked' : ''}>
    </div>
    ${extras}
  </div>`;

  const result = await CarlRPGDialog.prompt({
    window: { title },
    content,
    ok: {
      label: t('CARL_RPG.DamageDialog.Roll'),
      icon: 'fa-solid fa-burst',
      callback: (event, button) =>
        new foundry.applications.ux.FormDataExtended(button.form).object,
    },
    rejectClose: false,
  });
  if (!result) return null;

  const effect = damageEffects.find((e) => e.id === result.damageEffect);
  return {
    bonus: String(result.bonus ?? '').trim(),
    multiplier: String(result.multiplier ?? '').trim(),
    type: types.find((x) => x.id === result.type)?.id ?? '',
    also:
      result.also === NO_ALSO_TYPE ? NO_ALSO_TYPE : (types.find((x) => x.id === result.also)?.id ?? ''),
    ignoreDR: !!result.ignoreDR,
    damageEffect: effect?.id ?? '',
    option: !!(effect?.stun && result[`stun_${effect.id}`]),
    damageStat: damageStats.find((s) => s.id === result.damageStat)?.id ?? '',
    melee: !!result.melee,
  };
}

/** A build benefit that swaps the stat the damage adds (Cha for Str). */
function damageStatField(damageStats, abilities) {
  return damageStats.length
    ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.DamageStat'))}</label>
        <select name="damageStat">
          <option value="">${esc(t('CARL_RPG.RollDialog.DamageStatAsWritten'))}</option>
          ${damageStats
            .map(
              (s) =>
                `<option value="${esc(s.id)}">${esc(
                  t('CARL_RPG.RollDialog.DamageStatOption', {
                    to: t(abilities[s.to]),
                    from: t(abilities[s.from]),
                  })
                )}</option>`
            )
            .join('')}
        </select>
      </div>`
    : '';
}

/** One Damage Effect at most; an effect with an "instead of damage" option adds a tick. */
function damageEffectFields(damageEffects) {
  return damageEffects.length
    ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.DamageEffect'))}</label>
        <select name="damageEffect">
          <option value="">${esc(t('CARL_RPG.RollDialog.NoDamageEffect'))}</option>
          ${damageEffects.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}
        </select>
      </div>
      ${damageEffects
        .filter((e) => e.stun)
        .map(
          (e) => `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.StunInstead', { name: e.name }))}</label>
        <input type="checkbox" name="stun_${esc(e.id)}">
      </div>`
        )
        .join('')}`
    : '';
}

/** The melee range tick (a damage multiplier or bonus dice row can need it). */
function meleeField(meleeOption) {
  return meleeOption
    ? `<div class="form-group">
        <label>${esc(t('CARL_RPG.RollDialog.Melee'))}</label>
        <input type="checkbox" name="melee">
      </div>`
    : '';
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
  if (stat) {
    // A roll with no stat of its own (a skill whose stat is None) takes the chosen one after its d20.
    result = STAT_MOD.test(result)
      ? result.replace(new RegExp(STAT_MOD, 'g'), () => `@${stat}.mod`)
      : result.replace(/(\d*d20)/, (d20) => `${d20} + @${stat}.mod`);
  }
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
export function optionsParts({ bonus = '', stat = null, mode = 'normal', auto = [] } = {}) {
  const parts = [];
  if (mode === 'advantage') parts.push(t('CARL_RPG.RollDialog.Advantage'));
  if (mode === 'disadvantage') parts.push(t('CARL_RPG.RollDialog.Disadvantage'));
  if (bonus) parts.push(t('CARL_RPG.RollDialog.BonusNote', { bonus: esc(bonus) }));
  if (stat) {
    parts.push(
      t('CARL_RPG.RollDialog.StatNote', { stat: t(CONFIG.CARL_RPG.abilities[stat]) })
    );
  }
  parts.push(...auto);
  return parts;
}
