// The Heart of the Lands: the road to the centre gets harder, and whoever
// holds the centre long enough wins.
//
// Every land gets a ring: how far it lies from the nearest capital (ring 1 is
// next to a capital). The land farthest from every capital is the Heart.
// Free lands are held by the wild guard, the "вольные люди": few next to the
// capitals, more and more towards the Heart, the most in the Heart itself,
// behind walls. A House that takes a free land for the first time in the game
// earns glory by its ring. Each dawn the House holding the Heart earns glory,
// more for every dawn it keeps it. Whoever reaches the glory target at dawn
// wins at once; otherwise the game ends after its last day as before.
//
// No dice: a guard fight is counted like any battle. The attackers' strength
// is their men by rank, their lord's gifts and the fixed share of fortune;
// the guard's strength is its head count, behind the land's walls.
import { baseDefense } from '../core/combat.mjs';
import { commanderStats } from '../core/characters.mjs';
import { headsLost, strengthOf } from './ranks.mjs';
import { rulerLeadBonus } from './court.mjs';

export const HEART = Object.freeze({
  days: 8,
  target: 30,
  heartGlory: 5,
  heartGuards: 20,
  // Glory for each dawn the Heart is held: 3, 4, 5, ...
  holdBase: 2,
  fortune: 3
});

const SEA_STEP = 0.5;

function iso(ms) {
  return new Date(ms).toISOString();
}

// Distances over roads (1 per road) and sea lanes (half a road per stretch).
function distancesFrom(map, starts) {
  const near = new Map();
  const add = (a, b, w) => {
    if (!near.has(a)) near.set(a, []);
    if (!near.has(b)) near.set(b, []);
    near.get(a).push([b, w]);
    near.get(b).push([a, w]);
  };
  for (const [a, b] of map.land_edges || []) add(a, b, 1);
  for (const [a, b] of map.sea_lane_edges || []) add(a, b, SEA_STEP);
  const dist = new Map(starts.map(id => [id, 0]));
  const queue = [...starts];
  // Few nodes: a plain relaxation is enough.
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

const TYPE_RANK = { 'Город': 0, 'Деревня': 1, 'Дикая земля': 2, 'Половина острова': 3 };

// Rings of every land and the Heart. The Heart is the land farthest from the
// nearest capital (on the mainland, most evenly placed between all capitals).
// A land's ring grows the farther it is from the capitals and the nearer it
// is to the Heart: 1 by the capitals, RINGS next to the Heart.
const RINGS = 4;
export function heartLayout(map) {
  const capitals = Object.values(map.capitals || {});
  const nearest = distancesFrom(map, capitals);
  const each = capitals.map(c => distancesFrom(map, [c]));
  const candidates = map.territories.filter(t => !capitals.includes(t.id) && t.type !== 'Половина острова');
  let heart = null;
  let best = null;
  for (const t of candidates) {
    const ds = each.map(d => d.get(t.id) ?? 99);
    const min = Math.min(...ds);
    const key = [-min, Math.max(...ds) - min, TYPE_RANK[t.type] ?? 4, t.id];
    const better = !best || key[0] < best[0] ||
      (key[0] === best[0] && (key[1] < best[1] || (key[1] === best[1] && (key[2] < best[2] || (key[2] === best[2] && key[3] < best[3])))));
    if (better) { best = key; heart = t.id; }
  }
  const toHeart = heart ? distancesFrom(map, [heart]) : new Map();
  const score = id => (nearest.get(id) ?? 1) - (toHeart.get(id) ?? 0);
  const free = map.territories.filter(t => !capitals.includes(t.id) && t.id !== heart).map(t => t.id);
  const scores = free.map(score);
  const lo = Math.min(...scores), hi = Math.max(...scores);
  const rings = {};
  for (const id of capitals) rings[id] = 0;
  for (const id of free) {
    const share = hi > lo ? (score(id) - lo) / (hi - lo) : 0;
    rings[id] = 1 + Math.min(RINGS - 1, Math.floor(share * RINGS));
  }
  if (heart) rings[heart] = RINGS + 1;
  return { rings, heart, maxRing: RINGS };
}

// The guard is counted as peasants. Next to a capital two or three peasants
// do; the Heart wants a real host, of better troops or in several waves.
export function guardsFor(ring, type, isHeart) {
  if (isHeart) return HEART.heartGuards;
  const base = [0, 2, 4, 7, 10][Math.min(4, Math.max(1, ring))];
  return base + (type === 'Город' ? 1 : 0);
}

// Left alone, the guard grows back by one each dawn up to a third more than at
// the start. The Heart's guard never grows past its first number.
export function guardCap(ring, type, isHeart) {
  const base = guardsFor(ring, type, isHeart);
  return isHeart ? base : base + Math.floor(base / 3);
}

export function ringGlory(state, territory) {
  if (territory === state.heart?.territory) return HEART.heartGlory;
  return Math.max(1, Number(state.heart?.rings?.[territory] || 1));
}

// Sets up a new game for the Heart: rings, the wild guard on every free land.
export function seedHeart(game, map) {
  const { rings, heart, maxRing } = heartLayout(map);
  game.state.heart = {
    territory: heart,
    rings,
    max_ring: maxRing,
    target: HEART.target,
    days: HEART.days,
    holder: null,
    streak: 0
  };
  game.state.wild_guards = {};
  game.state.wild_taken = {};
  for (const t of map.territories) {
    if (game.state.territories[t.id]?.owner) continue;
    game.state.wild_guards[t.id] = guardsFor(rings[t.id], t.type, t.id === heart);
  }
  // The Heart stands behind walls.
  if (heart && game.state.territories[heart]) game.state.territories[heart].fort = true;
  return game;
}

export function heartMode(state) {
  return Boolean(state?.wild_guards);
}

// What a guard fight would cost: the fewest men that win with someone left standing.
export function menToTakeWild(guards) {
  for (let n = 1; n <= 40; n += 1) {
    if (n + HEART.fortune > guards && n - Math.ceil(guards / 2) > 0) return n;
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
  const attackerStrength = strengthOf(extra.ranks, men, { stars: extra.stars }) + HEART.fortune + stats.attack + rulerLeadBonus(extra.commander);
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
      glory = Number(extra.glory || 1);
      next.houses[action.house].victory_points = Number(next.houses[action.house].victory_points || 0) + glory;
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
 * At every dawn: the wild guard grows back on lands left alone, and the Heart
 * pays its holder. Mutates `game`. Returns the houses that reached the target.
 */
export function heartDawn(game, map, constants, nowMs = Date.now()) {
  const heart = game.state.heart;
  if (!heart || !game.state.wild_guards) return [];
  const state = game.state;
  const rings = heart.rings || {};
  for (const t of map.territories) {
    if (state.territories[t.id]?.owner) continue;
    const cap = guardCap(rings[t.id] || 1, t.type, t.id === heart.territory);
    const now = Number(state.wild_guards[t.id] || 0);
    if (now < cap) state.wild_guards[t.id] = now + 1;
  }

  const holder = heart.territory ? state.territories[heart.territory]?.owner || null : null;
  if (holder && holder === heart.holder) heart.streak += 1;
  else heart.streak = holder ? 1 : 0;
  if (holder !== heart.holder && holder) {
    state.journal.push({ kind: 'HEART_TAKEN', house: holder, houses: [holder], previous: heart.holder, territory: heart.territory, at: iso(nowMs) });
  }
  heart.holder = holder;
  if (holder) {
    const glory = HEART.holdBase + heart.streak;
    state.houses[holder].victory_points = Number(state.houses[holder].victory_points || 0) + glory;
    state.journal.push({
      kind: 'HEART_HELD', house: holder, houses: [holder], territory: heart.territory,
      streak: heart.streak, glory, total: state.houses[holder].victory_points, target: heart.target, at: iso(nowMs)
    });
  }
  const abandoned = game.lifecycle?.abandoned_houses || {};
  return Object.keys(state.houses || {})
    .filter(house => !abandoned[house] && Number(state.houses[house].victory_points || 0) >= heart.target);
}
