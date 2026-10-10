// The free lands and the men who hold them.
//
// Every land gets a ring by how far it lies from the nearest capital (ring 1
// is next to a capital, RINGS at the farthest). Lands nobody owns are held by
// the wild guard, the "вольные люди": few next to the capitals, more and more
// farther out, and left alone they grow back. A House that takes a free land
// for the first time in the game earns glory by its ring — the deeper it goes,
// the more the chroniclers make of it.
//
// The age lasts a set number of days. Whoever reaches the glory target at a
// dawn wins there and then; otherwise the age runs out and the greatest glory
// takes it.
//
// No dice: a guard fight is counted like any other battle.
import { baseDefense } from '../core/combat.mjs';
import { commanderStats } from '../core/characters.mjs';
import { headsLost, strengthOf } from './ranks.mjs';
import { rulerLeadBonus } from './court.mjs';
import { INFLUENCE, addInfluence } from './influence.mjs';

export const WILD = Object.freeze({
  // How long an age lasts and what glory wins it.
  days: 8,
  target: 30,
  // What courage and chance are worth to an attacker, counted, not rolled.
  fortune: 3
});

const RINGS = 4;
const SEA_STEP = 0.5;

function iso(ms) {
  return new Date(ms).toISOString();
}

function neighbours(map, { sea = true } = {}) {
  const near = new Map();
  const add = (a, b, w) => {
    if (!near.has(a)) near.set(a, []);
    if (!near.has(b)) near.set(b, []);
    near.get(a).push([b, w]);
    near.get(b).push([a, w]);
  };
  for (const [a, b] of map.land_edges || []) add(a, b, 1);
  if (sea) for (const [a, b] of map.sea_lane_edges || []) add(a, b, SEA_STEP);
  return near;
}

// Distances over roads (1 per road) and sea lanes (half a road per stretch).
function distancesFrom(map, starts, options) {
  const near = neighbours(map, options);
  const dist = new Map(starts.map(id => [id, 0]));
  const queue = [...starts];
  while (queue.length) {
    queue.sort((x, y) => dist.get(x) - dist.get(y));
    const at = queue.shift();
    for (const [to, w] of near.get(at) || []) {
      const d = dist.get(at) + w;
      if (d < (dist.get(to) ?? Infinity)) { dist.set(to, d); queue.push(to); }
    }
  }
  return dist;
}

// Rings: 1 by the capitals, RINGS at the farthest lands.
export function ringLayout(map) {
  const capitals = Object.values(map.capitals || {});
  const nearest = distancesFrom(map, capitals);
  const free = map.territories.filter(t => !capitals.includes(t.id)).map(t => t.id);
  const ds = free.map(id => nearest.get(id) ?? 1);
  const lo = Math.min(...ds), hi = Math.max(...ds);
  const rings = {};
  for (const id of capitals) rings[id] = 0;
  for (const id of free) {
    const share = hi > lo ? ((nearest.get(id) ?? 1) - lo) / (hi - lo) : 0;
    rings[id] = 1 + Math.min(RINGS - 1, Math.floor(share * RINGS));
  }
  return { rings, maxRing: RINGS };
}

// The guard is counted as peasants. Next to a capital two or three peasants do;
// deep in the free lands it is a host.
export function guardsFor(ring, type) {
  const base = [0, 2, 4, 7, 10][Math.min(4, Math.max(1, ring))];
  return base + (type === 'Город' ? 1 : 0);
}

// Left alone, the guard grows back by one each dawn up to half again its start.
export function guardCap(ring, type) {
  const base = guardsFor(ring, type);
  return base + Math.floor(base / 2);
}

// What taking this free land is worth to the chroniclers.
export function ringGlory(state, territory) {
  return Math.max(1, Number(state.wild?.rings?.[territory] || 1));
}

// Whether this game is played by these rules at all.
export function wildMode(state) {
  return Boolean(state?.wild_guards);
}

// Sets up a new game: rings, and the wild guard on every free land.
export function seedWild(game, map) {
  const { rings, maxRing } = ringLayout(map);
  game.state.wild = {
    rings,
    max_ring: maxRing,
    target: WILD.target,
    days: WILD.days
  };
  game.state.wild_guards = {};
  game.state.wild_taken = {};
  for (const t of map.territories) {
    if (game.state.territories[t.id]?.owner) continue;
    game.state.wild_guards[t.id] = guardsFor(rings[t.id], t.type);
  }
  return game;
}

// What a guard fight would cost: the fewest men that win with someone left standing.
export function menToTakeWild(guards) {
  for (let n = 1; n <= 40; n += 1) {
    if (n + WILD.fortune > guards && n - Math.ceil(guards / 2) > 0) return n;
  }
  return 41;
}

/**
 * An army marches on a free land held by the wild guard. Works on the
 * resolution state the order resolver prepared (origin always a land).
 * `extra` = { ranks, commander, glory, nowMs }.
 */
export function wildBattle(state, map, constants, action, extra = {}) {
  const next = structuredClone(state);
  const to = action.to;
  const guards = Number(next.wild_guards?.[to] || 0);
  const origin = next.territories[action.from];
  const target = next.territories[to];
  const men = Number(action.warriors);
  origin.warriors[action.house] = Number(origin.warriors[action.house] || 0) - men;
  if (origin.warriors[action.house] <= 0) delete origin.warriors[action.house];

  const stats = commanderStats(extra.commander);
  const attackerStrength = strengthOf(extra.ranks, men, { stars: extra.stars }) + WILD.fortune + stats.attack + rulerLeadBonus(extra.commander);
  const guardStrength = guards;
  const walls = guards > 0 ? baseDefense(map, next, constants, to) : 0;
  const toGuards = Math.max(0, Math.ceil(attackerStrength / 2) - walls);
  const toAttackers = Math.max(0, Math.ceil(guardStrength / 2) - stats.defense);
  const attackerLosses = Math.min(men, headsLost(extra.ranks, men, toAttackers));
  const guardLosses = Math.min(guards, toGuards);
  const survivors = men - attackerLosses;
  const success = survivors > 0 && attackerStrength > guardStrength;

  let glory = 0;
  if (success) {
    target.owner = action.house;
    target.warriors[action.house] = survivors;
    delete next.wild_guards[to];
    next.wild_taken ||= {};
    if (!next.wild_taken[to]) {
      next.wild_taken[to] = action.house;
      glory = addInfluence(next, action.house, INFLUENCE.wildLand, 'WILD_LAND', { territory: to, nowMs: extra.nowMs });
    }
  } else {
    next.wild_guards[to] = guards - guardLosses;
    if (survivors > 0) origin.warriors[action.house] = Number(origin.warriors[action.house] || 0) + survivors;
  }

  const result = {
    kind: 'WILD_BATTLE',
    success,
    guards,
    guard_losses: guardLosses,
    guards_left: success ? 0 : guards - guardLosses,
    attacker_strength: attackerStrength,
    guard_strength: guardStrength,
    walls,
    losses: attackerLosses,
    survivors,
    glory
  };
  next.journal.push({
    ...result,
    house: action.house,
    houses: [action.house],
    from: action.from,
    to,
    warriors: men,
    at: extra.nowMs ? iso(extra.nowMs) : undefined
  });
  return { state: next, result };
}

/**
 * At every dawn: the wild guard grows back on the lands left alone, and the
 * last day of the age is proclaimed. Mutates `game`. Returns the Houses that
 * have reached the glory target.
 */
export function wildDawn(game, map, constants, nowMs = Date.now(), day = null) {
  const state = game.state;
  if (!state.wild_guards) return [];
  const rings = state.wild?.rings || {};
  for (const t of map.territories) {
    if (state.territories[t.id]?.owner) continue;
    const cap = guardCap(rings[t.id] || 1, t.type);
    const now = Number(state.wild_guards[t.id] || 0);
    if (now < cap) state.wild_guards[t.id] = now + 1;
  }

  // The last day of the age: everything is decided on it, and everyone is told.
  const last = day !== null && Number(day) >= Number(state.wild?.days || WILD.days);
  if (last && !state.journal.some(e => e.kind === 'LAST_DAY')) {
    state.journal.push({ kind: 'LAST_DAY', houses: Object.keys(state.houses || {}), day: Number(day), at: iso(nowMs) });
  }

  // Nobody wins before the age is out: the most влияние on the last day takes it.
  return [];
}
