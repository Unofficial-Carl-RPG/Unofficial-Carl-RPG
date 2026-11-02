/**
 * The recap log: every natural 1 and 20 a crawler rolls on an item, a skill or stat
 * check, or a defending roll (not a rank advance) is written to a page for its floor
 * in one journal. The journal is named "Recap Log" by default; its ID is kept in a
 * world setting, so the GM can point it at another journal. The active GM's client
 * writes the entries. Rolls made while no GM was online are caught up from chat when
 * a GM connects.
 */
import { getFloor } from './floor.mjs';

const NS = 'carl-rpg';
export const RECAP_SETTING = 'recapLogId';
export const RECAP_NAME = 'Recap Log';

const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

/** Writes one entry at a time, so entries added together don't overwrite each other. */
let queue = Promise.resolve();

export function registerRecap() {
  game.settings.register(NS, RECAP_SETTING, {
    name: 'CARL_RPG.Combat.RecapSetting',
    hint: 'CARL_RPG.Combat.RecapSettingHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.StringField({ required: true, blank: true, initial: '' }),
  });

  Hooks.on('createChatMessage', (message) => {
    if (game.users.activeGM?.id === game.user.id) queueRecap(message);
  });

  // A GM connecting catches up on rolls made while no GM was online.
  Hooks.once('ready', () => {
    if (game.users.activeGM?.id !== game.user.id) return;
    for (const message of game.messages.contents) queueRecap(message);
  });
}

function queueRecap(message) {
  queue = queue.then(() => logRecap(message)).catch((err) => {
    console.error('carl-rpg | writing the recap log failed', err);
  });
}

/** The natural d20 a roll message holds (1 or 20), or null. */
function naturalOf(message) {
  for (const roll of message.rolls ?? []) {
    const die = roll.dice?.find((d) => d.faces === 20);
    if (die && (die.total === 1 || die.total === 20)) return die.total;
  }
  return null;
}

/** Whether a message is a roll the recap log takes: a crawler's, not yet logged, not an advance. */
function isRecapRoll(message) {
  if (message.getFlag(NS, 'recapped') || message.getFlag(NS, 'advance')) return false;
  const actor = message.constructor.getSpeakerActor(message.speaker);
  return actor?.type === 'crawler';
}

async function logRecap(message) {
  if (!isRecapRoll(message)) return;
  const natural = naturalOf(message);
  if (!natural) return;

  const actor = message.constructor.getSpeakerActor(message.speaker);
  const journal = await recapJournal();
  const page = await floorPage(journal, getFloor());
  const what = (message.flavor ?? '').replace(/<[^>]*>/g, '').trim();
  const label = game.i18n.localize(natural === 20 ? 'CARL_RPG.Combat.RecapNatural20' : 'CARL_RPG.Combat.RecapNatural1');
  const line = `<p><strong>${esc(actor.name)}</strong>${what ? `: ${esc(what)}` : ''} (${label})</p>`;
  await page.update({ 'text.content': (page.text.content ?? '') + line });
  await message.setFlag(NS, 'recapped', true);
}

/** The recap journal the setting names; a new "Recap Log" is made when there isn't one. */
async function recapJournal() {
  const id = game.settings.get(NS, RECAP_SETTING);
  let journal = id ? game.journal.get(id) : null;
  if (!journal) {
    journal = await JournalEntry.create({ name: RECAP_NAME });
    await game.settings.set(NS, RECAP_SETTING, journal.id);
  }
  return journal;
}

/** The page for a floor in the journal, made when it's first needed. */
async function floorPage(journal, floor) {
  const title = game.i18n.format('CARL_RPG.Combat.RecapFloor', { floor });
  let page = journal.pages.find((p) => p.name === title);
  if (!page) {
    [page] = await journal.createEmbeddedDocuments('JournalEntryPage', [
      { name: title, type: 'text', text: { content: '' } },
    ]);
  }
  return page;
}
