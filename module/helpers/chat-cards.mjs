/**
 * Chat card styling.
 *
 * A card says what kind it is with a flag (`flags.carl-rpg.card.kind`, and for a
 * check its `degree`). As the card is drawn this adds classes to the message so the
 * stylesheet can give each kind its own look:
 *
 *  - skills, spells, gear, items and mob abilities each have an accent colour and a
 *    small badge naming the kind;
 *  - attack and check cards are coloured by how well the roll went (a Critical Hit
 *    glows gold, a Critical Fail smoulders; see CONFIG.CARL_RPG.attackDegrees);
 *  - achievements, boss announcements and loot boxes are full banners with their own
 *    frame (a loot box card also takes the look of its tier).
 *
 * Only a mob's own cards keep the mob colour: a mob's "success" is bad news for a
 * crawler, so its degrees aren't shown as green and red.
 */
const NS = 'carl-rpg';

/** From worst to best, to pick the best result among an attack's targets. */
const DEGREE_ORDER = ['critFail', 'majorFail', 'fail', 'nearMiss', 'success', 'amazing', 'critHit'];

/** The badge for each kind of card: a Font Awesome icon (the name is in the language file). */
const KINDS = {
  skill: 'fa-star',
  spell: 'fa-wand-sparkles',
  gear: 'fa-shield-halved',
  item: 'fa-box-open',
  mobAbility: 'fa-skull',
  attack: 'fa-crosshairs',
  check: 'fa-dice-d20',
  defense: 'fa-shield',
  event: 'fa-bolt',
  effect: 'fa-hourglass-end',
};

/** The kinds that are full banners (no speaker header, their own frame). */
const BANNERS = ['achievement', 'boss', 'loot', 'system'];

/** How well an attack card went, for tinting the whole card. */
function attackDegree(attack) {
  if (attack.mob) return null;
  if (attack.degree) return attack.degree;
  const degrees = (attack.targets ?? []).map((target) => target.degree).filter(Boolean);
  if (!degrees.length) {
    return attack.crit ? 'critHit' : attack.natural === 1 ? 'critFail' : null;
  }
  return degrees.sort((a, b) => DEGREE_ORDER.indexOf(b) - DEGREE_ORDER.indexOf(a))[0];
}

export function registerChatCards() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    // Every message says who it is from, for the chat log's look (helpers: the GM and
    // whispers get their own edge colour; see the chat log styles).
    html.classList.add(message.author?.isGM ? 'carl-from-gm' : 'carl-from-player');
    if (message.whisper?.length) html.classList.add('carl-whisper');

    const flag = message.getFlag(NS, 'card');
    const attack = message.getFlag(NS, 'attack');
    const kind = flag?.kind ?? (attack ? (attack.mob ? 'mobAbility' : 'attack') : null);
    if (!kind) return;

    html.classList.add('carl-card', `carl-kind-${kind}`);
    const degree = flag?.degree ?? (attack ? attackDegree(attack) : null);
    if (degree) html.classList.add(`carl-degree-${degree}`);
    if (BANNERS.includes(kind)) html.classList.add('carl-banner');
    if (flag?.tier) html.classList.add(`carl-tier-${flag.tier}`);
    // A System announcement's look depends on what it announces.
    if (flag?.system) html.classList.add(`carl-sys-${flag.system}`);

    // A small badge naming the kind of card, at the top of its content (a card with its
    // own header, an item's image, name and badges, doesn't need one).
    const icon = KINDS[kind];
    const content = html.querySelector('.message-content');
    if (icon && content && !flag?.header && !content.querySelector('.card-kind')) {
      const badge = document.createElement('div');
      badge.className = 'card-kind';
      badge.innerHTML = `<i class="fas ${icon}"></i> ${foundry.utils.escapeHTML(
        game.i18n.localize(`CARL_RPG.Card.Kind.${kind}`)
      )}`;
      content.prepend(badge);
    }
  });
}
