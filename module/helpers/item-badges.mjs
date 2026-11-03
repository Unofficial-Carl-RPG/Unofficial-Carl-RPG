import { costOf, manaCostOf } from '../data/costs.mjs';

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
    if (sys.stat) badges.push(loc(CONFIG.CARL_RPG.abilities[sys.stat] ?? sys.stat));
    const target = sys.check?.target;
    if (target && CONFIG.CARL_RPG.checkTargets[target]) {
      badges.push(loc(CONFIG.CARL_RPG.checkTargets[target]));
    }
    return badges;
  }

  // Skills and spells: the stat, the type, the damage, mana and targets.
  if (['skill', 'spell'].includes(item.type)) {
    const eff = sys.effective ?? {};
    if (sys.stat) badges.push(loc(CONFIG.CARL_RPG.abilities[sys.stat] ?? sys.stat));
    let kind = 'CARL_RPG.Badges.Utility';
    if (sys.passive) kind = 'CARL_RPG.Badges.Passive';
    else if ((eff.target ?? sys.check?.target) === 'evade') kind = 'CARL_RPG.Badges.Attack';
    badges.push(loc(kind));
    if (eff.damage) badges.push(`${loc('CARL_RPG.Badges.Damage')} ${eff.damage}`);
    if (item.type === 'spell') {
      badges.push(`${loc('CARL_RPG.Badges.Mana')} ${eff.manaCost ?? sys.manaCost ?? 0}`);
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
    if (stat) badges.push(loc(CONFIG.CARL_RPG.abilities[stat] ?? stat));
    const target = sys.check?.target;
    if (target && CONFIG.CARL_RPG.checkTargets[target]) {
      badges.push(loc(CONFIG.CARL_RPG.checkTargets[target]));
    }
  }

  // Gear: the slot and the Damage Resistance it gives.
  if (item.type === 'gear') {
    if (sys.slot && CONFIG.CARL_RPG.gearSlots[sys.slot]) {
      badges.push(loc(CONFIG.CARL_RPG.gearSlots[sys.slot]));
    }
    if (sys.dr > 0) badges.push(`${loc('CARL_RPG.Badges.DR')} ${sys.dr}`);
  }

  // Anything with a damage formula (gear and items) shows it.
  if (['gear', 'item'].includes(item.type) && sys.damage) {
    badges.push(`${loc('CARL_RPG.Badges.Damage')} ${sys.damage}`);
  }

  // What using it costs, other than a spell's Mana (shown above), and Interrupts.
  if (item.type !== 'spell') {
    const mana = item.type === 'skill' ? (sys.effective?.manaCost ?? manaCostOf(sys.costs)) : manaCostOf(sys.costs);
    if (mana > 0) badges.push(`${loc('CARL_RPG.Badges.Mana')} ${mana}`);
  }
  const junk = costOf(sys.costs, 'junk');
  if (junk > 0) badges.push(`${loc('CARL_RPG.Badges.Junk')} ${junk}`);
  if (sys.interrupt) badges.push(loc('CARL_RPG.Badges.Interrupt'));

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

/** The skill (as the world has it) a gear or item's skill check rolls with, if any. */
function rollingSkillOf(item) {
  const uuids = item.system.skills ?? [];
  if (!uuids.length) return null;
  const marked = uuids.includes(item.system.rollSkill) ? item.system.rollSkill : uuids[0];
  try {
    return fromUuidSync(marked);
  } catch {
    return null;
  }
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
  return uuids.map((uuid) => {
    let skill = null;
    try {
      skill = fromUuidSync(uuid);
    } catch {
      /* not loaded: the uuid is shown instead */
    }
    const name = skill?.name ?? uuid;
    if (rolling && skill?.uuid === rolling.uuid) {
      const abbr = CONFIG.CARL_RPG.abilityAbbreviations[skill.system?.stat];
      const stat = abbr ? loc(abbr) : '';
      const label = stat ? ` (${stat.charAt(0).toUpperCase()}${stat.slice(1).toLowerCase()})` : '';
      return `${loc('CARL_RPG.Badges.RollsWith')} ${name}${label}`;
    }
    return `${loc('CARL_RPG.Badges.AlsoGrants')} ${name}`;
  });
}
