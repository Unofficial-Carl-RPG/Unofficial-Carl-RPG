/**
 * Hold result cards until the dice stop. With Dice So Nice on, a chat message that
 * holds a roll is hidden until Dice So Nice reports that its dice animation has
 * finished, so the result isn't shown before the dice land. A client setting, on by
 * default. The card follows Dice So Nice's own timing.
 */
const NS = 'carl-rpg';
const SETTING = 'holdResultCards';

export function registerDiceHold() {
  game.settings.register(NS, SETTING, {
    name: 'CARL_RPG.Combat.HoldCardsName',
    hint: 'CARL_RPG.Combat.HoldCardsHint',
    scope: 'client',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
  });

  // Cards still held (message id -> element), and cards already shown.
  const held = new Map();
  const shown = new Set();

  const reveal = (id) => {
    shown.add(id);
    const el = held.get(id);
    if (!el) return;
    el.style.visibility = '';
    held.delete(id);
  };

  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!game.dice3d || !game.settings.get(NS, SETTING)) return;
    if (!message.rolls?.length || shown.has(message.id)) return;
    if (!held.has(message.id)) held.set(message.id, html);
    html.style.visibility = 'hidden';
  });

  // Dice So Nice reports when a roll's animation has finished.
  Hooks.on('diceSoNiceRollComplete', (messageId) => reveal(messageId));
}
