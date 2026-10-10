// Storms at sea.
//
// Now and then a squall rises somewhere near a fleet on the open water and
// wanders without any plan of its own, as weather does. A fleet it passes over
// may lose men to it and may not: the sea decides. It blows itself out after a
// couple of days. Nothing on land feels it.
//
// state.storms  [{ id, at, next_at, until, seq }]

import { buildAdjacency } from '../core/map.mjs';
import { moveRanks } from './ranks.mjs';
import { STORM_SHARE } from './terrain.mjs';

export const STORM = Object.freeze({
  // How often a storm rises: once out of so many dawns with fleets at sea.
  chance: 0.22,
  // A quarter of a day between steps; it lasts two days and a half.
  stepShare: 1 / 4,
  days: 2.5,
  // Of the fleets it passes over, this many are actually struck.
  hitChance: 0.55,
  share: STORM_SHARE
});

function iso(ms) {
  return new Date(ms).toISOString();
}

function dayMs(game) {
  return Number(game.rounds?.round_duration_ms) > 0 ? Number(game.rounds.round_duration_ms) : 24 * 3600_000;
}

function lot(game, ...parts) {
  const text = `${game.id}:${parts.join(':')}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

function fleetsAt(state, id) {
  return Object.entries(state.sea_nodes?.[id]?.warriors || {}).filter(([, n]) => Number(n || 0) > 0);
}

function seaWaypointsWithFleets(state, map) {
  return Object.keys(map.sea_waypoints || {}).filter(id => fleetsAt(state, id).length);
}

/**
 * At dawn a storm may rise near a fleet on the open water. Mutates `game.state`
 * and returns the storm it raised, or null.
 */
export function stormsDawn(game, map, nowMs = Date.now()) {
  const state = game.state;
  const day = Number(game.rounds?.number || 0);
  const afloat = seaWaypointsWithFleets(state, map);
  if (!afloat.length) return null;
  state.storms ||= [];
  // One storm at a time over the world: the sea is not a tempest every day.
  if (state.storms.length) return null;
  if (lot(game, 'storm', day) >= STORM.chance) return null;
  // It rises beside one of the fleets, not always on it.
  const near = buildAdjacency(map.sea_lane_edges || []);
  const seed = afloat[Math.floor(lot(game, 'storm-where', day) * afloat.length)] || afloat[0];
  const around = [...(near.get(seed) || [])].filter(id => map.sea_waypoints?.[id]).sort();
  const choices = [seed, ...around];
  const at = choices[Math.floor(lot(game, 'storm-spot', day) * choices.length)] || seed;
  state.storm_seq = Number(state.storm_seq || 0) + 1;
  const storm = {
    id: `W${state.storm_seq}`,
    at,
    next_at: iso(nowMs + Math.round(dayMs(game) * STORM.stepShare)),
    until: iso(nowMs + Math.round(dayMs(game) * STORM.days))
  };
  state.storms.push(storm);
  state.journal.push({ kind: 'STORM_ROSE', position: at, at: iso(nowMs) });
  strike(game, map, storm, nowMs);
  return storm;
}

// A storm over a fleet: it may tear it, and it may pass by.
function strike(game, map, storm, nowMs) {
  const state = game.state;
  for (const [house, count] of fleetsAt(state, storm.at)) {
    const men = Number(count || 0);
    const roll = lot(game, storm.id, storm.at, house, storm.next_at);
    if (roll >= STORM.hitChance || men <= 1) {
      state.journal.push({ kind: 'STORM_PASSED', house, houses: [house], position: storm.at, men, at: iso(nowMs) });
      continue;
    }
    const lost = Math.min(men - 1, Math.max(1, Math.floor(men * STORM.share)));
    moveRanks(state, map, storm.at, null, house, 0, { losses: lost });
    const node = state.sea_nodes[storm.at];
    const left = men - lost;
    if (left > 0) node.warriors[house] = left;
    else delete node.warriors[house];
    const afloat = Object.keys(node.warriors || {}).filter(h => Number(node.warriors[h] || 0) > 0);
    node.owner = afloat.length === 1 ? afloat[0] : null;
    state.journal.push({ kind: 'STORM_HIT', house, houses: [house], position: storm.at, lost, left, at: iso(nowMs) });
  }
}

/**
 * The clock: storms wander and blow themselves out. Returns the same game when
 * nothing moved.
 */
export function processStorms(game, map, nowMs = Date.now()) {
  const storms = game.state?.storms || [];
  if (!storms.some(storm => Date.parse(storm.next_at) <= nowMs)) return game;
  const next = structuredClone(game);
  const state = next.state;
  const near = buildAdjacency(map.sea_lane_edges || []);
  for (const storm of state.storms) {
    while (Date.parse(storm.next_at) <= nowMs) {
      const at = Date.parse(storm.next_at);
      if (at >= Date.parse(storm.until)) {
        state.journal.push({ kind: 'STORM_SPENT', position: storm.at, at: iso(at) });
        storm.done = true;
        break;
      }
      // Wherever the wind takes it: any water next door, or it stands still.
      const around = [...(near.get(storm.at) || [])].filter(id => map.sea_waypoints?.[id]).sort();
      const choices = [...around, storm.at];
      storm.at = choices[Math.floor(lot(next, storm.id, 'step', at) * choices.length)] || storm.at;
      strike(next, map, storm, at);
      storm.next_at = iso(at + Math.round(dayMs(next) * STORM.stepShare));
    }
  }
  state.storms = state.storms.filter(storm => !storm.done);
  next.updated_at = iso(nowMs);
  return next;
}

export function nextStormDueAt(game) {
  return (game.state?.storms || []).map(storm => storm.next_at).sort()[0] || null;
}
