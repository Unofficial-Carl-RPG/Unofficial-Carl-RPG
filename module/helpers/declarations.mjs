/**
 * Mob declarations.
 *
 * A round starts with the GM declaring what the mobs will do. During the Mobs
 * Declare phase, using one of a mob's abilities from its sheet doesn't use it: it
 * is declared, with whoever is targeted at the time (hold Shift to use it right
 * away instead). A mob can also declare a movement, with a note about where it is
 * going. A mob can declare as many things as it has actions.
 *
 * Everyone sees the declarations (never the attack numbers) under the mobs in the
 * combat tracker, and chat announces them when the Crawlers React phase starts, so
 * the crawlers can use interrupts. When the Mob Attacks Resolve phase starts the
 * GM's client carries them out in order: each declared ability is used on its
 * targets (through the usual mob check cards), and each declared movement spends an
 * action and is announced. The declarations are cleared when Cleanup starts.
 *
 * They are kept on the combat, `flags.carl-rpg.declarations`, as
 * `{ [combatantId]: [{ id, kind: 'ability'|'move', itemUuid, itemName, note,
 * targets: [{ name, tokenUuid, actorUuid }], resolved }] }`.
 */
import { CarlRPGDialog } from './dialog.mjs';
import { chooseTargets } from './targeting.mjs';

const NS = 'carl-rpg';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

/*  Reading and changing the declarations       */

/** Everything declared this round, by combatant id. */
export function allDeclarations(combat) {
  return combat?.getFlag(NS, 'declarations') ?? {};
}

/** One combatant's declarations, in the order they were made. */
export function declarationsOf(combat, combatant) {
  return allDeclarations(combat)[combatant.id] ?? [];
}

async function save(combat, declarations) {
  await combat.setFlag(NS, 'declarations', declarations);
}

/** Whether the combat is in the Mobs Declare phase. */
export function isDeclarePhase(combat = game.combat) {
  return !!combat?.started && combat.currentPhase?.id === 'declare';
}

/** The combatant a mob is in the running combat as, if it is. */
function combatantOf(actor, combat = game.combat) {
  return combat?.started
    ? (combat.combatants.find((c) => c.actor === actor) ?? null)
    : null;
}

/** Add a declaration to a combatant (checking it has an action left to declare). */
async function add(combat, combatant, entry) {
  const declarations = foundry.utils.deepClone(allDeclarations(combat));
  const list = declarations[combatant.id] ?? [];
  if (combatant.maxActions > 0 && list.length >= combatant.maxActions) {
    ui.notifications.warn(t('CARL_RPG.Declare.TooMany', { name: esc(combatant.name) }));
    return false;
  }
  list.push({ id: foundry.utils.randomID(), resolved: false, note: '', targets: [], ...entry });
  declarations[combatant.id] = list;
  await save(combat, declarations);
  return true;
}

/** Take one declaration away (the GM changing their mind, or a crawler's interrupt stopping it). */
export async function removeDeclaration(combat, combatantId, id) {
  if (!game.user.isGM) return;
  const declarations = foundry.utils.deepClone(allDeclarations(combat));
  declarations[combatantId] = (declarations[combatantId] ?? []).filter((d) => d.id !== id);
  if (!declarations[combatantId].length) delete declarations[combatantId];
  await save(combat, declarations);
}

/** Clear everything declared. */
export async function clearDeclarations(combat) {
  if (!Object.keys(allDeclarations(combat)).length) return;
  await combat.unsetFlag(NS, 'declarations');
}

/*  Declaring                                   */

/** The targeted tokens, as a declaration remembers them. */
function currentTargets() {
  return [...game.user.targets].map((token) => ({
    name: token.name,
    tokenUuid: token.document.uuid,
    actorUuid: token.actor?.uuid ?? '',
  }));
}

/**
 * Called when a mob's ability is used: in the Mobs Declare phase it is declared
 * instead of used. Returns true if it was handled here (so it isn't used now).
 * @param {Item} item
 * @returns {Promise<boolean>}
 */
export async function declareInsteadOfUsing(item) {
  const actor = item.actor;
  const combat = game.combat;
  if (actor?.type !== 'mob' || !isDeclarePhase(combat)) return false;
  const combatant = combatantOf(actor, combat);
  if (!combatant) return false;
  // The GM picks the targets now; they are stored with the declaration. Cancelling
  // declares nothing.
  if (!(await chooseTargets(item))) return true;

  await add(combat, combatant, {
    kind: 'ability',
    itemUuid: item.uuid,
    itemName: item.name,
    targets: currentTargets(),
  });
  return true;
}

/**
 * Declare a movement for a mob: asks where it is going.
 * @param {Combatant} combatant
 */
export async function declareMove(combatant) {
  const combat = combatant.parent;
  if (!game.user.isGM || !isDeclarePhase(combat)) return;
  const note = await CarlRPGDialog.prompt({
    window: { title: t('CARL_RPG.Declare.MoveTitle') },
    content: `<input type="text" name="note" placeholder="${esc(t('CARL_RPG.Declare.MovePlaceholder'))}" autofocus />`,
    ok: {
      label: t('CARL_RPG.Declare.MoveOk'),
      callback: (event, button) => button.form.elements.note.value.trim(),
    },
    rejectClose: false,
  });
  if (note === null || note === undefined) return;
  await add(combat, combatant, { kind: 'move', note });
}

/*  Showing them                                */

/** One declaration as a line of text (no attack numbers: they aren't stored). */
export function describeDeclaration(declaration) {
  if (declaration.kind === 'move') {
    return declaration.note
      ? t('CARL_RPG.Declare.Moves', { note: esc(declaration.note) })
      : t('CARL_RPG.Declare.MovesNoNote');
  }
  const targets = declaration.targets.map((target) => esc(target.name)).join(', ');
  return targets
    ? t('CARL_RPG.Declare.Uses', { ability: esc(declaration.itemName), targets })
    : esc(declaration.itemName);
}

/** Chat announces what the mobs declared, as the Crawlers React phase starts. */
export async function announceDeclarations(combat) {
  const lines = [];
  for (const combatant of combat.combatants) {
    const list = declarationsOf(combat, combatant);
    if (!list.length) continue;
    lines.push(
      `<li><strong>${esc(combatant.name)}</strong>: ${list.map(describeDeclaration).join('; ')}</li>`
    );
  }
  if (!lines.length) return;
  await ChatMessage.create({
    content: `<div class="carl-declarations"><strong>${t('CARL_RPG.Declare.Announce')}</strong><ul>${lines.join('')}</ul></div>`,
  });
}

/*  Resolving                                   */

/** Put the declared targets back as the GM's targets (the ones on this scene). */
async function retarget(declaration) {
  await game.user.updateTokenTargets([]);
  const ids = [];
  for (const target of declaration.targets ?? []) {
    const token = fromUuidSync(target.tokenUuid)?.object;
    if (token) ids.push(token.id);
  }
  if (ids.length) await game.user.updateTokenTargets(ids);
}

/** Carry out one declaration. */
async function resolveOne(combatant, declaration) {
  const actor = combatant.actor;
  if (declaration.kind === 'move') {
    // A movement takes one of the mob's actions and is announced.
    const spent = combatant.getFlag(NS, 'actionsSpent') ?? 0;
    if (combatant.maxActions > spent) await combatant.setFlag(NS, 'actionsSpent', spent + 1);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<em>${describeDeclaration(declaration)}</em>`,
    });
    return;
  }

  const item =
    actor?.items.find((i) => i.uuid === declaration.itemUuid) ??
    (await fromUuid(declaration.itemUuid));
  if (!item) {
    ui.notifications.warn(t('CARL_RPG.Declare.CantResolve', { name: esc(declaration.itemName) }));
    return;
  }
  await retarget(declaration);
  await item.roll(null, { declared: true });
}

/**
 * Carry out everything declared, in order (the GM's client, when the Mob Attacks
 * Resolve phase starts). What was resolved stays in the list, marked, until
 * Cleanup clears it.
 * @param {Combat} combat
 */
export async function resolveDeclarations(combat) {
  const declarations = foundry.utils.deepClone(allDeclarations(combat));
  for (const combatant of combat.combatants) {
    for (const declaration of declarations[combatant.id] ?? []) {
      if (declaration.resolved) continue;
      try {
        await resolveOne(combatant, declaration);
      } catch (err) {
        console.error(`${NS} | could not resolve a declaration`, err);
      }
      declaration.resolved = true;
    }
  }
  await game.user.updateTokenTargets([]);
  await save(combat, declarations);
}

/*  Setup                                       */

export function registerDeclarations() {
  // The mobs' declarations carry out as Resolve starts, are announced as React
  // starts and are cleared when Cleanup starts. Only the GM's client does this,
  // and not when stepping back through the phases.
  Hooks.on('updateCombat', (combat, changed, options) => {
    if (!foundry.utils.hasProperty(changed, `flags.${NS}.phase`)) return;
    if (options?.carlDirection === 'back') return;
    if (game.user !== game.users.activeGM) return;
    const phase = combat.currentPhase?.id;
    if (phase === 'react') announceDeclarations(combat);
    else if (phase === 'resolve') resolveDeclarations(combat);
    else if (phase === 'cleanup') clearDeclarations(combat);
  });
  Hooks.on('deleteCombat', () => {
    // (The declarations go with the combat.)
  });
}
