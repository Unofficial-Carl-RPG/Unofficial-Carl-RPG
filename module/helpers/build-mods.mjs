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
 *  - skillCap    raises the rank cap of skills and spells from 15 to 20 (see skill-cap.mjs);
 *                `target` is the scope: `all`, `skill` (`value` is its Identifier, `name`
 *                its name for display), `tag` (`value` is the tag) or `stat` (every skill and
 *                spell using one of `stats`; `skillKind` narrows it to skills or spells)
 *  - skillRankBonus   adds `amount` (a whole number, negative allowed) to the effective rank of
 *                the skills it covers, same scope as Skill cap (see skill-rank.mjs); rows add together.
 *                `min` (optional): a penalty does not drop a stored rank of 1 or more below it
 *  - statSplit   `points` for the player to split between the stats in `stats` (all five when
 *                empty); `split` holds the player's answer, `repick` ('floor': can be redone
 *                once per floor) and `usedFloor` the floor it was last redone on (see picks.mjs)
 *  - a scoped kind whose scope is `pick` covers only the skills the player picked: `count` of
 *                them, from those matching the optional `tag`, `stat` and `skillKind`; `picks`
 *                is [{value: Identifier, name}] (see picks.mjs)
 *  - rankDamageBonus, rankDamageStep   move the dice of the @rankDamage scalar (see
 *                rank-damage.mjs): `target` and `value` are the scope like Skill cap's,
 *                `amount` a whole number (negative allowed); rows add together
 *  - damageDice, damageStat   extra damage dice on the attacks a scope covers, and swapping
 *                the stat a damage formula adds (same scopes; see build-damage.mjs)
 * Only effects that are on count.
 */
const NS = 'carl-rpg';

const cap = (stat) => stat.charAt(0).toUpperCase() + stat.slice(1);
const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/**
 * The rows of every effect on the actor that is on.
 * @param {Actor|null} actor
 * @param {{stored?: boolean}} [options]  `stored`: judge an effect an upgrade holds back by
 *   stored ranks instead of effective ones (used to work the effective rank out itself)
 */
export function* eachBuildRow(actor, { stored = false } = {}) {
  for (const effect of actor?.effects ?? []) {
    if (effect.disabled) continue;
    if (stored && effect.lockedRank ? effect.lockedRank({ stored: true }) !== null : effect.isSuppressed) {
      continue;
    }
    for (const row of effect.getFlag?.(NS, 'buildMods') ?? []) {
      if (row && row.kind in CONFIG.CARL_RPG.buildKinds) yield { row, effect };
    }
  }
}

/** Just the rows (see eachBuildRow). */
export function buildModsOf(actor, options = {}) {
  return Array.from(eachBuildRow(actor, options), ({ row }) => row);
}

/** The build benefit kinds that cover skills and spells by a scope (all, one skill or a tag). */
export const isScopedKind = (kind) =>
  [
    'skillCap',
    'skillRankBonus',
    'rankDamageBonus',
    'rankDamageStep',
    'damageDice',
    'damageStat',
  ].includes(kind);

/** The kinds that also hold a whole number, `amount`. */
export const hasAmount = (kind) =>
  kind === 'skillRankBonus' || kind === 'rankDamageBonus' || kind === 'rankDamageStep';

/** A row's amount: a whole number, 1 when it has none yet. */
const amountOf = (n) => (n == null ? 1 : Math.trunc(Number(n)) || 0);

/** Whether text is one die ("d6", "1d4"). */
export const validDie = (text) => /^\d*d\d+$/i.test(String(text ?? '').trim());

const abilityKeys = () => Object.keys(CONFIG.CARL_RPG.abilities);

/** The fields of a scoped row whose scope is Player picks, tidied; `before` is the row as saved. */
function cleanPickFields(row, before) {
  const count = Math.trunc(Number(row.count));
  const stat = String(row.stat ?? '').trim();
  const skillKind = String(row.skillKind ?? '').trim();
  return {
    count: Number.isFinite(count) && count >= 1 ? count : 1,
    tag: String(row.tag ?? '').trim(),
    stat: abilityKeys().includes(stat) ? stat : '',
    skillKind: skillKind in CONFIG.CARL_RPG.pickKinds ? skillKind : '',
    picks: Array.isArray(before?.picks) ? before.picks : [],
  };
}

/** The fields of a scoped row whose scope is By stat, tidied: the stats ticked, and its kind. */
function cleanScopeStats(row) {
  const skillKind = String(row.skillKind ?? '').trim();
  return {
    stats: abilityKeys().filter((key) => (row.stats ?? []).includes(key)),
    skillKind: skillKind in CONFIG.CARL_RPG.pickKinds ? skillKind : '',
  };
}

/** The stats a Stat split row offers: the ones listed, else all five. */
export function splitStats(row) {
  const listed = abilityKeys().filter((key) => (row?.stats ?? []).includes(key));
  return listed.length ? listed : abilityKeys();
}

/** The points a Stat split row hands out: a whole number of 1 or more. */
export const splitPoints = (row) => Math.max(1, Math.trunc(Number(row?.points)) || 1);

/**
 * A Stat split row's answer tidied: whole numbers of 0 or more for the stats it offers, and
 * never more than its points in all (later stats lose the excess).
 * @param {object} row
 * @param {object} [raw]  The answer to tidy; the row's own by default
 * @returns {Object<string, number>}  Only the stats that got points
 */
export function cleanSplit(row, raw = row?.split) {
  const out = {};
  let left = splitPoints(row);
  for (const key of splitStats(row)) {
    const take = Math.min(Math.max(0, Math.trunc(Number(raw?.[key])) || 0), left);
    if (take) out[key] = take;
    left -= take;
  }
  return out;
}

/** The points of a Stat split row that have been handed out. */
export const splitTotal = (row) => Object.values(cleanSplit(row)).reduce((a, b) => a + b, 0);

/**
 * What every Stat split row adds to each stat (it goes into the stat's Enhanced value).
 * @param {Actor|null} actor
 * @returns {Object<string, number>}
 */
export function statSplitOf(actor) {
  const out = Object.fromEntries(abilityKeys().map((key) => [key, 0]));
  for (const row of buildModsOf(actor)) {
    if (row.kind !== 'statSplit') continue;
    for (const [key, n] of Object.entries(cleanSplit(row))) out[key] += n;
  }
  return out;
}

/** The fields of a Bonus damage dice row, tidied (a new row starts as 1d4). */
function cleanDiceFields(row) {
  const first = String(row.bonusType ?? '').trim();
  const when = String(row.when ?? '').trim();
  const feet = Number(String(row.feet ?? '').trim());
  return {
    dice: row.dice === undefined ? '1d4' : String(row.dice ?? '').trim(),
    bonusType: first,
    bonusAlso: first ? String(row.bonusAlso ?? '').trim() : '',
    when,
    // (a "within" condition starts at 5 ft, melee)
    ...(when === 'within' ? { feet: feet > 0 ? feet : 5 } : {}),
  };
}

/** The fields of a Damage stat row, tidied (a new row swaps Str for Cha). */
function cleanStatFields(row) {
  const stats = abilityKeys();
  return {
    from: stats.includes(row.from) ? row.from : 'str',
    to: stats.includes(row.to) ? row.to : 'cha',
  };
}

/** The minimum rank a Skill rank bonus row holds: a whole number, 0 for none. */
export const rankMinOf = (row) => Math.max(0, Math.trunc(Number(row?.min)) || 0);

/** The extra fields a scoped row of this kind keeps (none for the other kinds). */
export function kindFields(row) {
  if (row?.kind === 'damageDice') return cleanDiceFields(row);
  if (row?.kind === 'damageStat') return cleanStatFields(row);
  if (row?.kind === 'skillRankBonus') return rankMinOf(row) ? { min: rankMinOf(row) } : {};
  return {};
}

/**
 * A build benefit row tidied for saving. A scoped row's (Skill cap, Skill rank bonus, Rank
 * damage bonus or Rank damage step) target is its scope (all,
 * skill or tag), its value the Identifier or the tag, and `name` the dropped skill's
 * name. Any other row's target is Evade or a stat. Changing a row's kind or scope
 * clears what no longer fits.
 * @param {{kind: string, target?: string, value?: string, name?: string}} row
 * @param {object|null} [before]  The row as it was saved
 */
export function cleanBuildRow(row, before = null) {
  const { kind } = row;
  const text = String(row.value ?? '').trim();
  if (isScopedKind(kind)) {
    const scope = row.target in CONFIG.CARL_RPG.skillCapScopes ? row.target : 'all';
    const same = isScopedKind(before?.kind) && before.target === scope;
    const value = ['all', 'pick', 'stat'].includes(scope) || !same ? '' : text;
    const name = scope === 'skill' && value ? String(row.name ?? '').trim() : '';
    return {
      kind,
      target: scope,
      value,
      ...(name ? { name } : {}),
      ...(hasAmount(kind) ? { amount: amountOf(row.amount) } : {}),
      ...(scope === 'pick' ? cleanPickFields(row, same ? before : null) : {}),
      ...(scope === 'stat' ? cleanScopeStats(row) : {}),
      ...kindFields(row),
    };
  }
  if (kind === 'statSplit') {
    const asked = abilityKeys().filter((key) => (row.stats ?? []).includes(key));
    const kept = before?.kind === 'statSplit';
    const out = {
      kind,
      target: '',
      value: '',
      points: row.points === undefined ? 2 : splitPoints(row),
      stats: asked.length === abilityKeys().length ? [] : asked,
      repick: row.repick in CONFIG.CARL_RPG.repickRules ? row.repick : 'never',
      split: kept ? before.split ?? {} : {},
    };
    if (kept && before.usedFloor !== undefined && before.usedFloor !== null) out.usedFloor = before.usedFloor;
    return out;
  }
  const own = row.target === 'evade' || row.target in CONFIG.CARL_RPG.abilities;
  return {
    kind,
    target: own ? row.target : 'evade',
    value: own && !isScopedKind(before?.kind) ? text : '',
  };
}

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
