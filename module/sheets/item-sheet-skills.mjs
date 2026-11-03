/**
 * Item sheet: skills embedded in an item, and the skills a race, class or background grants.
 */

export const ItemSheetEmbeddedSkills = (Base) => class ItemSheetEmbeddedSkills extends Base {
  /**
   * Create a brand new Skill (in the world's Items directory), embed it in this
   * gear or item, and open it for editing.
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _newEmbeddedSkill(event, target) {
    event.preventDefault();
    const skill = await Item.create({
      name: Item.defaultName({ type: 'skill' }),
      type: 'skill',
    });
    if (!skill) return;
    await this._addEmbeddedSkill(skill.uuid);
    skill.sheet.render(true);
  }

  /**
   * Open an embedded skill's own sheet.
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _viewEmbeddedSkill(event, target) {
    const uuid = target.closest('[data-skill-uuid]')?.dataset.skillUuid;
    const skill = uuid ? await fromUuid(uuid) : null;
    skill?.sheet.render(true);
  }

  /**
   * Remove a skill from this gear or item (the skill itself is not deleted).
   *
   * @this CarlRPGItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _removeEmbeddedSkill(event, target) {
    const uuid = target.closest('[data-skill-uuid]')?.dataset.skillUuid;
    if (!uuid) return;
    const skills = (this.item.system.skills ?? []).filter((u) => u !== uuid);
    await this.item.update({ 'system.skills': skills });
  }

  /*  Events tab                                  */

  /**
   * Add a skill (by UUID) to this gear or item's embedded skills, unless it is
   * already there.
   * @param {string} uuid
   */
  async _addEmbeddedSkill(uuid) {
    const current = this.item.system.skills ?? [];
    if (current.includes(uuid)) return;
    await this.item.update({ 'system.skills': [...current, uuid] });
  }

  /** @this CarlRPGItemSheet */
  static async _removeGrantedSkill(event, target) {
    const gi = Number(target.dataset.gi);
    await this._updateEvents((system) => system.grantedSkills.splice(gi, 1));
  }
};
