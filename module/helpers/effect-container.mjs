/**
 * Effect Containers (item type effectContainer): world or compendium items that only
 * store effects. Dropped on a sheet that can hold effects, they hand over copies of
 * those effects and keep no link to the container, which is never added to an actor.
 *
 * Targets: crawler, mob and pet sheets (an effect then sits on the actor like one made
 * by hand) and item sheets with an Effects tab (the effects become templates on the
 * item; on an item an actor already holds they also go on to the actor, as if the
 * item had just been added). An effect the target already has (same Identifier, else
 * name) is replaced in place, keeping its on/off state, stacks and sources.
 *
 * The planning and data shaping are pure (tests/effect-container.test.mjs); the
 * functions that touch documents are at the bottom.
 */
export const EFFECT_CONTAINER = 'effectContainer';

const NS = 'carl-rpg';

/** Actor types with an Effects tab. */
export const ACTOR_TARGETS = ['crawler', 'mob', 'pet'];

/** Item types with an Effects tab (a container can also take another container's effects). */
export const ITEM_TARGETS = [
  'skill', 'spell', 'gear', 'item', 'mobAbility', 'club', 'deity',
  'race', 'class', 'subclass', 'species', EFFECT_CONTAINER,
];

/** The effect flags that belong to an effect's life on an actor, kept when it is replaced. */
const RUNTIME_FLAGS = ['sourceItems', 'stacks', 'roundsLeft'];

/** Effect fields a replacement never copies over (identity, state and ties of the old effect). */
const KEPT_FIELDS = ['_id', '_stats', 'origin', 'transfer', 'disabled', 'start', 'sort', 'flags', 'ownership', 'folder'];

/** @returns {boolean} whether the document is an Effect Container item */
export function isEffectContainer(doc) {
  return doc?.type === EFFECT_CONTAINER && doc?.documentName !== 'Actor';
}

/** @returns {boolean} whether the actor or item can hold effects (has an Effects tab) */
export function canHoldEffects(doc) {
  if (!doc) return false;
  if (doc.documentName === 'Actor') return ACTOR_TARGETS.includes(doc.type);
  return ITEM_TARGETS.includes(doc.type);
}

/**
 * Pair each incoming effect with the target effect it replaces (or null for a new one).
 * Two incoming effects that match each other are one effect (the first wins), except
 * stacking buffs, which are separate effects by design. A target effect is replaced once.
 * @param {object[]} incoming              the container's effects
 * @param {object[]} existing              the target's effects
 * @param {(a: object, b: object) => boolean} matches   the "same effect" rule
 * @param {(effect: object) => boolean} [isStacker]     effect joins a stacking buff group
 * @returns {{template: object, replaces: object|null}[]}
 */
export function planDrop(incoming, existing, matches, isStacker = () => false) {
  const plan = [];
  const used = new Set();
  for (const template of incoming) {
    const queued = plan.some((p) => matches(p.template, template));
    if (queued && !isStacker(template)) continue;
    const old = existing.find((e) => !used.has(e) && matches(e, template)) ?? null;
    if (old) used.add(old);
    plan.push({ template, replaces: old });
  }
  return plan;
}

/** Whether an effect starts switched off: buffs do, and gear-tied effects follow the gear. */
export function startsDisabled(template, { gear = false, equipped = false } = {}) {
  if (template.equipLinked && gear) return !equipped;
  return template.kind === 'buff';
}

/**
 * Data for a new effect made from a container's effect.
 * @param {object} template                   the container's effect (a document)
 * @param {object} [options]
 * @param {{id: string, uuid: string, type: string, system?: object}|null} [options.source]
 *   the item on an actor that gives it (null: put on the actor by hand, or on an item)
 * @param {boolean} [options.onActor]         the effect is going onto an actor
 * @param {number} [options.tier]             a deity's tier section for it
 */
export function newEffectData(template, { source = null, onActor = false, tier = 0 } = {}) {
  const data = template.toObject();
  delete data._id;
  delete data._stats;
  data.transfer = false;
  data.flags ??= {};
  data.flags[NS] ??= {};
  const flags = data.flags[NS];
  if (onActor) {
    data.origin = source ? source.uuid : null;
    data.disabled = startsDisabled(template, {
      gear: source?.type === 'gear',
      equipped: !!source?.system?.equipped,
    });
    flags.sourceItems = source ? [source.id] : [];
    flags.stacks = 1;
  } else {
    delete data.origin;
    for (const key of RUNTIME_FLAGS) delete flags[key];
  }
  delete flags.roundsLeft;
  if (tier) flags.tier = tier;
  return data;
}

/**
 * The update that makes an existing effect the container's effect, keeping what
 * belongs to the old one's life: its on/off state, origin, stacks, rounds left and
 * sources (plus this item as a source). Flags the container's effect lacks are removed.
 * @param {object} old        the existing effect's source data (toObject())
 * @param {object} fresh      newEffectData() for the container's effect
 * @param {string} [sourceId] an item id to add to the effect's sources
 * @param {number} [tier]     a deity's tier section to put it in (0: keep the new data's)
 */
export function replaceUpdate(old, fresh, sourceId = '', tier = 0) {
  const update = {};
  for (const [key, value] of Object.entries(fresh)) {
    if (!KEPT_FIELDS.includes(key)) update[key] = value;
  }
  const oldFlags = old.flags?.[NS] ?? {};
  const newFlags = { ...(fresh.flags?.[NS] ?? {}) };
  for (const key of RUNTIME_FLAGS) delete newFlags[key];
  const carl = { ...newFlags };
  for (const key of Object.keys(oldFlags)) {
    if (RUNTIME_FLAGS.includes(key)) continue;
    if (!(key in newFlags)) carl[`-=${key}`] = null;
  }
  const sources = [...(oldFlags.sourceItems ?? [])];
  if (sourceId && !sources.includes(sourceId)) sources.push(sourceId);
  carl.sourceItems = sources;
  if (tier) carl.tier = tier;
  update.flags = { [NS]: carl };
  return update;
}

/* -------------------------------------------- */
/*  Putting effects on documents                */
/* -------------------------------------------- */

const same = (a, b) => CONFIG.ActiveEffect.documentClass.matches(a, b);

/**
 * Put copies of effects on an actor. Effects the actor already has are replaced in place.
 * @param {Actor} actor
 * @param {ActiveEffect[]} templates
 * @param {Item|null} [source]   the item on the actor that gives them (null: by hand)
 * @returns {Promise<{added: number, replaced: number}>}
 */
export async function putEffectsOnActor(actor, templates, source = null) {
  const plan = planDrop(templates, [...actor.effects], same, (e) => !!e.slotGroup);
  const create = [];
  const update = [];
  for (const { template, replaces } of plan) {
    const fresh = newEffectData(template, { source, onActor: true });
    if (replaces) update.push({ _id: replaces.id, ...replaceUpdate(replaces.toObject(), fresh, source?.id) });
    else create.push(fresh);
  }
  if (update.length) await actor.updateEmbeddedDocuments('ActiveEffect', update);
  if (create.length) await actor.createEmbeddedDocuments('ActiveEffect', create, { carlGrant: !!source });
  return { added: create.length, replaced: update.length };
}

/**
 * Put copies of effects on an item (as templates). Effects it already has are replaced.
 * @param {Item} item
 * @param {ActiveEffect[]} templates
 * @returns {Promise<{added: number, replaced: number, touched: ActiveEffect[]}>}
 *   touched: the item's effects that were added or replaced, as they now are
 */
export async function putEffectsOnItem(item, templates) {
  const plan = planDrop(templates, [...item.effects], same, (e) => !!e.slotGroup);
  const deity = item.type === 'deity';
  const create = [];
  const update = [];
  const touched = [];
  for (const { template, replaces } of plan) {
    // A deity lists its effects by tier; a new one goes in tier 1.
    const tier = deity ? replaces?.getFlag(NS, 'tier') || 1 : 0;
    const fresh = newEffectData(template, { tier });
    if (replaces) {
      update.push({ _id: replaces.id, ...replaceUpdate(replaces.toObject(), fresh, '', tier) });
      touched.push(replaces);
    } else create.push(fresh);
  }
  if (update.length) await item.updateEmbeddedDocuments('ActiveEffect', update);
  const made = create.length ? await item.createEmbeddedDocuments('ActiveEffect', create) : [];
  touched.push(...made);
  return { added: create.length, replaced: update.length, touched };
}

/**
 * Hand a container's effects to a sheet's document. On an item an actor holds they
 * go on to the actor too, as if the item had just been added.
 * @param {Actor|Item} target
 * @param {Item} container
 * @returns {Promise<{added: number, replaced: number}|null>}  null when the target can't hold effects
 */
export async function dropContainer(target, container) {
  if (!isEffectContainer(container)) return null;
  if (!canHoldEffects(target)) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.EffectContainer.NoEffects'));
    return null;
  }
  const templates = [...container.effects];
  if (!templates.length) {
    ui.notifications.warn(game.i18n.format('CARL_RPG.EffectContainer.Empty', { name: container.name }));
    return { added: 0, replaced: 0 };
  }
  let result;
  if (target.documentName === 'Actor') {
    result = await putEffectsOnActor(target, templates);
  } else {
    result = await putEffectsOnItem(target, templates);
    const actor = target.parent;
    if (actor instanceof Actor) {
      if (target.type === 'deity') {
        // A deity gives its effects by tier: take away the copies that were replaced so they come back new.
        const gone = actor.effects
          .filter((e) => e.sourceItems.includes(target.id) && result.touched.some((t) => same(e, t)))
          .map((e) => e.id);
        if (gone.length) await actor.deleteEmbeddedDocuments('ActiveEffect', gone);
        await target.syncDeityTiers();
      } else {
        await putEffectsOnActor(actor, result.touched, target);
      }
    }
  }
  ui.notifications.info(
    game.i18n.format('CARL_RPG.EffectContainer.Done', {
      name: container.name,
      target: target.name,
      added: result.added,
      replaced: result.replaced,
    })
  );
  return result;
}
