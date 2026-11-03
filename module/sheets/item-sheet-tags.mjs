/**
 * Item sheet: tags and prerequisites.
 */
import { withTag, withoutTag } from '../helpers/tags.mjs';

export const ItemSheetTags = (Base) => class ItemSheetTags extends Base {
  /** Save a new list for a tag field: 'tags' or 'categories'. */
  async _setTagList(field, list) {
    if (!this.item.isOwner || !['tags', 'categories'].includes(field)) return;
    await this.item.update({ [`system.${field}`]: list });
  }

  /**
   * Tick or untick a creation category (Childhood, Hobby...) a background is
   * offered in. The list keeps the order the creation config gives.
   */
  async _toggleBackgroundCategory(id, on) {
    if (!this.item.isOwner) return;
    const current = this.item.toObject().system.categories ?? [];
    const next = on
      ? [...new Set([...current, id])]
      : current.filter((c) => c !== id);
    const order = CONFIG.CARL_RPG.creation.skillGroups.map((g) => g.id);
    next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    await this.item.update({ 'system.categories': next });
  }

  /** Tick or untick one of the suggested class categories. */
  async _toggleTag(tag, on) {
    const list = this.item.toObject().system.categories;
    await this._setTagList(
      'categories',
      on ? withTag(list, tag) : withoutTag(list, tag)
    );
  }

  /**
   * Add what was typed in the box next to the button (ignoring case, so it
   * can't be added twice). `data-field` says which list: tags or categories.
   * @this CarlRPGItemSheet
   */
  static async _addTag(event, target) {
    const field = target?.dataset.field;
    const input = this.element.querySelector(`.tag-input[data-field="${field}"]`);
    const text = input?.value.trim();
    if (!text) return;
    await this._setTagList(
      field,
      withTag(this.item.toObject().system[field], text)
    );
  }

  /** @this CarlRPGItemSheet */
  static async _removeTag(event, target) {
    const field = target.dataset.field;
    await this._setTagList(
      field,
      withoutTag(this.item.toObject().system[field], target.dataset.tag)
    );
  }

  /** @this CarlRPGItemSheet */
  static async _addPrerequisite() {
    await this._updateEvents((system) => {
      system.prerequisites.push({
        type: 'stat',
        stat: 'str',
        value: 1,
        category: 'earthBased',
        uuid: '',
      });
    });
  }

  /** @this CarlRPGItemSheet */
  static async _removePrerequisite(event, target) {
    const pi = Number(target.dataset.pi);
    await this._updateEvents((system) => system.prerequisites.splice(pi, 1));
  }
};
