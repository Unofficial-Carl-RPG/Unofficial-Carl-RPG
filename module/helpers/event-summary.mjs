/**
 * One-line, plain-English summaries of events ("When the round ends, if the Floor
 * is at least 3, take 2 damage"), shown on each event card and when an action asks
 * first. They only read the stored event; nothing here changes anything.
 */
import { damageTypeLabel } from './damage-types.mjs';

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** The name of a document a UUID points to, or a note that it can't be found. */
async function nameOf(uuid) {
  if (!uuid) return t('CARL_RPG.Events.Summary.nothing');
  const doc = await fromUuid(uuid);
  return doc?.name ?? t('CARL_RPG.Events.Missing');
}

const stat = (key) => t(CONFIG.CARL_RPG.abilities[key] ?? key);

/** What a condition says, as a short phrase. */
export async function summarizeCondition(c) {
  const S = 'CARL_RPG.Events.Summary.Cond.';
  let text;
  switch (c.type) {
    case 'stat':
      text = t(`${S}stat`, { stat: stat(c.stat), value: c.value });
      break;
    case 'mana':
      text = t(`${S}mana`, { value: c.value });
      break;
    case 'phase':
      text = t(`${S}phase`, {
        phase:
          c.phase === 'any'
            ? t('CARL_RPG.Events.AnyPhase')
            : t(`CARL_RPG.Combat.Phases.${c.phase}`),
      });
      break;
    case 'rollMin':
    case 'rollMax':
      text = t(`${S}${c.type}`, { value: c.value });
      break;
    case 'nat20':
    case 'nat1':
    case 'inCombat':
      text = t(`${S}${c.type}`);
      break;
    case 'degree':
      text = t(`${S}degree`, { degree: t(CONFIG.CARL_RPG.attackDegrees[c.degree]) });
      break;
    case 'lootItem':
      text = t(`${S}lootItem`, { name: await nameOf(c.uuid) });
      break;
    case 'lootGold':
      text = t(`${S}lootGold`, { value: c.value });
      break;
    case 'classTag':
      text = t(`${S}classTag`, { tag: c.tag });
      break;
    case 'effect':
      text = t(`${S}effect`, { name: await nameOf(c.uuid) });
      break;
    case 'hasSkill':
      text = t(`${S}hasSkill`, { name: await nameOf(c.uuid) });
      break;
    case 'floor':
      text = t(`${S}floor`, { value: c.value });
      break;
    case 'floorExact':
      text = t(`${S}floorExact`, { value: c.value });
      break;
    case 'health':
      text = t(`${S}health`, { value: c.value });
      break;
    case 'chance':
      text = t(`${S}chance`, { value: c.value });
      break;
    case 'targetSize':
      text = t(`${S}targetSize`, { value: c.value });
      break;
    case 'distance':
      text = t(`${S}distance`, { value: c.value });
      break;
    case 'targetKind':
      text = t(`${S}targetKind`, {
        kind: t(CONFIG.CARL_RPG.eventTargetKinds[c.text] ?? c.text),
      });
      break;
    case 'damageOption':
      text = t(`${S}damageOption`);
      break;
    case 'restKind':
      text = t(`${S}restKind`, {
        kind: t(CONFIG.CARL_RPG.eventRestKinds[c.text] ?? c.text),
      });
      break;
    default:
      text = c.type;
  }
  return c.negate ? t('CARL_RPG.Events.Summary.not', { text }) : text;
}

/** What an action does, as a short phrase (with who it affects). */
export async function summarizeAction(a, otherEvents = {}) {
  const S = 'CARL_RPG.Events.Summary.Act.';
  const amount = String(a.amount ?? '').trim() || '1';
  let text;
  switch (a.type) {
    case 'useItem':
      text = t(`${S}useItem`, { name: await nameOf(a.uuid) });
      break;
    case 'macro':
      text = t(`${S}macro`, { name: await nameOf(a.uuid) });
      break;
    case 'toggleEffect':
      text = t(`${S}effect.${a.mode || 'toggle'}`, { name: await nameOf(a.uuid) });
      break;
    case 'applyEffect':
      text = t(`${S}applyEffect`, { name: await nameOf(a.uuid) });
      break;
    case 'addItem':
      text = t(`${S}addItem`, { amount, name: await nameOf(a.uuid) });
      break;
    case 'addToken':
      text = t(`${S}${a.hidden ? 'addTokenHidden' : 'addToken'}`, { amount, name: await nameOf(a.uuid) });
      break;
    case 'summon':
      text = t(`${S}summon.${['raise', 'copy'].includes(a.mode) ? a.mode : 'place'}`, { amount, name: await nameOf(a.uuid) });
      break;
    case 'awardAchievement':
      text = t(`${S}awardAchievement`, { name: await nameOf(a.uuid) });
      break;
    case 'revive':
      text = t(`${S}revive`);
      break;
    case 'grantSkill':
      text = t(`${S}grantSkill`, { amount, name: await nameOf(a.uuid) });
      break;
    case 'removeItem':
      text = a.selfItem
        ? t(`${S}removeSelf`)
        : t(`${S}removeItem`, { name: await nameOf(a.uuid) });
      break;
    case 'mana':
      text = t(`${S}mana.${a.mode === 'restore' ? 'restore' : 'spend'}`, { amount });
      break;
    case 'health':
      text = t(`${S}health.${{ heal: 'heal', remove: 'remove' }[a.mode] ?? 'damage'}`, { amount });
      break;
    case 'delayedDamage': {
      const type = a.damageType ? ` ${damageTypeLabel(a.damageType)}` : '';
      const delay = String(a.delay ?? '').trim();
      text = t(`${S}${delay && delay !== '1' ? 'delayedDamageLater' : 'delayedDamage'}`, {
        amount,
        type,
        delay,
      });
      break;
    }
    case 'message':
      text = t(`${S}message`, { text: a.text });
      break;
    case 'actions':
      text = t(`${S}actions.${a.mode === 'restore' ? 'restore' : 'spend'}`, { amount });
      break;
    case 'gold':
      text = t(`${S}gold.${a.mode === 'remove' ? 'remove' : 'add'}`, { amount });
      break;
    case 'aiFavor':
      text = t(`${S}aiFavor.${a.mode === 'spend' ? 'spend' : 'award'}`, { amount });
      break;
    case 'popularity':
      text = t(S + 'popularity.' + (a.mode === 'remove' ? 'remove' : 'award'), { amount });
      break;
    case 'rollTable':
      text = t(`${S}rollTable`, { name: await nameOf(a.uuid) });
      break;
    case 'runEvent':
      text = t(`${S}runEvent`, { name: otherEvents[a.mode] ?? t('CARL_RPG.Events.Missing') });
      break;
    default:
      text = a.type;
  }
  if (a.targetGroup && !['applyEffect', 'addToken', 'summon'].includes(a.type)) {
    text += ` (${t(CONFIG.CARL_RPG.eventTargetGroups[a.targetGroup])})`;
  }
  return text;
}

/**
 * A sentence for a whole event: when it happens, what has to be true, what it does.
 * @param {object} event
 * @param {Object<string, string>} [otherEvents]  Names of the item's events, by id
 */
export async function summarizeEvent(event, otherEvents = {}) {
  const S = 'CARL_RPG.Events.Summary.';
  let when = t(CONFIG.CARL_RPG.eventTriggers[event.trigger] ?? event.trigger);
  if (CONFIG.CARL_RPG.eventTriggersWithPhase.includes(event.trigger) && event.phase !== 'any') {
    when += ` (${t(`CARL_RPG.Combat.Phases.${event.phase}`)})`;
  }
  const conditions = await Promise.all((event.conditions ?? []).map(summarizeCondition));
  const actions = await Promise.all(
    (event.actions ?? []).map((a) => summarizeAction(a, otherEvents))
  );
  const joiner = t(event.match === 'any' ? `${S}or` : `${S}and`);
  let text = t(`${S}when`, { when });
  if (conditions.length) text += ` ${t(`${S}if`, { conditions: conditions.join(joiner) })}`;
  text += `${actions.length ? `: ${actions.join('; ')}` : `: ${t(`${S}nothing`)}`}.`;
  return text;
}
