/**
 * Actor sheet: a pet's Upgrades tab and the events editor.
 */

export const ActorSheetUpgrades = (Base) => class ActorSheetUpgrades extends Base {
  /**
   * Change a pet's stored upgrades with a function, then save them. (The shared
   * events editor, helpers/event-editor.mjs, saves through this.) Saving as a GM
   * marks the events the upgrades carry as trusted; see CarlRPGActor#_preUpdate.
   * @param {(system: object) => void} mutate
   */
  async _updateEvents(mutate) {
    if (!this.actor.isOwner) return;
    const system = this.actor.toObject().system;
    mutate(system);
    await this.actor.update({ 'system.upgrades': system.upgrades });
  }

  /** The document whose events these are (the editor's "run now" button uses it). */
  get eventDoc() {
    return this.actor;
  }

  /** A GM approves a pet's upgrade events as they are. */
  static async _approveEvents() {
    if (!game.user.isGM) return;
    await this.actor.update({ 'system.eventsTrusted': true });
  }

  /** New events on a pet start with a trigger that makes sense for a pet. */
  get defaultEventTrigger() {
    return CONFIG.CARL_RPG.petUpgrades.triggers[0];
  }

  /** Save one field of an upgrade (a level, description, change or event field). */
  async _saveUpgradeField(el) {
    const path = el.dataset.path;
    const value =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? Number(el.value) || 0
          : el.value;
    await this._updateEvents((system) => {
      foundry.utils.setProperty(system, path, value);
      // Upgrades are kept in level order.
      if (/^upgrades\.\d+\.rank$/.test(path)) {
        system.upgrades.sort((a, b) => a.rank - b.rank);
      }
      // A different kind of change starts with a value that suits it.
      if (/^upgrades\.\d+\.changes\.\d+\.type$/.test(path)) {
        foundry.utils.setProperty(system, path.replace(/\.type$/, '.value'), '1');
      }
    });
  }

  /** Tick or untick an effect an upgrade unlocks. */
  async _toggleUnlockedEffect(ui, key, on) {
    await this._updateEvents((system) => {
      const list = system.upgrades[ui].unlocksEffects;
      const at = list.indexOf(key);
      if (on && at < 0) list.push(key);
      if (!on && at >= 0) list.splice(at, 1);
    });
  }

  /**
   * Add an upgrade, at level 15 (or the next level after the ones already used).
   * The list is kept in level order.
   */
  static async _addUpgrade() {
    const { defaultLevel, levelStep } = CONFIG.CARL_RPG.petUpgrades;
    await this._updateEvents((system) => {
      const used = system.upgrades.map((u) => u.rank);
      const rank = used.includes(defaultLevel)
        ? Math.max(...used) + levelStep
        : defaultLevel;
      system.upgrades.push({
        id: foundry.utils.randomID(),
        rank,
        description: '',
        changes: [],
        grants: [],
        unlocksEffects: [],
        events: [],
      });
      system.upgrades.sort((a, b) => a.rank - b.rank);
    });
  }

  /** @this CarlRPGActorSheet */
  static async _removeUpgrade(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => system.upgrades.splice(ui, 1));
  }

  /** @this CarlRPGActorSheet */
  static async _addChange(event, target) {
    const ui = Number(target.dataset.ui);
    await this._updateEvents((system) => {
      system.upgrades[ui].changes.push({ type: 'statBonus', value: '1', stat: 'str' });
    });
  }

  /** @this CarlRPGActorSheet */
  static async _removeChange(event, target) {
    const ui = Number(target.dataset.ui);
    const ci = Number(target.dataset.ci);
    await this._updateEvents((system) => system.upgrades[ui].changes.splice(ci, 1));
  }

  /** @this CarlRPGActorSheet */
  static async _removeGrant(event, target) {
    const ui = Number(target.dataset.ui);
    const gi = Number(target.dataset.gi);
    await this._updateEvents((system) => system.upgrades[ui].grants.splice(gi, 1));
  }
};
