/**
 * Actor sheet: dropping things onto the sheet (items, actors, folders, effects).
 */
import { dropTarget } from '../helpers/event-editor.mjs';

export const ActorSheetDrops = (Base) => class ActorSheetDrops extends Base {
  /**
   * Drops on a pet's Upgrades tab: a document on one of the events editor's drop
   * boxes, or a skill or spell on an upgrade's list of what it gives. Anything
   * else is handled as usual.
   * @override
   */
  async _onDrop(event) {
    const zone = ['pet', 'mob'].includes(this.actor.type) ? event.target.closest('.drop-target') : null;
    if (!zone) return super._onDrop(event);
    event.preventDefault();
    if (!this.actor.isOwner) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);

    if (zone.dataset.accept === 'grant') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (!dropped || !['skill', 'spell'].includes(dropped.type)) {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Upgrades.OnlySkillsSpells'));
        return;
      }
      const ui_ = Number(zone.dataset.ui);
      await this._updateEvents((system) => {
        const list = system.upgrades[ui_].grants;
        if (!list.includes(dropped.uuid)) list.push(dropped.uuid);
      });
      return;
    }
    if (zone.dataset.accept === 'mobLoot') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (!dropped || dropped.documentName !== 'Item') return;
      const items = this.actor.toObject().system.loot.items;
      if (items.some((entry) => entry.uuid === dropped.uuid)) return;
      items.push({ uuid: dropped.uuid, chance: 100 });
      await this.actor.update({ 'system.loot.items': items });
      return;
    }
    if (zone.dataset.accept === 'lootBox') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (!dropped || dropped.type !== 'lootBox') {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.RewardOnlyBox'));
        return;
      }
      await this.actor.update({ 'system.rewardBox': dropped.uuid });
      return;
    }
    return dropTarget.call(this, zone, data);
  }

  /**
   * Handle the dropping of ActiveEffect data onto an Actor Sheet
   * @param {DragEvent} event                  The concluding DragEvent which contains drop data
   * @param {object} data                      The data transfer extracted from the event
   * @returns {Promise<ActiveEffect|boolean>}  The created ActiveEffect object or false if it couldn't be created.
   * @protected
   */
  async _onDropActiveEffect(event, data) {
    const aeCls = getDocumentClass('ActiveEffect');
    const effect = await aeCls.fromDropData(data);
    if (!this.actor.isOwner || !effect) return false;
    if (effect.target === this.actor)
      return this._onSortActiveEffect(event, effect);
    return aeCls.create(effect, { parent: this.actor });
  }

  /**
   * Handle a drop event for an existing embedded Active Effect to sort that Active Effect relative to its siblings
   *
   * @param {DragEvent} event
   * @param {ActiveEffect} effect
   */
  async _onSortActiveEffect(event, effect) {
    /** @type {HTMLElement} */
    const dropTarget = event.target.closest('[data-effect-id]');
    if (!dropTarget) return;
    const target = this._getEmbeddedDocument(dropTarget);

    // Don't sort on yourself
    if (effect.uuid === target.uuid) return;

    // Identify sibling items based on adjacent HTML elements
    const siblings = [];
    for (const el of dropTarget.parentElement.children) {
      const siblingId = el.dataset.effectId;
      const parentId = el.dataset.parentId;
      if (
        siblingId &&
        parentId &&
        (siblingId !== effect.id || parentId !== effect.parent.id)
      )
        siblings.push(this._getEmbeddedDocument(el));
    }

    // Perform the sort
    const sortUpdates = SortingHelpers.performIntegerSort(effect, {
      target,
      siblings,
    });

    // Split the updates up by parent document
    const directUpdates = [];

    const grandchildUpdateData = sortUpdates.reduce((items, u) => {
      const parentId = u.target.parent.id;
      const update = { _id: u.target.id, ...u.update };
      if (parentId === this.actor.id) {
        directUpdates.push(update);
        return items;
      }
      if (items[parentId]) items[parentId].push(update);
      else items[parentId] = [update];
      return items;
    }, {});

    // Effects-on-items updates
    for (const [itemId, updates] of Object.entries(grandchildUpdateData)) {
      await this.actor.items
        .get(itemId)
        .updateEmbeddedDocuments('ActiveEffect', updates);
    }

    // Update on the main actor
    return this.actor.updateEmbeddedDocuments('ActiveEffect', directUpdates);
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
    if (!this.actor.isOwner) return false;
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
    if (!this.actor.isOwner) return [];
    const folder = await Folder.implementation.fromDropData(data);
    if (folder.type !== 'Item') return [];
    const droppedItemData = await Promise.all(
      folder.contents.map(async (item) => {
        if (!(document instanceof Item)) item = await fromUuid(item.uuid);
        return item;
      })
    );
    return this._onDropItemCreate(droppedItemData, event);
  }

  /**
   * Handle the final creation of dropped Item data on the Actor.
   * This method is factored out to allow downstream classes the opportunity to override item creation behavior.
   * @param {object[]|object} itemData      The item data requested for creation
   * @param {DragEvent} event               The concluding DragEvent which provided the drop data
   * @returns {Promise<Item[]>}
   */
  async _onDropItemCreate(itemData, event) {
    itemData = itemData instanceof Array ? itemData : [itemData];
    // A deity starts at tier 1 on the crawler (the GM can change it after).
    for (const d of itemData) if (d.type === 'deity') foundry.utils.setProperty(d, 'system.tier', 1);
    // A crawler has one deity: a new one replaces the old.
    if (itemData.some((d) => d.type === 'deity')) {
      const old = this.actor.itemTypes.deity.map((i) => i.id);
      if (old.length) await this.actor.deleteEmbeddedDocuments('Item', old);
    }
    // A crawler has one Personal Space: a new one replaces the old.
    if (itemData.some((d) => d.type === 'personalSpace')) {
      const old = this.actor.itemTypes.personalSpace.map((i) => i.id);
      if (old.length) await this.actor.deleteEmbeddedDocuments('Item', old);
    }
    // A crawler can hold up to the sponsor limit (-1 means no limit).
    const limit = game.settings.get('carl-rpg', 'sponsorLimit');
    const incoming = itemData.filter((d) => d.type === 'sponsor');
    if (incoming.length && limit >= 0) {
      const held = this.actor.itemTypes.sponsor.length;
      if (held + incoming.length > limit) {
        ui.notifications.warn(game.i18n.format('CARL_RPG.Sponsors.Full', { limit }));
        itemData = itemData.filter((d) => d.type !== 'sponsor');
        if (!itemData.length) return [];
      }
    }
    return this.actor.createEmbeddedDocuments('Item', itemData);
  }
};
