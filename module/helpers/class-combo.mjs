/**
 * Race and Class combos.
 *
 * Some races are also a class. A race is a combo when one of its effects holds the
 * "Acts as Class" modifier (CONFIG.CARL_RPG.effectModifiers.classCombo) above 0. It is
 * read from the race's own effects, so switching a copy of the effect off on a crawler
 * changes nothing.
 *
 * A crawler with a combo needs no class item: the combo fills the Class box, counts as
 * their class for class tag prerequisites and subclasses, and keeps them from taking
 * a Class item (see CarlRPGItem#_preCreate and helpers/origins.mjs).
 */

/**
 * Whether a race also acts as a class.
 * @param {Item|null|undefined} item
 * @returns {boolean}
 */
export function actsAsClass(item) {
  if (item?.type !== 'race') return false;
  const key = CONFIG.CARL_RPG.effectModifiers.classCombo.key;
  return [...(item.effects ?? [])].some((effect) =>
    (effect.changes ?? []).some((change) => change.key === key && Number(change.value) > 0)
  );
}
