/**
 * The Health Bar in roll data.
 *
 * Every actor's roll data (Actor#getRollData, so damage formulas, Bonus damage dice rows, event
 * amounts and conditions, ranges...) carries `@health.value`, `@health.max` and `@health.lost`:
 * the boxes (health points, for a mob) left, the most there can be, and how many are gone
 * (`max - value`, never below 0). A Barbarian's Rage, "+1 damage for each Health Bar slot you
 * have lost", is a Bonus damage dice row of `@health.lost` with the melee condition.
 *
 * Worked out each time roll data is asked for, so it is the live value when the damage is
 * rolled. Pure, so it can be checked under plain Node.
 */

/**
 * A health bar as roll data: its own fields (`perBox`, `capacity`...) with whole-number
 * `value` and `max` (never below 0) and `lost`. The actor's own object is not changed.
 * @param {{value?: number, max?: number}|null|undefined} health  The actor's `system.health`
 * @returns {{value: number, max: number, lost: number}}
 */
export function healthRollData(health) {
  const whole = (n) => Math.max(0, Math.trunc(Number(n)) || 0);
  const max = whole(health?.max);
  const value = whole(health?.value);
  return { ...health, value, max, lost: Math.max(0, max - value) };
}
