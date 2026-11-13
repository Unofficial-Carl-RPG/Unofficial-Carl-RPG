/**
 * Item sheet: dragging and dropping onto and out of the sheet.
 */
import { addLibraryPageToEvents } from '../helpers/event-editor.mjs';
import { canHoldEffects, dropContainer, isEffectContainer } from '../helpers/effect-container.mjs';

export const ItemSheetDrops = (Base) => class ItemSheetDrops extends Base {
  /**
   * Define whether a user is able to begin a dragstart workflow for a given drag selector
   * @param {string} selector       The candidate HTML selector for dragging
   * @returns {boolean}             Can the current user drag this selector?
   * @protected
   */
  _canDragStart(selector) {
    return this.isEditable;
  }

  /**
   * Define whether a user is able to conclude a drag-and-drop workflow for a given drop selector
   * @param {string} selector       The candidate HTML selector for the drop target
   * @returns {boolean}             Can the current user drop on this selector?
   * @protected
   */
  _canDragDrop(selector) {
    return this.isEditable;
  }

  /**
   * Callback actions which occur at the beginning of a drag start workflow.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  _onDragStart(event) {
    const li = event.currentTarget;
    if ('link' in event.target.dataset) return;

    let dragData = null;

    // Active Effect
    if (li.dataset.effectId) {
      const effect = this.item.effects.get(li.dataset.effectId);
      dragData = effect.toDragData();
    }

    if (!dragData) return;

    // Set data transfer
    event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
  }

  /**
   * Callback actions which occur when a dragged element is over a drop target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  _onDragOver(event) { }

  /**
   * Callback actions which occur when a dragged element is dropped on a target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const item = this.item;
    const allowed = Hooks.call('dropItemSheetData', item, this, data);
    if (allowed === false) return;

    // A library template dropped on the Events tab is added as a copy of its event.
    if (data.type === 'JournalEntryPage' && event.target.closest('section.events')) {
      event.preventDefault();
      return addLibraryPageToEvents(this, data.uuid);
    }

    // A drop box on the Events tab (item, macro, effect or actor).
    const zone = event.target.closest('.drop-target');
    if (zone) {
      event.preventDefault();
      return this._onDropTarget(zone, data);
    }

    // Each kind of dropped document goes to its own handler.
    switch (data.type) {
      case 'ActiveEffect':
        return this._onDropActiveEffect(event, data);
      case 'Actor':
        return this._onDropActor(event, data);
      case 'Item':
        return this._onDropItem(event, data);
      case 'Folder':
        return this._onDropFolder(event, data);
    }
  }


  /**
   * Handle dropping of an Actor data onto another Actor sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<object|boolean>}  A data object which describes the result of the drop, or false if the drop was
   *                                     not permitted.
   * @protected
   */
  async _onDropActor(event, data) {
    if (!this.item.isOwner) return false;
  }


  /**
   * Handle dropping of an item reference or item data onto an Actor Sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<Item[]|boolean>}  The created or updated Item instances, or false if the drop was not permitted.
   * @protected
   */
  async _onDropItem(event, data) {
    if (!this.item.isOwner) return false;

    // An Effect Container hands its effects to any sheet that can hold effects.
    if (canHoldEffects(this.item)) {
      const container = await Item.fromDropData(data);
      if (isEffectContainer(container)) {
        if (container.uuid !== this.item.uuid) await dropContainer(this.item, container);
        return container;
      }
    }

    // Races and classes: skills dropped on the Skills tab are granted at rank 1.
    if (['race', 'class', 'subclass', 'species'].includes(this.item.type)) {
      if (!event.target.closest('.tab.grantedSkills')) return false;
      const dropped = await Item.fromDropData(data);
      if (dropped?.type !== 'skill' || !dropped.uuid) {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Origin.Drop.Wrong.skill'));
        return false;
      }
      await this._updateEvents((system) => {
        if (system.grantedSkills.some((g) => g.uuid === dropped.uuid)) return;
        system.grantedSkills.push({ uuid: dropped.uuid, rank: 1 });
      });
      return dropped;
    }

    // Stores: an item dropped on the store joins its listings once.
    if (this.item.type === 'store') {
      const dropped = await Item.fromDropData(data);
      if (!dropped?.uuid) return false;
      if (dropped.type === 'store') {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Store.NoStores'));
        return false;
      }
      const listings = this.item.toObject().system.listings;
      if (listings.some((l) => l.uuid === dropped.uuid)) return false;
      listings.push({ uuid: dropped.uuid, price: null, quantity: null });
      await this.item.update({ 'system.listings': listings });
      return dropped;
    }

    // Loot boxes: items dropped on the Random Rewards tab join the reward
    // list; items dropped on the Guaranteed tab join the guaranteed items.
    if (this.item.type === 'lootBox') {
      const onGuaranteed = !!event.target.closest('.tab.guaranteed');
      if (!onGuaranteed && !event.target.closest('.tab.rewards')) return false;
      const dropped = await Item.fromDropData(data);
      if (!dropped?.uuid) return false;
      if (dropped.type === 'lootBox') {
        // Loot boxes never reward loot boxes.
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Loot.NoLootBoxes'));
        return false;
      }
      const list = onGuaranteed ? 'guaranteed' : 'rewards';
      const entries = this.item.toObject().system[list];
      if (entries.some((r) => r.uuid === dropped.uuid)) return false;
      entries.push(
        list === 'guaranteed'
          ? { uuid: dropped.uuid, quantity: '1' }
          : { uuid: dropped.uuid, quantity: 1, weight: 1 }
      );
      await this.item.update({ [`system.${list}`]: entries });
      return dropped;
    }
    // Skills can be dropped onto the Skills tab of gear, items and backgrounds.
    if (!['gear', 'item', 'background'].includes(this.item.type)) return false;
    if (!event.target.closest('.tab.skills')) return false;

    const dropped = await Item.fromDropData(data);
    if (!dropped?.uuid || dropped.type !== 'skill') {
      ui.notifications.warn(
        game.i18n.localize('CARL_RPG.Item.EmbeddedSkill.OnlySkills')
      );
      return false;
    }
    await this._addEmbeddedSkill(dropped.uuid);
    return dropped;
  }


  /**
   * Handle dropping of a Folder on an Actor Sheet.
   * The core sheet currently supports dropping a Folder of Items to create all items as owned items.
   * @param {DragEvent} event     The concluding DragEvent which contains drop data
   * @param {object} data         The data transfer extracted from the event
   * @returns {Promise<Item[]>}
   * @protected
   */
  async _onDropFolder(event, data) {
    if (!this.item.isOwner) return [];
  }
};
