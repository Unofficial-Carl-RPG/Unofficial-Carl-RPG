/**
 * The small badges that summarise an item's main attributes, worked out from its
 * fields so nobody has to type them into the description. Shown at the top of the
 * Description tab and in tooltips (not in chat cards or sheet rows).
 */

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
