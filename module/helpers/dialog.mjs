/**
 * The Carl RPG dialog.
 *
 * Every pop-up in this system (confirmations, choices, prompts) uses this instead
 * of Foundry's plain DialogV2, so it gets the Dungeon Crawler Carl theme: the
 * `carl-rpg` class turns on the theme's window frame, fonts, form controls and
 * buttons (see src/scss/components/_theme.scss), and `carl-dialog` adds a few
 * dialog-only touches.
 *
 * It works exactly like DialogV2, so use its static helpers the same way:
 *
 *   await CarlRPGDialog.confirm({ window: { title }, content });
 *   await CarlRPGDialog.prompt({ window: { title }, content, ok: { callback } });
 *   await CarlRPGDialog.wait({ window: { title }, content, buttons });
 *
 * Any new dialog should use CarlRPGDialog (never DialogV2 directly).
 */
export class CarlRPGDialog extends foundry.applications.api.DialogV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['carl-rpg', 'carl-dialog'],
  };
}
