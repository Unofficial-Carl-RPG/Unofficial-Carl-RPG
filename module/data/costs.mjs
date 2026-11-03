/*
 * Costs: what an item spends when it is used. Each cost is a resource and an amount:
 * the user's Mana, the user's Misc Junk, or uses of the item itself (the item's Uses
 * settings say how many it has and when they come back).
 */

export const COST_RESOURCES = ['mana', 'junk', 'uses'];

/** The `costs` field for an item's data model. */
export function costsSchema() {
  const fields = foundry.data.fields;
  return new fields.ArrayField(
    new fields.SchemaField({
      resource: new fields.StringField({
        required: true,
        blank: false,
        choices: COST_RESOURCES,
        initial: 'mana',
      }),
      amount: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 1,
        initial: 1,
      }),
    })
  );
}

/** The total amount of one resource in a list of costs. */
export function costOf(costs, resource) {
  return (costs ?? [])
    .filter((c) => c?.resource === resource)
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

/**
 * The Mana a list of costs spends. An item saved before costs existed may still have
 * its own `manaCost` number, which counts when there are no costs yet.
 */
export function manaCostOf(costs, legacy = 0) {
  return Array.isArray(costs) ? costOf(costs, 'mana') : Number(legacy ?? 0);
}

/** How many of its own uses an item spends each time it is used. */
export const usesCost = (item) => costOf(item?.system?.costs, 'uses');

/**
 * Give an item saved before costs existed the costs that match how it behaved: a
 * spell's Mana Cost becomes a Mana cost, and an item with a limit on its uses spends
 * one use.
 */
export function migrateCosts(source) {
  if (source.costs !== undefined) return source;
  const costs = [];
  const mana = Number(source.manaCost ?? 0);
  if (mana > 0) costs.push({ resource: 'mana', amount: Math.trunc(mana) });
  if (Number(source.uses?.max ?? 0) > 0) costs.push({ resource: 'uses', amount: 1 });
  source.costs = costs;
  return source;
}
