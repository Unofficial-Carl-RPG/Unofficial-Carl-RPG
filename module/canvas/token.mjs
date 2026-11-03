import { crawlerNumberLabel, skullText, starText } from '../helpers/crawler-number.mjs';

/** How big the crawler number is next to the name (a fraction of its size). */
const NUMBER_SCALE = 0.7;

/**
 * The Carl RPG token. When its name is shown in a scene, a crawler's token also
 * shows its crawler number ("Crawler # 5") on a new line under the name, in
 * smaller text. The number is its own text object, kept in step with the
 * nameplate (its position, scale and visibility), so it appears and disappears
 * with the name.
 */
export class CarlRPGToken extends foundry.canvas.placeables.Token {
  /**
   * The crawler number text, under the nameplate.
   * @type {PreciseText|undefined}
   */
  numberplate;

  /** @override */
  _refreshNameplate() {
    super._refreshNameplate();
    // Crawler Killer skulls go after the name, on the same line.
    const skulls = [skullText(this.actor), starText(this.actor)].filter(Boolean).join(' ');
    if (skulls) this.nameplate.text = `${this.document.name} ${skulls}`;
    this.#updateNumberplate();
  }

  /** @override */
  _refreshState() {
    super._refreshState();
    this.#updateNumberplate();
  }

  /** @override */
  _refreshSize() {
    super._refreshSize();
    this.#updateNumberplate();
  }

  /** Create, fill, size and place the number text to match the nameplate. */
  #updateNumberplate() {
    if (!this.nameplate) return;
    const label = crawlerNumberLabel(this.actor);
    if (!label) {
      if (this.numberplate) this.numberplate.visible = false;
      return;
    }

    if (!this.numberplate) {
      this.numberplate = this.addChild(
        new foundry.canvas.containers.PreciseText('', this._getTextStyle())
      );
      this.numberplate.anchor.set(0.5, 0);
    }
    const plate = this.numberplate;

    // The name's style, only smaller.
    const style = this._getTextStyle();
    style.fontSize = (Number(style.fontSize) || 24) * NUMBER_SCALE;
    plate.style = style;
    plate.text = label;
    plate.scale.copyFrom(this.nameplate.scale);

    // Directly under the name, and shown whenever the name is.
    plate.position.set(
      this.nameplate.position.x,
      this.nameplate.position.y + this.nameplate.height
    );
    plate.visible = this.nameplate.visible;
  }
}
