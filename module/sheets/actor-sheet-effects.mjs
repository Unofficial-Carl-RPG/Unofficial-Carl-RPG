/**
 * Actor sheet: the Effects tab (switching effects on and off, adding them, stacks).
 */

export const ActorSheetEffects = (Base) => class ActorSheetEffects extends Base {
  /** Determines effect parent to pass to helper */
  static async _toggleEffect(event, target) {
    event.preventDefault();
    const effect = this._getEmbeddedDocument(target);
    // Applies the rules: 3 buff limit with a swap prompt, equipment-controlled
    // effects, adding a stack to stackable debuffs (see CarlRPGActiveEffect).
    await effect?.setActive();
  }

  /** Create a new effect directly on the actor (not from an item) and open it. */
  static async _createEffect(event, target) {
    event.preventDefault();
    const kind = target.dataset.kind ?? 'buff';
    const [effect] = await this.actor.createEmbeddedDocuments('ActiveEffect', [
      {
        name: game.i18n.format('CARL_RPG.Effect.NewName', {
          type: game.i18n.localize(CONFIG.CARL_RPG.effectKinds[kind]),
        }),
        img: 'icons/svg/aura.svg',
        origin: this.actor.uuid,
        // New buffs start off until used; debuffs and passives start on.
        disabled: kind === 'buff',
        flags: { 'carl-rpg': { kind, sourceItems: [], stacks: 1 } },
      },
    ]);
    effect?.sheet.render(true);
  }

  /** Add a stack, remove a stack, or remove all stacks of a stackable debuff. */
  static async _effectStacks(event, target) {
    event.preventDefault();
    const effect = this._getEmbeddedDocument(target);
    if (!effect) return;
    switch (target.dataset.mode) {
      case 'add':
        await effect.changeStacks(1);
        break;
      case 'remove':
        await effect.changeStacks(-1);
        break;
      case 'all':
        await effect.removeAllStacks();
        break;
    }
  }
};
