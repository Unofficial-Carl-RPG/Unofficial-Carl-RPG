import { damageTypes } from '../helpers/damage-types.mjs';
import { actsAsClass } from '../helpers/class-combo.mjs';
/**
 * Item sheet: the Events tab and an item's Requirements.
 */

export const ItemSheetEvents = (Base) => class ItemSheetEvents extends Base {
  /** The document whose events these are (the editor's "run now" button uses it). */
  get eventDoc() {
    return this.item;
  }

  /**
   * Change the stored requirements/events with a function, then save them.
   * Always writes both lists, so a GM saving marks the events as trusted.
   * @param {(system: object) => void} mutate
   */
  async _updateEvents(mutate) {
    if (!this.item.isOwner) return;
    const system = this.item.toObject().system;
    mutate(system);
    const update = {
      'system.events': system.events,
      'system.requirements': system.requirements,
    };
    // Races and classes keep their prerequisites and granted skills here too.
    if ('prerequisites' in system) update['system.prerequisites'] = system.prerequisites;
    if ('grantedSkills' in system) update['system.grantedSkills'] = system.grantedSkills;
    // Skills and spells keep their upgrades (and the events those carry) here too.
    if ('upgrades' in system) update['system.upgrades'] = system.upgrades;
    await this.item.update(update);
  }

  /** Save one field of an event, condition, action or requirement. */
  async _saveEventField(el) {
    const value =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? Number(el.value) || 0
          : el.value;
    const path = el.dataset.path;
    await this._updateEvents((system) => {
      foundry.utils.setProperty(system, path, value);
      // Upgrades are kept in rank order.
      if (/^upgrades\.\d+\.rank$/.test(path)) {
        system.upgrades.sort((a, b) => a.rank - b.rank);
      }
      // No type means no second type either.
      if (/^upgrades\.\d+\.changes\.\d+\.bonusType$/.test(path) && !value) {
        foundry.utils.setProperty(system, path.replace(/bonusType$/, 'bonusAlso'), '');
      }
      // A different kind of change starts with a value that suits it.
      if (/^upgrades\.\d+\.changes\.\d+\.type$/.test(path)) {
        const starts = {
          damageAdd: '',
          damageReplace: '',
          dieStep: '1',
          manaCost: '-1',
          junkCost: '-1',
          usesCost: '-1',
          rollBonus: '1',
          rollTarget: 'evade',
          damageType: damageTypes()[0]?.id ?? '',
          rmDR: '5',
          damageMultiply: '2',
          areaShape: 'cone',
          areaShapeExtra: 'cone',
          areaSizeAdd: '5',
          areaSizeReplace: '10',
          splashAdd: '5',
        };
        foundry.utils.setProperty(
          system,
          path.replace(/\.type$/, '.value'),
          starts[value] ?? ''
        );
        // (and no "Only when" condition, which not every kind of change has)
        foundry.utils.setProperty(system, path.replace(/\.type$/, '.when'), '');
        foundry.utils.setProperty(
          system,
          path.replace(/\.type$/, '.scope'),
          value === 'damageMultiply' ? 'total' : ''
        );
        foundry.utils.setProperty(system, path.replace(/\.type$/, '.bonusType'), '');
        foundry.utils.setProperty(system, path.replace(/\.type$/, '.bonusAlso'), '');
        // (nor an added shape's own size or keeping the base)
        foundry.utils.setProperty(system, path.replace(/\.type$/, '.size'), '');
        foundry.utils.setProperty(system, path.replace(/\.type$/, '.keep'), false);
      }
    });
  }

  /** A drop box was dropped on: store the dropped document's UUID. */
  async _onDropTarget(zone, data) {
    // The item an Ammunition cost spends (see ItemSheetCosts).
    if (zone.dataset.accept === 'ammo') return this._onDropAmmo(zone, data);

    // A quest's reward achievement, or an achievement's reward box (below, by field).
    if (zone.dataset.accept === 'achievement') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (dropped?.type !== 'achievement') {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Item.Quest.WrongAchievement'));
        return false;
      }
      await this.item.update({ ['system.' + zone.dataset.field]: dropped.uuid });
      return true;
    }

    // A subclass's class: a class item (or a Race and Class combo) dropped on the box.
    if (zone.dataset.accept === 'classLink') {
      const dropped = data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (dropped?.type !== 'class' && !actsAsClass(dropped)) {
        ui.notifications.warn(game.i18n.localize('CARL_RPG.Origin.Drop.Wrong.class'));
        return false;
      }
      await this.item.update({ 'system.classUuid': dropped.uuid });
      return true;
    }

    // The reward loot box of an achievement or a quest.
    if (zone.dataset.accept === 'lootBox') {
      const dropped =
        data.type === 'Item' && data.uuid ? await fromUuid(data.uuid) : null;
      if (dropped?.type !== 'lootBox') {
        ui.notifications.warn(
          game.i18n.localize('CARL_RPG.Achievement.WrongDrop')
        );
        return false;
      }
      await this.item.update({ ['system.' + (zone.dataset.field || 'lootBox')]: dropped.uuid });
      return true;
    }

    const accepts = { item: 'Item', macro: 'Macro', effect: 'ActiveEffect', actor: 'Actor' };
    if (data.type !== accepts[zone.dataset.accept] || !data.uuid) {
      ui.notifications.warn(
        game.i18n.localize(`CARL_RPG.Events.Drop.Wrong.${zone.dataset.accept}`)
      );
      return false;
    }
    // Some drop boxes only take a particular kind of item (a skill, a race...).
    if (zone.dataset.itemType) {
      const doc = await fromUuid(data.uuid);
      if (doc?.type !== zone.dataset.itemType) {
        ui.notifications.warn(
          game.i18n.localize(`CARL_RPG.Origin.Drop.Wrong.${zone.dataset.itemType}`)
        );
        return false;
      }
    }
    await this._updateEvents((system) =>
      foundry.utils.setProperty(
        system,
        `${zone.dataset.path}.${zone.dataset.field}`,
        data.uuid
      )
    );
    return true;
  }

  /**
   * A GM approves the item's events as they are (events a player saved are limited
   * to what that player could do themselves).
   */
  static async _approveEvents() {
    if (!game.user.isGM) return;
    await this.item.update({ 'system.eventsTrusted': true });
  }

  /** @this CarlRPGItemSheet */
  static async _addRequirement() {
    await this._updateEvents((system) => {
      system.requirements.push({ type: 'mana', stat: 'str', value: '1' });
    });
  }

  /** @this CarlRPGItemSheet */
  static async _removeRequirement(event, target) {
    const ri = Number(target.dataset.ri);
    await this._updateEvents((system) => system.requirements.splice(ri, 1));
  }

  /** Helper Functions */
};
