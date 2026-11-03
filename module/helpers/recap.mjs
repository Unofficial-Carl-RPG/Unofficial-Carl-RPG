/**
 * The recap log: one journal with a page for each floor. Every natural 1 and 20 a
 * crawler rolls on an item, a skill or stat check, or a defending roll (not a rank
 * advance) is written to its floor's page, and so are the things the session recap
 * counts: boss stars and crawler kills (each rise in a crawler's counters), Elites
 * defeated, achievements earned and loot boxes opened. Each page keeps those counts
 * in a flag, and the GM posts them as a card from Dungeon Info (see postRecap).
 *
 * The journal is named "Recap Log" by default; its ID is kept in a world setting, so
 * the GM can point it at another journal. The active GM's client writes the entries.
 * Rolls and loot boxes opened while no GM was online are caught up from chat when a
 * GM connects.
 */
import { getFloor } from './floor.mjs';

const NS = 'carl-rpg';
export const RECAP_SETTING = 'recapLogId';
export const RECAP_NAME = 'Recap Log';

const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Which count each kind of entry adds to; a kind with none is only a line. */
const COUNT_OF = { star: 'stars', kill: 'kills', achievement: 'achievements', loot: 'boxes' };

/** Writes one entry at a time, so entries added together don't overwrite each other. */
let queue = Promise.resolve();

const isRecorder = () => game.users.activeGM?.id === game.user.id;

export function registerRecap() {
  game.settings.register(NS, RECAP_SETTING, {
    name: 'CARL_RPG.Combat.RecapSetting',
    hint: 'CARL_RPG.Combat.RecapSettingHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.StringField({ required: true, blank: true, initial: '' }),
  });

  // The floor is stamped on each message as it is made, so a catch-up entry still
  // goes on the page for the floor it was rolled on.
  Hooks.on('preCreateChatMessage', (message) => {
    message.updateSource({ [`flags.${NS}.floor`]: getFloor() });
  });

  Hooks.on('createChatMessage', (message) => {
    if (isRecorder()) queueRecap(message);
  });

  // A GM connecting catches up on rolls made while no GM was online.
  Hooks.once('ready', () => {
    if (!isRecorder()) return;
    for (const message of game.messages.contents) queueRecap(message);
  });

  // The update only says the new value, so the old one travels in the update's options.
  Hooks.on('preUpdateActor', (actor, changes, options) => {
    const system = changes.system;
    if (actor.type !== 'crawler' || !system) return;
    if (system.bossKills === undefined && system.crawlerKills === undefined) return;
    options.carlRecap = { bossKills: actor.system.bossKills, crawlerKills: actor.system.crawlerKills };
  });

  Hooks.on('updateActor', (actor, changes, options) => {
    if (!isRecorder() || !options.carlRecap) return;
    for (const [field, kind, key] of [
      ['bossKills', 'star', 'CARL_RPG.Recap.LineStar'],
      ['crawlerKills', 'kill', 'CARL_RPG.Recap.LineKill'],
    ]) {
      const now = changes.system?.[field];
      const amount = now === undefined ? 0 : now - (options.carlRecap[field] ?? 0);
      if (amount > 0) recordRecap({ actor, kind, amount, line: t(key, { count: amount }) });
    }
  });

  Hooks.on('createItem', (item) => {
    if (!isRecorder() || item.type !== 'achievement' || item.parent?.type !== 'crawler') return;
    recordRecap({
      actor: item.parent,
      kind: 'achievement',
      line: t('CARL_RPG.Recap.LineAchievement', { achievement: esc(item.name) }),
    });
  });
}

/**
 * Add one thing to a floor's recap: a line on its page and, for the kinds that are
 * counted, a count in the page's flags. Only the active GM's client should call this.
 * @param {object} entry
 * @param {string} entry.kind    'star', 'kill', 'achievement', 'loot' or 'elite'
 * @param {string} entry.line    The text after the crawler's name (HTML)
 * @param {Actor} [entry.actor]  The crawler it is for (none for an Elite)
 * @param {number} [entry.amount]
 * @param {number} [entry.floor] Defaults to the current floor
 */
export function recordRecap(entry) {
  queue = queue.then(() => writeRecap(entry)).catch((err) => {
    console.error('carl-rpg | writing the recap log failed', err);
  });
  return queue;
}

async function writeRecap({ kind, line, actor = null, amount = 1, floor = getFloor() }) {
  const page = await floorPage(await recapJournal(), floor);
  const counts = foundry.utils.deepClone(page.getFlag(NS, 'recap') ?? { crawlers: {}, elites: 0 });
  if (kind === 'elite') counts.elites += amount;
  else if (COUNT_OF[kind] && actor) {
    const row = (counts.crawlers[actor.id] ??= { name: actor.name, stars: 0, kills: 0, achievements: 0, boxes: 0 });
    row.name = actor.name;
    row[COUNT_OF[kind]] += amount;
  }
  const who = actor ? `<strong>${esc(actor.name)}</strong>: ` : '';
  await page.update({
    'text.content': `${page.text.content ?? ''}<p>${who}${line}</p>`,
    [`flags.${NS}.recap`]: counts,
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

/** Whether a message is one the recap log takes: a crawler's, not yet logged, not an advance. */
function isRecapMessage(message) {
  if (message.getFlag(NS, 'recapped') || message.getFlag(NS, 'advance')) return false;
  const actor = message.constructor.getSpeakerActor(message.speaker);
  return actor?.type === 'crawler';
}

async function logRecap(message) {
  if (!isRecapMessage(message)) return;
  const actor = message.constructor.getSpeakerActor(message.speaker);
  const floor = message.getFlag(NS, 'floor') ?? getFloor();
  const card = message.getFlag(NS, 'card');

  if (card?.kind === 'loot') {
    // Only openings that name their box: older cards would all land on today's page.
    if (!card.box) return;
    await writeRecap({ kind: 'loot', actor, floor, line: t('CARL_RPG.Recap.LineLoot', { box: esc(card.box) }) });
  } else {
    const natural = naturalOf(message);
    if (!natural) return;
    const what = (message.flavor ?? '').replace(/<[^>]*>/g, '').trim();
    const label = t(natural === 20 ? 'CARL_RPG.Combat.RecapNatural20' : 'CARL_RPG.Combat.RecapNatural1');
    await writeRecap({ kind: 'roll', actor, floor, line: `${what ? `${esc(what)} ` : ''}(${label})` });
  }
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

const pageTitle = (floor) => t('CARL_RPG.Combat.RecapFloor', { floor });

/** The page for a floor in the journal, made when it's first needed. */
async function floorPage(journal, floor) {
  const title = pageTitle(floor);
  let page = journal.pages.find((p) => p.name === title);
  if (!page) {
    [page] = await journal.createEmbeddedDocuments('JournalEntryPage', [
      { name: title, type: 'text', text: { content: '' } },
    ]);
  }
  return page;
}

/**
 * The GM posts the current floor's recap to chat: a row for each crawler (boss stars,
 * crawler kills, achievements, loot boxes opened) and the party's totals, with the
 * Elites defeated.
 */
export async function postRecap() {
  if (!game.user.isGM) return;
  const floor = getFloor();
  const journalId = game.settings.get(NS, RECAP_SETTING);
  const page = game.journal.get(journalId)?.pages.find((p) => p.name === pageTitle(floor));
  const counts = page?.getFlag(NS, 'recap');
  const rows = Object.values(counts?.crawlers ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length && !counts?.elites) {
    ui.notifications.info(t('CARL_RPG.Recap.Nothing', { floor }));
    return;
  }

  const columns = [
    ['stars', 'fa-star', 'CARL_RPG.Recap.Stars'],
    ['kills', 'fa-skull', 'CARL_RPG.Recap.Kills'],
    ['achievements', 'fa-trophy', 'CARL_RPG.Recap.Achievements'],
    ['boxes', 'fa-box-open', 'CARL_RPG.Recap.Boxes'],
  ];
  const head = columns
    .map(([, icon, label]) => `<th data-tooltip="${esc(t(label))}"><i class="fas ${icon}"></i></th>`)
    .join('');
  const cells = (row) => columns.map(([key]) => `<td>${row[key] ?? 0}</td>`).join('');
  const body = rows.map((row) => `<tr><th scope="row">${esc(row.name)}</th>${cells(row)}</tr>`).join('');
  const total = Object.fromEntries(columns.map(([key]) => [key, rows.reduce((sum, r) => sum + (r[key] ?? 0), 0)]));

  await ChatMessage.create({
    content: `<div class="carl-recap-card">
      <div class="recap-title">${t('CARL_RPG.Recap.Title', { floor })}</div>
      <table>
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><th scope="row">${t('CARL_RPG.Recap.Party')}</th>${cells(total)}</tr></tfoot>
      </table>
      <div class="recap-elites">${t('CARL_RPG.Recap.Elites', { count: counts?.elites ?? 0 })}</div>
    </div>`,
  });
}
