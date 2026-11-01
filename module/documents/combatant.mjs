import { updateWithRelay } from '../helpers/relay.mjs';
import { logActions } from '../helpers/change-log.mjs';

const NS = 'carl-rpg';

/**
 * A combatant with an action pool. Everyone gets a number of generic actions
 * each round: the maximum comes from the actor, and how many have been spent
 * this round is stored on the combatant. Cleanup refills everyone (see
 * CarlRPGCombat#resetActions).
 */
export class CarlRPGCombatant extends Combatant {
  /**
   * Remember how many actions were spent before an update, so the Action Spent
   * event can tell when the number went up (see helpers/events.mjs).
   * @override
   */
  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if (allowed === false) return false;
    options.carlPrevSpent = Number(this.getFlag(NS, 'actionsSpent')) || 0;
  }

  /**
   * The most actions this combatant has per round. Bosses (actors flagged
   * `actions.perCrawler`) get one per crawler in the encounter, counting
   * crawlers that have been defeated, plus any bonus from effects.
   * @returns {number}
   */
  get maxActions() {
    const actions = this.actor?.system?.actions;
    if (!actions) return 0;
    if (actions.perCrawler) {
      const crawlers =
        this.parent?.combatants.filter((c) => c.actor?.type === 'crawler')
          .length ?? 0;
      return Math.max(0, crawlers + (this.actor.system.bonuses?.actions ?? 0));
    }
    return actions.max ?? 0;
  }

  /** Actions spent this round (never more than the maximum). */
  get actionsSpent() {
    const spent = Number(this.getFlag(NS, 'actionsSpent')) || 0;
    return Math.min(Math.max(spent, 0), this.maxActions);
  }

  /** Actions still available this round. */
  get actionsLeft() {
    return this.maxActions - this.actionsSpent;
  }

  /**
   * Set how many actions are left (kept between 0 and the maximum).
   * @param {number} left
   */
  async setActionsLeft(left) {
    left = Math.min(Math.max(Math.trunc(left), 0), this.maxActions);
    const spent = this.maxActions - left;
    if (spent === (Number(this.getFlag(NS, 'actionsSpent')) || 0)) return;
    // An Observer using an item can't change this themselves: the GM's client
    // does it for them (see helpers/relay.mjs).
    await updateWithRelay(this, { [`flags.${NS}.actionsSpent`]: spent });
    logActions(this.actor, spent, left);
  }

  /** Spend one action. */
  async spendAction() {
    await this.setActionsLeft(this.actionsLeft - 1);
  }

  /** Give one action back. */
  async restoreAction() {
    await this.setActionsLeft(this.actionsLeft + 1);
  }
}
