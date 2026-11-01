/**
 * The events editor, shared by the sheets that have one (the item sheet, the effect
 * sheet and the pet's Upgrades tab). The pieces here:
 *
 *  - buildEventRows / eventOptions  what the editor template (templates/item/
 *    event-cards.hbs) needs
 *  - EVENT_EDITOR_ACTIONS           the add / remove / move / duplicate buttons, to
 *    be listed among a sheet's actions
 *  - saveEventField / dropTarget    saving a field, and dropping a document on a
 *    drop box
 *  - EVENT_TEMPLATES                ready-made events to start from
 *
 * A sheet that uses them provides `_updateEvents(mutate)`, which changes a copy of
 * the stored data with `mutate(system)` and saves it, and `eventDoc` (the item,
 * effect or actor the events belong to, for "run now"). Controls name the list of
 * events they belong to with `data-list` (such as 'events' or 'upgrades.0.events').
 */
import { summarizeEvent } from './event-summary.mjs';
import { runEventNow } from './events.mjs';

const t = (key) => game.i18n.localize(key);

/** The list of events a control of the event editor belongs to (its `data-list`, or the sheet's own). */
export const eventList = (system, target) =>
  foundry.utils.getProperty(system, target?.dataset?.list || 'events');

/* -------------------------------------------- */
/*  New events, conditions and actions          */
/* -------------------------------------------- */

/** A new event, with every field filled in. */
export function newEvent(trigger = 'used', extra = {}) {
  return {
    id: foundry.utils.randomID(),
    name: '',
    enabled: true,
    trigger,
    phase: 'any',
    match: 'all',
    conditions: [],
    actions: [],
    ...extra,
  };
}

/** A new condition, with every field filled in. */
export function newCondition(extra = {}) {
  return {
    type: 'mana',
    negate: false,
    stat: 'str',
    value: 1,
    phase: 'any',
    degree: 'success',
    uuid: '',
    tag: '',
    text: '',
    ...extra,
  };
}

/** A new action, with every field filled in. */
export function newAction(extra = {}) {
  return {
    type: 'useItem',
    mode: '',
    uuid: '',
    amount: '1',
    targetActor: '',
    runOn: 'user',
    selfItem: false,
    skipIfHas: true,
    ignoreDR: false,
    ask: false,
    text: '',
    targetGroup: '',
    ...extra,
  };
}

/** Events to start from (for the "add from a template" links). */
export const EVENT_TEMPLATES = {
  damageOverTime: () =>
    newEvent('roundEnd', {
      name: t('CARL_RPG.Events.Templates.damageOverTime'),
      actions: [newAction({ type: 'health', mode: 'damage', amount: '2', ignoreDR: true })],
    }),
  healEachRound: () =>
    newEvent('roundEnd', {
      name: t('CARL_RPG.Events.Templates.healEachRound'),
      actions: [newAction({ type: 'health', mode: 'heal', amount: '1' })],
    }),
  manaEachRound: () =>
    newEvent('roundEnd', {
      name: t('CARL_RPG.Events.Templates.manaEachRound'),
      actions: [newAction({ type: 'mana', mode: 'restore', amount: '1' })],
    }),
  bossLine: () =>
    newEvent('takesDamage', {
      name: t('CARL_RPG.Events.Templates.bossLine'),
      conditions: [
        newCondition({ type: 'health', value: 5 }),
        newCondition({ type: 'effect', uuid: '', negate: true }),
      ],
      actions: [
        newAction({ type: 'toggleEffect', mode: 'on', uuid: '' }),
        newAction({ type: 'message', text: '{name} enters a new phase!' }),
      ],
    }),
  bossSwap: () =>
    newEvent('takesDamage', {
      name: t('CARL_RPG.Events.Templates.bossSwap'),
      conditions: [
        newCondition({ type: 'health', value: 5 }),
        newCondition({ type: 'effect', uuid: '', negate: true }),
      ],
      actions: [
        newAction({ type: 'toggleEffect', mode: 'on', uuid: '' }),
        newAction({ type: 'removeItem', uuid: '' }),
        newAction({ type: 'addItem', uuid: '' }),
        newAction({ type: 'message', text: '{name} changes its tactics!' }),
      ],
    }),
  teachSkill: () =>
    newEvent('used', {
      name: t('CARL_RPG.Events.Templates.teachSkill'),
      actions: [
        newAction({ type: 'addItem', uuid: '' }),
        newAction({ type: 'removeItem', uuid: '' }),
      ],
    }),
  healOnUse: () =>
    newEvent('used', {
      name: t('CARL_RPG.Events.Templates.healOnUse'),
      actions: [newAction({ type: 'health', mode: 'heal', amount: '1' })],
    }),
  reactionPrompt: () =>
    newEvent('takesDamage', {
      name: t('CARL_RPG.Events.Templates.reactionPrompt'),
      actions: [newAction({ type: 'message', ask: true, text: '{name} reacts with {item}!' })],
    }),
};

/* -------------------------------------------- */
/*  What the template needs                     */
/* -------------------------------------------- */

/**
 * The rows the editor shows for a list of events, with every drop target's name
 * resolved and a one-line summary of each event.
 * @param {object[]} events  The stored events
 * @param {string} base      Where the list is stored, as a path in `system`
 */
export async function buildEventRows(events, base) {
  const cfg = CONFIG.CARL_RPG;
  // The names of the list's events by id, for "run another event".
  const names = Object.fromEntries(
    events.map((e, i) => [e.id, e.name || game.i18n.format('CARL_RPG.Events.Unnamed', { n: i + 1 })])
  );

  return Promise.all(
    events.map(async (ev, ei) => ({
      ...ev,
      index: ei,
      path: `${base}.${ei}`,
      // The list this event is in, so its controls can name it.
      list: base,
      hasPhase: cfg.eventTriggersWithPhase.includes(ev.trigger),
      // With more than one condition there is a choice between all and any.
      hasMatch: ev.conditions.length > 1,
      summary: await summarizeEvent(ev, names),
      // Roll conditions only make sense for "used", "hit" and "misses", loot
      // conditions for "opened" and the rest for "a rest"; a condition already set
      // keeps its kind in the menu.
      conditionOptions: Object.fromEntries(
        Object.entries(cfg.eventConditions).filter(([key]) => {
          if (ev.conditions.some((c) => c.type === key)) return true;
          const attacking = ['used', 'hit', 'miss'].includes(ev.trigger);
          if (['rollMin', 'rollMax', 'nat20', 'nat1', 'degree'].includes(key)) {
            return attacking;
          }
          if (['targetSize', 'targetKind'].includes(key)) return attacking;
          if (['lootItem', 'lootGold'].includes(key)) return ev.trigger === 'opened';
          if (key === 'restKind') return ev.trigger === 'restTaken';
          return true;
        })
      ),
      // The other events of this list, to pick from when running another event.
      eventChoices: Object.fromEntries(
        Object.entries(names).filter(([id]) => id !== ev.id)
      ),
      first: ei === 0,
      last: ei === events.length - 1,
      conditions: await Promise.all(
        ev.conditions.map(async (c, ci) => {
          const doc = c.uuid ? await fromUuid(c.uuid) : null;
          return {
            ...c,
            index: ci,
            path: `${base}.${ei}.conditions.${ci}`,
            showStat: c.type === 'stat',
            showValue: [
              'stat',
              'mana',
              'rollMin',
              'rollMax',
              'lootGold',
              'floor',
              'floorExact',
              'health',
              'chance',
              'targetSize',
            ].includes(c.type),
            showPhase: c.type === 'phase',
            showDegree: c.type === 'degree',
            showTag: c.type === 'classTag',
            showDrop: ['lootItem', 'effect'].includes(c.type),
            dropAccept: c.type === 'effect' ? 'effect' : 'item',
            dropHint: c.type === 'effect' ? 'CARL_RPG.Events.Drop.effect' : 'CARL_RPG.Events.Drop.item',
            showTargetKind: c.type === 'targetKind',
            showRestKind: c.type === 'restKind',
            docName: doc?.name,
            docMissing: !!c.uuid && !doc,
          };
        })
      ),
      actions: await Promise.all(
        ev.actions.map(async (a, ai) => {
          const doc = a.uuid ? await fromUuid(a.uuid) : null;
          const target = a.targetActor ? await fromUuid(a.targetActor) : null;
          const effectish = ['toggleEffect', 'applyEffect'].includes(a.type);
          const accept =
            a.type === 'macro'
              ? 'macro'
              : effectish
                ? 'effect'
                : a.type === 'rollTable'
                  ? 'table'
                  : 'item';
          const needsDrop =
            ['useItem', 'macro', 'toggleEffect', 'applyEffect', 'addItem', 'awardAchievement', 'grantSkill', 'rollTable'].includes(
              a.type
            ) ||
            (a.type === 'removeItem' && !a.selfItem);
          return {
            ...a,
            index: ai,
            path: `${base}.${ei}.actions.${ai}`,
            first: ai === 0,
            last: ai === ev.actions.length - 1,
            isMacro: a.type === 'macro',
            // "Apply effect to the target that was hit" is set up like the
            // buff / debuff action, but always affects the hit target.
            isToggleEffect: effectish,
            fixedTarget: a.type === 'applyEffect',
            isAddItem: a.type === 'addItem',
            isRemoveItem: a.type === 'removeItem',
            isMana: a.type === 'mana',
            isHealth: a.type === 'health',
            isActions: a.type === 'actions',
            isGold: a.type === 'gold',
            isAiFavor: a.type === 'aiFavor',
            isMessage: a.type === 'message',
            isRunEvent: a.type === 'runEvent',
            showAmount: [
              'addItem',
              'removeItem',
              'mana',
              'health',
              'actions',
              'gold',
              'aiFavor',
              'grantSkill',
            ].includes(a.type),
            // Who it affects: not for a macro (it runs once), the hit target, or
            // another event (which has its own actions).
            canChooseTarget: !['macro', 'applyEffect', 'runEvent'].includes(a.type),
            showSpecificActor:
              !a.targetGroup && !['macro', 'applyEffect', 'runEvent'].includes(a.type),
            needsDrop,
            docAccept: accept,
            docName: doc?.name,
            dropHint: `CARL_RPG.Events.Drop.${accept}`,
            docMissing: !!a.uuid && !doc,
            targetName: target?.name ?? (a.targetActor ? a.targetActor : ''),
            targetMissing: !!a.targetActor && !target,
          };
        })
      ),
    }))
  );
}

/**
 * The menus the editor's drop-downs use.
 * @param {string[]} [triggers]  Only offer these triggers (all of them if omitted)
 */
export function eventOptions(triggers) {
  const cfg = CONFIG.CARL_RPG;
  const phases = Object.fromEntries([
    ['any', 'CARL_RPG.Events.AnyPhase'],
    ...cfg.combatPhases.map((p) => [p.id, `CARL_RPG.Combat.Phases.${p.id}`]),
  ]);
  return {
    triggers: Object.fromEntries(
      Object.entries(cfg.eventTriggers).filter(
        ([key]) => !triggers || triggers.includes(key)
      )
    ),
    phases,
    degrees: cfg.attackDegrees,
    stats: cfg.abilities,
    conditions: cfg.eventConditions,
    requirements: cfg.itemRequirements,
    actions: cfg.eventActions,
    effectModes: cfg.effectActionModes,
    manaModes: cfg.manaModes,
    healthModes: cfg.healthModes,
    actionsModes: cfg.actionsModes,
    goldModes: cfg.goldModes,
    aiFavorModes: cfg.aiFavorModes,
    targetGroups: cfg.eventTargetGroups,
    targetKinds: cfg.eventTargetKinds,
    restKinds: cfg.eventRestKinds,
    matches: {
      all: 'CARL_RPG.Events.Match.all',
      any: 'CARL_RPG.Events.Match.any',
    },
    templates: Object.fromEntries(
      Object.keys(EVENT_TEMPLATES).map((key) => [key, `CARL_RPG.Events.Templates.${key}`])
    ),
    runOn: cfg.macroRunOn,
  };
}

/* -------------------------------------------- */
/*  Buttons                                     */
/* -------------------------------------------- */

/** @this {object} A sheet that provides _updateEvents */
async function addEvent(event, target) {
  await this._updateEvents((system) => {
    // (A sheet can say which trigger a new event starts with.)
    eventList(system, target).push(newEvent(this.defaultEventTrigger ?? 'used'));
  });
}

async function addEventTemplate(event, target) {
  const make = EVENT_TEMPLATES[target.dataset.template];
  if (!make) return;
  await this._updateEvents((system) => {
    eventList(system, target).push(make());
  });
}

async function duplicateEvent(event, target) {
  const ei = Number(target.dataset.ei);
  await this._updateEvents((system) => {
    const events = eventList(system, target);
    const copy = foundry.utils.deepClone(events[ei]);
    copy.id = foundry.utils.randomID();
    copy.name = copy.name ? `${copy.name} ${t('CARL_RPG.Events.Copy')}` : '';
    events.splice(ei + 1, 0, copy);
  });
}

/** Try an event out (GM only): carry out its actions now, whatever its trigger and conditions. */
async function runNow(event, target) {
  if (!game.user.isGM) return;
  // (The event may live in the item's events or an upgrade's; it is found by id.)
  await runEventNow(this.eventDoc, target.dataset.eventId);
}

async function removeEvent(event, target) {
  const ei = Number(target.dataset.ei);
  await this._updateEvents((system) => eventList(system, target).splice(ei, 1));
}

async function moveEvent(event, target) {
  const ei = Number(target.dataset.ei);
  const to = ei + Number(target.dataset.dir);
  await this._updateEvents((system) => {
    const events = eventList(system, target);
    if (to < 0 || to >= events.length) return;
    [events[ei], events[to]] = [events[to], events[ei]];
  });
}

async function addCondition(event, target) {
  const ei = Number(target.dataset.ei);
  await this._updateEvents((system) => {
    eventList(system, target)[ei].conditions.push(newCondition());
  });
}

async function removeCondition(event, target) {
  const ei = Number(target.dataset.ei);
  const ci = Number(target.dataset.ci);
  await this._updateEvents((system) =>
    eventList(system, target)[ei].conditions.splice(ci, 1)
  );
}

async function addEventAction(event, target) {
  const ei = Number(target.dataset.ei);
  await this._updateEvents((system) => {
    eventList(system, target)[ei].actions.push(newAction());
  });
}

async function removeEventAction(event, target) {
  const ei = Number(target.dataset.ei);
  const ai = Number(target.dataset.ai);
  await this._updateEvents((system) =>
    eventList(system, target)[ei].actions.splice(ai, 1)
  );
}

async function moveEventAction(event, target) {
  const ei = Number(target.dataset.ei);
  const ai = Number(target.dataset.ai);
  const to = ai + Number(target.dataset.dir);
  await this._updateEvents((system) => {
    const actions = eventList(system, target)[ei].actions;
    if (to < 0 || to >= actions.length) return;
    [actions[ai], actions[to]] = [actions[to], actions[ai]];
  });
}

async function clearTarget(event, target) {
  await this._updateEvents((system) =>
    foundry.utils.setProperty(
      system,
      `${target.dataset.path}.${target.dataset.field}`,
      ''
    )
  );
}

/** The event editor's buttons, ready to be listed among a sheet's actions. */
export const EVENT_EDITOR_ACTIONS = {
  addEvent,
  addEventTemplate,
  duplicateEvent,
  runNow,
  removeEvent,
  moveEvent,
  addCondition,
  removeCondition,
  addEventAction,
  removeEventAction,
  moveEventAction,
  clearTarget,
};

/* -------------------------------------------- */
/*  Fields and drop boxes                       */
/* -------------------------------------------- */

/**
 * Save one field of an event, condition or action (by its `data-path`).
 * @this {object} A sheet that provides _updateEvents
 */
export async function saveEventField(el) {
  const value =
    el.type === 'checkbox'
      ? el.checked
      : el.type === 'number'
        ? Number(el.value) || 0
        : el.value;
  await this._updateEvents((system) =>
    foundry.utils.setProperty(system, el.dataset.path, value)
  );
}

/**
 * A document was dropped on one of the editor's drop boxes: store its UUID.
 * @this {object} A sheet that provides _updateEvents
 * @param {HTMLElement} zone  The drop box
 * @param {object} data       The drag data
 * @returns {Promise<boolean>}
 */
export async function dropTarget(zone, data) {
  const accepts = {
    item: 'Item',
    macro: 'Macro',
    effect: 'ActiveEffect',
    actor: 'Actor',
    table: 'RollTable',
  };
  if (data.type !== accepts[zone.dataset.accept] || !data.uuid) {
    ui.notifications.warn(t(`CARL_RPG.Events.Drop.Wrong.${zone.dataset.accept}`));
    return false;
  }
  await this._updateEvents((system) =>
    foundry.utils.setProperty(
      system,
      `${zone.dataset.path}.${zone.dataset.field}`,
      data.uuid
    )
  );
  return true;
}
