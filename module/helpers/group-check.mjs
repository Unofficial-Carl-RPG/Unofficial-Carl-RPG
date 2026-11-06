import { checkNumber, ownCrawler, parseCheck, button, plain } from './journal.mjs';
import { rankOf } from './skill-rank.mjs';
import { degreeOf, naturalD20 } from './attacks.mjs';
import { partyMembers } from './party.mjs';
import { CarlRPGDialog } from './dialog.mjs';

/*
 * Group checks. The GM posts a card with a stat or skill and a DC. Each crawler's
 * owner clicks Roll on the card; the roll posts with its degree. Once every crawler
 * in the group has rolled, the GM's client posts the overall result by the pass rule
 * (all, most, or at least N must pass).
 *   /group str dc=12 most               chat command (GM only)
 *   @GroupCheck[skill=Climbing dc=floor] journal button (GM only)
 *   Dungeon Info > Group check          GM dialog
 */

const NS = 'carl-rpg';
const PASSING = ['success', 'amazing', 'critHit'];
const STATS = ['str', 'int', 'con', 'dex', 'cha'];

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const loc = (key, data) => t(`CARL_RPG.Group.${key}`, data);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));
const flagOf = (message) => message.getFlag(NS, 'group');

/** A group spec from text: "str dc=12 most" or "skill=Climbing dc=floor atLeast=2". */
export function parseGroupSpec(inner) {
  let text = inner.trim();
  let rule = 'all';
  let n = 1;
  const atLeast = text.match(/\batLeast=(\d+)\b/i);
  if (atLeast) {
    rule = 'atLeast';
    n = Number(atLeast[1]);
    text = text.replace(atLeast[0], ' ');
  } else if (/\bmost\b/i.test(text)) {
    rule = 'most';
    text = text.replace(/\bmost\b/i, ' ');
  } else {
    text = text.replace(/\ball\b/i, ' ');
  }
  const { skill, stat, dc } = parseCheck(text);
  return { skill, stat, dc: dc ?? 'unopposed', rule, n };
}

const specLabel = (spec) => spec.skill ?? (spec.stat ? spec.stat.toUpperCase() : loc('Check'));

const ruleText = (rule, n) =>
  rule === 'atLeast' ? loc('AtLeastText', { n }) : loc(rule === 'most' ? 'Most' : 'All');

/** GM: post the group card. */
export async function startGroupCheck(spec) {
  if (!game.user.isGM) return ui.notifications.warn(loc('NotGM'));
  const crawlers = partyMembers().map((member) => member.id);
  if (!crawlers.length) return ui.notifications.warn(loc('NoCrawlers'));
  const number = checkNumber(spec.dc);
  const label = specLabel(spec);
  await ChatMessage.create({
    content: `<div class="carl-group-card"><strong>${esc(loc('Title'))}</strong><div>${esc(
      label
    )} · ${esc(loc('DC'))} ${number}</div><div>${esc(ruleText(spec.rule, spec.n))}</div></div>`,
    flags: {
      [NS]: {
        card: { kind: 'check' },
        group: {
          id: foundry.utils.randomID(),
          label,
          stat: spec.stat ?? null,
          skill: spec.skill ?? null,
          dc: number,
          rule: spec.rule,
          n: spec.n,
          crawlers,
        },
      },
    },
  });
}

/** Whether a crawler has already rolled for a group. */
const rolledBy = (groupId, actorId) =>
  game.messages.contents.some((m) => {
    const g = flagOf(m);
    return g?.id === groupId && g?.actorId === actorId;
  });

/** A crawler's roll for a group, posted with its degree. */
async function rollGroupCheck(group) {
  const crawler = ownCrawler();
  if (!crawler || !group.crawlers.includes(crawler.id)) {
    return ui.notifications.warn(loc('NotInGroup'));
  }
  if (rolledBy(group.id, crawler.id)) return ui.notifications.warn(loc('AlreadyRolled'));

  let stat = group.stat ?? null;
  let rank = 0;
  if (group.skill) {
    // A skill's own stat and rank, as its roll on the sheet.
    const item = crawler.items.find(
      (i) => i.type === 'skill' && i.name.toLowerCase() === group.skill.toLowerCase()
    );
    if (!item) return ui.notifications.warn(loc('NoSkill', { name: group.skill }));
    stat = item.system.stat;
    rank = rankOf(item.system);
  }
  const mod = stat ? (crawler.system.abilities?.[stat]?.mod ?? 0) : 0;
  const roll = await new Roll('1d20 + @mod + @rank', { mod, rank }).evaluate();
  const degree = degreeOf(naturalD20(roll), roll.total, group.dc);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: crawler }),
    content: `<div class="carl-check">${esc(
      `${crawler.name}: ${group.label} ${roll.total} vs ${group.dc}, ${t(
        `CARL_RPG.Enrichers.Degree.${degree}`
      )}`
    )}</div>`,
    rolls: [roll],
    flags: {
      [NS]: {
        card: { kind: 'check', degree },
        group: {
          id: group.id,
          actorId: crawler.id,
          pass: PASSING.includes(degree),
          degree,
        },
      },
    },
  });
}

/**
 * Once every crawler in a group has rolled, the GM's client posts the overall
 * result. Runs once: the result message marks the group as finished.
 */
async function finishIfDone(groupId) {
  const messages = game.messages.contents;
  const card = messages.find((m) => flagOf(m)?.id === groupId && flagOf(m)?.crawlers);
  if (!card) return;
  if (messages.some((m) => flagOf(m)?.id === groupId && flagOf(m)?.result)) return;

  const group = flagOf(card);
  const rolls = messages.filter((m) => flagOf(m)?.id === groupId && flagOf(m)?.actorId);
  const rolled = new Set(rolls.map((m) => flagOf(m).actorId));
  if (!group.crawlers.every((id) => rolled.has(id))) return;

  const total = group.crawlers.length;
  const passes = rolls.filter((m) => flagOf(m).pass).length;
  const passed =
    group.rule === 'all'
      ? passes === total
      : group.rule === 'most'
        ? passes * 2 > total
        : passes >= group.n;

  const lines = rolls
    .map((m) => {
      const name = game.actors.get(flagOf(m).actorId)?.name ?? '';
      const degree = t(`CARL_RPG.Enrichers.Degree.${flagOf(m).degree}`);
      return `<li>${esc(name)}: ${esc(degree)}</li>`;
    })
    .join('');
  await ChatMessage.create({
    content: `<div class="carl-group-card carl-group-result"><strong>${esc(
      loc('Overall')
    )}: ${esc(group.label)}</strong><ul>${lines}</ul><div>${esc(
      loc(passed ? 'Passed' : 'Failed', { passes, total })
    )}</div></div>`,
    flags: {
      [NS]: {
        card: { kind: 'check', degree: passed ? 'success' : 'fail' },
        group: { id: groupId, result: true },
      },
    },
  });
}

/** GM: a dialog for the stat or skill, the DC and the pass rule. Resolves to a spec or null. */
export function promptGroupCheck() {
  const statOptions = [
    `<option value="">${loc('None')}</option>`,
    ...STATS.map((s) => `<option value="${s}">${s.toUpperCase()}</option>`),
  ].join('');
  return CarlRPGDialog.prompt({
    window: { title: loc('Title') },
    content: `
      <div class="form-group"><label>${loc('Stat')}</label><select name="stat">${statOptions}</select></div>
      <div class="form-group"><label>${loc('Skill')}</label><input name="skill" type="text" placeholder="${esc(
        loc('SkillPlaceholder')
      )}" /></div>
      <div class="form-group"><label>${loc('DC')}</label><input name="dc" type="number" value="12" /></div>
      <div class="form-group"><label>${loc('Rule')}</label><select name="rule">
        <option value="all">${loc('All')}</option>
        <option value="most">${loc('Most')}</option>
        <option value="atLeast">${loc('AtLeast')}</option>
      </select></div>
      <div class="form-group"><label>${loc('N')}</label><input name="n" type="number" min="1" value="2" /></div>`,
    ok: {
      label: loc('Start'),
      callback: (event, btn) => {
        const f = btn.form.elements;
        const skill = f.skill.value.trim();
        return {
          skill: skill || null,
          stat: skill ? null : f.stat.value || null,
          dc: f.dc.value || 'unopposed',
          rule: f.rule.value,
          n: Number(f.n.value) || 1,
        };
      },
    },
  });
}

export function registerGroupChecks() {
  // The GM's client finishes a group when its last roll is posted (one GM client does it).
  Hooks.on('createChatMessage', (message) => {
    const group = flagOf(message);
    if (!group?.actorId || !game.user.isGM || game.users.activeGM !== game.user) return;
    finishIfDone(group.id);
  });

  // A group card carries a Roll button until the group has its result.
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const group = flagOf(message);
    if (!group?.crawlers || group.result) return;
    if (game.messages.contents.some((m) => flagOf(m)?.id === group.id && flagOf(m)?.result)) {
      return;
    }
    const content = html.querySelector('.message-content');
    if (!content || content.querySelector('.carl-group-roll')) return;
    content.append(button(loc('Roll'), 'carl-group-roll', () => rollGroupCheck(group)));
  });

  // @GroupCheck[...] in journal text: a button for the GM, plain text for players.
  CONFIG.TextEditor.enrichers.push({
    pattern: /@GroupCheck\[([^\]]*)\]/g,
    enricher: (match) => {
      const spec = parseGroupSpec(match[1]);
      if (!game.user.isGM) return plain(specLabel(spec));
      return button(loc('Start'), 'carl-enrich-group', () => startGroupCheck(spec));
    },
  });
}
