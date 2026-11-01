import { getFloor, getDaysLeft } from './floor.mjs';
import { getPartyName } from './party.mjs';
import { CarlRPGDialog } from './dialog.mjs';
import { degreeOf, naturalD20, evadeOf } from './attacks.mjs';
import { announceSystem, SYSTEM_KINDS } from './system-announcements.mjs';

/*
 * Journal enrichers, typed into journal text, chat and item descriptions.
 *   @Floor, @Party, @DaysLeft   live values, updated in open pages when they change
 *   @Check[skill=Name stat dc=floor]  anyone clicks it: rolls the crawler's check
 *   @Gold[50], @Junk[3]         GM only: give gold or Misc Junk to a crawler
 *   @LootBox[uuid]              GM only: give a copy of a loot box to a crawler
 *   @Effect[uuid]               GM only: apply an effect to a crawler
 *   @Announce[kind|text]        GM only: post a System announcement
 *   @Embed[uuid]                items, effects and mobs as a card (other embeds are Foundry's)
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

/**
 * Parse the inside of @Check[...]: an optional skill name (which may contain
 * spaces), an optional stat, and an optional DC. With no DC the roll only posts
 * its total.
 */
function parseCheck(inner) {
  let text = inner.trim();
  let skill = null;
  const found = text.match(/skill=(.+?)(?=\s+dc=|\s+(?:str|int|con|dex|cha)\b|$)/i);
  if (found) {
    skill = found[1].trim();
    text = text.replace(found[0], ' ');
  }
  let stat = null;
  let dc = null;
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (STATS.includes(lower)) stat = lower;
    else if (lower.startsWith('dc=')) dc = lower.slice(3);
  }
  return { skill, stat, dc };
}

/**
 * The number a check has to reach: a number, floor (10 + Floor) or unopposed
 * (10 + 2 x Floor). Null when there is no DC.
 */
function checkNumber(dc) {
  if (dc === null) return null;
  const { base, unopposedFloorFactor } = CONFIG.CARL_RPG.checks;
  const floor = getFloor();
  if (dc === 'floor') return base + floor;
  const n = Number(dc);
  if (dc !== 'unopposed' && Number.isFinite(n)) return n;
  return base + floor * unopposedFloorFactor;
}

async function rollCheck({ skill, stat, dc }) {
  const crawler = ownCrawler();
  if (!crawler) {
    ui.notifications.warn(t('CARL_RPG.Item.Store.NoCrawlers'));
    return;
  }
  let label = stat ? stat.toUpperCase() : loc('Check');
  let rank = 0;
  if (skill) {
    // A skill's own stat and rank, the same as its roll on the sheet.
    const item = crawler.items.find(
      (i) => i.type === 'skill' && i.name.toLowerCase() === skill.toLowerCase()
    );
    if (!item) {
      ui.notifications.warn(loc('NoSkill', { name: skill }));
      return;
    }
    stat = item.system.stat;
    rank = item.system.rank ?? 0;
    label = item.name;
  }
  const mod = stat ? (crawler.system.abilities?.[stat]?.mod ?? 0) : 0;
  const number = checkNumber(dc);
  const roll = await new Roll('1d20 + @mod + @rank', { mod, rank }).evaluate();
  const text =
    number === null
      ? loc('CheckResultNoDC', { name: crawler.name, stat: label, total: roll.total })
      : loc('CheckResult', {
          name: crawler.name,
          stat: label,
          total: roll.total,
          dc: number,
          degree: loc(`Degree.${degreeOf(naturalD20(roll), roll.total, number)}`),
        });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: crawler }),
    content: `<div class="carl-check">${foundry.utils.escapeHTML(text)}</div>`,
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
/*  @Embed                                      */
/* -------------------------------------------- */

/** Whether an @Embed target is one this system draws (the rest stay Foundry's). */
const ownsEmbed = (doc) =>
  doc instanceof Item || doc instanceof ActiveEffect || (doc instanceof Actor && doc.type === 'mob');

/**
 * The key numbers an embed shows. Players see a mob's Evade and DR (they show on
 * the journal page); the GM also sees an item's value.
 */
function embedNumbers(doc) {
  const rows = [];
  if (doc instanceof Actor) {
    rows.push([loc('Evade'), evadeOf(doc)], [loc('DR'), doc.system.drTotal ?? 0]);
    return rows;
  }
  if (doc.type === 'skill') {
    rows.push([loc('Stat'), String(doc.system.stat ?? '').toUpperCase()], [loc('Rank'), doc.system.rank ?? 0]);
  }
  if (doc.type === 'spell') rows.push([loc('Mana'), doc.system.manaCost ?? 0]);
  if (doc.type === 'gear') rows.push([loc('DR'), doc.system.dr ?? 0]);
  if (doc.system?.damage) rows.push([loc('Damage'), doc.system.damage]);
  if (isGM() && doc.system?.value !== undefined) rows.push([loc('Value'), doc.system.value]);
  return rows;
}

/** A card for an embed: picture, name, key numbers and description. */
function embedCard(doc, label) {
  const card = document.createElement('div');
  card.className = 'carl-embed';

  const head = document.createElement('div');
  head.className = 'carl-embed-head';
  if (doc.img) {
    const img = document.createElement('img');
    img.src = doc.img;
    img.alt = '';
    head.append(img);
  }
  const title = document.createElement('strong');
  title.textContent = label || doc.name;
  head.append(title);
  card.append(head);

  const numbers = embedNumbers(doc);
  if (numbers.length) {
    const row = document.createElement('div');
    row.className = 'carl-embed-numbers';
    for (const [name, value] of numbers) {
      const cell = document.createElement('span');
      cell.textContent = `${name} ${value}`;
      row.append(cell);
    }
    card.append(row);
  }

  const body = document.createElement('div');
  body.className = 'carl-embed-body';
  body.innerHTML = doc.system?.description ?? '';
  card.append(body);

  // Every upgrade the item has, reached or not.
  const upgrades = Array.isArray(doc.system?.upgrades) ? doc.system.upgrades : [];
  if (upgrades.length) {
    const list = document.createElement('div');
    list.className = 'carl-embed-upgrades';
    const heading = document.createElement('strong');
    heading.textContent = loc('Upgrades');
    list.append(heading);
    for (const upgrade of [...upgrades].sort((a, b) => a.rank - b.rank)) {
      const row = document.createElement('div');
      row.textContent = `${loc('Rank')} ${upgrade.rank}: ${upgrade.description ?? ''}`.trim();
      list.append(row);
    }
    card.append(list);
  }
  card.addEventListener('click', () => openEmbed(doc, label));
  return card;
}

/**
 * Clicking an embed opens the real sheet for a player who can view the document,
 * otherwise a read-only preview of the same card.
 */
function openEmbed(doc, label) {
  if (doc.testUserPermission(game.user, 'OBSERVER')) return doc.sheet?.render(true);
  return CarlRPGDialog.prompt({
    window: { title: label || doc.name },
    content: `<div class="carl-embed-preview">${embedCard(doc, label).outerHTML}</div>`,
    ok: { label: loc('Close'), callback: () => true },
  });
}

/**
 * Foundry runs @Embed through TextEditor._embedContent. Items, effects and mobs get
 * our card; every other embed is passed on to Foundry unchanged.
 */
function installEmbedOverride() {
  const TE = foundry.applications.ux.TextEditor.implementation;
  const original = TE._embedContent;
  TE._embedContent = async function (match, options) {
    const uuid = (match.groups?.config ?? '').trim().split(/\s+/)[0];
    const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (doc && ownsEmbed(doc)) return embedCard(doc, match.groups?.label);
    return original.call(this, match, options);
  };
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerJournalEnrichers() {
  installEmbedOverride();

  CONFIG.TextEditor.enrichers.push(
    { pattern: /@Floor\b/g, enricher: liveEnricher('floor') },
    { pattern: /@Party\b/g, enricher: liveEnricher('party') },
    { pattern: /@DaysLeft\b/g, enricher: liveEnricher('daysLeft') },

    {
      pattern: /@Check\[([^\]]*)\]/g,
      enricher: (match) => {
        const check = parseCheck(match[1]);
        const number = checkNumber(check.dc);
        const label = check.skill ?? (check.stat ? check.stat.toUpperCase() : loc('Check'));
        const text =
          number === null
            ? loc('CheckButtonStat', { stat: label })
            : loc('CheckButton', { stat: label, dc: number });
        return button(text, 'carl-enrich-check', () => rollCheck(check));
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
