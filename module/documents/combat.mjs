/**
 * Carl RPG combat: there is no initiative. Each round is four phases, and the
 * Combat tracks which phase it is in (stored as a flag):
 *
 *   1. Mobs declare their attacks
 *   2. Crawlers react to the mobs
 *   3. Mob attacks resolve
 *   4. Crawlers get an action phase
 *   5. Cleanup (the end of the round)
 *
 * Within a phase everyone on the acting side goes together, in any order, so
 * there are no individual turns. "Next Turn" in the tracker advances the phase
 * and, after the last phase, starts the next round.
 *
 * Every phase change says which phase it came from and whether it is moving
 * forward or back (`carlPrevPhase` and `carlDirection` in the update options), so
 * the phase events (helpers/events.mjs) know what just ended and don't run
 * again when the GM steps back.
 */
export class CarlRPGCombat extends Combat {
  /** The index (0-3) of the current phase. */
  get phase() {
    return this.getFlag('carl-rpg', 'phase') ?? 0;
  }

  /** The current phase definition: { id, side }. */
  get currentPhase() {
    return CONFIG.CARL_RPG.combatPhases[this.phase];
  }

  /**
   * Which side a combatant is on: 'mob' or 'crawler' (a pet is on its crawler's side).
   * @param {Combatant} combatant
   * @returns {string|undefined}
   */
  static sideOf(combatant) {
    const type = combatant.actor?.type;
    if (!type) return undefined;
    return type === 'mob' ? 'mob' : 'crawler';
  }

  /** Mobs are listed first (they act first), then crawlers, then by name. */
  _sortCombatants(a, b) {
    const order = (c) => (CarlRPGCombat.sideOf(c) === 'mob' ? 0 : 1);
    return order(a) - order(b) || (a.name ?? '').localeCompare(b.name ?? '');
  }

  /**
   * Move to a phase, noting the one it comes from and the direction, for the
   * phase events.
   * @param {number} phase
   * @param {'forward'|'back'} direction
   */
  async #setPhase(phase, direction = 'forward') {
    return this.update(
      { 'flags.carl-rpg.phase': phase },
      { carlPrevPhase: this.phase, carlDirection: direction }
    );
  }

  /** @override Start at the first phase of round 1, with everyone's actions full. */
  async startCombat() {
    await super.startCombat();
    await this.resetActions();
    return this.setFlag('carl-rpg', 'phase', 0);
  }

  /**
   * Refill every combatant's actions. Done when combat starts and in the
   * Cleanup phase of each round.
   */
  async resetActions() {
    const updates = this.combatants
      .filter((c) => c.getFlag('carl-rpg', 'actionsSpent'))
      .map((c) => ({ _id: c.id, 'flags.carl-rpg.actionsSpent': 0 }));
    if (updates.length) await this.updateEmbeddedDocuments('Combatant', updates);
  }

  /** @override "Next Turn" advances to the next phase, then the next round. */
  async nextTurn() {
    if (this.phase >= CONFIG.CARL_RPG.combatPhases.length - 1) {
      return this.nextRound();
    }
    return this.#setPhase(this.phase + 1);
  }

  /** @override "Previous Turn" goes back a phase, then to the last phase of the previous round. */
  async previousTurn() {
    if (this.phase > 0) {
      return this.#setPhase(this.phase - 1, 'back');
    }
    if (this.round > 1) {
      await this.previousRound();
      return this.#setPhase(CONFIG.CARL_RPG.combatPhases.length - 1, 'back');
    }
    return this;
  }

  /** @override A new round always starts at the first phase. */
  async nextRound() {
    await super.nextRound();
    return this.#setPhase(0);
  }

  /** @override */
  async previousRound() {
    await super.previousRound();
    return this.#setPhase(0, 'back');
  }
}

/**
 * Refill every combatant's actions (GM only) and post a note in chat. Used by the
 * tracker's Refill Actions button and by the carlrpg.utils.refillActions macro call.
 * @param {Combat} [combat=game.combat]
 */
export async function refillCombatActions(combat = game.combat) {
  if (!game.user.isGM) {
    ui.notifications.warn('Only the GM can refill actions.');
    return;
  }
  if (!combat) return;
  await combat.resetActions();
  ChatMessage.create({
    content: `<div class="carl-phase-message">${game.i18n.localize('CARL_RPG.Combat.RefillDone')}</div>`,
  });
}
