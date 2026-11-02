/**
 * The event library: saved events, each kept as a page in a journal the GM picks (a
 * world setting). A template page holds one event, in the flag `libraryEvent`. Anyone
 * who can edit an item can save its events here; only the GM can delete a template.
 */
const NS = 'carl-rpg';
export const LIBRARY_SETTING = 'eventLibraryJournal';
export const LIBRARY_FLAG = 'libraryEvent';

export function registerEventLibrary() {
  // A player's save, sent to the GM's client (see saveLibraryEvent).
  Hooks.on('createChatMessage', (message) => {
    const relay = message.getFlag(NS, 'libraryRelay');
    if (relay && game.user === game.users.activeGM) handleLibraryRelay(message, relay);
  });
  game.settings.register(NS, LIBRARY_SETTING, {
    name: 'CARL_RPG.Combat.LibrarySetting',
    hint: 'CARL_RPG.Combat.LibrarySettingHint',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.StringField({ required: true, blank: true, initial: '' }),
  });
}

/** The journal the library uses, or null if none is picked. */
export function libraryJournal() {
  const id = game.settings.get(NS, LIBRARY_SETTING);
  return id ? (game.journal.get(id) ?? null) : null;
}

/** Every template in the library: { id, name, event }. */
export function listTemplates() {
  const journal = libraryJournal();
  if (!journal) return [];
  return journal.pages
    .filter((page) => page.getFlag(NS, LIBRARY_FLAG))
    .map((page) => ({
      id: page.id,
      name: page.name,
      event: page.getFlag(NS, LIBRARY_FLAG),
    }));
}

/**
 * Save an event as a template. Writes to the library journal, so the caller must be
 * the GM (players go through the GM's client; see the next step).
 * @returns {Promise<boolean>} Whether it was saved
 */
export async function saveTemplate(name, event) {
  const journal = libraryJournal();
  if (!journal || !game.user.isGM) return false;
  await journal.createEmbeddedDocuments('JournalEntryPage', [
    {
      name: name || game.i18n.localize('CARL_RPG.Combat.LibraryUnnamed'),
      type: 'text',
      text: { content: '' },
      flags: { [NS]: { [LIBRARY_FLAG]: event } },
    },
  ]);
  return true;
}

/** Delete a template from the library (GM only). */
export async function deleteTemplate(pageId) {
  const journal = libraryJournal();
  if (!journal || !game.user.isGM) return false;
  const page = journal.pages.get(pageId);
  if (!page) return false;
  await page.delete();
  return true;
}

/**
 * Save an event from an item to the library. The GM writes it; a player whose item it
 * is asks the GM's client to (players can't write to the GM's journal).
 * @returns {Promise<boolean>}  Whether it was saved, or sent to the GM
 */
export async function saveLibraryEvent(item, name, event) {
  if (!libraryJournal()) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Combat.LibraryNone'));
    return false;
  }
  if (game.user.isGM) {
    await saveTemplate(name, event);
    ui.notifications.info(game.i18n.localize('CARL_RPG.Combat.LibrarySaved'));
    return true;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize('CARL_RPG.Relay.NoGM'));
    return false;
  }
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    whisper: gmIds,
    content: `<em>${game.i18n.localize('CARL_RPG.Relay.Working')}</em>`,
    flags: {
      [NS]: { libraryRelay: { itemUuid: item.uuid, name, event, userId: game.user.id } },
    },
  });
  ui.notifications.info(game.i18n.localize('CARL_RPG.Combat.LibrarySent'));
  return true;
}

/** On the GM's client: check the requester owns the item, then save the event. */
async function handleLibraryRelay(message, relay) {
  await message.delete();
  const user = game.users.get(relay.userId);
  const item = await fromUuid(relay.itemUuid);
  if (!user || !item || !item.testUserPermission(user, 'OWNER')) return;
  await saveTemplate(relay.name, relay.event);
}
