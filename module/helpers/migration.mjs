/**
 * Updating the system without breaking a world.
 *
 * The system's version is in system.json. The version a world was last brought up
 * to is kept in a hidden world setting. When the system is newer, the active GM's
 * client does two things when the world loads, then records the new version:
 *
 *  1. Fill in new fields: every world actor and item, and every item an actor
 *     holds, is saved again with the full system data its model has now, so a field
 *     added since it was saved gets its default.
 *  2. Run the steps in STEPS that are newer than the stored version, oldest first.
 *
 * If anything fails the version is not recorded, so it is tried again next time.
 *
 * These saves carry the option `carlMigration`, which the document classes read to
 * leave alone what a normal save would do (marking events as approved, giving gear
 * skills, starting Dying, handing a pet its skills).
 */
import { migrateClassTags } from './tags.mjs';

const NS = 'carl-rpg';
export const MIGRATION_SETTING = 'migratedVersion';

/** How many documents are saved in one request. */
const BATCH = 50;

/**
 * Steps that change stored data in a way a new field's default can't. Each runs
 * once, for a world last brought up to an older version. Add new ones at the end,
 * with the version that needs them.
 * @type {Array<{version: string, run: () => Promise<void>}>}
 */
export const STEPS = [
  // Class tags were first stored as regular tags: they are categories now.
  { version: '0.1.0', run: () => migrateClassTags() },
];

const t = (key, data) =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

export function registerMigration() {
  game.settings.register(NS, MIGRATION_SETTING, {
    scope: 'world',
    config: false,
    type: new foundry.data.fields.StringField({ initial: '' }),
  });
}

/**
 * Compare two versions like "0.1.0" and "0.10.2". A blank version is older than any.
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v || '0')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/**
 * The steps a world last brought up to `stored` still has to run to reach `current`.
 * @param {string} stored
 * @param {string} current
 */
export function pendingSteps(stored, current) {
  return STEPS.filter(
    (step) =>
      compareVersions(step.version, stored) > 0 &&
      compareVersions(step.version, current) <= 0
  ).sort((a, b) => compareVersions(a.version, b.version));
}

/** A save of a document's stored system data (defaults for any new field included). */
const full = (doc) => ({ _id: doc.id, system: foundry.utils.deepClone(doc._source.system) });

/** Save the full system data of some documents, a few at a time. */
async function saveAll(docs, save) {
  const updates = docs.filter((doc) => doc._source?.system).map(full);
  for (let i = 0; i < updates.length; i += BATCH) {
    await save(updates.slice(i, i + BATCH));
  }
}

/** Fill in new fields on every world actor and item, and on the items actors hold. */
export async function fillNewFields() {
  const options = { diff: false, render: false, carlMigration: true };
  await saveAll([...game.actors], (updates) =>
    CONFIG.Actor.documentClass.updateDocuments(updates, options)
  );
  await saveAll([...game.items], (updates) =>
    CONFIG.Item.documentClass.updateDocuments(updates, options)
  );
  for (const actor of game.actors) {
    await saveAll([...actor.items], (updates) =>
      actor.updateEmbeddedDocuments('Item', updates, options)
    );
  }
}

/** Bring the world up to the system's version, if it is behind (the active GM only). */
export async function runMigration() {
  if (game.user !== game.users.activeGM) return;
  const current = game.system.version;
  const stored = game.settings.get(NS, MIGRATION_SETTING) ?? '';
  if (compareVersions(current, stored) <= 0) return;

  ui.notifications.info(t('CARL_RPG.Migration.Started', { version: current }));
  try {
    await fillNewFields();
    for (const step of pendingSteps(stored, current)) await step.run();
    await game.settings.set(NS, MIGRATION_SETTING, current);
    ui.notifications.info(t('CARL_RPG.Migration.Done', { version: current }));
  } catch (err) {
    console.error(`${NS} | updating the world failed`, err);
    ui.notifications.error(t('CARL_RPG.Migration.Failed'));
  }
}
