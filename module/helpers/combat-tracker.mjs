import { CarlRPGCombat, refillCombatActions } from '../documents/combat.mjs';
import { addDefeatedLoot } from './mob-loot.mjs';
import {
  declarationsOf,
  declareMove,
  describeDeclaration,
  isDeclarePhase,
  removeDeclaration,
} from './declarations.mjs';

/**
 * Adjusts Foundry's combat tracker for phase-based combat (no initiative):
 *  - shows the round and the four phases, with the current one highlighted
 *  - highlights every combatant on the side that acts in the current phase
 *    (instead of a single active turn)
 *  - posts a chat message whenever the phase changes
 * Initiative controls are hidden with CSS (see styles/_combat.scss).
 */
export function registerCombatTracker() {
  Hooks.on('renderCombatTracker', (app, element) => {
    const combat = app.viewed ?? game.combat;
    if (!combat?.started) return;

    const phases = CONFIG.CARL_RPG.combatPhases;
    const current = combat.phase;
    const side = phases[current]?.side;

    // Highlight the acting side, not a single combatant.
    for (const li of element.querySelectorAll('.combatant')) {
      li.classList.remove('active');
      const combatant = combat.combatants.get(li.dataset.combatantId);
      const acting =
        side === 'all' || (combatant && CarlRPGCombat.sideOf(combatant) === side);
      li.classList.toggle('phase-active', !!acting);
      if (combatant) addActionPips(li, combatant);
      if (combatant) addDeclarations(li, combatant, combat);
    }

    // Phase banner above the combatant list.
    element.querySelector('.carl-combat-phases')?.remove();
    const banner = document.createElement('div');
    banner.className = 'carl-combat-phases';
    const steps = phases
      .map((phase, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        const label = game.i18n.localize(`CARL_RPG.Combat.Phases.${phase.id}`);
        return `<li class="phase ${state}">${i + 1}. ${label}</li>`;
      })
      .join('');
    banner.innerHTML = `
      <div class="phase-round">${game.i18n.format('CARL_RPG.Combat.Round', { round: combat.round })}</div>
      <ol class="phase-list">${steps}</ol>`;
    const list = element.querySelector('.combat-tracker, #combat-tracker');
    if (list) list.before(banner);
    else element.prepend(banner);

    // GM-only button to refill everyone's actions, in the banner's header row.
    if (game.user.isGM) {
      const refill = document.createElement('button');
      refill.type = 'button';
      refill.className = 'carl-refill-actions';
      refill.innerHTML = `<i class="fas fa-rotate"></i> ${game.i18n.localize('CARL_RPG.Combat.RefillActions')}`;
      refill.addEventListener('click', (event) => {
        event.preventDefault();
        refillCombatActions(combat);
      });
      banner.append(refill);
    }

    addDefeatedLoot(element, combat);
    renameNextButton(element);
  });

  // Announce each new phase in chat (once, from a single GM client).
  Hooks.on('updateCombat', (combat, changed) => {
    if (!foundry.utils.hasProperty(changed, 'flags.carl-rpg.phase')) return;
    if (game.user !== game.users.activeGM) return;

    const phase = CONFIG.CARL_RPG.combatPhases[combat.phase];
    if (!phase) return;
    const note =
      phase.id === 'cleanup'
        ? `<div>${game.i18n.localize('CARL_RPG.Combat.CleanupNote')}</div>`
        : '';
    ChatMessage.create({
      content: `<div class="carl-phase-message"><strong>${game.i18n.format(
        'CARL_RPG.Combat.Round',
        { round: combat.round }
      )}</strong> &mdash; ${combat.phase + 1}. ${game.i18n.localize(
        `CARL_RPG.Combat.Phases.${phase.id}`
      )}${note}</div>`,
    });

    // Hook for automating the rest of the cleanup phase (resolving remaining
    // effects, ...). Fires once, on the GM's client.
    if (phase.id === 'cleanup') {
      // Cleanup refills everyone's actions.
      combat.resetActions();
      Hooks.callAll('carlrpg.cleanupPhase', combat);
    }
  });
}

/**
 * Foundry's footer button says "Next Turn"; for phase combat it moves to the next
 * phase, so show "Next Phase" instead (label and tooltip only).
 * @param {HTMLElement} element
 */
function renameNextButton(element) {
  const label = game.i18n.localize('CARL_RPG.Combat.NextPhase');
  const coreLabel = game.i18n.localize('COMBAT.NextTurn');
  for (const el of element.querySelectorAll('button, a')) {
    const isNext =
      el.dataset.control === 'nextTurn' ||
      el.dataset.action === 'nextTurn' ||
      el.textContent.trim() === coreLabel;
    if (!isNext) continue;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === coreLabel) {
        node.textContent = ` ${label}`;
      }
    }
    el.dataset.tooltip = label;
    el.setAttribute('aria-label', label);
  }
}

/**
 * What a mob has declared, under its name (everyone sees it, never attack numbers).
 * In the Mobs Declare phase the GM also gets a button to declare a movement, and a
 * way to take a declaration away. See helpers/declarations.mjs.
 * @param {HTMLElement} li
 * @param {Combatant} combatant
 * @param {Combat} combat
 */
function addDeclarations(li, combatant, combat) {
  li.querySelector('.declared')?.remove();
  const list = declarationsOf(combat, combatant);
  const canDeclare =
    game.user.isGM && combatant.actor?.type === 'mob' && isDeclarePhase(combat);
  if (!list.length && !canDeclare) return;

  const box = document.createElement('div');
  box.className = 'declared';
  for (const declaration of list) {
    const row = document.createElement('div');
    row.className = `declaration${declaration.resolved ? ' resolved' : ''}`;
    row.innerHTML = `<i class="fas ${declaration.kind === 'move' ? 'fa-person-running' : 'fa-bullseye'}"></i> <span>${describeDeclaration(declaration)}</span>`;
    if (game.user.isGM && !declaration.resolved) {
      const remove = document.createElement('a');
      remove.className = 'declaration-remove';
      remove.dataset.tooltip = game.i18n.localize('CARL_RPG.Declare.Remove');
      remove.innerHTML = '<i class="fas fa-xmark"></i>';
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeDeclaration(combat, combatant.id, declaration.id);
      });
      row.append(remove);
    }
    box.append(row);
  }
  if (canDeclare) {
    const move = document.createElement('a');
    move.className = 'declare-move';
    move.innerHTML = `<i class="fas fa-person-running"></i> ${game.i18n.localize('CARL_RPG.Declare.MoveButton')}`;
    move.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      declareMove(combatant);
    });
    box.append(move);
  }
  li.append(box);
}

/**
 * Action pips next to a combatant's name: filled pips are actions left, hollow
 * ones are spent. Clicking a pip spends or restores one action (the GM can
 * change anyone's; players can change their own crawler's).
 * @param {HTMLElement} li         The combatant's row in the tracker
 * @param {Combatant} combatant
 */
function addActionPips(li, combatant) {
  li.querySelector('.action-pips')?.remove();

  const max = combatant.maxActions;
  if (!max) return;
  const left = combatant.actionsLeft;
  const canEdit = combatant.isOwner;

  const pips = document.createElement('span');
  pips.className = 'action-pips';
  pips.dataset.tooltip = game.i18n.format('CARL_RPG.Combat.Actions', {
    left,
    max,
  });
  // More pips than fit is unlikely; show up to 12.
  for (let i = 0; i < Math.min(max, 12); i++) {
    const pip = document.createElement('a');
    pip.className = `action-pip${i < left ? ' filled' : ''}${
      canEdit ? '' : ' readonly'
    }`;
    if (canEdit) {
      pip.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (pip.classList.contains('filled')) await combatant.spendAction();
        else await combatant.restoreAction();
      });
    }
    pips.append(pip);
  }

  const name = li.querySelector('.token-name') ?? li;
  name.append(pips);
}
