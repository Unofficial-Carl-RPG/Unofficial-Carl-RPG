/**
 * The stat of a skill, spell or mob ability. 'none' (the default) adds no stat modifier to
 * its roll; otherwise it is one of the five stats.
 */
export const NO_STAT = 'none';

/** Whether a stat value names a real stat (not blank and not None). */
export function hasStat(stat) {
  return !!stat && stat !== NO_STAT;
}

/**
 * The roll of a skill, spell or mob ability: 1d20 + the stat's modifier (left out when the
 * stat is None) + the rank, plus an optional flat roll bonus.
 * @param {string} stat
 * @param {number} rank
 * @param {number} [bonus]
 * @returns {string}
 */
export function skillRollFormula(stat, rank, bonus = 0) {
  const mod = hasStat(stat) ? ` + @${stat}.mod` : '';
  const extra = bonus ? ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}` : '';
  return `1d20${mod} + ${rank}${extra}`;
}
