import { getFloor, getDaysLeft } from './floor.mjs';
import { getPartyName } from './party.mjs';

/*
 * Journal enrichers. @Floor, @Party and @DaysLeft are live values: the span keeps
 * its name in data-carl-live, so every open journal page can update in place when
 * the world changes.
 */

const LIVE = {
  floor: () => getFloor(),
  party: () => getPartyName(),
  daysLeft: () => getDaysLeft(),
};

const liveEnricher = (name) => () => {
  const span = document.createElement('span');
  span.className = 'carl-live';
  span.dataset.carlLive = name;
  span.textContent = String(LIVE[name]() ?? '');
  return span;
};

/** Refresh every live value on the page (called when a carl-rpg setting changes). */
export function refreshLiveValues() {
  for (const [name, value] of Object.entries(LIVE)) {
    for (const el of document.querySelectorAll(`[data-carl-live="${name}"]`)) {
      el.textContent = String(value() ?? '');
    }
  }
}

export function registerJournalEnrichers() {
  CONFIG.TextEditor.enrichers.push(
    { pattern: /@Floor\b/g, enricher: liveEnricher('floor') },
    { pattern: /@Party\b/g, enricher: liveEnricher('party') },
    { pattern: /@DaysLeft\b/g, enricher: liveEnricher('daysLeft') }
  );
  Hooks.on('updateSetting', (setting) => {
    if (setting?.key?.startsWith('carl-rpg.')) refreshLiveValues();
  });
}
