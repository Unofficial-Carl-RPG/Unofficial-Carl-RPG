import { getFloor } from './floor.mjs';
import { levelOf } from './upgrades.mjs';
import { CarlRPGDialog } from './dialog.mjs';

/*
 * A crawler as plain text, for printing or pasting: a right-click entry in the
 * Actors directory opens it in a window with a Save as file button. Anyone who can
 * view the crawler gets the summary; gold, Misc Junk and the background notes
 * are only in the owner's copy, as on the sheet.
 */

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const loc = (key, data) => t(`CARL_RPG.Summary.${key}`, data);

/** HTML as plain text, whitespace collapsed. */
const plainText = (html) =>
  (new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** The crawler as lines of text. */
export function crawlerSummaryText(actor) {
  const s = actor.system;
  const owner = actor.isOwner;
  const lines = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && value !== '') lines.push(`${label}: ${value}`);
  };
  const heading = (name) => lines.push('', name.toUpperCase());
  const items = (type) =>
    actor.items.filter((i) => i.type === type).sort((a, b) => a.name.localeCompare(b.name));

  lines.push(
    s.crawlerNumber ? `${actor.name} (${loc('Crawler')} #${s.crawlerNumber})` : actor.name
  );
  add(loc('Race'), s.race);
  add(loc('Class'), s.className);
  add(loc('Level'), levelOf(s));
  add(loc('Floor'), getFloor());
  add(loc('Gender'), s.gender);

  heading(loc('Stats'));
  for (const key of Object.keys(CONFIG.CARL_RPG.abilities)) {
    const ability = s.abilities?.[key];
    if (!ability) continue;
    const mod = ability.mod ?? 0;
    lines.push(`${key.toUpperCase()}: ${ability.enhanced} (${mod >= 0 ? '+' : ''}${mod})`);
  }

  heading(loc('Skills'));
  for (const skill of items('skill')) {
    lines.push(`${skill.name} (${String(skill.system.stat).toUpperCase()}) ${loc('Rank')} ${skill.system.rank ?? 0}`);
  }

  heading(loc('Spells'));
  for (const spell of items('spell')) {
    lines.push(
      `${spell.name} ${loc('Rank')} ${spell.system.rank ?? 0}, ${spell.system.manaCost ?? 0} ${loc('Mana')}`
    );
  }

  heading(loc('Gear'));
  for (const gear of items('gear')) {
    lines.push(`${gear.name}${gear.system.equipped ? ` (${loc('Equipped')})` : ''}`);
  }

  heading(loc('Inventory'));
  for (const item of items('item')) {
    const quantity = item.system.quantity ?? 1;
    lines.push(`${item.name}${quantity > 1 ? ` x${quantity}` : ''}`);
  }
  if (owner) {
    add(loc('Gold'), s.gold);
    add(loc('Junk'), s.junk);
  }

  heading(loc('Personal'));
  for (const [type, label] of [
    ['sponsor', loc('Sponsor')],
    ['club', loc('Club')],
    ['deity', loc('Deity')],
  ]) {
    for (const item of items(type)) {
      const text = plainText(item.system.description);
      lines.push(`${label}: ${item.name}${text ? ` - ${text}` : ''}`);
    }
  }

  heading(loc('Bio'));
  lines.push(plainText(s.biography));

  if (owner) {
    heading(loc('Notes'));
    for (const [key, value] of Object.entries(s.background ?? {})) {
      const label = game.i18n.has(`CARL_RPG.Summary.Background.${key}`)
        ? loc(`Background.${key}`)
        : key;
      add(label, plainText(value));
    }
  }

  return lines.join('\n').trim();
}

/** Open the summary in a window, with a Save as file button. */
export async function showCrawlerSummary(actor) {
  const summary = crawlerSummaryText(actor);
  const save = await CarlRPGDialog.prompt({
    window: { title: loc('Title', { name: actor.name }) },
    content: `<textarea readonly rows="22" class="carl-summary">${foundry.utils.escapeHTML(
      summary
    )}</textarea>`,
    ok: { label: loc('SaveFile'), callback: () => true },
  });
  if (save) {
    const slug = actor.name.replace(/[^\w-]+/g, '_');
    foundry.utils.saveDataToFile(summary, 'text/plain', `${slug}-summary.txt`);
  }
}

/**
 * The Actors directory, with a Summary entry on the right-click menu of each
 * crawler the user can view.
 */
export class CarlRPGActorDirectory extends foundry.applications.sidebar.tabs.ActorDirectory {
  /** @inheritDoc */
  _getEntryContextOptions() {
    const options = super._getEntryContextOptions();
    const summary = {
      name: loc('Menu'),
      icon: '<i class="fa-solid fa-file-lines"></i>',
      condition: (li) => {
        const actor = this.collection.get(li.dataset.entryId);
        return actor?.type === 'crawler' && actor.testUserPermission(game.user, 'OBSERVER');
      },
      callback: (li) => showCrawlerSummary(this.collection.get(li.dataset.entryId)),
    };
    return [summary, ...options];
  }
}
