// Warriors camped as guests on a host's land (right of passage).
//
// They stay only while the host owns the land and keeps his roads open to
// them. When the land changes hands, or the right is withdrawn, or war breaks
// out, they are led home to the nearest land of their own House.

import { buildAdjacency } from '../core/map.mjs';
import { hasPassage } from './diplomacy.mjs';
import { guestKey, moveRanks } from './ranks.mjs';

export function nearestOwnLand(state, map, house, from) {
  const adjacency = buildAdjacency([...(map.land_edges || []), ...(map.sea_lane_edges || [])]);
  const seen = new Set([from]);
  let wave = [from];
  while (wave.length) {
    const hit = wave.filter(id => state.territories?.[id]?.owner === house).sort()[0];
    if (hit) return hit;
    const next = [];
    for (const id of wave) {
      for (const other of adjacency.get(id) || []) {
        if (seen.has(other)) continue;
        seen.add(other);
        next.push(other);
      }
    }
    wave = next;
  }
  return null;
}

// A lord with an army on a land his House has just lost goes with the men that
// got away, or to the nearest land of his House when none did.
export function leadArmiesAway(state, map, house, land, to = null) {
  const home = to || nearestOwnLand(state, map, house, land);
  for (const army of Object.values(state.armies || {})) {
    if (army.house !== house || army.territory !== land || army.moving_order_id) continue;
    if (!home) continue;
    army.territory = home;
    const commander = state.characters?.[army.commander_id];
    if (commander) commander.location = { kind: 'TERRITORY', territory: home };
  }
  return home;
}

export function expelGuests(game, map, constants, nowMs = Date.now()) {
  const guests = game.state?.guests;
  if (!guests || !Object.keys(guests).length) return game;
  const unwelcome = [];
  for (const [id, byHouse] of Object.entries(guests)) {
    const host = game.state.territories?.[id]?.owner ?? null;
    for (const [house, count] of Object.entries(byHouse)) {
      if (Number(count) > 0 && (host === house || !hasPassage(game.state, host, house))) {
        unwelcome.push([id, house, Number(count), host]);
      }
    }
  }
  if (!unwelcome.length) return game;

  const next = structuredClone(game);
  for (const [id, house, count, host] of unwelcome) {
    delete next.state.guests[id][house];
    if (!Object.keys(next.state.guests[id]).length) delete next.state.guests[id];

    // The land became ours while we camped there: the camp is its garrison now.
    const home = host === house ? id : nearestOwnLand(next.state, map, house, id);
    let kept = 0;
    if (home) {
      const land = next.state.territories[home];
      const room = constants.territory_warrior_cap -
        Object.values(land.warriors || {}).reduce((sum, n) => sum + Number(n || 0), 0);
      kept = Math.max(0, Math.min(count, room));
      moveRanks(next.state, map, guestKey(id), home, house, kept, { losses: count - kept });
      if (kept > 0) land.warriors[house] = Number(land.warriors[house] || 0) + kept;
    }
    for (const army of Object.values(next.state.armies || {})) {
      if (army.house === house && army.territory === id && !army.moving_order_id && home) {
        army.territory = home;
        const commander = next.state.characters?.[army.commander_id];
        if (commander) commander.location = { kind: 'TERRITORY', territory: home };
      }
    }
    if (host !== house) {
      next.state.journal.push({
        kind: 'GUESTS_EXPELLED',
        house,
        host,
        houses: [house, host].filter(Boolean),
        from: id,
        to: home,
        warriors: count,
        lost: count - kept,
        at: new Date(nowMs).toISOString()
      });
    }
  }
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}
