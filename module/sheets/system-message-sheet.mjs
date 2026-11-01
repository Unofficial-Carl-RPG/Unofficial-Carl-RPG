import { announceSystem, defaultBanner, SYSTEM_KINDS } from '../helpers/system-announcements.mjs';

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** HTML as plain words, for a System announcement (which takes plain text). */
const plainText = (html) =>
  (new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The sheet for a System message page: the editable fields for the GM, and the
 * System-styled message for everyone. The GM also gets Send to chat.
 */
export default class CarlRPGSystemMessageSheet extends foundry.applications.sheets.journal
  .JournalEntryPageHandlebarsSheet {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['carl-system-message-page'],
    window: { icon: 'fa-solid fa-bolt' },
    actions: { sendToChat: CarlRPGSystemMessageSheet._onSendToChat },
  };

  /** @override */
  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: {
      template: 'systems/carl-rpg/templates/journal/system-message-edit.hbs',
      classes: ['standard-form'],
    },
    footer: super.EDIT_PARTS.footer,
  };

  /** @override */
  static VIEW_PARTS = {
    content: {
      template: 'systems/carl-rpg/templates/journal/system-message-view.hbs',
      root: true,
    },
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.page.system;
    const schema = this.page.schema.fields.system.fields;
    Object.assign(context, {
      kindField: schema.kind,
      headlineField: schema.headline,
      textField: schema.text,
      kind: system.kind,
      headline: system.headline,
      text: system.text,
      kindLabel: t(`CARL_RPG.SystemMessage.Kind.${system.kind}`),
      kindIcon: SYSTEM_KINDS[system.kind]?.icon ?? 'fa-bullhorn',
      enrichedText: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        system.text ?? '',
        { async: true, relativeTo: this.page }
      ),
      canSend: game.user.isGM,
    });
    return context;
  }

  /** GM: post the page as a System announcement (with its banner if its kind has one). */
  /** @this CarlRPGSystemMessageSheet */
  static async _onSendToChat() {
    if (!game.user.isGM) return;
    const { kind, headline, text } = this.page.system;
    const body = plainText(text);
    await announceSystem({
      kind,
      text: headline ? `${headline}. ${body}` : body,
      actor: null,
      banner: defaultBanner(kind),
    });
  }
}
