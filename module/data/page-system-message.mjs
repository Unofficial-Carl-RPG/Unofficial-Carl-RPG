import { SYSTEM_KINDS } from '../helpers/system-announcements.mjs';

const fields = foundry.data.fields;

/**
 * A System message journal page: the GM writes it once and posts it to chat as a
 * System announcement. Its kind sets the look, and whether it has a banner (see
 * helpers/system-announcements.mjs). "Died" is not offered: it needs a crawler.
 */
export default class CarlRPGSystemMessagePage extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: new fields.StringField({
        required: true,
        blank: false,
        initial: 'general',
        choices: Object.keys(SYSTEM_KINDS).filter((kind) => kind !== 'died'),
      }),
      headline: new fields.StringField({ required: true, blank: true, initial: '' }),
      text: new fields.HTMLField({ required: true, blank: true, initial: '' }),
    };
  }
}
