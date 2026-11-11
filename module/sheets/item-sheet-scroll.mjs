/**
 * Item sheet: putting a spell on a Spell Scroll (see helpers/spell-scroll.mjs).
 */
import { assignment, EMPTY_SOURCE } from '../helpers/spell-scroll.mjs';

export const ItemSheetScroll = (Base) => class ItemSheetScroll extends Base {
  /** A spell was dropped on a scroll's drop box: copy it onto the scroll (GM only). */
  async _onDropScrollSpell(data) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.SpellScroll.GMOnly'));
      return false;
    }
    const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
    if (dropped?.type !== 'spell') {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.SpellScroll.OnlySpells'));
      return false;
    }
    const artwork = this.item.constructor.getDefaultArtwork?.({ type: this.item.type });
    const defaults = {
      makeName: (spell) => game.i18n.format('CARL_RPG.SpellScroll.Name', { spell }),
      defaultName: game.i18n.format('DOCUMENT.New', {
        type: game.i18n.localize('TYPES.Item.spellScroll'),
      }),
      defaultImg: artwork?.img ?? 'icons/svg/item-bag.svg',
    };
    await this.item.update(assignment(this.item, dropped, dropped.toObject().system, defaults));
    return true;
  }

  /** Take the spell off the scroll (what was copied stays, but the scroll can't be used). */
  static async _clearScrollSpell() {
    if (!game.user.isGM) return;
    await this.item.update({ 'system.spellSource': { ...EMPTY_SOURCE } });
  }
};
