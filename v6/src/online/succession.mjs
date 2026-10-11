// The throne does not stay empty.
//
// When a House's ruler is dead, his heir is raised in his place: the same
// lord, the same gifts, but now the crown is his — the throne pays its
// influence again and he leads a host as a ruler does. In his stead the next
// grown child of the House comes to court as the new heir.
//
// If the heir is in chains, the House waits for him: the throne stands empty
// and the House pays for it every dawn until somebody sits on it. If there is
// no child left at all, the line is broken and the empty throne is a wound
// that does not close.
//
// state.interregnum[house] = { since }   while nobody sits on the throne

import { CHARACTER_MODE, CHARACTER_STATUS, activeRecord, listCatalog } from '../core/characters.mjs';

// What an empty throne costs the House at every dawn.
export const EMPTY_THRONE = Object.freeze({ influence: -1 });

function living(state, house, role) {
  return Object.values(state?.characters || {}).find(character =>
    character.house === house && character.role === role &&
    character.alive && character.mode !== CHARACTER_MODE.DEAD);
}

export function rulerOf(state, house) {
  return living(state, house, 'RULER') || null;
}

export function heirOf(state, house) {
  return living(state, house, 'HEIR') || null;
}

export function isInterregnum(state, house) {
  return Boolean(state?.interregnum?.[house]);
}

// The next grown child of the House who is not already at court.
function nextChild(state, catalog, house) {
  const taken = new Set(Object.keys(state.characters || {}));
  return listCatalog(catalog).find(card =>
    card.house_pool === house &&
    card.type === 'Законный ребёнок' &&
    !taken.has(card.id)) || null;
}

/**
 * Settles the throne of every House. Mutates `game`; returns true if anything
 * changed, so the caller knows to save.
 */
export function processSuccession(game, map, catalog, { nowMs = Date.now() } = {}) {
  const state = game.state;
  if (!state?.characters) return false;
  const houses = game.rounds?.houses || Object.keys(state.houses || {});
  let changed = false;

  for (const house of houses) {
    const ruler = rulerOf(state, house);
    if (ruler && ruler.mode !== CHARACTER_MODE.CAPTIVE) {
      if (state.interregnum?.[house]) { delete state.interregnum[house]; changed = true; }
      continue;
    }
    // The ruler is dead or in chains. Is there anyone to take the crown?
    const heir = heirOf(state, house);
    const free = heir && heir.mode !== CHARACTER_MODE.CAPTIVE && heir.status === CHARACTER_STATUS.ACTIVE;
    if (!ruler && free) {
      heir.role = 'RULER';
      const child = nextChild(state, catalog, house);
      let raised = null;
      if (child) {
        raised = activeRecord(child, house, 'HEIR', CHARACTER_MODE.COURT, map);
        state.characters[raised.id] = raised;
      }
      if (state.interregnum?.[house]) delete state.interregnum[house];
      state.journal.push({
        kind: 'SUCCESSION', house, houses: [house],
        character_id: heir.id, character_name: heir.name,
        heir_id: raised?.id || null, heir_name: raised?.name || null,
        at: new Date(nowMs).toISOString()
      });
      changed = true;
      continue;
    }
    // Nobody can be crowned: the throne stands empty and the House pays for it.
    if (!state.interregnum?.[house]) {
      state.interregnum ||= {};
      state.interregnum[house] = { since: new Date(nowMs).toISOString() };
      state.journal.push({
        kind: 'THRONE_EMPTY', house, houses: [house],
        why: ruler ? 'CAPTIVE' : heir ? 'HEIR_HELD' : 'NO_HEIR',
        at: new Date(nowMs).toISOString()
      });
      changed = true;
    }
  }
  return changed;
}
