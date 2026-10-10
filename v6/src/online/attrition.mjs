// Non-battle losses. A host that stands on rough ground outside its own realm
// bleeds every dawn: men fall sick in the marshes, founder on the mountain
// tracks, die of thirst in the sands and of cold in the snows. In the lands of
// its own House an army is fed and quartered, and the weather spares it. The
// weakest go first, as they do in a retreat. The sea has a toll of its own
// (sea-toll.mjs); this is the land.

import { moveRanks, guestKey } from './ranks.mjs';
import { wearAt, TERRAIN } from './terrain.mjs';
import { seasonNow } from './seasons.mjs';

// A House's own realm: the lands that have always been its own. There its men
// are fed, quartered and doctored, so the weather and the road take nobody.
// Everything else — a neighbour's land, a land just taken from the wild, the
// open sea — is foreign ground, and an army that stands on it wears away.
export function atHome(map, id, house) {
  return map?.territories?.find(t => t.id === id)?.house_sector === house;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// Losses of `men` at `rate`: the whole part always, the remainder by lot, and
// never the last man — a host is worn down, not wiped out, by the road.
export function wearLoss(men, rate, lot) {
  if (men <= 1 || rate <= 0) return 0;
  const exact = men * rate;
  const whole = Math.floor(exact);
  const extra = lot < exact - whole ? 1 : 0;
  return Math.min(men - 1, whole + extra);
}

/**
 * One dawn of non-battle losses on land. Mutates `game.state`; returns the
 * losses it took.
 */
export function attritionDawn(game, map, nowMs = Date.now(), season = null) {
  const state = game.state;
  const day = Number(game.rounds?.number || 0);
  season ||= seasonNow(game, map);
  const out = [];
  const take = (id, house, men, key) => {
    if (atHome(map, id, house)) return 0;
    const wear = wearAt(map, state, id, house, season);
    if (!wear) return 0;
    const lot = hash(`${game.id}:${day}:${id}:${house}`);
    const lost = wearLoss(men, wear.rate, lot);
    if (!lost) return 0;
    moveRanks(state, map, key, null, house, 0, { losses: lost });
    out.push({ house, territory: id, lost, why: wear.why });
    state.journal.push({
      kind: 'ATTRITION', house, houses: [house], territory: id, lost, left: men - lost,
      why: wear.why, terrain: wear.terrain || null, at: new Date(nowMs).toISOString()
    });
    return lost;
  };

  for (const [id, land] of Object.entries(state.territories || {})) {
    if (map.sea_waypoints?.[id]) continue;
    for (const [house, count] of Object.entries(land.warriors || {})) {
      const men = Number(count || 0);
      if (men <= 0) continue;
      const lost = take(id, house, men, id);
      if (!lost) continue;
      const left = men - lost;
      if (left > 0) land.warriors[house] = left;
      else delete land.warriors[house];
    }
  }
  // Men camped as guests on another House's land suffer the same weather.
  for (const [id, byHouse] of Object.entries(state.guests || {})) {
    for (const [house, count] of Object.entries(byHouse || {})) {
      const men = Number(count || 0);
      if (men <= 0) continue;
      const lost = take(id, house, men, guestKey(id));
      if (!lost) continue;
      const left = men - lost;
      if (left > 0) byHouse[house] = left;
      else delete byHouse[house];
    }
  }
  for (const id of Object.keys(state.guests || {})) {
    if (!Object.keys(state.guests[id]).length) delete state.guests[id];
  }
  return out;
}

/**
 * What the client needs to draw a skull over a host: the reason it bleeds and
 * how many men it stands to lose by the next dawn. Built from what the House
 * can actually see, so it tells nothing the fog hides.
 */
export function attritionView(state, map, season = null) {
  const view = {};
  const note = (id, house, men) => {
    if (atHome(map, id, house)) return;
    const wear = wearAt(map, state, id, house, season);
    if (!wear || men <= 1) return;
    const lost = Math.max(1, Math.floor(men * wear.rate));
    (view[id] ||= {})[house] = { why: wear.why, text: wear.text, men: Math.min(men - 1, lost) };
  };
  for (const [id, land] of Object.entries(state.territories || {})) {
    for (const [house, count] of Object.entries(land.warriors || {})) note(id, house, Number(count || 0));
  }
  for (const [id, node] of Object.entries(state.sea_nodes || {})) {
    for (const [house, count] of Object.entries(node.warriors || {})) note(id, house, Number(count || 0));
  }
  for (const [id, byHouse] of Object.entries(state.guests || {})) {
    for (const [house, count] of Object.entries(byHouse || {})) note(id, house, Number(count || 0));
  }
  return view;
}

// For the land card: what this ground does to an army.
export function terrainNote(map, id) {
  const kind = map?.terrain?.[id];
  const here = TERRAIN[kind];
  if (!here || !kind || kind === 'равнина') return null;
  return { kind, name: here.name, slow: here.slow, wear: here.wear, lore: here.lore };
}
