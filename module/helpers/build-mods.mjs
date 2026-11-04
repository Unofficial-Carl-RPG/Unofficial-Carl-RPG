/**
 * Race and class build benefits, given by effects.
 *
 * Numbers that simply add up are normal effect modifiers (CARL_RPG.effectModifiers):
 *  - advStr, advInt, ...    above 0: advantage on that stat's checks and on rolls of
 *                           skills (and weapons that use a skill) that use the stat
 *  - skillStr, skillInt...  +N to the roll of every skill that uses that stat
 *                           (a negative number is a detriment; the rank is untouched)
 *  - step                   added to the crawler's Step
 *
 * Benefits that need something picked are rows in the effect's flags, `buildMods`,
 * a list of `{ kind, target, value }` (edited on the effect sheet):
 *  - checkDie    `value` is a die ("1d4"), added to the actor's own checks against
 *                `target` (Evade or a stat): the defending roll and a stat check
 *  - healthStat  `target` is the stat whose modifier a health box is worth, instead
 *                of Constitution (the last one wins)
 *  - statCap     `value` is the most `target` can enhance up to (the lowest wins)
 * Only effects that are on count.
 */
const NS = 'carl-rpg';

const cap = (stat) => stat.charAt(0).toUpperCase() + stat.slice(1);
const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** The rows of every effect on the actor that is on. */
export function buildModsOf(actor) {
  const rows = [];
  for (const effect of actor?.effects ?? []) {
    if (effect.disabled || effect.isSuppressed) continue;
    for (const row of effect.getFlag?.(NS, 'buildMods') ?? []) {
      if (row && row.kind in CONFIG.CARL_RPG.buildKinds) rows.push(row);
    }
  }
  return rows;
}

/** Whether text is one die ("d6", "1d4"). */
export const validDie = (text) => /^\d*d\d+$/i.test(String(text ?? '').trim());

/** The stat a health box is worth the modifier of, or null for Constitution. */
export function healthStatOf(actor) {
  const rows = buildModsOf(actor).filter(
    (row) => row.kind === 'healthStat' && row.target in CONFIG.CARL_RPG.abilities
  );
  return rows.length ? rows.at(-1).target : null;
}

/** The most a stat can be enhanced to, or null for no cap. */
export function statCapOf(actor, stat) {
  const caps = buildModsOf(actor)
    .filter(
      (row) =>
        row.kind === 'statCap' && row.target === stat && String(row.value ?? '').trim() !== ''
    )
    .map((row) => Number(row.value))
    .filter((n) => Number.isFinite(n));
  return caps.length ? Math.min(...caps) : null;
}

/**
 * What a roll gets from the actor's build.
 * @param {Actor} actor
 * @param {object} [roll]
 * @param {string|null} [roll.stat]    The stat the roll uses
 * @param {string|null} [roll.target]  What the roll is a check against (Evade or a stat)
 * @param {boolean} [roll.skill]       Whether it is a skill's roll
 * @returns {{advantage: boolean, dice: string[], flat: number}}
 */
export function rollBenefits(actor, { stat = null, target = null, skill = false } = {}) {
  const bonuses = actor?.system?.bonuses ?? {};
  const abilities = CONFIG.CARL_RPG.abilities;
  const own = stat in abilities;
  return {
    advantage: own && (Number(bonuses[`adv${cap(stat)}`]) || 0) > 0,
    dice: target
      ? buildModsOf(actor)
          .filter((row) => row.kind === 'checkDie' && row.target === target && validDie(row.value))
          .map((row) => String(row.value).trim())
      : [],
    flat: skill && own ? Math.trunc(Number(bonuses[`skill${cap(stat)}`]) || 0) : 0,
  };
}

/**
 * Put a roll's benefits into the roll pop-up's answers: advantage (which a chosen
 * disadvantage cancels), and the dice and flat bonus added to the extra bonus.
 * @param {{bonus?: string, stat?: string|null, mode?: string}} options
 * @param {{advantage: boolean, dice: string[], flat: number}} benefits
 */
export function applyBenefits(options, { advantage, dice, flat }) {
  const out = { ...options };
  let mode = out.mode ?? 'normal';
  const auto = [];
  if (advantage) {
    if (mode === 'disadvantage') {
      mode = 'normal';
      auto.push(t('CARL_RPG.Build.Cancelled'));
    } else mode = 'advantage';
  }
  let bonus = String(out.bonus ?? '').trim();
  for (const term of [...dice, ...(flat ? [String(flat)] : [])]) {
    bonus = bonus ? `${bonus}${/^[+-]/.test(term) ? ' ' : ' + '}${term}` : term;
  }
  return { ...out, mode, bonus, auto };
}
