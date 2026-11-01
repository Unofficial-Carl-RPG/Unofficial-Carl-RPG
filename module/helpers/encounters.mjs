/**
 * Encounters: the GM draws the roll table for the current floor on Dungeon Info,
 * or picks mobs in the encounter builder. The mobs are placed on the map where the
 * GM clicks, in a tight cluster, and join the combat if one is running on this
 * scene (or one is started, when the auto-start setting is on).
 *
 * A roll table row links to a mob. How many to place is given in square brackets
 * at the start of the row's text: "[1d3] Goblin" places 1 to 3 goblins. A row with
 * no brackets places one.
 */
import { CarlRPGDialog } from './dialog.mjs';
import {
  AUTO_COMBAT_SETTING,
  getEncounterTables,
  getFloor,
} from './floor.mjs';

const NS = 'carl-rpg';
const COUNT = /^\s*\[([^\]]+)\]\s*/;

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

/**
 * The roll table for a floor: the one set for that floor, else the one set for
 * every floor (a table with no floor). Empty rows are ignored.
 * @param {number} [floor]
 * @returns {string}  The table's UUID, or '' if there is none
 */
export function tableForFloor(floor = getFloor()) {
  const tables = getEncounterTables().filter((row) => row.uuid);
  return (
    tables.find((row) => row.floor === floor)?.uuid ??
    tables.find((row) => row.floor === null)?.uuid ??
    ''
  );
}

/**
 * Split a row's text into how many to place (the text in brackets, rolled) and
 * the rest.
 * @param {string} [text]
 * @returns {{formula: string, name: string}}
 */
export function parseRowText(text = '') {
  const match = COUNT.exec(text);
  if (!match) return { formula: '1', name: String(text).trim() };
  return {
    formula: match[1].trim(),
    name: String(text).slice(match[0].length).trim(),
  };
}

/** Roll a count formula to a whole number, 0 or more (1 if the formula is no good). */
async function countFrom(formula) {
  try {
    const roll = await new Roll(formula || '1').evaluate();
    return Math.max(0, Math.floor(roll.total));
  } catch (err) {
    console.warn(`${NS} | bad encounter count "${formula}"`, err);
    return 1;
  }
}

/** The mob actor a table result links to, if it links to one. */
async function mobOf(result) {
  const uuid =
    result.documentUuid ??
    (result.documentCollection && result.documentId
      ? `${result.documentCollection}.${result.documentId}`
      : null);
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  return doc?.documentName === 'Actor' && doc.type === 'mob' ? doc : null;
}

/**
 * Draw the floor's encounter table (GM only).
 * @param {number} [floor]
 * @returns {Promise<{actor: Actor, count: number}[]|null>}  null if the floor has no table
 */
export async function drawEncounter(floor = getFloor()) {
  const uuid = tableForFloor(floor);
  if (!uuid) return null;
  const table = await fromUuid(uuid);
  if (table?.documentName !== 'RollTable') return null;
  const { results } = await table.draw({ displayChat: false });
  const entries = [];
  for (const result of results) {
    const actor = await mobOf(result);
    if (!actor) continue;
    const { formula } = parseRowText(result.text);
    entries.push({ actor, count: await countFrom(formula) });
  }
  return entries.filter((entry) => entry.count > 0);
}

/**
 * The cell offsets for n mobs, nearest the centre first: a spiral around (0, 0).
 * @param {number} n
 * @returns {[number, number][]}
 */
function clusterOffsets(n) {
  const cells = [[0, 0]];
  for (let r = 1; cells.length < n; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) cells.push([dx, dy]);
      }
    }
  }
  return cells.slice(0, n);
}

/**
 * Wait for the GM to click the map. Resolves with the snapped top-left point, or
 * null if Escape is pressed.
 * @returns {Promise<{x: number, y: number}|null>}
 */
function pickPoint() {
  return new Promise((resolve) => {
    const stage = canvas.stage;
    const finish = (value) => {
      stage.off('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onDown = (event) => {
      const pos = event.getLocalPosition(canvas.stage);
      finish(
        canvas.grid.getSnappedPoint(pos, {
          mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX,
        })
      );
    };
    const onKey = (event) => {
      if (event.key === 'Escape') finish(null);
    };
    stage.on('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
  });
}

/**
 * Place mobs on the scene, clustered around a point the GM clicks, and join them
 * to the combat on this scene. With no combat running, a new one is started only
 * if the auto-start setting is on.
 * @param {{actor: Actor, count: number}[]} entries
 */
export async function placeEncounter(entries) {
  if (!game.user.isGM) return;
  const scene = canvas?.scene;
  if (!scene) return ui.notifications.warn(t('CARL_RPG.Encounters.NoScene'));
  const mobs = entries.flatMap(({ actor, count }) =>
    Array.from({ length: count }, () => actor)
  );
  if (!mobs.length) return ui.notifications.warn(t('CARL_RPG.Encounters.NoMobs'));

  ui.notifications.info(t('CARL_RPG.Encounters.ClickToPlace'));
  const origin = await pickPoint();
  if (!origin) return;

  const size = canvas.grid.size;
  const cluster = clusterOffsets(mobs.length);
  const datas = mobs.map((actor, i) => {
    const [dx, dy] = cluster[i];
    // Each token is its own copy, so each mob has its own health.
    return foundry.utils.mergeObject(actor.prototypeToken.toObject(), {
      x: origin.x + dx * size,
      y: origin.y + dy * size,
      actorId: actor.id,
      actorLink: false,
    });
  });
  const tokens = await scene.createEmbeddedDocuments('Token', datas);

  let combat = game.combat;
  if (!combat && game.settings.get(NS, AUTO_COMBAT_SETTING)) {
    combat = await CONFIG.Combat.documentClass.create({
      scene: scene.id,
      active: true,
    });
  }
  if (combat?.scene?.id === scene.id) {
    await combat.createEmbeddedDocuments(
      'Combatant',
      tokens.map((token) => ({
        tokenId: token.id,
        sceneId: scene.id,
        actorId: token.actorId,
        hidden: false,
      }))
    );
  }
}

/**
 * Roll the floor's encounter table, confirm the mobs with the GM, then place them.
 * @returns {Promise<void>}
 */
export async function rollEncounter() {
  if (!game.user.isGM) return;
  const entries = await drawEncounter();
  if (entries === null) return ui.notifications.warn(t('CARL_RPG.Encounters.NoTable'));
  if (!entries.length) return ui.notifications.warn(t('CARL_RPG.Encounters.NoMobs'));

  const lines = entries
    .map(({ actor, count }) => `${count} &times; ${esc(actor.name)}`)
    .join('<br>');
  const ok = await CarlRPGDialog.confirm({
    window: { title: t('CARL_RPG.Encounters.Rolled') },
    content: `<p>${lines}</p><p><em>${t('CARL_RPG.Encounters.PlaceHint')}</em></p>`,
    rejectClose: false,
  });
  if (ok) await placeEncounter(entries);
}
