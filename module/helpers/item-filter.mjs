/**
 * A filter and sort bar above each item list on an actor sheet. It works in the
 * browser only: the choices are remembered per person, per list, on this computer.
 */

const esc = (value) => foundry.utils.escapeHTML(String(value ?? ''));
const loc = (key) => game.i18n.localize(key);

/** A description as plain text, for searching it. */
function plainText(html) {
  const text = new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent ?? '';
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The types an item has, as chips. Each chip has a group: chips in the same group
 * are alternatives (one is enough), and a list needs a match in every group chosen.
 * @param {Item} item
 * @returns {{group: string, key: string, label: string}[]}
 */
export function chipsFor(item) {
  const sys = item.system ?? {};
  const chips = [];
  if (['skill', 'spell'].includes(item.type)) {
    const key = sys.passive ? 'passive' : sys.check?.target === 'evade' ? 'attack' : 'utility';
    const label = { passive: 'CARL_RPG.Badges.Passive', attack: 'CARL_RPG.Badges.Attack', utility: 'CARL_RPG.Badges.Utility' }[key];
    chips.push({ group: 'kind', key, label });
  }
  if (item.type === 'mobAbility') {
    const attack = sys.check?.target === 'evade' || !!sys.damage;
    chips.push({
      group: 'kind',
      key: attack ? 'attack' : 'other',
      label: attack ? 'CARL_RPG.Badges.Attack' : 'CARL_RPG.Filter.Other',
    });
  }
  if (item.type === 'gear') {
    if (sys.slot) chips.push({ group: 'slot', key: sys.slot, label: CONFIG.CARL_RPG.gearSlots[sys.slot] ?? sys.slot });
    chips.push({
      group: 'equip',
      key: sys.equipped ? 'equipped' : 'notEquipped',
      label: sys.equipped ? 'CARL_RPG.Filter.Equipped' : 'CARL_RPG.Filter.NotEquipped',
    });
    const weapon = !!sys.damage;
    const armor = (sys.dr ?? 0) > 0;
    if (weapon) chips.push({ group: 'category', key: 'weapon', label: 'CARL_RPG.Filter.Weapon' });
    if (armor) chips.push({ group: 'category', key: 'armor', label: 'CARL_RPG.Filter.Armor' });
    if (!weapon && !armor) chips.push({ group: 'category', key: 'other', label: 'CARL_RPG.Filter.Other' });
    if ((sys.quantity ?? 1) > 1 || (sys.uses?.max ?? 0) > 0) {
      chips.push({ group: 'category', key: 'consumable', label: 'CARL_RPG.Filter.Consumable' });
    }
  }
  return chips;
}

/** Remaining uses of an item, or Infinity when it has none (so they sort last). */
function usesLeft(item) {
  const max = item.system?.uses?.max ?? 0;
  return max > 0 ? max - (item.system?.uses?.spent ?? 0) : Infinity;
}

/** Whether a row passes the search, the chips and the tags. */
function matches(item, state) {
  const term = (state.search ?? '').trim().toLowerCase();
  if (term) {
    const inName = (item.name ?? '').toLowerCase().includes(term);
    const inDesc = state.inDesc && plainText(item.system?.description).includes(term);
    if (!inName && !inDesc) return false;
  }
  const chips = chipsFor(item);
  for (const [group, keys] of Object.entries(state.groups ?? {})) {
    if (!keys?.length) continue;
    if (!chips.some((c) => c.group === group && keys.includes(c.key))) return false;
  }
  if (state.tags?.length) {
    const tags = item.system?.tags ?? [];
    const ok =
      state.tagMode === 'all'
        ? state.tags.every((t) => tags.includes(t))
        : state.tags.some((t) => tags.includes(t));
    if (!ok) return false;
  }
  return true;
}

/** The sort options that make sense for the items in a list. */
function sortOptions(items, canSortValue = false) {
  const options = [
    { value: 'manual', label: 'CARL_RPG.Filter.Sort.Manual' },
    { value: 'name', label: 'CARL_RPG.Filter.Sort.Name' },
  ];
  if (items.some((i) => i.type !== items[0].type || ['gear', 'mobAbility'].includes(i.type))) {
    options.push({ value: 'type', label: 'CARL_RPG.Filter.Sort.Type' });
  }
  if (items.some((i) => ['skill', 'spell'].includes(i.type))) {
    options.push({ value: 'rank', label: 'CARL_RPG.Filter.Sort.Rank' });
  }
  if (items.some((i) => i.type === 'spell')) {
    options.push({ value: 'mana', label: 'CARL_RPG.Filter.Sort.Mana' });
  }
  if (items.some((i) => usesLeft(i) !== Infinity)) {
    options.push({ value: 'uses', label: 'CARL_RPG.Filter.Sort.Uses' });
  }
  if (items.some((i) => i.type === 'gear')) {
    options.push({ value: 'slot', label: 'CARL_RPG.Filter.Sort.Slot' });
  }
  if (canSortValue) {
    options.push({ value: 'value', label: 'CARL_RPG.Filter.Sort.Value' });
  }
  return options;
}

/** Compare two rows by the chosen sort. */
function compareRows(sort, a, b) {
  const byName = a.item.name.localeCompare(b.item.name);
  const typeOrder = ['skill', 'spell', 'gear', 'mobAbility'];
  switch (sort) {
    case 'name':
      return byName;
    case 'type':
      return (
        (typeOrder.indexOf(a.item.type) - typeOrder.indexOf(b.item.type)) || byName
      );
    case 'rank':
      return (a.item.system.rank ?? 0) - (b.item.system.rank ?? 0) || byName;
    case 'value':
      return (a.item.system.value ?? 0) - (b.item.system.value ?? 0) || byName;
    case 'mana':
      return (a.item.system.manaCost ?? 0) - (b.item.system.manaCost ?? 0) || byName;
    case 'uses': {
      const x = usesLeft(a.item);
      const y = usesLeft(b.item);
      return (x === y ? 0 : x < y ? -1 : 1) || byName;
    }
    case 'slot': {
      const slots = Object.keys(CONFIG.CARL_RPG.gearSlots);
      const equipped = (b.item.system.equipped ? 1 : 0) - (a.item.system.equipped ? 1 : 0);
      const slot = slots.indexOf(a.item.system.slot) - slots.indexOf(b.item.system.slot);
      return equipped || slot || byName;
    }
    default:
      return a.manual - b.manual;
  }
}

/** Load a list's saved filters, or the defaults. */
function loadState(key) {
  const defaults = { search: '', inDesc: false, groups: {}, tags: [], tagMode: 'any', sort: 'manual', open: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch (err) {
    return defaults;
  }
}

function saveState(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (err) {
    // Storage can be blocked; the filters still work for this visit.
  }
}

/**
 * Add a filter and sort bar above each item list on an actor sheet.
 * @param {ActorSheet} sheet
 */
export function setupItemFilters(sheet) {
  const actor = sheet.actor;
  const lists = [...sheet.element.querySelectorAll('ol.items-list')];
  lists.forEach((list, index) => {
    const rows = [...list.querySelectorAll(':scope > li.item[data-item-id]')]
      .map((li, manual) => {
        const item = actor.items.get(li.dataset.itemId);
        const next = li.nextElementSibling;
        const body = next?.classList.contains('item-desc') ? next : null;
        return { li, body, item, manual };
      })
      .filter((row) => row.item);
    if (!rows.length) return;

    const items = rows.map((row) => row.item);
    const tab = list.closest('[data-tab]')?.dataset.tab ?? 'sheet';
    const key = `carl-rpg.filter.${actor.id}.${tab}.${index}`;
    const state = loadState(key);

    const bar = document.createElement('div');
    bar.className = 'item-filter-bar';
    // Sits above the expand and collapse control, when there is one.
    const above = list.previousElementSibling?.classList.contains('item-desc-all')
      ? list.previousElementSibling
      : list;
    above.before(bar);

    const apply = () => {
      for (const row of rows) {
        const visible = matches(row.item, state);
        row.li.classList.toggle('if-out', !visible);
        row.body?.classList.toggle('if-out', !visible);
      }
      const sorted = [...rows].sort((a, b) => compareRows(state.sort, a, b));
      for (const row of sorted) {
        list.append(row.li);
        if (row.body) list.append(row.body);
      }
    };

    const paint = () => {
      const chipMap = new Map();
      for (const item of items) {
        for (const chip of chipsFor(item)) chipMap.set(`${chip.group}|${chip.key}`, chip);
      }
      const tagList = [...new Set(items.flatMap((item) => item.system?.tags ?? []))].sort();
      const sortChoices = sortOptions(items, game.user.isGM || !!actor.system.bonuses?.sortValue);
      if (!sortChoices.some((o) => o.value === state.sort)) state.sort = 'manual';

      const chipHtml = [...chipMap.values()]
        .map((chip) => {
          const on = state.groups?.[chip.group]?.includes(chip.key) ? ' checked' : '';
          return `<label class="if-chip"><input type="checkbox" data-group="${esc(chip.group)}" data-key="${esc(chip.key)}"${on}> ${esc(loc(chip.label))}</label>`;
        })
        .join('');
      const tagHtml = tagList.length
        ? `<details class="if-tags"><summary>${loc('CARL_RPG.Filter.Tags')}</summary>
            <select class="if-tag-mode">
              <option value="any"${state.tagMode !== 'all' ? ' selected' : ''}>${loc('CARL_RPG.Filter.Any')}</option>
              <option value="all"${state.tagMode === 'all' ? ' selected' : ''}>${loc('CARL_RPG.Filter.All')}</option>
            </select>
            ${tagList
              .map((tag) => `<label class="if-chip"><input type="checkbox" data-tag="${esc(tag)}"${state.tags.includes(tag) ? ' checked' : ''}> ${esc(tag)}</label>`)
              .join('')}
          </details>`
        : '';
      const sortHtml =
        sortChoices.length > 2
          ? `<select class="if-sort" title="${loc('CARL_RPG.Filter.SortHint')}">${sortChoices
              .map((o) => `<option value="${o.value}"${o.value === state.sort ? ' selected' : ''}>${loc(o.label)}</option>`)
              .join('')}</select>`
          : '';

      bar.innerHTML = `
        <details class="item-filter"${state.open ? ' open' : ''}>
          <summary>${loc('CARL_RPG.Filter.Title')}</summary>
          <div class="if-body">
            <div class="if-row">
              <input type="search" class="if-search" placeholder="${loc('CARL_RPG.Filter.Search')}" value="${esc(state.search)}">
              <label class="if-inline"><input type="checkbox" class="if-desc"${state.inDesc ? ' checked' : ''}> ${loc('CARL_RPG.Filter.Descriptions')}</label>
              ${sortHtml}
              <button type="button" class="if-clear">${loc('CARL_RPG.Filter.Clear')}</button>
            </div>
            ${chipHtml ? `<div class="if-chips">${chipHtml}</div>` : ''}
            ${tagHtml}
          </div>
        </details>`;

      bar.querySelector('details.item-filter').addEventListener('toggle', (event) => {
        state.open = event.currentTarget.open;
        saveState(key, state);
      });
    };

    // One set of listeners on the bar: the controls are rebuilt by paint().
    bar.addEventListener('input', (event) => {
      if (!event.target.matches('.if-search')) return;
      state.search = event.target.value;
      saveState(key, state);
      apply();
    });
    bar.addEventListener('change', (event) => {
      const el = event.target;
      if (el.matches('.if-desc')) state.inDesc = el.checked;
      else if (el.matches('.if-sort')) state.sort = el.value;
      else if (el.matches('.if-tag-mode')) state.tagMode = el.value;
      else if (el.dataset.group) {
        const keys = new Set(state.groups[el.dataset.group] ?? []);
        if (el.checked) keys.add(el.dataset.key);
        else keys.delete(el.dataset.key);
        state.groups[el.dataset.group] = [...keys];
      } else if (el.dataset.tag) {
        state.tags = el.checked
          ? [...state.tags, el.dataset.tag]
          : state.tags.filter((t) => t !== el.dataset.tag);
      } else return;
      saveState(key, state);
      apply();
    });
    bar.addEventListener('click', (event) => {
      if (!event.target.closest('.if-clear')) return;
      Object.assign(state, { search: '', inDesc: false, groups: {}, tags: [], tagMode: 'any' });
      saveState(key, state);
      paint();
      apply();
    });

    paint();
    apply();
  });
}
