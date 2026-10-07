// What becomes of a commander who lost a battle, online.
//
// There are no dice: how heavy the defeat was decides. A narrow defeat leaves
// the commander weakened; a heavy one puts him in the victor's hands; only a
// rout kills. A weakened commander gives no bonuses and fares worse if beaten
// again before he has recovered.
//
// A captive waits for the captor's word: ransom, release, the dungeon of the
// nearest fort (if the captor has one), or the block.

import { buildAdjacency } from '../core/map.mjs';
import { CHARACTER_HEALTH, CHARACTER_MODE, CHARACTER_STATUS } from '../core/characters.mjs';

const WEAKENED_PENALTY = 2;
export const AI_RANSOM = 3;
export const MAX_RANSOM = 20;

// Recovery takes half a game day.
export function recoveryMs(game) {
  const day = game?.rounds?.mode === 'days' ? Number(game.rounds.round_duration_ms) : 0;
  return day > 0 ? Math.round(day / 2) : 120_000;
}

// The two "dice" the core Fate check is fed. An even fight counts as a 10 and
// every point of strength the loser was short takes one off; the core adds
// Survival and takes one more if the army was wiped out. 10+ saved, 7+
// weakened, 5+ captured, below that dead.
export function fateDice(result, commander) {
  const margin = Math.abs(
    Number(result.attackerStrength || 0) - Number(result.defenderStrength || 0)
  );
  const weak = commander?.health === CHARACTER_HEALTH.WEAKENED ? WEAKENED_PENALTY : 0;
  const total = Math.max(2, Math.min(12, 10 - margin - weak));
  const first = Math.max(1, Math.min(6, Math.floor(total / 2)));
  return [first, total - first];
}

function capitalOf(map, house) {
  return map.capitals?.[house] || null;
}

function toCourt(state, map, character) {
  if (character.army_id && state.armies?.[character.army_id]) delete state.armies[character.army_id];
  character.army_id = null;
  character.mode = CHARACTER_MODE.COURT;
  character.status = CHARACTER_STATUS.ACTIVE;
  character.fate_pending = null;
  character.location = { kind: 'COURT', territory: capitalOf(map, character.house) };
}

function weaken(character, nowMs, recovery) {
  character.health = CHARACTER_HEALTH.WEAKENED;
  character.weakened_until = new Date(nowMs + recovery).toISOString();
}

// Called right after the core Fate check. Whoever is neither dead nor taken is
// weakened; a commander whose army is gone returns to his court.
export function settleFate(state, map, characterId, { nowMs = Date.now(), recovery = 120_000 } = {}) {
  const next = structuredClone(state);
  const character = next.characters?.[characterId];
  if (!character || !character.alive || character.mode === CHARACTER_MODE.CAPTIVE) return next;
  weaken(character, nowMs, recovery);
  if (character.status === CHARACTER_STATUS.FATE_LOCATION_PENDING) toCourt(next, map, character);
  return next;
}

function fortsOf(state, house) {
  return Object.entries(state.territories || {})
    .filter(([, territory]) => territory.owner === house && territory.fort)
    .map(([id]) => id);
}

// The captor's fort nearest to where the prisoner was taken.
export function nearestFort(state, map, house, from) {
  const forts = new Set(fortsOf(state, house));
  if (!forts.size) return null;
  if (from && state.territories?.[from]) {
    const adjacency = buildAdjacency(map.land_edges);
    const seen = new Set([from]);
    let wave = [from];
    while (wave.length) {
      const hit = wave.filter(id => forts.has(id)).sort()[0];
      if (hit) return hit;
      const nextWave = [];
      for (const id of wave) {
        for (const other of adjacency.get(id) || []) {
          if (seen.has(other)) continue;
          seen.add(other);
          nextWave.push(other);
        }
      }
      wave = nextWave;
    }
  }
  return [...forts].sort()[0];
}

function note(game, kind, character, captor, nowMs, extra = {}) {
  game.state.journal.push({
    kind,
    character_id: character.id,
    character_name: character.name,
    house: character.house,
    captor,
    houses: [character.house, captor].filter(Boolean),
    at: new Date(nowMs).toISOString(),
    ...extra
  });
  game.updated_at = new Date(nowMs).toISOString();
}

function free(game, map, character, nowMs) {
  character.captivity = null;
  toCourt(game.state, map, character);
  weaken(character, nowMs, recoveryMs(game));
}

function applyCaptorChoice(game, map, character, action, amount, nowMs) {
  const captivity = character.captivity;
  const captor = captivity.held_by;
  if (action === 'RELEASE') {
    free(game, map, character, nowMs);
    return note(game, 'CAPTIVE_RELEASED', character, captor, nowMs);
  }
  if (action === 'EXECUTE') {
    character.alive = false;
    character.mode = CHARACTER_MODE.DEAD;
    character.status = CHARACTER_STATUS.ACTIVE;
    character.location = { kind: 'DEAD', territory: captivity.detention_location || null };
    character.captivity = null;
    return note(game, 'CAPTIVE_EXECUTED', character, captor, nowMs);
  }
  if (action === 'RANSOM') {
    const price = Number(amount);
    if (!Number.isInteger(price) || price < 1 || price > MAX_RANSOM) {
      throw new Error(`выкуп назначается от 1 до ${MAX_RANSOM} золота`);
    }
    captivity.ransom_amount = price;
    captivity.ransom_response = null;
    captivity.decision_pending = false;
    return note(game, 'RANSOM_DEMANDED', character, captor, nowMs, { amount: price });
  }
  if (action === 'IMPRISON') {
    const fort = nearestFort(game.state, map, captor, captivity.detention_location);
    if (!fort) throw new Error('чтобы держать пленника, нужна крепость');
    captivity.prison = fort;
    captivity.detention_location = fort;
    captivity.ransom_amount = null;
    captivity.decision_pending = false;
    character.location = { kind: 'PRISON', territory: fort };
    return note(game, 'CAPTIVE_IMPRISONED', character, captor, nowMs, { territory: fort });
  }
  throw new Error(`unknown captive action ${action}`);
}

function applyOwnerChoice(game, map, character, action, nowMs) {
  const captivity = character.captivity;
  const captor = captivity.held_by;
  const price = Number(captivity.ransom_amount || 0);
  if (!price) throw new Error('выкуп за этого пленника не назначен');
  if (action === 'PAY_RANSOM') {
    const purse = game.state.houses[character.house];
    if (Number(purse.gold || 0) < price) throw new Error('в казне не хватает золота на выкуп');
    purse.gold -= price;
    game.state.houses[captor].gold += price;
    free(game, map, character, nowMs);
    return note(game, 'RANSOM_PAID', character, captor, nowMs, { amount: price });
  }
  if (action === 'REFUSE_RANSOM') {
    captivity.ransom_amount = null;
    captivity.ransom_response = 'REFUSED';
    captivity.decision_pending = true;
    return note(game, 'RANSOM_REFUSED', character, captor, nowMs, { amount: price });
  }
  throw new Error(`unknown captive action ${action}`);
}

// A player's word on a captive: the captor's (RANSOM, RELEASE, IMPRISON,
// EXECUTE) or the owner's answer to a ransom (PAY_RANSOM, REFUSE_RANSOM).
export function captiveAction(game, map, constants, { house, characterId, action, amount }, { nowMs = Date.now() } = {}) {
  const next = structuredClone(game);
  const character = next.state.characters?.[characterId];
  if (!character || character.mode !== CHARACTER_MODE.CAPTIVE || !character.captivity) {
    throw new Error('такого пленника нет');
  }
  const verb = String(action || '').toUpperCase();
  if (verb === 'PAY_RANSOM' || verb === 'REFUSE_RANSOM') {
    if (character.house !== house) throw new Error('это не твой человек');
    applyOwnerChoice(next, map, character, verb, nowMs);
  } else {
    if (character.captivity.held_by !== house) throw new Error('этот пленник не в твоих руках');
    applyCaptorChoice(next, map, character, verb, amount, nowMs);
  }
  return next;
}

// Housekeeping on every tick: recoveries, stuck Fate records from older
// builds, prisoners whose dungeon changed hands, and the choices of Houses
// nobody plays.
export function processCharacters(game, map, constants, { nowMs = Date.now() } = {}) {
  if (game.lifecycle?.status && game.lifecycle.status !== 'RUNNING') return game;
  const characters = Object.values(game.state?.characters || {});
  if (!characters.length) return game;

  const aiHouses = new Set(game.rounds?.ai_houses || []);
  const abandoned = house => Boolean(game.lifecycle?.abandoned_houses?.[house]);
  const unplayed = house => aiHouses.has(house) || abandoned(house);
  const needs = character => {
    if (!character.alive) return false;
    if (character.status === CHARACTER_STATUS.FATE_LOCATION_PENDING) return true;
    if (character.health === CHARACTER_HEALTH.WEAKENED &&
      (!character.weakened_until || Date.parse(character.weakened_until) <= nowMs)) return true;
    const captivity = character.mode === CHARACTER_MODE.CAPTIVE ? character.captivity : null;
    if (!captivity) return false;
    if (captivity.prison && game.state.territories?.[captivity.prison]?.owner !== captivity.held_by) return true;
    if (captivity.decision_pending && unplayed(captivity.held_by)) return true;
    if (captivity.ransom_amount && unplayed(character.house)) return true;
    return false;
  };
  if (!characters.some(needs)) return game;

  const next = structuredClone(game);
  for (const character of Object.values(next.state.characters)) {
    if (!needs(character)) continue;

    if (character.status === CHARACTER_STATUS.FATE_LOCATION_PENDING) {
      toCourt(next.state, map, character);
      weaken(character, nowMs, recoveryMs(next));
      next.updated_at = new Date(nowMs).toISOString();
      continue;
    }
    if (character.health === CHARACTER_HEALTH.WEAKENED && character.mode !== CHARACTER_MODE.CAPTIVE) {
      if (!character.weakened_until) {
        weaken(character, nowMs, recoveryMs(next));
        next.updated_at = new Date(nowMs).toISOString();
      } else if (Date.parse(character.weakened_until) <= nowMs) {
        character.health = CHARACTER_HEALTH.HEALTHY;
        character.weakened_until = null;
        note(next, 'COMMANDER_RECOVERED', character, null, nowMs);
      }
      continue;
    }

    const captivity = character.captivity;
    if (!captivity) continue;
    const captor = captivity.held_by;
    if (captivity.prison && next.state.territories?.[captivity.prison]?.owner !== captor) {
      const master = next.state.territories?.[captivity.prison]?.owner || null;
      if (!master || master === character.house) {
        // The dungeon fell to his own House (or to no one): he walks free.
        free(next, map, character, nowMs);
        note(next, 'PRISONER_FREED', character, captor, nowMs, { territory: captivity.prison });
      } else {
        // The dungeon has a new master, and so has the prisoner.
        captivity.held_by = master;
        captivity.decision_pending = true;
        captivity.ransom_amount = null;
        captivity.ransom_response = null;
        note(next, 'PRISONER_TAKEN_OVER', character, master, nowMs, { territory: captivity.prison, from: captor });
      }
      continue;
    }
    if (captivity.ransom_amount && unplayed(character.house)) {
      const canPay = !abandoned(character.house) &&
        Number(next.state.houses[character.house].gold || 0) >= captivity.ransom_amount;
      applyOwnerChoice(next, map, character, canPay ? 'PAY_RANSOM' : 'REFUSE_RANSOM', nowMs);
      continue;
    }
    if (captivity.decision_pending && unplayed(captor)) {
      if (abandoned(captor)) applyCaptorChoice(next, map, character, 'RELEASE', null, nowMs);
      else if (!captivity.ransom_response) applyCaptorChoice(next, map, character, 'RANSOM', AI_RANSOM, nowMs);
      else if (fortsOf(next.state, captor).length) applyCaptorChoice(next, map, character, 'IMPRISON', null, nowMs);
      else applyCaptorChoice(next, map, character, 'RELEASE', null, nowMs);
    }
  }
  return next;
}

export function nextCharacterDueAt(game) {
  const times = Object.values(game.state?.characters || {})
    .filter(character => character.alive && character.health === CHARACTER_HEALTH.WEAKENED && character.weakened_until)
    .map(character => character.weakened_until)
    .sort();
  return times[0] || null;
}

// The prisoners a House holds, and whether it has a dungeon for them.
export function captivesView(game, map, house) {
  const held = Object.values(game.state?.characters || {})
    .filter(character => character.mode === CHARACTER_MODE.CAPTIVE && character.captivity?.held_by === house)
    .map(character => ({
      id: character.id,
      name: character.name,
      house: character.house,
      role: character.role,
      captivity: structuredClone(character.captivity),
      prison_available: nearestFort(game.state, map, house, character.captivity.detention_location)
    }));
  return { held, max_ransom: MAX_RANSOM };
}
