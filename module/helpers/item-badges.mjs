import { costOf, manaCostOf } from '../data/costs.mjs';
import { hasStat } from './stat-term.mjs';
import { rangeInfo } from './amounts.mjs';
import { splashReach } from './area-plan.mjs';
import { effectiveOf } from './upgrades.mjs';

import { isTwoHanded } from './gear-slots.mjs';

/**
 * The small badges that summarise an item's main attributes, worked out from its
 * fields so nobody has to type them into the description. Shown at the top of the
 * Description tab and in tooltips (not in chat cards or sheet rows).
 */

/**
 * An item's Short Description as plain text (its full description if it has no
 * short one), cut to a line. Markup is read as text only, never run.
 * @param {Item} item
 * @returns {string}
 */
export function shortTextOf(item) {
  const html = (item?.system?.shortDescription ?? '').trim() || (item?.system?.description ?? '');
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > 160 ? `${plain.slice(0, 157)}...` : plain;
}

/**
 * A range (see rangeInfo in helpers/amounts.mjs) as text: "30 ft", Melee, Touch,
 * Unlimited, or the formula itself when it can't be worked out yet. Blank for no range.
 * @param {{kind: string, feet: number, text: string}} info
 * @returns {string}
 */
export function rangeText(info) {
  const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
  switch (info.kind) {
    case 'melee':
      return loc('CARL_RPG.Targeting.RangeMelee');
    case 'touch':
      return loc('CARL_RPG.Targeting.RangeTouch');
    case 'unlimited':
      return loc('CARL_RPG.Targeting.RangeUnlimited');
    case 'feet':
      return loc('CARL_RPG.Targeting.RangeFeet', { n: info.feet });
    case 'none':
      return '';
    default:
      return info.text;
  }
}

/**
 * @param {Item} item
 * @returns {string[]} The badge labels, in display order.
 */
export function describeBadges(item) {
  const sys = item?.system ?? {};
  const loc = (key) => game.i18n.localize(key);
  const badges = [];

  // Mob abilities: their numbers are for the GM only.
  if (item.type === 'mobAbility') {
    if (!game.user?.isGM) return [];
    if (hasStat(sys.stat)) badges.push(loc(CONFIG.CARL_RPG.abilities[sys.stat] ?? sys.stat));
    const target = sys.check?.target;
    if (target && CONFIG.CARL_RPG.checkTargets[target]) {
      badges.push(loc(CONFIG.CARL_RPG.checkTargets[target]));
    }
    return badges;
  }

  // Skills and spells: the stat, the type, the damage, mana and targets.
  if (['skill', 'spell'].includes(item.type)) {
    const eff = sys.effective ?? {};
    const labels = costLabelsOf(item);
    if (hasStat(sys.stat)) badges.push(loc(CONFIG.CARL_RPG.abilities[sys.stat] ?? sys.stat));
    let kind = 'CARL_RPG.Badges.Utility';
    if (sys.passive) kind = 'CARL_RPG.Badges.Passive';
    else if ((eff.target ?? sys.check?.target) === 'evade') kind = 'CARL_RPG.Badges.Attack';
    badges.push(loc(kind));
    if (eff.damage) badges.push(`${loc('CARL_RPG.Badges.Damage')} ${eff.damage}`);
    if (item.type === 'spell') {
      badges.push(`${loc('CARL_RPG.Badges.Mana')} ${labels.mana || 0}`);
    }
    const target = eff.target ?? sys.check?.target;
    if (target && CONFIG.CARL_RPG.checkTargets[target]) {
      badges.push(loc(CONFIG.CARL_RPG.checkTargets[target]));
    }
  }

  // Gear and items: the stat their action rolls, and what it is checked against.
  if (['gear', 'item'].includes(item.type) && sys.action?.type && sys.action.type !== 'none') {
    let stat = sys.action.type === 'stat' ? sys.action.stat : '';
    if (sys.action.type === 'skill') stat = rollingSkillOf(item)?.system?.stat ?? '';
    if (hasStat(stat)) badges.push(loc(CONFIG.CARL_RPG.abilities[stat] ?? stat));
    const target = sys.check?.target;
    if (target && CONFIG.CARL_RPG.checkTargets[target]) {
      badges.push(loc(CONFIG.CARL_RPG.checkTargets[target]));
    }
  }

  // Gear: the slot and the Damage Resistance it gives.
  if (item.type === 'gear') {
    if (sys.slot && CONFIG.CARL_RPG.gearSlots[sys.slot]) {
      badges.push(
        loc(isTwoHanded(sys) ? 'CARL_RPG.Item.Gear.Slots.handsTwo' : CONFIG.CARL_RPG.gearSlots[sys.slot])
      );
    }
    if (sys.dr > 0) badges.push(`${loc('CARL_RPG.Badges.DR')} ${sys.dr}`);
  }

  // Anything with a damage formula (gear and items) shows it.
  if (['gear', 'item'].includes(item.type) && sys.damage) {
    badges.push(`${loc('CARL_RPG.Badges.Damage')} ${sys.damage}`);
  }

  // What using it costs, other than a spell's Mana (shown above), and Interrupts.
  if (item.type !== 'spell') {
    const mana = costLabelsOf(item).mana;
    if (mana) badges.push(`${loc('CARL_RPG.Badges.Mana')} ${mana}`);
  }
  const junk = costLabelsOf(item).junk;
  if (junk) badges.push(`${loc('CARL_RPG.Badges.Junk')} ${junk}`);
  if (sys.interrupt) badges.push(loc('CARL_RPG.Badges.Interrupt'));

  // Ammunition: what a use spends and, on a crawler, how much is left.
  for (const ammo of item.ammoSummary ?? []) {
    const left = ammo.left === null ? '' : ` (${ammo.left})`;
    badges.push(`${loc('CARL_RPG.Badges.Ammo')} ${ammo.name} ${ammo.need}${left}`.replace(/\s+/g, ' ').trim());
  }

  // How far it reaches, for an item that picks targets or places an area.
  const targeting = sys.targeting;
  if (['count', 'area'].includes(targeting?.mode) && String(targeting.range ?? '').trim()) {
    const info = item.rangeInfo ? item.rangeInfo() : rangeInfo(targeting.range);
    badges.push(`${loc('CARL_RPG.Badges.Range')} ${rangeText(info)}`);
  }
  // The extra reach of a splash (beyond an area, or around each chosen target).
  if (['count', 'area'].includes(targeting?.mode)) {
    const splash = splashReach(targeting, effectiveOf(item), item.costData ? item.costData() : {});
    if (splash > 0) {
      badges.push(
        `${loc('CARL_RPG.Badges.Splash')} ${game.i18n.format('CARL_RPG.Targeting.RangeFeet', { n: splash })}`
      );
    }
  }

  // Quantity and uses, wherever the item has them.
  if (sys.quantity !== undefined && sys.quantity > 1) {
    badges.push(`${loc('CARL_RPG.Badges.Quantity')} ${sys.quantity}`);
  }
  if (sys.uses?.max > 0) {
    const left = Math.max(0, sys.uses.max - (sys.uses.spent ?? 0));
    badges.push(`${loc('CARL_RPG.Badges.Uses')} ${left}/${sys.uses.max}`);
  }

  return badges;
}

/** What an item costs in each resource, as text (a stand-in for anything that isn't an item document). */
function costLabelsOf(item) {
  if (item.costLabels) return item.costLabels();
  const sys = item.system;
  const text = (n) => (n > 0 ? String(n) : '');
  return { mana: text(manaCostOf(sys.costs)), junk: text(costOf(sys.costs, 'junk')), uses: '' };
}

/**
 * The skill a gear or item's skill check rolls with, if any: the one picked on its
 * crawler's sheet (one of the crawler's own skills), else the first it lists.
 */
function rollingSkillOf(item) {
  const uuids = item.system.skills ?? [];
  if (!uuids.length) return null;
  const find = (uuid) => {
    try {
      const skill = uuid ? fromUuidSync(uuid) : null;
      return skill?.type === 'skill' ? skill : null;
    } catch {
      return null;
    }
  };
  return find(item.system.rollSkill) ?? find(uuids[0]);
}

/**
 * A row of badges for a chat card. The parts must already be safe HTML (they are made
 * from translated text and escaped values); a closing full stop is dropped.
 * @param {string[]} parts
 * @param {string} [className]   An extra class for the row
 * @returns {string} HTML ('' when there is nothing to show)
 */
export function badgeRowHtml(parts, className = '') {
  const shown = parts.filter(Boolean).map((part) => String(part).trim().replace(/\.$/, ''));
  if (!shown.length) return '';
  const badges = shown.map((part) => `<span class="item-badge">${part}</span>`).join('');
  return `<div class="item-badges ${className}">${badges}</div>`;
}

/**
 * The top of an item's chat card: its image, its name beside it and its badges (the
 * ones the tooltip shows) under the name. A mob ability shows no badges: its numbers
 * are for the GM, and a card is written once for everyone.
 * @param {Item} item
 * @returns {string} HTML
 */
export function itemCardHeader(item) {
  const esc = foundry.utils.escapeHTML;
  const badges = (item.type === 'mobAbility' ? [] : [...describeBadges(item), ...skillBadges(item)])
    .map((badge) => `<span class="item-badge">${esc(badge)}</span>`)
    .join('');
  return (
    '<div class="item-card-head">' +
    `<img class="item-card-img" src="${esc(item.img)}" alt="" width="40" height="40">` +
    `<div class="item-card-title"><div class="item-card-name">${esc(item.name)}</div>` +
    (badges ? `<div class="item-badges">${badges}</div>` : '') +
    '</div></div>'
  );
}

/**
 * Badges for the skills a gear or item holds: the one its skill check rolls with
 * (with its stat), and the others it also grants. Names only, so nothing is fetched.
 * @param {Item} item
 * @returns {string[]}
 */
export function skillBadges(item) {
  if (item?.type !== 'gear') return [];
  const loc = (key) => game.i18n.localize(key);
  const uuids = item.system.skills ?? [];
  const rolling = item.system.action?.type === 'skill' ? rollingSkillOf(item) : null;
  // The crawler's own copy and the skill the weapon lists are the same skill when
  // their identifier (or name) match.
  const keyOf = (skill) => skill?.system?.identifier?.trim() || skill?.name;
  const badges = [];
  if (rolling) {
    const abbr = CONFIG.CARL_RPG.abilityAbbreviations[rolling.system?.stat];
    const stat = abbr ? loc(abbr) : '';
    const label = stat ? ` (${stat.charAt(0).toUpperCase()}${stat.slice(1).toLowerCase()})` : '';
    badges.push(`${loc('CARL_RPG.Badges.RollsWith')} ${rolling.name}${label}`);
  }
  for (const uuid of uuids) {
    let skill = null;
    try {
      skill = fromUuidSync(uuid);
    } catch {
      /* not loaded: the uuid is shown instead */
    }
    if (rolling && skill && keyOf(skill) === keyOf(rolling)) continue;
    badges.push(`${loc('CARL_RPG.Badges.AlsoGrants')} ${skill?.name ?? uuid}`);
  }
  return badges;
}
