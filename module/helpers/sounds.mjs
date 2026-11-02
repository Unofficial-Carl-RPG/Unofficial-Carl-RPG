/**
 * Sound cues. The GM picks a sound file for each cue in the system settings; a cue
 * with no file is silent. Each player sets their own volume and can mute. A cue plays
 * on every client that sees its event: a chat card with the cue's flag, a natural
 * 20 or 1 rolled by a crawler, or a new achievement given to a crawler.
 */
const NS = 'carl-rpg';

export const CUES = {
  boss: { setting: 'soundBoss', label: 'CARL_RPG.Combat.SoundBoss' },
  natural: { setting: 'soundNatural', label: 'CARL_RPG.Combat.SoundNatural' },
  dying: { setting: 'soundDying', label: 'CARL_RPG.Combat.SoundDying' },
  achievement: { setting: 'soundAchievement', label: 'CARL_RPG.Combat.SoundAchievement' },
  loot: { setting: 'soundLoot', label: 'CARL_RPG.Combat.SoundLoot' },
};

export function registerSounds() {
  for (const { setting, label } of Object.values(CUES)) {
    game.settings.register(NS, setting, {
      name: label,
      scope: 'world',
      config: true,
      type: new foundry.data.fields.FilePathField({ categories: ['AUDIO'], initial: '' }),
    });
  }
  game.settings.register(NS, 'soundVolume', {
    name: 'CARL_RPG.Combat.SoundVolume',
    scope: 'client',
    config: true,
    type: new foundry.data.fields.NumberField({ integer: true, min: 0, max: 100, initial: 100 }),
  });
  game.settings.register(NS, 'soundMuted', {
    name: 'CARL_RPG.Combat.SoundMute',
    scope: 'client',
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });

  Hooks.on('createChatMessage', (message) => {
    const cue = message.getFlag(NS, 'cue') ?? cueFromCard(message) ?? (isNatural(message) ? 'natural' : null);
    if (cue) playCue(cue);
  });
}

/** Play a cue's sound on this client, at this player's volume (silent if muted or unset). */
export function playCue(cue) {
  if (!CUES[cue] || game.settings.get(NS, 'soundMuted')) return;
  const src = game.settings.get(NS, CUES[cue].setting);
  if (!src) return;
  const volume = (game.settings.get(NS, 'soundVolume') ?? 100) / 100;
  foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
}

/** The cue a system announcement card is for (boss announcements only). */
function cueFromCard(message) {
  const card = message.getFlag(NS, 'card');
  if (card?.kind === 'system' && card.system === 'boss') return 'boss';
  if (card?.kind === 'achievement') return 'achievement';
  return null;
}

/** Whether a message is a crawler's roll that came up a natural 1 or 20. */
function isNatural(message) {
  if (!message.rolls?.length) return false;
  const actor = message.constructor.getSpeakerActor(message.speaker);
  if (actor?.type !== 'crawler') return false;
  return message.rolls.some((roll) => {
    const die = roll.dice?.find((d) => d.faces === 20);
    return !!die && (die.total === 1 || die.total === 20);
  });
}
