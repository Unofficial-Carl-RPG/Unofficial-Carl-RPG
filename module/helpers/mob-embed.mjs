/**
 * What a mob's @Embed card shows (the drawing is in helpers/journal.mjs). Plain data, no
 * DOM, so the rules can be tested without Foundry. Journal embeds deliberately show a mob's
 * numbers to anyone who can see the page.
 *
 * `words` carries the localized labels:
 *   level, evade, dr, move, surprise, floor, step, check, damage, ignoresDr  strings
 *   kind(key), size(key)                                        functions
 *   target(key), damageType(id), stat(key)                      functions
 */
export function mobEmbedInfo(actor, words) {
  const system = actor.system;
  const line = [
    words.kind(system.mobType),
    system.race || '',
    words.size(actor.system.size),
  ].filter(Boolean);

  // The stat block, as the book lays it out: a label over its value. Surprise, Evade and DR
  // show the mob's own number with "+F" (the Floor is added on top); Move shows "+S".
  const floor = system.floor ?? 0;
  const stats = [
    [words.level, `${system.attributes?.level?.value ?? 1}`],
    [words.surprise, `${(system.surpriseTotal ?? 0) - floor}+${words.floor}`],
    [words.evade, `${(system.evadeTotal ?? 0) - floor}+${words.floor}`],
    [words.move, `${system.moveTotal ?? 0}+${words.step}`],
    [words.dr, `${(system.drTotal ?? 0) - floor}+${words.floor}`],
  ];

  const attributes = Object.entries(system.abilities ?? {}).map(([key, data]) => ({
    key,
    label: words.stat(key),
    value: data.value ?? 0,
    mod: data.mod ?? 0,
    text: `${data.value ?? 0} (${(data.mod ?? 0) < 0 ? '' : '+'}${data.mod ?? 0})`,
  }));

  // The health bar as the mob sheet draws it: one box per point of max health, each showing the
  // damage it holds (a slot value row, else the CON modifier) over the share of health it is.
  const total = Math.max(1, Math.floor(system.health?.max ?? 1));
  const health = Array.from({ length: total }, (_, i) => ({
    label: `${system.health?.slots?.[i] ?? system.health?.perBox ?? 0}`,
    percent: `${Math.round(((i + 1) / total) * 100)}%`,
  }));

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

  return { line, stats, attributes, health, abilities };
}
