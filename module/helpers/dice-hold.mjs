/**
 * Hold result cards until the dice stop. With Dice So Nice on, a chat message that
 * holds a roll is hidden until its dice animation finishes, so the result isn't
 * shown before the dice land. A client setting (on by default); if the animation
 * never reports back, the card is shown after a short wait.
 */
const NS = 'carl-rpg';
const SETTING = 'holdResultCards';
const HOLD_MS = 10000;

export function registerDiceHold() {
  game.settings.register(NS, SETTING, {
    name: 'CARL_RPG.Combat.HoldCardsName',
    hint: 'CARL_RPG.Combat.HoldCardsHint',
    scope: 'client',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
  });

  // Cards still held (message id -> element and timer), and cards already shown.
  const held = new Map();
  const shown = new Set();

  const reveal = (id) => {
    const entry = held.get(id);
    shown.add(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.el.style.visibility = '';
    held.delete(id);
  };

  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!game.dice3d || !game.settings.get(NS, SETTING)) return;
    if (!message.rolls?.length || shown.has(message.id)) return;
    if (!held.has(message.id)) {
      held.set(message.id, {
        el: html,
        timer: setTimeout(() => reveal(message.id), HOLD_MS),
      });
    }
    html.style.visibility = 'hidden';
  });

  // Dice So Nice reports when a roll's animation has finished.
  Hooks.on('diceSoNiceRollComplete', (messageId) => reveal(messageId));
}
