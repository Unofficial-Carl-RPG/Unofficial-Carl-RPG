/*
 * The Action of an item (gear and plain items): what happens, roll-wise, when it is
 * used. Nothing (just the description), a stat check (1d20 + a stat's modifier),
 * a skill check (1d20 + a skill's stat, rank and bonuses) or a custom formula.
 * Stat and skill checks can add a modifier formula of their own.
 */

export const ACTION_TYPES = ['none', 'stat', 'skill', 'custom'];

/** The `action` field for an item's data model. */
export function actionSchema() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    type: new fields.StringField({
      required: true,
      blank: false,
      choices: ACTION_TYPES,
      initial: 'none',
    }),
    stat: new fields.StringField({ required: true, blank: false, initial: 'str' }),
    modifier: new fields.StringField({ required: true, blank: true, initial: '' }),
    formula: new fields.StringField({ required: true, blank: true, initial: '' }),
  });
}

/** A formula with a modifier added on ("+ 2" and "-1" work too; blank adds nothing). */
export function addModifier(formula, modifier) {
  const mod = String(modifier ?? '').trim();
  if (!mod) return formula;
  return /^[+-]/.test(mod) ? `${formula} ${mod[0]} ${mod.slice(1).trim()}` : `${formula} + ${mod}`;
}

/**
 * The roll formula of an action ('' when it has none). A skill check's formula is
 * built when it is used, from the skill; here it is only the plain d20.
 */
export function actionFormula(action) {
  switch (action?.type) {
    case 'stat':
      return addModifier(`1d20 + @${action.stat || 'str'}.mod`, action.modifier);
    case 'skill':
      return '1d20';
    case 'custom':
      return String(action.formula ?? '').trim();
    default:
      return '';
  }
}

/** Gear used to roll a built formula; an old item gets the action that matches it. */
const OLD_DEFAULT = { diceNum: 1, diceSize: 'd20', diceBonus: '+@str.mod+ceil(@lvl / 2)' };

/**
 * Give an item saved before actions existed the action that matches how it behaved:
 * gear with skills becomes a skill check, gear with a changed roll becomes a custom
 * formula, everything else has none.
 */
export function migrateAction(source, itemType) {
  if (source.action !== undefined) return source;
  let action = { type: 'none' };
  if (itemType === 'gear') {
    const roll = source.roll ?? {};
    const num = roll.diceNum ?? OLD_DEFAULT.diceNum;
    const size = roll.diceSize ?? OLD_DEFAULT.diceSize;
    const bonus = roll.diceBonus ?? OLD_DEFAULT.diceBonus;
    const changed =
      num !== OLD_DEFAULT.diceNum || size !== OLD_DEFAULT.diceSize || bonus !== OLD_DEFAULT.diceBonus;
    if ((source.skills ?? []).length) action = { type: 'skill' };
    else if (changed) action = { type: 'custom', formula: `${num}${size}${bonus}` };
  }
  source.action = action;
  return source;
}
