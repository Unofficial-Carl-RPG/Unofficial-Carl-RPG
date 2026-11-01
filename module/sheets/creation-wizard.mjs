import { CarlRPGDialog } from '../helpers/dialog.mjs';
import {
  applyCreation,
  getCreationDefaults,
  loadBackgrounds,
  planSkills,
  resolveItems,
  skillPool,
  skillStatLabel,
  weaponSkill,
} from '../helpers/creation.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } =
  foundry.applications.api;

const NS = 'carl-rpg';
const STEPS = ['basics', 'stats', 'skills', 'weapon', 'gear', 'bio', 'review'];
const BACKGROUND = ['pastTrauma', 'popularity', 'looseEnds', 'regrets'];

/**
 * The character creation wizard: it guides a new crawler through their name and
 * basics, the standard array for their stats, eight skills in four pairs, a
 * weapon, starting gear and their background, then writes it all to the crawler
 * (see helpers/creation.mjs). What is on offer comes from the creation settings.
 */
export class CarlRPGCreationWizard extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /**
   * @param {Actor} actor  The crawler being created
   */
  constructor(actor, options = {}) {
    super({ id: `carl-rpg-wizard-${actor.id}`, ...options });
    this.actor = actor;
    const stats = {};
    for (const key of Object.keys(CONFIG.CARL_RPG.abilities)) stats[key] = null;
    // Stats already rolled for this crawler are kept on it, so closing the wizard
    // doesn't give another roll.
    if (getCreationDefaults().statMethod === 'roll') {
      const saved = actor.getFlag(NS, 'creationStats') ?? {};
      for (const key of Object.keys(stats)) stats[key] = saved[key] ?? null;
    }
    this.draft = {
      name: actor.name,
      gender: actor.system.gender ?? '',
      size: actor.system.size,
      stats,
      skills: Array(
        CONFIG.CARL_RPG.creation.skillGroups.length *
          CONFIG.CARL_RPG.creation.skillsPerGroup
      ).fill(''),
      // Where each category's skills come from: '' (not chosen yet), 'any' (any
      // skill with the skill tag) or the UUID of a background.
      sources: Object.fromEntries(
        CONFIG.CARL_RPG.creation.skillGroups.map((group) => [group.id, ''])
      ),
      weapon: '',
      gear: [],
      background: Object.fromEntries(BACKGROUND.map((k) => [k, ''])),
    };
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['carl-rpg', 'creation-wizard'],
    position: { width: 640, height: 'auto' },
    window: {
      title: 'CARL_RPG.Creation.Wizard.Title',
      icon: 'fa-solid fa-user-plus',
      resizable: true,
    },
    actions: {
      back: CarlRPGCreationWizard._onBack,
      next: CarlRPGCreationWizard._onNext,
      goto: CarlRPGCreationWizard._onGoto,
      pickStat: CarlRPGCreationWizard._onPickStat,
      pickSource: CarlRPGCreationWizard._onPickSource,
      toggleSkill: CarlRPGCreationWizard._onToggleSkill,
      rollStats: CarlRPGCreationWizard._onRollStats,
      resetRolls: CarlRPGCreationWizard._onResetRolls,
      finish: CarlRPGCreationWizard._onFinish,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'systems/carl-rpg/templates/creation/wizard.hbs',
      scrollable: [''],
    },
  };

  #step = 0;
  #busy = false;
  #rolling = false;
  /** The backgrounds on offer, loaded at each render (see loadBackgrounds). */
  #backgrounds = {};
  /** The skills "any skill" can pick from, loaded at each render (see skillPool). */
  #skillPool = [];

  /** Open the wizard for a crawler. */
  static open(actor) {
    const id = `carl-rpg-wizard-${actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.render({ force: true });
    return new CarlRPGCreationWizard(actor).render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Validation                                  */
  /* -------------------------------------------- */

  /**
   * Whether a step is filled in. Nothing stops moving between steps; only
   * finishing needs every step filled in (see #problems).
   */
  #valid(step) {
    const s = this.draft;
    const defaults = getCreationDefaults();
    switch (step) {
      case 'basics':
        return s.name.trim().length > 0;
      case 'stats': {
        const values = Object.values(s.stats);
        if (!values.every((v) => v !== null)) return false;
        // The standard array uses each number once; rolled stats can repeat.
        return (
          defaults.statMethod === 'roll' ||
          new Set(values).size === values.length
        );
      }
      case 'skills':
        return (
          s.skills.every(Boolean) && new Set(s.skills).size === s.skills.length
        );
      case 'weapon':
        // With no weapons set up there is nothing to pick.
        return !defaults.weapons.length || !!s.weapon;
      case 'gear':
        return s.gear.length <= defaults.gearPicks;
      default:
        return true;
    }
  }

  /** Whether everything before the review step is complete. */
  #allValid() {
    return STEPS.slice(0, -1).every((step) => this.#valid(step));
  }

  /** The indexes in the draft's skills list that belong to a category. */
  #groupSlots(groupIndex) {
    const per = CONFIG.CARL_RPG.creation.skillsPerGroup;
    return Array.from({ length: per }, (_, n) => groupIndex * per + n);
  }

  /**
   * Where a category's skills come from right now: 'any' (any skill with the
   * skill tag), the UUID of a background, or '' if nothing is chosen yet. A
   * category with no backgrounds uses "any" on its own, as long as that is
   * allowed.
   */
  #sourceOf(groupId) {
    const allowAny = getCreationDefaults().allowAnySkill;
    const offered = this.#backgrounds[groupId] ?? [];
    if (!offered.length) return allowAny ? 'any' : '';
    const source = this.draft.sources[groupId];
    if (source === 'any') return allowAny ? 'any' : '';
    return offered.some((b) => b.uuid === source) ? source : '';
  }

  /**
   * What still needs filling in, for the Review step. Each one names the step
   * it belongs to, so it can be clicked to go there.
   * @returns {Array<{step: string, text: string}>}
   */
  #problems() {
    const s = this.draft;
    const cfg = CONFIG.CARL_RPG;
    const defaults = getCreationDefaults();
    const missing = (key, data) =>
      game.i18n.format(`CARL_RPG.Creation.Wizard.Missing.${key}`, data);
    const problems = [];

    if (!s.name.trim()) problems.push({ step: 'basics', text: missing('name') });

    const unassigned = Object.entries(s.stats)
      .filter(([, value]) => value === null)
      .map(([key]) => game.i18n.localize(cfg.abilities[key]));
    if (unassigned.length) {
      problems.push({
        step: 'stats',
        text:
          defaults.statMethod === 'roll'
            ? missing('rollStats')
            : missing('stats', { stats: unassigned.join(', ') }),
      });
    }

    // Skills: one line for each category that still has picks to make.
    let anyPicksNeeded = 0;
    cfg.creation.skillGroups.forEach((group, g) => {
      const open = this.#groupSlots(g).filter((i) => !s.skills[i]).length;
      if (!open) return;
      const label = game.i18n.localize(`CARL_RPG.Creation.Groups.${group.id}`);
      const source = this.#sourceOf(group.id);
      let text;
      if (!this.#backgrounds[group.id]?.length && !defaults.allowAnySkill) {
        text = missing('noBackgrounds', { group: label });
      } else if (!source) {
        text = missing('chooseSkills', { group: label });
      } else {
        text = missing('groupSkills', { count: open, group: label });
      }
      problems.push({ step: 'skills', text });
      if (source === 'any') anyPicksNeeded += open;
    });
    // Picks from "any skill" can't all be filled if there aren't enough skills.
    if (anyPicksNeeded && this.#skillPool.length < anyPicksNeeded) {
      problems.push({
        step: 'skills',
        text: game.i18n.localize('CARL_RPG.Creation.Wizard.PoolSmall'),
      });
    }

    if (defaults.weapons.length && !s.weapon) {
      problems.push({ step: 'weapon', text: missing('weapon') });
    }
    return problems;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const cfg = CONFIG.CARL_RPG;
    const defaults = getCreationDefaults();
    const s = this.draft;
    const step = STEPS[this.#step];
    // The backgrounds on offer (needed by the skills step and the problems list).
    this.#backgrounds = await loadBackgrounds();
    this.#skillPool = await skillPool();

    context.steps = STEPS.map((id, i) => ({
      id,
      label: `CARL_RPG.Creation.Steps.${id}`,
      current: i === this.#step,
      done: i < this.#step,
    }));
    context.is = Object.fromEntries(STEPS.map((id) => [id, id === step]));
    context.isFirst = this.#step === 0;
    context.isLast = this.#step === STEPS.length - 1;
    context.canFinish = this.#allValid();
    context.problems = step === 'review' ? this.#problems() : [];

    // Basics
    context.name = s.name;
    context.gender = s.gender;
    // (Each size shows its Size Class number, like "Medium (4)".)
    context.sizes = cfg.sizeOptions();
    context.size = s.size;

    // Stats. With the Standard Array: a row of buttons, one per value, where a
    // value another stat has taken is disabled until that stat lets go of it.
    // With Roll For Stats: a button rolls them (see _onRollStats).
    context.rollMode = defaults.statMethod === 'roll';
    context.rolling = this.#rolling;
    context.hasRolled = Object.values(s.stats).every((v) => v !== null);
    // The GM can reset a crawler's rolled stats so they can roll again.
    context.canResetRolls =
      game.user.isGM && Object.values(s.stats).some((v) => v !== null);
    const used = Object.values(s.stats).filter((v) => v !== null);
    context.statRows = Object.entries(cfg.abilities).map(([key, label]) => {
      const value = s.stats[key];
      return {
        key,
        label,
        value,
        // The modifier is only shown once a value has been picked.
        hasMod: value !== null,
        mod: value === null ? 0 : cfg.getStatModifier(value),
        buttons: cfg.creation.standardArray.map((v) => ({
          value: v,
          selected: v === value,
          disabled: v !== value && used.includes(v),
        })),
      };
    });

    // Skills: four groups of two, each skill only once. Each category offers its
    // backgrounds (pick one, then two of its skills) and, if allowed, "any skill"
    // (two dropdowns). A category with no backgrounds just shows the dropdowns.
    const pool = this.#skillPool;
    let anyPicks = 0;
    context.skillGroups = cfg.creation.skillGroups.map((group, g) => {
      const slotIndexes = this.#groupSlots(g);
      const picked = slotIndexes.map((i) => s.skills[i]).filter(Boolean);
      const offered = this.#backgrounds[group.id] ?? [];
      const source = this.#sourceOf(group.id);
      if (source === 'any') anyPicks += slotIndexes.length;
      return {
        id: group.id,
        label: `CARL_RPG.Creation.Groups.${group.id}`,
        rank: group.rank,
        noOptions: !offered.length && !defaults.allowAnySkill,
        // With no backgrounds there is nothing to choose between.
        showChoices: offered.length > 0,
        allowAny: defaults.allowAnySkill && offered.length > 0,
        anySelected: source === 'any',
        backgrounds: offered.map((background) => ({
          uuid: background.uuid,
          name: background.name,
          selected: source === background.uuid,
          skills: background.skills.map((skill) => {
            // A skill picked in another category can't be picked again, and
            // only two can be picked here.
            const mine = source === background.uuid && picked.includes(skill.uuid);
            const usedElsewhere = s.skills.some(
              (uuid, i) => uuid === skill.uuid && !slotIndexes.includes(i)
            );
            const full =
              source === background.uuid &&
              !mine &&
              picked.length >= slotIndexes.length;
            return {
              uuid: skill.uuid,
              label: skill.label,
              picked: mine,
              disabled: usedElsewhere || full,
            };
          }),
        })),
        showSelects: source === 'any',
        slots: slotIndexes.map((index) => ({
          index,
          value: s.skills[index],
          // Each option reads like "Awesome Skill (Cha)".
          options: pool
            .filter(
              (skill) =>
                skill.uuid === s.skills[index] || !s.skills.includes(skill.uuid)
            )
            .map((skill) => {
              const stat = skillStatLabel(skill);
              return {
                uuid: skill.uuid,
                label: stat ? `${skill.name} (${stat})` : skill.name,
              };
            }),
        })),
      };
    });
    context.poolSize = pool.length;
    context.poolNeeded = anyPicks;
    context.anyBackgrounds = context.skillGroups.some((group) => group.showChoices);

    // Weapon
    const weapons = await resolveItems(defaults.weapons);
    context.weapons = weapons.map((w) => ({
      uuid: w.uuid,
      name: w.name,
      selected: w.uuid === s.weapon,
    }));
    context.noWeapons = !weapons.length;
    const picked = weapons.find((w) => w.uuid === s.weapon);
    const skill = picked ? await weaponSkill(picked) : null;
    context.weaponSkill = skill?.name ?? '';
    context.weaponRank = cfg.creation.weaponRank;
    context.freeSkills = (
      await Promise.all(
        defaults.freeSkills.map(async (f) => {
          const doc = await fromUuid(f.uuid);
          return doc ? { name: doc.name, rank: f.rank } : null;
        })
      )
    ).filter(Boolean);

    // Starting gear
    const gear = await resolveItems(defaults.gear);
    context.gear = gear.map((g) => ({
      uuid: g.uuid,
      name: g.name,
      img: g.img,
      checked: s.gear.includes(g.uuid),
    }));
    context.gearPicks = defaults.gearPicks;
    context.gearChosen = s.gear.length;
    context.noGear = !gear.length;

    // Background
    context.background = BACKGROUND.map((key) => ({
      key,
      label: `CARL_RPG.Actor.Crawler.Extras.${key[0].toUpperCase()}${key.slice(1)}`,
      value: s.background[key],
    }));

    // Review
    if (step === 'review') {
      context.reviewStats = context.statRows.map((r) => ({
        label: r.label,
        value: r.value,
        hasMod: r.hasMod,
        mod: r.mod,
      }));
      context.reviewSkills = (await planSkills(s))
        .map(({ skill, rank }) => ({ name: skill.name, rank }))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
      context.reviewWeapon = picked?.name ?? '';
      context.reviewGear = gear
        .filter((g) => s.gear.includes(g.uuid))
        .map((g) => g.name);
      context.reviewBackground = context.background.filter((b) => b.value);
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Events                                      */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const el of this.element.querySelectorAll('[data-field]')) {
      el.addEventListener('change', () => this.#onField(el));
    }
    for (const box of this.element.querySelectorAll('[data-gear]')) {
      box.addEventListener('change', () => this.#onGear(box));
    }
  }

  /** A field changed: store it. Choices that change what is on offer redraw. */
  #onField(el) {
    const path = el.dataset.field;
    let value = el.value;
    if (el.dataset.type === 'number') {
      value = value === '' ? null : Number(value);
    }
    foundry.utils.setProperty(this.draft, path, value);
    if (el.dataset.redraw) this.render();
    else this.#refreshNav();
  }

  /** A starting gear box was ticked or unticked (no more than the picks). */
  #onGear(box) {
    const uuid = box.dataset.gear;
    const picks = getCreationDefaults().gearPicks;
    if (box.checked) {
      if (this.draft.gear.length >= picks) {
        box.checked = false;
        ui.notifications.warn(
          game.i18n.format('CARL_RPG.Creation.Wizard.TooMuchGear', { picks })
        );
        return;
      }
      this.draft.gear.push(uuid);
    } else {
      this.draft.gear = this.draft.gear.filter((u) => u !== uuid);
    }
    this.render();
  }

  /** Enable or disable the Finish button without redrawing. */
  #refreshNav() {
    const finish = this.element.querySelector('[data-action="finish"]');
    if (finish) finish.disabled = !this.#allValid();
  }

  /** @this CarlRPGCreationWizard */
  static _onBack() {
    if (this.#step > 0) {
      this.#step -= 1;
      this.render();
    }
  }

  /** @this CarlRPGCreationWizard */
  static _onNext() {
    if (this.#step < STEPS.length - 1) {
      this.#step += 1;
      this.render();
    }
  }

  /**
   * Click a value for a stat: it is given to that stat, and clicking the stat's
   * chosen value again clears it. (A value another stat has is disabled.)
   * @this CarlRPGCreationWizard
   */
  static _onPickStat(event, target) {
    if (getCreationDefaults().statMethod === 'roll') return;
    const { stat } = target.dataset;
    const value = Number(target.dataset.value);
    const stats = this.draft.stats;
    if (!(stat in stats)) return;
    if (stats[stat] === value) {
      stats[stat] = null;
    } else if (!Object.values(stats).includes(value)) {
      stats[stat] = value;
    }
    this.render();
  }

  /**
   * Choose where a category's skills come from: one of its backgrounds, or "any".
   * Changing it clears that category's picks. Returns whether it changed.
   */
  #setSource(groupId, source) {
    if (this.#sourceOf(groupId) === source) return false;
    this.draft.sources[groupId] = source;
    const g = CONFIG.CARL_RPG.creation.skillGroups.findIndex(
      (group) => group.id === groupId
    );
    for (const i of this.#groupSlots(g)) this.draft.skills[i] = '';
    return true;
  }

  /**
   * A background (or "any skill") was clicked in a category's list.
   * @this CarlRPGCreationWizard
   */
  static _onPickSource(event, target) {
    this.#setSource(target.dataset.group, target.dataset.source);
    this.render();
  }

  /**
   * A skill chip was clicked: it is picked, or put back if it was already
   * picked. Clicking a chip of another background switches to that background
   * first. Two can be picked, and a skill picked in another category can't be.
   * @this CarlRPGCreationWizard
   */
  static _onToggleSkill(event, target) {
    const { group, source, skill } = target.dataset;
    this.#setSource(group, source);
    const g = CONFIG.CARL_RPG.creation.skillGroups.findIndex((x) => x.id === group);
    const slots = this.#groupSlots(g);
    const taken = slots.find((i) => this.draft.skills[i] === skill);
    if (taken !== undefined) {
      this.draft.skills[taken] = '';
    } else if (!this.draft.skills.includes(skill)) {
      const free = slots.find((i) => !this.draft.skills[i]);
      if (free !== undefined) this.draft.skills[free] = skill;
    }
    this.render();
  }

  /**
   * Roll For Stats: roll the stats that have no value yet, one at a time in order,
   * a couple of seconds apart. Each is 1d6, re-rolling 1s. A value is kept on the
   * crawler as soon as it is rolled, so closing the wizard doesn't allow a
   * re-roll (and an interrupted roll carries on with the stats that are left).
   * @this CarlRPGCreationWizard
   */
  static async _onRollStats() {
    if (this.#rolling || getCreationDefaults().statMethod !== 'roll') return;
    const { die, rerollBelow, delayMs } = CONFIG.CARL_RPG.creation.statRoll;
    this.#rolling = true;
    this.render();
    try {
      let first = true;
      for (const key of Object.keys(this.draft.stats)) {
        if (this.draft.stats[key] !== null) continue;
        // A pause between stats (none before the first).
        if (!first) await new Promise((resolve) => setTimeout(resolve, delayMs));
        first = false;
        if (!this.rendered) break; // the wizard was closed

        let value;
        do {
          const roll = await new Roll(`1d${die}`).evaluate();
          value = roll.total;
        } while (value < rerollBelow);
        this.draft.stats[key] = value;
        foundry.audio?.AudioHelper?.play(
          { src: CONFIG.sounds.dice, volume: 0.6 },
          false
        );
        await this.actor.setFlag(NS, 'creationStats', { ...this.draft.stats });
        this.render();
      }
    } finally {
      this.#rolling = false;
      if (this.rendered) this.render();
    }
  }

  /**
   * Clear the rolled stats, so the crawler can roll again.
   */
  clearRolledStats() {
    for (const key of Object.keys(this.draft.stats)) this.draft.stats[key] = null;
    this.render();
  }

  /**
   * The GM resets a crawler's rolled stats (after asking). The saved rolls are
   * removed from the crawler, and the player's open wizard, if any, clears its
   * stats too (see the updateActor hook below).
   * @this CarlRPGCreationWizard
   */
  static async _onResetRolls() {
    if (!game.user.isGM || this.#rolling) return;
    const ok = await CarlRPGDialog.confirm({
      window: { title: game.i18n.localize('CARL_RPG.Creation.Wizard.ResetRolls') },
      content: `<p>${game.i18n.format('CARL_RPG.Creation.Wizard.ResetConfirm', {
        name: Handlebars.escapeExpression(this.actor.name),
      })}</p>`,
      rejectClose: false,
    });
    if (!ok) return;
    await this.actor.unsetFlag(NS, 'creationStats');
    this.clearRolledStats();
  }

  /**
   * Jump to a step (from the Review step's list of what is still to fill in).
   * @this CarlRPGCreationWizard
   */
  static _onGoto(event, target) {
    const step = STEPS.indexOf(target.dataset.step);
    if (step >= 0) {
      this.#step = step;
      this.render();
    }
  }

  /** @this CarlRPGCreationWizard */
  static async _onFinish() {
    if (this.#busy || !this.#allValid()) return;
    this.#busy = true;
    try {
      await applyCreation(this.actor, this.draft);
      await this.close();
    } catch (err) {
      console.error('carl-rpg | character creation failed', err);
      ui.notifications.error(
        game.i18n.localize('CARL_RPG.Creation.Wizard.Failed')
      );
    } finally {
      this.#busy = false;
    }
  }
}

// When the GM resets a crawler's rolled stats, the player's open wizard (if there
// is one) clears its stats too, so they can roll again.
Hooks.on('updateActor', (actor, changes) => {
  const flags = changes.flags?.[NS] ?? {};
  // Finishing the crawler also removes the saved rolls; that isn't a reset.
  if (flags.creationComplete) return;
  // (A removed flag shows up as "-=creationStats", or as null once applied.)
  if (!('-=creationStats' in flags) && flags.creationStats !== null) return;
  foundry.applications.instances
    .get(`carl-rpg-wizard-${actor.id}`)
    ?.clearRolledStats?.();
});