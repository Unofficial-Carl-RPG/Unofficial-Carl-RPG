import { getFloor, getDaysLeft } from './floor.mjs';
import { getPartyName } from './party.mjs';
import { CarlRPGDialog } from './dialog.mjs';
import { degreeOf, naturalD20 } from './attacks.mjs';
import { announceSystem, SYSTEM_KINDS } from './system-announcements.mjs';

/*
 * Journal enrichers, typed into journal text, chat and item descriptions.
 *   @Floor, @Party, @DaysLeft   live values, updated in open pages when they change
 *   @Check[str dc=floor]        anyone clicks it: rolls the crawler's stat check
 *   @Gold[50], @Junk[3]         GM only: give gold or Misc Junk to a crawler
 *   @LootBox[uuid]              GM only: give a copy of a loot box to a crawler
 *   @Effect[uuid]               GM only: apply an effect to a crawler
 *   @Announce[kind|text]        GM only: post a System announcement
 * Players see plain text where a button is GM only.
 */

const NS = 'carl-rpg';
const STATS = ['str', 'int', 'con', 'dex', 'cha'];

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const loc = (key, data) => t(`CARL_RPG.Enrichers.${key}`, data);

/* -------------------------------------------- */
/*  Live values                                 */
/* -------------------------------------------- */

const LIVE = {
  floor: () => getFloor(),
  party: () => getPartyName(),
  daysLeft: () => getDaysLeft(),
};

const liveEnricher = (name) => () => {
  const span = document.createElement('span');
  span.className = 'carl-live';
  span.dataset.carlLive = name;
  span.textContent = String(LIVE[name]() ?? '');
  return span;
};

/** Refresh every live value on the page (called when a carl-rpg setting changes). */
export function refreshLiveValues() {
  for (const [name, value] of Object.entries(LIVE)) {
    for (const el of document.querySelectorAll(`[data-carl-live="${name}"]`)) {
      el.textContent = String(value() ?? '');
    }
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const isGM = () => game.user.isGM;

/** A button for an enricher. */
function button(label, className, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `carl-enrich-button ${className}`;
  el.textContent = label;
  el.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return el;
}

/** Plain text, for players who see no button. */
function plain(label) {
  const span = document.createElement('span');
  span.className = 'carl-enrich-text';
  span.textContent = label;
  return span;
}

/** The crawler a player's roll is for: their own character, else one they own. */
function ownCrawler() {
  const own = game.user.character;
  if (own?.type === 'crawler') return own;
  return game.actors.find((a) => a.type === 'crawler' && a.isOwner) ?? null;
}

/** GM: ask which crawler a button gives something to. */
async function pickCrawler(title) {
  const crawlers = game.actors.filter((a) => a.type === 'crawler');
  if (!crawlers.length) {
    ui.notifications.warn(t('CARL_RPG.Item.Store.NoCrawlers'));
    return null;
  }
  const choices = crawlers
    .map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`)
    .join('');
  const id = await CarlRPGDialog.prompt({
    window: { title },
    content: `<div class="form-group"><label>${t(
      'CARL_RPG.Loot.PickCrawler'
    )}</label><select name="crawler">${choices}</select></div>`,
    ok: {
      label: title,
      callback: (event, btn) => btn.form.elements.crawler.value,
    },
  });
  return id ? game.actors.get(id) : null;
}

/* -------------------------------------------- */
/*  @Check                                      */
/* -------------------------------------------- */

/** Parse the inside of @Check[...]: a stat (optional) and a DC. */
function parseCheck(inner) {
  let stat = null;
  let dc = 'unopposed';
  for (const token of inner.trim().split(/\s+/)) {
    const lower = token.toLowerCase();
    if (STATS.includes(lower)) stat = lower;
    else if (lower.startsWith('dc=')) dc = lower.slice(3);
  }
  return { stat, dc };
}

/** The number a check has to reach: a number, floor (10 + Floor) or unopposed (10 + 2 x Floor). */
function checkNumber(dc) {
  const { base, unopposedFloorFactor } = CONFIG.CARL_RPG.checks;
  const floor = getFloor();
  if (dc === 'floor') return base + floor;
  const n = Number(dc);
  if (dc !== 'unopposed' && Number.isFinite(n)) return n;
  return base + floor * unopposedFloorFactor;
}

async function rollCheck(stat, dc) {
  const crawler = ownCrawler();
  if (!crawler) {
    ui.notifications.warn(t('CARL_RPG.Item.Store.NoCrawlers'));
    return;
  }
  const mod = stat ? (crawler.system.abilities?.[stat]?.mod ?? 0) : 0;
  const number = checkNumber(dc);
  const roll = await new Roll('1d20 + @mod', { mod }).evaluate();
  const degree = degreeOf(naturalD20(roll), roll.total, number);
  const statLabel = stat ? stat.toUpperCase() : loc('Check');
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: crawler }),
    content: `<div class="carl-check">${foundry.utils.escapeHTML(
      loc('CheckResult', {
        name: crawler.name,
        stat: statLabel,
        total: roll.total,
        dc: number,
        degree: loc(`Degree.${degree}`),
      })
    )}</div>`,
    rolls: [roll],
  });
}

/* -------------------------------------------- */
/*  GM actions                                  */
/* -------------------------------------------- */

async function giveGold(amount) {
  const crawler = await pickCrawler(loc('GiveGold', { n: amount }));
  await crawler?.addGold(amount);
}

async function giveJunk(amount) {
  const crawler = await pickCrawler(loc('GiveJunk', { n: amount }));
  if (crawler) {
    await crawler.update({ 'system.junk': (crawler.system.junk ?? 0) + amount });
  }
}

async function giveLootBox(uuid) {
  const box = await fromUuid(uuid);
  if (!box || box.type !== 'lootBox') {
    ui.notifications.warn(loc('LootBox'));
    return;
  }
  const crawler = await pickCrawler(loc('GiveLootBox'));
  if (crawler) await crawler.createEmbeddedDocuments('Item', [box.toObject()]);
}

async function applyEffect(uuid) {
  const effect = await fromUuid(uuid);
  if (!(effect instanceof ActiveEffect)) {
    ui.notifications.warn(loc('ApplyEffect'));
    return;
  }
  const crawler = await pickCrawler(loc('ApplyEffect'));
  if (!crawler) return;
  // Copied the way the events system copies an applied effect, then switched on.
  const data = effect.toObject();
  delete data._id;
  data.transfer = false;
  data.disabled = true;
  foundry.utils.setProperty(data, `flags.${NS}.sourceItems`, []);
  foundry.utils.setProperty(data, `flags.${NS}.stacks`, 1);
  const [copy] = await crawler.createEmbeddedDocuments('ActiveEffect', [data], {
    carlGrant: true,
  });
  await copy.setActive(true);
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerJournalEnrichers() {
  CONFIG.TextEditor.enrichers.push(
    { pattern: /@Floor\b/g, enricher: liveEnricher('floor') },
    { pattern: /@Party\b/g, enricher: liveEnricher('party') },
    { pattern: /@DaysLeft\b/g, enricher: liveEnricher('daysLeft') },

    {
      pattern: /@Check\[([^\]]*)\]/g,
      enricher: (match) => {
        const { stat, dc } = parseCheck(match[1]);
        const number = checkNumber(dc);
        const statLabel = stat ? stat.toUpperCase() : loc('Check');
        return button(
          loc('CheckButton', { stat: statLabel, dc: number }),
          'carl-enrich-check',
          () => rollCheck(stat, dc)
        );
      },
    },
    {
      pattern: /@Gold\[(\d+)\]/g,
      enricher: (match) => {
        const amount = Number(match[1]);
        if (!isGM()) return plain(loc('Gold', { n: amount }));
        return button(loc('GiveGold', { n: amount }), 'carl-enrich-gold', () =>
          giveGold(amount)
        );
      },
    },
    {
      pattern: /@Junk\[(\d+)\]/g,
      enricher: (match) => {
        const amount = Number(match[1]);
        if (!isGM()) return plain(loc('Junk', { n: amount }));
        return button(loc('GiveJunk', { n: amount }), 'carl-enrich-junk', () =>
          giveJunk(amount)
        );
      },
    },
    {
      pattern: /@LootBox\[([^\]]+)\]/g,
      enricher: (match) => {
        const uuid = match[1].trim();
        if (!isGM()) return plain(loc('LootBox'));
        return button(loc('GiveLootBox'), 'carl-enrich-lootbox', () => giveLootBox(uuid));
      },
    },
    {
      pattern: /@Effect\[([^\]]+)\]/g,
      enricher: (match) => {
        const uuid = match[1].trim();
        if (!isGM()) return plain(loc('Effect'));
        return button(loc('ApplyEffect'), 'carl-enrich-effect', () => applyEffect(uuid));
      },
    },
    {
      pattern: /@Announce\[([^\]]+)\]/g,
      enricher: (match) => {
        const [first, ...rest] = match[1].split('|');
        const kind = first.trim() in SYSTEM_KINDS ? first.trim() : 'general';
        const text = rest.join('|').trim() || first.trim();
        if (!isGM()) return plain(text);
        return button(loc('Announce'), 'carl-enrich-announce', () =>
          announceSystem({ kind, text })
        );
      },
    }
  );

  Hooks.on('updateSetting', (setting) => {
    if (setting?.key?.startsWith(`${NS}.`)) refreshLiveValues();
  });
}
