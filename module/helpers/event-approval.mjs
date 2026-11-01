/**
 * Approving events.
 *
 * Events last saved by a player are limited to what that player could do
 * themselves: the GM's client won't carry out their changes to other actors or run
 * their GM-side macros until a GM has approved them (`eventsTrusted` on an item or
 * a pet, the same flag on an effect). Saving them as a GM approves them; this lists
 * what is still waiting and approves it with one click.
 */
import { isTrusted } from './events.mjs';

const NS = 'carl-rpg';

/** Whether an item, effect or pet has any events at all (even ones not yet reached). */
function hasAnyEvents(doc) {
  if (doc.documentName === 'ActiveEffect') return (doc.getFlag(NS, 'events') ?? []).length > 0;
  const system = doc.system ?? {};
  return (
    (system.events ?? []).length > 0 ||
    (system.upgrades ?? []).some((upgrade) => (upgrade.events ?? []).length > 0)
  );
}

/**
 * Everything in the world whose events are waiting for approval.
 * @returns {Array<{uuid: string, name: string, where: string}>}
 */
export function unapprovedEvents() {
  const found = [];
  const check = (doc, where) => {
    if (hasAnyEvents(doc) && !isTrusted(doc)) {
      found.push({ uuid: doc.uuid, name: doc.name, where });
    }
  };
  for (const item of game.items) check(item, '');
  for (const actor of game.actors) {
    if (actor.type === 'pet') check(actor, '');
    for (const item of actor.items) check(item, actor.name);
    for (const effect of actor.effects) check(effect, actor.name);
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Approve the events on one document. */
export async function approveEvents(uuid) {
  if (!game.user.isGM) return;
  const doc = await fromUuid(uuid);
  if (!doc) return;
  if (doc.documentName === 'ActiveEffect') await doc.setFlag(NS, 'eventsTrusted', true);
  else await doc.update({ 'system.eventsTrusted': true });
}

/** Approve everything that is waiting. */
export async function approveAllEvents() {
  for (const entry of unapprovedEvents()) await approveEvents(entry.uuid);
}

/**
 * A quiet whisper to the GM when events are waiting for approval: at startup, and
 * at each Cleanup phase. Nothing is sent when nothing is waiting.
 */
function remindApprovals() {
  if (!game.user.isGM) return;
  const count = unapprovedEvents().length;
  if (!count) return;
  ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
    content: game.i18n.format('CARL_RPG.Combat.ApprovalReminder', { count }),
  });
}

Hooks.once('ready', remindApprovals);
Hooks.on('carlrpg.cleanupPhase', remindApprovals);
