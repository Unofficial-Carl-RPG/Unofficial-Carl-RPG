/**
 * What a mob's @Embed card shows (the drawing is in helpers/journal.mjs). Plain data, no
 * DOM, so the rules can be tested without Foundry. Journal embeds deliberately show a mob's
 * numbers to anyone who can see the page.
 *
 * `words` carries the localized labels:
 *   level, evade, dr, move, surprise, check, damage, ignoresDr  strings
 *   health(boxes, perBox), kind(key), size(key)                 functions
 *   target(key), damageType(id), stat(key)                      functions
 */
export function mobEmbedInfo(actor, words) {
  const system = actor.system;
  const line = [
    words.kind(system.mobType),
    system.race || '',
    words.size(actor.system.size),
    `${words.level} ${system.attributes?.level?.value ?? 1}`,
  ].filter(Boolean);

  const chips = [
    [words.evade, system.evadeTotal ?? 0],
    [words.dr, system.drTotal ?? 0],
    [words.move, system.moveTotal ?? 0],
    [words.surprise, system.surpriseTotal ?? 0],
  ];

  const attributes = Object.entries(system.abilities ?? {}).map(([key, data]) => ({
    key,
    label: words.stat(key),
    value: data.value ?? 0,
    mod: data.mod ?? 0,
  }));

  const health = words.health(system.health?.max ?? 0, system.health?.perBox ?? 0);

  const floor = system.floor ?? 0;
  const abilities = [...(actor.items ?? [])]
    .filter((item) => item.type === 'mobAbility')
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((item) => {
      const data = item.system;
      const target = data.check?.target ?? 'unopposed';
      const abilityChips = [[words.check, (data.check?.number ?? 0) + floor]];
      if (target !== 'unopposed') abilityChips.push([words.target(target), '']);
      if (data.damage) {
        const type = data.damageType ? ` ${words.damageType(data.damageType)}` : '';
        abilityChips.push([words.damage, `${data.damage}${type}`]);
        if (data.armorPiercing) abilityChips.push([words.ignoresDr, '']);
      }
      return { item, name: item.name, img: item.img, chips: abilityChips };
    });

  return { line, chips, attributes, health, abilities };
}
