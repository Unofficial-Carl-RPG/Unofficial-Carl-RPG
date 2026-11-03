/**
 * Actor sheet: creation, levelling, race and class, rests and skill advancement.
 */
import { levelUp, spendPoints } from '../helpers/level-up.mjs';
import { chooseOrigin, chooseSubclass } from '../helpers/origins.mjs';
import { confirmRest } from '../helpers/rests.mjs';
import { CarlRPGCreationWizard } from './creation-wizard.mjs';
import { attemptAdvance } from '../helpers/advancement.mjs';

export const ActorSheetProgression = (Base) => class ActorSheetProgression extends Base {
  /**
   * Try to advance a skill or spell: a d20 against its rank (see
   * helpers/advancement.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _advanceSkill(event, target) {
    event.preventDefault();
    const item = this._getEmbeddedDocument(target);
    if (item) await attemptAdvance(item);
  }

  /**
   * Mark a skill or spell as one the crawler can try to raise the rank of (or not).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _toggleAdvanceable(event, target) {
    event.preventDefault();
    const item = this._getEmbeddedDocument(target);
    if (!item) return;
    await item.update({ 'system.advanceable': !item.system.advanceable });
  }

  static async _rest(event, target) {
    event.preventDefault();
    await confirmRest(target.dataset.rest, this.actor);
  }

  /**
   * Level the crawler up (see helpers/level-up.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _levelUp(event, target) {
    event.preventDefault();
    await levelUp(this.actor);
  }

  /**
   * Open the character creation wizard (see sheets/creation-wizard.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _createCharacter(event, target) {
    event.preventDefault();
    CarlRPGCreationWizard.open(this.actor);
  }

  /**
   * Choose a subclass (see helpers/origins.mjs).
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The element that was clicked
   */
  static async _chooseSubclass(event, target) {
    await chooseSubclass(this.actor);
  }

  /**
   * Choose a race, then a class (see helpers/origins.mjs).
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _chooseOrigin(event, target) {
    event.preventDefault();
    await chooseOrigin(this.actor);
  }

  /**
   * Open the Spend Points dialog.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _spendPoints(event, target) {
    event.preventDefault();
    await spendPoints(this.actor);
  }
};
