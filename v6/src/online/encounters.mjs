// Armies of different Houses that meet on the road.
//
// A march is a timed order; while it runs the army is somewhere along its
// route. Two armies meet when they walk the same stretch towards each other,
// or reach the same crossroads at about the same moment. Allies pass; anyone
// else fights there and then, and neutral Houses are at war from that moment.
//
// As everywhere online there are no dice: warriors and commanders decide.

import {
  commanderStats,
  markCommanderFatePending,
  resolveCommanderFate,
  settleCommander
} from '../core/characters.mjs';
import { fateDice, recoveryMs, settleFate } from './fate.mjs';
import { areAllies, declareWarInPlace, hasPassage } from './diplomacy.mjs';

const BATTLE_DIE = 3;
// Two armies "meet" at a crossroads when they reach it within this share of
// the shorter stretch leading to it.
const CROSSROADS_WINDOW = 0.25;

// Where the army is and when: [{ node, at }] from the first step to the last.
export function orderTimeline(order) {
  // An army camped on the road is not walking anywhere.
  if (order.halted) return [];
  const segments = order.travel_segments?.length ? order.travel_segments : (order.action?.route_segments || []);
  const start = Date.parse(order.created_at);
  const end = Date.parse(order.due_at);
  if (!segments.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }
  const planned = segments.reduce((sum, s) => sum + Number(s.duration_ms || 0), 0);
  const factor = planned > 0 ? (end - start) / planned : 0;
  const points = [{ node: segments[0].from, at: start }];
  let at = start;
  for (const segment of segments) {
    at += Number(segment.duration_ms || 0) * factor;
    points.push({ node: segment.to, at });
  }
  return points;
}

function meeting(a, b) {
  const ta = orderTimeline(a);
  const tb = orderTimeline(b);
  let best = null;
  const consider = candidate => {
    if (!best || candidate.at < best.at) best = candidate;
  };

  for (let i = 0; i + 1 < ta.length; i += 1) {
    for (let j = 0; j + 1 < tb.length; j += 1) {
      // Head-on along one stretch of road or sea lane.
      if (ta[i].node === tb[j + 1].node && ta[i + 1].node === tb[j].node) {
        const a0 = ta[i].at, da = ta[i + 1].at - a0;
        const b0 = tb[j].at, db = tb[j + 1].at - b0;
        if (da <= 0 || db <= 0) continue;
        const at = (1 + a0 / da + b0 / db) / (1 / da + 1 / db);
        if (at >= a0 && at <= a0 + da && at >= b0 && at <= b0 + db) {
          consider({ at, from: ta[i].node, to: ta[i + 1].node, node: null });
        }
      }
    }
  }

  // The same crossroads, passed by both (never the end of either march: an
  // arrival is settled by the usual rules).
  for (let i = 1; i + 1 < ta.length; i += 1) {
    for (let j = 1; j + 1 < tb.length; j += 1) {
      if (ta[i].node !== tb[j].node) continue;
      const window = CROSSROADS_WINDOW * Math.min(
        ta[i].at - ta[i - 1].at,
        tb[j].at - tb[j - 1].at
      );
      if (Math.abs(ta[i].at - tb[j].at) <= window) {
        consider({ at: Math.max(ta[i].at, tb[j].at), from: null, to: null, node: ta[i].node });
      }
    }
  }
  return best;
}

// The earliest meeting still ahead of the pending orders, or null.
export function nextEncounter(game) {
  const pending = (game.orders || []).filter(order => order.status === 'PENDING');
  let best = null;
  for (let i = 0; i < pending.length; i += 1) {
    for (let j = i + 1; j < pending.length; j += 1) {
      const a = pending[i];
      const b = pending[j];
      if (a.action.house === b.action.house) continue;
      if (areAllies(game, a.action.house, b.action.house)) continue;
      // A guest with right of passage and his host do not fight on the road.
      if (hasPassage(game.state, a.action.house, b.action.house) ||
        hasPassage(game.state, b.action.house, a.action.house)) continue;
      const met = meeting(a, b);
      if (!met) continue;
      if (!best || met.at < best.at || (met.at === best.at && a.id < best.a.id)) {
        best = { ...met, a, b };
      }
    }
  }
  return best;
}

export function nextEncounterAt(game) {
  const found = nextEncounter(game);
  return found ? new Date(Math.ceil(found.at)).toISOString() : null;
}

function loseAtOrigin(state, action, losses) {
  if (losses <= 0) return;
  const source = state.territories?.[action.from] || state.sea_nodes?.[action.from];
  if (!source) return;
  const left = Math.max(0, Number(source.warriors?.[action.house] || 0) - losses);
  if (left > 0) source.warriors[action.house] = left;
  else delete source.warriors[action.house];

  if (state.sea_nodes?.[action.from]) {
    const houses = Object.keys(source.warriors || {})
      .filter(h => Number(source.warriors[h] || 0) > 0);
    source.owner = houses.length === 1 ? houses[0] : null;
  }
}

function side(state, order) {
  const commander = order.commander_id ? state.characters?.[order.commander_id] || null : null;
  const stats = commanderStats(commander) || {};
  const warriors = Number(order.action.warriors || 0);
  return {
    order,
    house: order.action.house,
    warriors,
    attack: Number(stats.attack || 0),
    defense: Number(stats.defense || 0),
    strength: warriors + BATTLE_DIE + Number(stats.attack || 0)
  };
}

// The beaten commander faces his Fate like after any lost battle.
function commanderFate(game, map, constants, order, opponent, strengths, destroyed, nowMs) {
  const id = order.commander_id;
  const commander = id ? game.state.characters?.[id] : null;
  if (!commander || !commander.alive) return;
  try {
    let state = markCommanderFatePending(game.state, id, {
      battle_territory: order.action.from,
      opponent_house: opponent,
      side: 'ATTACKER',
      army_destroyed: destroyed,
      fallback_territory: destroyed ? null : order.action.from,
      created_at: new Date(nowMs).toISOString()
    });
    const fate = resolveCommanderFate(state, map, constants, id, fateDice(strengths, commander), { nowMs });
    game.state = settleFate(fate.state, map, id, { nowMs, recovery: recoveryMs(game) });
  } catch {
    // The march is already settled; a commander the Fate rules cannot place stays with his army.
  }
}

function turnBack(game, order, result, nowMs) {
  order.status = 'RESOLVED';
  order.resolved_at = new Date(nowMs).toISOString();
  order.result = result;
  order.failure_reason = null;
  if (order.commander_id) {
    game.state = settleCommander(game.state, order.commander_id, order.action.from);
  }
}

function fight(game, found, nowMs, map, constants) {
  const orderA = game.orders.find(order => order.id === found.a.id);
  const orderB = game.orders.find(order => order.id === found.b.id);
  const a = side(game.state, orderA);
  const b = side(game.state, orderB);

  const warDeclared = declareWarInPlace(game, a.house, b.house, { nowMs, cause: 'ENCOUNTER' });

  const lossesA = Math.min(a.warriors, Math.max(0, Math.ceil(b.strength / 2) - a.defense));
  const lossesB = Math.min(b.warriors, Math.max(0, Math.ceil(a.strength / 2) - b.defense));
  const leftA = a.warriors - lossesA;
  const leftB = b.warriors - lossesB;
  let winner = null;
  if (a.strength > b.strength && leftA > 0) winner = a.house;
  if (b.strength > a.strength && leftB > 0) winner = b.house;

  loseAtOrigin(game.state, orderA.action, lossesA);
  loseAtOrigin(game.state, orderB.action, lossesB);

  const entry = {
    kind: 'FIELD_BATTLE',
    houses: [a.house, b.house],
    winner,
    war_declared: warDeclared,
    place_from: found.from,
    place_to: found.to,
    place_node: found.node,
    sides: [
      { house: a.house, order_id: orderA.id, warriors: a.warriors, strength: a.strength, losses: lossesA, survivors: leftA, from: orderA.action.from, to: orderA.action.to },
      { house: b.house, order_id: orderB.id, warriors: b.warriors, strength: b.strength, losses: lossesB, survivors: leftB, from: orderB.action.from, to: orderB.action.to }
    ],
    at: new Date(nowMs).toISOString()
  };

  for (const [me, order, left] of [[a, orderA, leftA], [b, orderB, leftB]]) {
    if (winner === me.house) {
      // The victor marches on with whoever is left standing.
      order.action.warriors = left;
    } else {
      turnBack(game, order, {
        kind: 'FIELD_BATTLE_DEFEAT',
        opponent: me === a ? b.house : a.house,
        losses: me.warriors - left,
        survivors: left,
        returned_to: order.action.from
      }, nowMs);
      commanderFate(
        game, map, constants, order, me === a ? b.house : a.house,
        { attackerStrength: a.strength, defenderStrength: b.strength },
        left === 0 && Number(
          (game.state.territories?.[order.action.from] || game.state.sea_nodes?.[order.action.from])
            ?.warriors?.[me.house] || 0
        ) === 0,
        nowMs
      );
    }
  }

  game.state.journal.push(entry);
  game.updated_at = new Date(nowMs).toISOString();
}

// Settles every meeting that has already happened by `nowMs`, oldest first.
export function processEncounters(game, map, constants, nowMs = Date.now()) {
  if (game.lifecycle?.status && game.lifecycle.status !== 'RUNNING') return game;
  let next = null;
  for (let guard = 0; guard < 200; guard += 1) {
    const found = nextEncounter(next || game);
    if (!found || found.at > nowMs) break;
    next ||= structuredClone(game);
    fight(next, found, nowMs, map, constants);
  }
  return next || game;
}
