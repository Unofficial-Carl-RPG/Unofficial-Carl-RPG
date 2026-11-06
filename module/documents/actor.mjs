/** The Carl RPG actor: crawlers, mobs, pets, loot piles and mounts. */
import { adjustForType, adjustParts, damageTypeNote } from '../helpers/damage-types.mjs';
import { runActorEvents } from '../helpers/events.mjs';
import { defeatMob } from '../helpers/defeat.mjs';
import { canDie, cancelDying, hurtWhileDying, startDying } from '../helpers/dying.mjs';
import { clearTempDR, tempDRTotal } from '../helpers/roll-mods.mjs';

export class CarlRPGActor extends Actor {
  /**
   * A brand new crawler (created with no data) is marked as waiting for the
   * character creation wizard, which adds a Create Character link to its sheet.
   * Crawlers that are imported or duplicated are left as they are.
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    if (this.type === 'crawler' && foundry.utils.isEmpty(data.system ?? {})) {
      this.updateSource({ 'flags.carl-rpg.creationPending': true });
    }
    // A new mob's token shows its health bar to everyone (fill only; no numbers are drawn).
    if (this.type === 'mob' && foundry.utils.isEmpty(data.prototypeToken ?? {})) {
      this.updateSource({
        'prototypeToken.displayBars': CONST.TOKEN_DISPLAY_MODES.ALWAYS,
      });
    }
    // A new pet's token is linked to it and friendly, like a player's.
    if (this.type === 'pet' && foundry.utils.isEmpty(data.prototypeToken ?? {})) {
      this.updateSource({
        'prototypeToken.actorLink': true,
        'prototypeToken.disposition': CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      });
    }
  }

  /**
   * Only a GM saving a pet's upgrades marks the events they carry as trusted
   * (see helpers/events.mjs); anyone else editing them clears the mark.
   * @override
   */
  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if (allowed === false) return false;
    if (this.type === 'pet' && changes.system && 'upgrades' in changes.system && !options?.carlMigration) {
      foundry.utils.setProperty(changes, 'system.eventsTrusted', user.isGM);
    }
  }

  /**
   * When a GM gives a pet an owner, that crawler's player owners get Owner permission
   * on the pet, so they can edit its sheet and roll for it. Runs once, on the GM's
   * client, when the change is made.
   * @override
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (options?.carlMigration) return;
    if (game.user === game.users.activeGM && foundry.utils.hasProperty(changed, 'system.health.value')) {
      const health = this.system.health.value;
      if (health === 0 && canDie(this)) startDying(this);
      else if (health === 0 && this.type === 'mob') defeatMob(this);
      else if (health > 0) cancelDying(this);
    }
    if (this.type !== 'pet' || userId !== game.user.id || !game.user.isGM) return;
    if (!foundry.utils.hasProperty(changed, 'system.owner')) return;
    const crawler = game.actors.get(this.system.owner);
    if (!crawler) return;
    const update = {};
    for (const user of game.users) {
      if (user.isGM || !crawler.testUserPermission(user, 'OWNER')) continue;
      if (this.testUserPermission(user, 'OWNER')) continue;
      update[`ownership.${user.id}`] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    }
    if (!foundry.utils.isEmpty(update)) this.update(update);
  }

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
  }

  /**
   * Data worked out here is available inside and outside the sheets (a roll made
   * straight from the actor).
   * @override
   */
  prepareDerivedData() {
    const actorData = this;
    const flags = actorData.flags.carlrpg || {};
  }

  /** The actor's roll data plus its data model's. @override */
  getRollData() {
    return { ...super.getRollData(), ...(this.system.getRollData?.() ?? null) };
  }

  /**
   * Apply incoming damage to a crawler's 10 box health bar.
   * Boxes lost = (total damage - damage reduction) / CON modifier, rounded per
   * CONFIG.CARL_RPG.damageRounding.
   *
   * @param {number} amount                     Total damage before DR
   * @param {object} [options]
   * @param {boolean} [options.ignoreDR=false]  Skip damage reduction
   * @param {string} [options.damageType='']  The damage's type; effects can halve, double or stop it
   * @param {{type: string, amount: number}[]|null} [options.parts=null]  The damage by type (typed
   *   bonus dice): each part is worked out on its own, then added up. `amount` is their total and
   *   `damageType` is ignored.
   * @returns {Promise<{amount: number, dr: number, net: number, boxes: number, value: number}>}
   */
  async applyDamage(amount, { ignoreDR = false, damageType = '', parts = null } = {}) {
    amount = Number(amount) || 0;
    // Effects that make the actor resist, be immune to or be vulnerable to the type. Damage in
    // several types (typed bonus dice) is worked out type by type, then added up.
    let typeNote;
    if (parts?.length) {
      const typed = adjustParts(parts, this);
      amount = typed.amount;
      typeNote = typed.changes
        .map((change) => damageTypeNote(change.multiplier, this.name, change.type))
        .filter(Boolean)
        .join(' ');
    } else {
      const typed = adjustForType(amount, this, damageType);
      amount = typed.amount;
      typeNote = damageTypeNote(typed.multiplier, this.name, damageType);
    }
    const withNote = (text) => (typeNote ? `${text} ${typeNote}` : text);
    // (Crawlers and pets have the 10 box health bar; mobs have set health.)
    if (this.type === 'mob') {
      // Mobs: their Damage Resistance (a set value plus the Floor) is taken off,
      // and what is left comes off their health, a point for each box.
      const dr = ignoreDR ? 0 : (this.system.drTotal ?? 0) + tempDRTotal(this);
      const net = Math.max(amount - dr, 0);
      const value = Math.max(this.system.health.value - net, 0);
      await this.update({ 'system.health.value': value });
      // A Roll Modifier's DR bonus is used up by this damage.
      await clearTempDR(this);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: withNote(
          game.i18n.format('CARL_RPG.Actor.Crawler.Header.DamageTaken', {
            name: this.name,
            amount,
            dr,
            boxes: net,
            value,
          })
        ),
      });
      if (net > 0) await hurtWhileDying(this);
      if (net > 0) runActorEvents(this, 'takesDamage', { amount: net });
      return { amount, dr, net, boxes: net, value };
    }

    const dr = ignoreDR ? 0 : this.system.dr.total + tempDRTotal(this);
    const net = Math.max(amount - dr, 0);
    const roundFn = Math[CONFIG.CARL_RPG.damageRounding] ?? Math.ceil;
    const boxes = roundFn(net / this.system.health.perBox);
    const value = Math.max(this.system.health.value - boxes, 0);
    await this.update({ 'system.health.value': value });
    // A Roll Modifier's DR bonus is used up by this damage.
    await clearTempDR(this);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: withNote(
        game.i18n.format('CARL_RPG.Actor.Crawler.Header.DamageTaken', {
          name: this.name,
          amount,
          dr,
          boxes,
          value,
        })
      ),
    });
    if (boxes > 0) await hurtWhileDying(this);
    if (boxes > 0) runActorEvents(this, 'takesDamage', { amount: boxes });
    return { amount, dr, net, boxes, value };
  }

  /**
   * Add gold to a crawler. This is the one place gold is granted from, so loot,
   * shops and events all use it. Only whole, positive amounts are accepted.
   *
   * @param {number} amount  Whole gold pieces to add
   * @returns {Promise<number|false>}  The new total, or false if nothing was added
   */
  async addGold(amount) {
    amount = Math.trunc(Number(amount));
    if (this.type !== 'crawler' || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    const total = this.system.gold + amount;
    await this.update({ 'system.gold': total });
    return total;
  }

  /**
   * Take gold from a crawler, if they have enough. Nothing is taken (and false
   * is returned) when they can't afford it, so gold never goes below 0.
   *
   * @param {number} amount  Whole gold pieces to spend
   * @returns {Promise<number|false>}  The new total, or false if they can't afford it
   */
  async spendGold(amount) {
    amount = Math.trunc(Number(amount));
    if (this.type !== 'crawler' || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    if (this.system.gold < amount) return false;
    const total = this.system.gold - amount;
    await this.update({ 'system.gold': total });
    return total;
  }
}
