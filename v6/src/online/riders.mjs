// A lord sent from court to lead an army rides there in person. He leaves the
// capital at once and takes command only when he reaches the army; on the way
// he can be caught (a land on his road that has gone over to an enemy at war)
// and becomes that House's prisoner.
import {
  assignCharacterToArmy,
  characterArmyAssignmentEligibility
} from '../core/characters.mjs';
import { relationOf, RELATION, hasPassage } from './diplomacy.mjs';
import { findOnlineRoute } from './route-planner.mjs';
import { ONLINE_TIMING, timeScale } from './orders.mjs';

function stamp(ms) {
  return new Date(ms).toISOString();
}

export function ridersOf(game, house) {
  return (game.riders || []).filter(rider => rider.house === house);
}

export function startRide(game, map, constants, { house, characterId, position }, { nowMs = Date.now() } = {}) {
  const check = characterArmyAssignmentEligibility(game.state, map, constants, { house, characterId });
  if (!check.allowed) throw new Error(check.reason);
  if ((game.riders || []).some(rider => rider.character_id === characterId)) throw new Error('он уже в пути');
  const armies = Object.values(game.state.armies || {}).filter(army => army.house === house).length;
  if (armies + ridersOf(game, house).length >= 2) throw new Error('У Дома уже два воеводы при ратях или в пути к ним.');
  const target = check.targets.find(item => item.id === position) || (check.targets.length === 1 ? check.targets[0] : null);
  if (!target) throw new Error('Выберите армию Дома, к которой назначить персонажа.');
  const capital = map.capitals?.[house];
  const scale = timeScale(game);
  let segments = [];
  if (capital && capital !== target.id) {
    const route = findOnlineRoute(game.state, map, constants, house, capital, target.id, ONLINE_TIMING, { free: true });
    if (!route) throw new Error('к этому войску из столицы дороги нет');
    segments = route.segments.map(segment => ({ ...segment, duration_ms: Math.round(Number(segment.duration_ms || 0) * scale) }));
  }
  const total = segments.reduce((sum, segment) => sum + segment.duration_ms, 0);
  const next = structuredClone(game);
  next.riders ||= [];
  next.riders.push({
    id: `R${nowMs.toString(36)}${next.riders.length}`,
    house,
    character_id: characterId,
    character_name: next.state.characters[characterId].name,
    from: capital,
    to: target.id,
    segments,
    passed: 0,
    created_at: stamp(nowMs),
    due_at: stamp(nowMs + total)
  });
  next.state.characters[characterId].location = { kind: 'ROAD', to: target.id };
  next.state.journal.push({ kind: 'RIDER_SENT', house, houses: [house], character_name: next.state.characters[characterId].name, to: target.id, at: stamp(nowMs) });
  next.updated_at = stamp(nowMs);
  return next;
}

// Where the rider is: [node reached last, share of the next stretch].
export function riderPlace(rider, nowMs) {
  let left = Math.max(0, nowMs - Date.parse(rider.created_at));
  for (let i = 0; i < rider.segments.length; i += 1) {
    const length = Math.max(1, rider.segments[i].duration_ms);
    if (left < length) return { index: i, local: left / length };
    left -= length;
  }
  return { index: rider.segments.length, local: 0 };
}

function capture(game, rider, captor, territory, nowMs) {
  const character = game.state.characters[rider.character_id];
  if (!character) return;
  character.mode = 'CAPTIVE';
  character.status = 'ACTIVE';
  character.location = { kind: 'CAPTURE_CONTEXT', territory };
  character.captivity = {
    held_by: captor,
    detention_location: territory,
    decision_pending: true,
    ransom_offer: null,
    ransom_amount: null,
    ransom_response: null,
    history: [{ kind: 'CAPTURED_ON_ROAD', at: stamp(nowMs), territory, captor_house: captor }]
  };
  game.state.journal.push({
    kind: 'RIDER_CAPTURED', house: rider.house, captor, houses: [rider.house, captor],
    character_name: rider.character_name, territory, at: stamp(nowMs)
  });
}

export function processRiders(game, map, constants, nowMs = Date.now()) {
  if (!game.riders?.length) return game;
  const next = structuredClone(game);
  let changed = false;
  const keep = [];
  for (const rider of next.riders) {
    const character = next.state.characters[rider.character_id];
    if (!character || !character.alive) { changed = true; continue; }
    // Every crossroads he has reached since the last look: is it still safe?
    const reached = Math.min(rider.segments.length, riderPlace(rider, nowMs).index);
    let caught = false;
    for (let i = rider.passed; i < reached; i += 1) {
      const node = rider.segments[i].to;
      const owner = next.state.territories?.[node]?.owner || null;
      if (!owner || owner === rider.house || hasPassage(next.state, owner, rider.house)) continue;
      if (relationOf(next, owner, rider.house) === RELATION.WAR) {
        capture(next, rider, owner, node, nowMs);
        caught = true;
        break;
      }
    }
    if (reached !== rider.passed) { rider.passed = reached; changed = true; }
    if (caught) { changed = true; continue; }
    if (Date.parse(rider.due_at) > nowMs) { keep.push(rider); continue; }
    changed = true;
    character.location = { kind: 'COURT' };
    try {
      next.state = assignCharacterToArmy(next.state, map, constants, { house: rider.house, characterId: rider.character_id, position: rider.to });
    } catch {
      // The army he rode to is gone or has a leader: he rides home to court.
      next.state.journal.push({ kind: 'RIDER_TURNED_BACK', house: rider.house, houses: [rider.house], character_name: rider.character_name, to: rider.to, at: stamp(nowMs) });
    }
  }
  if (!changed) return game;
  next.riders = keep;
  next.updated_at = stamp(nowMs);
  return next;
}

export function nextRiderDueAt(game) {
  return (game.riders || []).map(rider => rider.due_at).sort()[0] || null;
}
