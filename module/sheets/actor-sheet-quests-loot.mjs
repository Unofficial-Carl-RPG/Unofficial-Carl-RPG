/**
 * Actor sheet: quests, loot boxes, mob loot and boss rewards.
 */
import { plainText } from '../helpers/store.mjs';
import { pickCrawlerAndLoot } from '../helpers/mob-loot.mjs';
import { openAllLootBoxes, openLootBox } from '../helpers/loot.mjs';
import { CarlRPGDialog } from '../helpers/dialog.mjs';
import { revive } from '../helpers/dying.mjs';

export const ActorSheetQuestsAndLoot = (Base) => class ActorSheetQuestsAndLoot extends Base {
  /** A mob's loot list: each item with its name and its chance. */
  async _prepareLootRows(context) {
    context.lootRows = await Promise.all(
      (this.actor.system.loot?.items ?? []).map(async (entry, index) => {
        const doc = entry.uuid ? await fromUuid(entry.uuid) : null;
        return {
          index,
          chance: entry.chance,
          uuid: doc ? entry.uuid : '',
          name: doc?.name ?? entry.uuid,
          img: doc?.img ?? 'icons/svg/mystery-man.svg',
          missing: !doc,
        };
      })
    );
  }

  /** The crawler's quests, with their reward and deadline, for the Quests tab. */
  async _prepareQuests(context) {
    context.isGM = game.user.isGM;
    context.quests = await Promise.all(
      (this.actor.itemTypes?.quest ?? []).map(async (quest) => {
        const s = quest.system;
        const box = s.rewardBox ? await fromUuid(s.rewardBox) : null;
        const ach = s.rewardAchievement ? await fromUuid(s.rewardAchievement) : null;
        let deadlineLabel = '';
        if (s.deadline.type === 'floor') {
          deadlineLabel = game.i18n.format('CARL_RPG.Item.Quest.DeadlineFloor', { floor: s.deadline.value });
        } else if (s.deadline.type === 'days') {
          deadlineLabel = game.i18n.format('CARL_RPG.Item.Quest.DeadlineDays', { days: s.deadline.value });
        }
        return {
          id: quest.id,
          name: quest.name,
          img: quest.img,
          giver: s.giver,
          completed: s.completed,
          canComplete: game.user.isGM && !s.completed,
          tooltip: plainText(s.shortDescription),
          deadlineLabel,
          objectives: s.objectives.map((o, index) => ({ index, text: o.text, done: o.done })),
          gold: s.rewardGold,
          box: box?.name ?? '',
          achievement: ach?.name ?? '',
        };
      })
    );
  }

  /** A quest's objectives: its checkboxes save together. */
  async _saveQuestObjectives(event) {
    const questEl = event.currentTarget.closest('.quest');
    const quest = this.actor.items.get(questEl?.dataset.id);
    if (!quest) return;
    const objectives = quest.toObject().system.objectives.map((o, index) => ({
      ...o,
      done: !!questEl.querySelector(`.quest-objective[data-index="${index}"]`)?.checked,
    }));
    await quest.update({ 'system.objectives': objectives });
  }

  /** GM: complete a quest on this crawler: pay its gold, give its loot box and achievement. */
  static async _completeQuest(event, target) {
    if (!game.user.isGM) return;
    const quest = this.actor.items.get(target.closest('.quest').dataset.id);
    if (!quest || quest.system.completed) return;
    const { rewardGold, rewardBox, rewardAchievement } = quest.system;
    if (rewardGold) await this.actor.addGold(rewardGold);
    for (const uuid of [rewardBox, rewardAchievement]) {
      const doc = uuid ? await fromUuid(uuid) : null;
      if (doc?.documentName === 'Item') {
        await this.actor.createEmbeddedDocuments('Item', [game.items.fromCompendium(doc)]);
      }
    }
    await quest.update({ 'system.completed': true });
    await ChatMessage.create({
      content: `<div class="carl-quest-card">${game.i18n.format('CARL_RPG.Item.Quest.Done', {
        crawler: this.actor.name,
        quest: quest.name,
      })}</div>`,
    });
  }

  /** GM: remove a quest from this crawler. */
  static async _removeQuest(event, target) {
    if (!game.user.isGM) return;
    const quest = this.actor.items.get(target.closest('.quest').dataset.id);
    await quest?.delete();
  }

  /** GM: loot this defeated mob, giving its loot to the crawler picked. */
  static async _lootMob() {
    await pickCrawlerAndLoot(this.actor);
  }

  /** GM: take one item off the mob's loot list. */
  static async _removeLoot(event, target) {
    const index = Number(target.closest('.loot-row').dataset.index);
    const items = this.actor.toObject().system.loot.items;
    items.splice(index, 1);
    await this.actor.update({ 'system.loot.items': items });
  }

  /** Save the chances of the loot rows (they have no form names). */
  async _saveLootChances() {
    const items = this.actor.toObject().system.loot.items;
    for (const row of this.element.querySelectorAll('.loot-row')) {
      const entry = items[Number(row.dataset.index)];
      if (!entry) continue;
      const value = Math.floor(Number(row.querySelector('.loot-chance').value)) || 0;
      entry.chance = Math.min(100, Math.max(0, value));
    }
    await this.actor.update({ 'system.loot.items': items });
  }

  /** GM: take the mob's reward box off it. */
  static async _clearReward() {
    await this.actor.update({ 'system.rewardBox': '' });
  }

  /** GM: after a mob is defeated, give its reward loot box to the crawlers picked. */
  static async _giveReward() {
    if (!game.user.isGM) return;
    const box = await fromUuid(this.actor.system.rewardBox);
    if (!box || box.type !== 'lootBox') return;
    const crawlers = game.actors.filter((a) => a.type === 'crawler');
    if (!crawlers.length) return;
    const rows = crawlers
      .map(
        (c) =>
          `<label class="reward-pick"><input type="checkbox" name="crawler" value="${c.id}" checked> ${foundry.utils.escapeHTML(c.name)}</label>`
      )
      .join('');
    const ids = await CarlRPGDialog.prompt({
      window: { title: game.i18n.localize('CARL_RPG.Combat.RewardTitle') },
      content: `<p>${game.i18n.localize('CARL_RPG.Combat.RewardPick')}</p>${rows}`,
      ok: {
        label: game.i18n.localize('CARL_RPG.Combat.GiveReward'),
        callback: (event, button) =>
          [...button.form.querySelectorAll('input[name="crawler"]:checked')].map((i) => i.value),
      },
    });
    if (!ids?.length) return;
    for (const id of ids) {
      const crawler = game.actors.get(id);
      if (crawler) await crawler.createEmbeddedDocuments('Item', [game.items.fromCompendium(box)]);
    }
  }

  /** Open one of the crawler's loot boxes (see helpers/loot.mjs). */
  static async _openLootBox(event, target) {
    event.preventDefault();
    const item = this._getEmbeddedDocument(target);
    if (item) await openLootBox(item);
  }

  /** GM: bring a dead crawler back with 1 health box. */
  static async _revive() {
    if (game.user.isGM) await revive(this.actor);
  }

  /** GM: a defeated boss gives every crawler in its combat a star (once per boss). */
  static async _giveStar() {
    if (!game.user.isGM) return;
    const combat = game.combats.get(this.actor.getFlag('carl-rpg', 'defeatedIn')) ?? game.combat;
    const crawlers = (combat?.combatants.contents ?? [])
      .map((c) => c.actor)
      .filter((a) => a?.type === 'crawler');
    if (!crawlers.length) {
      ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.NoCrawlersStar'));
      return;
    }
    for (const crawler of crawlers) {
      await crawler.update({ 'system.bossKills': (crawler.system.bossKills ?? 0) + 1 });
    }
    await ChatMessage.create({
      content: `<div class="carl-loot-card">${game.i18n.format('CARL_RPG.Combat.StarGiven', {
        boss: Handlebars.escapeExpression(this.actor.name),
      })}</div>`,
    });
  }

  /** Open all of this crawler's loot boxes, lowest tier first. */
  static async _openAllBoxes(event, target) {
    await openAllLootBoxes(this.actor);
  }
};
