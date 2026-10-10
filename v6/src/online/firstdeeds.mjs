// The first deeds: what a House is told to do on the day it is founded.
//
// A player who opens the map on the first day sees a realm and no reason to
// touch anything. These four deeds are that reason: each one is a plain thing
// to do, each pays once, and together they walk a newcomer through the whole
// game — take ground, raise men, build, and speak to a neighbour. They are not
// a lesson: an old hand does them in the first ten minutes without noticing.
//
// state.deeds[house] = [key...] — the deeds already paid for.

import { addInfluence } from './influence.mjs';

export const DEEDS = Object.freeze([
  {
    key: 'LAND',
    name: 'Расширить владения',
    want: 'взять любую вольную землю',
    lore: 'Вокруг столицы лежат земли, которые держат вольные люди. Кто придёт с ратью, тот и господин.',
    gold: 5
  },
  {
    key: 'HOST',
    name: 'Собрать рать',
    want: 'нанять воинов',
    lore: 'Четыре меча — не войско. Казна есть, люди есть; дело за твоим словом.',
    gold: 5
  },
  {
    key: 'FORT',
    name: 'Поставить крепость',
    want: 'возвести крепость в своей земле',
    lore: 'Стены держат землю, когда рать ушла.',
    influence: 2
  },
  {
    key: 'ENVOY',
    name: 'Послать гонца',
    want: 'заключить сделку с другим Домом',
    lore: 'Слово дешевле меча, а берёт порой больше.',
    influence: 2
  }
]);

function hasDone(game, map, house, key) {
  const state = game.state;
  const journal = state.journal || [];
  if (key === 'LAND') {
    const capital = map.capitals?.[house];
    return Object.entries(state.territories || {}).some(([id, land]) => land.owner === house && id !== capital);
  }
  if (key === 'HOST') {
    return journal.some(e => ['UNITS_HIRED', 'RECRUIT_QUEUED', 'RECRUIT_COMPLETE', 'MILITIA_RAISED'].includes(e.kind)
      && (e.house === house || (e.houses || []).includes(house)));
  }
  if (key === 'FORT') {
    if (Object.values(state.territories || {}).some(land => land.owner === house && land.fort)) return true;
    return journal.some(e => ['FORT_QUEUED', 'FORT_COMPLETE'].includes(e.kind) && (e.house === house || (e.houses || []).includes(house)));
  }
  if (key === 'ENVOY') {
    return journal.some(e => ['DEAL_MADE', 'ALLIANCE_FORMED', 'PEACE_MADE', 'AID_SENT'].includes(e.kind)
      && (e.house === house || (e.houses || []).includes(house) || e.from === house));
  }
  return false;
}

export function deedsOf(state, house) {
  return state?.deeds?.[house] || [];
}

// What the House still has to do, and what it has already been paid for.
export function deedsView(game, map, house) {
  const taken = new Set(deedsOf(game.state, house));
  return DEEDS.map(deed => ({
    key: deed.key,
    name: deed.name,
    want: deed.want,
    lore: deed.lore,
    gold: deed.gold || 0,
    influence: deed.influence || 0,
    done: taken.has(deed.key) || hasDone(game, map, house, deed.key)
  }));
}

/**
 * Pays for every first deed done since the last look. Mutates `game`; returns
 * true when anything was paid.
 */
export function checkDeeds(game, map, constants, { nowMs = Date.now() } = {}) {
  const state = game.state;
  if (!state?.houses) return false;
  state.deeds ||= {};
  let changed = false;
  for (const house of Object.keys(state.houses)) {
    const taken = state.deeds[house] ||= [];
    for (const deed of DEEDS) {
      if (taken.includes(deed.key)) continue;
      if (!hasDone(game, map, house, deed.key)) continue;
      taken.push(deed.key);
      if (deed.gold) state.houses[house].gold = Number(state.houses[house].gold || 0) + deed.gold;
      if (deed.influence) addInfluence(state, house, deed.influence, 'DEED', { nowMs });
      state.journal.push({
        kind: 'DEED_DONE', house, houses: [house], deed: deed.key, name: deed.name,
        gold: deed.gold || 0, influence: deed.influence || 0,
        last: taken.length === DEEDS.length, at: new Date(nowMs).toISOString()
      });
      changed = true;
    }
  }
  return changed;
}
