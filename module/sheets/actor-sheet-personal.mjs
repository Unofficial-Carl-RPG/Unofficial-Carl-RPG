/**
 * Actor sheet: the Personal tab (kills, mount rows, sponsor gifts, offerings) and pets.
 */
import { CarlRPGDialog } from '../helpers/dialog.mjs';

export const ActorSheetPersonal = (Base) => class ActorSheetPersonal extends Base {
  /**
   * Add a row to the kills list.
   * @this CarlRPGActorSheet
   */
  static async _addKill() {
    const kills = [...this.document.system.killLog, { name: '', note: '' }];
    await this.document.update({ 'system.killLog': kills });
  }

  /**
   * Add a row to a mount list (occupants, accessories or attacks). The button's
   * data-path names the list; attacks get a blank attack row.
   * @this CarlRPGActorSheet
   */
  static async _addMountRow(event, target) {
    const path = target.dataset.path;
    const list = foundry.utils.getProperty(this.document, path) ?? [];
    const blank = path === 'system.attacks' ? { name: '', roll: '', damage: '' } : '';
    await this.document.update({ [path]: [...list, blank] });
  }

  /** @this CarlRPGActorSheet */
  static async _removeMountRow(event, target) {
    const path = target.dataset.path;
    const index = Number(target.dataset.index);
    const list = foundry.utils.getProperty(this.document, path) ?? [];
    await this.document.update({ [path]: list.filter((_, i) => i !== index) });
  }

  /**
   * GM only: a sponsor sends the crawler a loot box. The GM picks a world loot box,
   * a copy goes onto the crawler and the sponsor posts a card about it.
   * @this CarlRPGActorSheet
   */
  static async _sendGift(event, target) {
    if (!game.user.isGM) return;
    const sponsor = this.document.items.get(target.dataset.sponsor);
    if (!sponsor) return;
    const boxes = game.items
      .filter((i) => i.type === 'lootBox')
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!boxes.length) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Sponsors.NoBoxes'));
      return;
    }
    const options = boxes
      .map((b) => `<option value="${b.uuid}">${foundry.utils.escapeHTML(b.name)}</option>`)
      .join('');
    const picked = await CarlRPGDialog.wait({
      window: { title: game.i18n.localize('CARL_RPG.Sponsors.SendGift') },
      content: `<p class="hint">${game.i18n.localize('CARL_RPG.Sponsors.GiftHint')}</p><select name="box">${options}</select>`,
      buttons: [
        {
          action: 'send',
          label: game.i18n.localize('CARL_RPG.Sponsors.SendGift'),
          default: true,
          callback: (event, button) => button.form.elements.box.value,
        },
        { action: 'cancel', label: game.i18n.localize('CARL_RPG.Sponsors.Cancel') },
      ],
    });
    if (!picked || picked === 'cancel') return;
    const box = await fromUuid(picked);
    if (!box) return;
    await this.document.createEmbeddedDocuments('Item', [box.toObject()]);
    await ChatMessage.create({
      content: game.i18n.format('CARL_RPG.Sponsors.GiftCard', {
        sponsor: sponsor.name,
        name: this.document.name,
        box: box.name,
      }),
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
    });
  }

  /** @this CarlRPGActorSheet */
  static async _removeKill(event, target) {
    const index = Number(target.dataset.index);
    const kills = this.document.system.killLog.filter((_, i) => i !== index);
    await this.document.update({ 'system.killLog': kills });
  }

  /**
   * Open a pet's sheet from the Pets list on its crawler's sheet.
   *
   * @this CarlRPGActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static _openPet(event, target) {
    event.preventDefault();
    game.actors.get(target.dataset.actorId)?.sheet.render(true);
  }

  /** Post the deity's offering text to chat. */
  static async _offering(event, target) {
    const deity = this.actor.itemTypes.deity[0];
    const text = deity?.system.offering?.trim();
    if (!deity || !text) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Sponsors.NoOfferingText'));
      return;
    }
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="carl-offering-card"><strong>${Handlebars.escapeExpression(deity.name)}</strong><p>${Handlebars.escapeExpression(text)}</p></div>`,
    });
  }
};
