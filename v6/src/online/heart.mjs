// The Heart of the Lands: the road to the centre gets harder, and whoever
// holds the Heart long enough wins.
//
// Every land gets a ring by how far it lies from the nearest capital (ring 1
// is next to a capital). Free lands are held by the wild guard, the "вольные
// люди": few next to the capitals, more and more farther out; left alone they
// grow back. A House that takes a free land for the first time in the game
// earns glory by its ring.
//
// Nobody knows at the start where the Heart is. On the dawn of day
// `appearDay` several Hearts appear among the lands still free, placed by how
// the Houses stand: far from those who have spread the most, nearer to those
// who stayed home (who still have the wild guard to fight through). Only one
// is true; the others are decoys. A spy who reaches a Heart or a land next to
// it learns which it is; from the next dawn the chroniclers expose one decoy a
// day. Whoever takes a decoy wakes the Horde, which marches on his capital
// through his lands, leaving part of itself in every land it takes. Whoever
// takes the true Heart reveals it to all, and each dawn he holds it earns him
// glory, more each dawn. Reaching the glory target at dawn wins at once.
//
// No dice: guard fights and Horde fights are counted like any battle.
import crypto from 'node:crypto';
import { baseDefense, legalDefenderRetreats } from '../core/combat.mjs';
import { commanderStats } from '../core/characters.mjs';
import { compAt, headsLost, moveRanks, reconcileRanks, starsAt, strengthOf } from './ranks.mjs';
import { rulerLeadBonus } from './court.mjs';
import { leadArmiesAway } from './guests.mjs';

export const HEART = Object.freeze({
  days: 8,
  target: 30,
  heartGlory: 5,
  heartGuards: 20,
  // Glory for each dawn the Heart is held: 3, 4, 5, ...
  holdBase: 2,
  fortune: 3,
  appearDay: 3,
  maxDecoys: 3,
  hordeMen: 24,
  // If nobody takes the true Heart, the chroniclers warn on day appear+2 and
  // on the next dawn the Horde breaks out of every decoy at once.
  countdownDays: 2,
  // The Horde takes a step every eighth of a game day.
  hordeStepShare: 1 / 8
});

// The scourge of the century. On one dawn it comes for every House at once:
// from the sea where the world is islands, from the wild lands where it is
// not. Each House gets its own host, measured against its own strength, and
// the first to break the one sent for it is seen by all to be the strongest.
export const SCOURGE = Object.freeze({
  day: 4,
  share: 0.6,       // of the House's own men
  floor: 5,
  cap: 24
});

const SEA_STEP = 0.5;
const RINGS = 4;

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
export function heartLayout(map) {
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

// The guard is counted as peasants. Next to a capital two or three peasants
// do; a Heart wants a real host, of better troops or in several waves.
export function guardsFor(ring, type, isHeart) {
  if (isHeart) return HEART.heartGuards;
  const base = [0, 2, 4, 7, 10][Math.min(4, Math.max(1, ring))];
  return base + (type === 'Город' ? 1 : 0);
}

// Left alone, the guard grows back by one each dawn up to half again its start.
export function guardCap(ring, type, isHeart) {
  const base = guardsFor(ring, type, isHeart);
  return isHeart ? base : base + Math.floor(base / 2);
}

export function isCandidate(state, territory) {
  return Boolean(state.heart?.candidates?.includes(territory));
}

export function ringGlory(state, territory) {
  if (isCandidate(state, territory)) return territory === state.heart.truth ? HEART.heartGlory : 1;
  return Math.max(1, Number(state.heart?.rings?.[territory] || 1));
}

// Sets up a new game for the Heart: rings and the wild guard on every free land.
export function seedHeart(game, map) {
  const { rings, maxRing } = heartLayout(map);
  game.state.heart = {
    appear_day: HEART.appearDay,
    candidates: [],
    truth: null,
    territory: null,
    revealed: [],
    known: {},
    woken: [],
    rings,
    max_ring: maxRing,
    target: HEART.target,
    days: HEART.days,
    holder: null,
    streak: 0
  };
  game.state.hordes = [];
  game.state.wild_guards = {};
  game.state.wild_taken = {};
  for (const t of map.territories) {
    if (game.state.territories[t.id]?.owner) continue;
    game.state.wild_guards[t.id] = guardsFor(rings[t.id], t.type, false);
  }
  return game;
}

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Where the Hearts appear: among the free mainland lands, far from the Houses
// that have spread the most and nearer to those that have not.
export function chooseHearts(game, map) {
  const state = game.state;
  const abandoned = game.lifecycle?.abandoned_houses || {};
  const lands = {};
  for (const [id, t] of Object.entries(state.territories)) if (t.owner) (lands[t.owner] ||= []).push(id);
  const houses = Object.keys(lands).filter(h => !abandoned[h]);
  if (!houses.length) return [];
  const avg = houses.reduce((s, h) => s + lands[h].length, 0) / houses.length;
  const dist = Object.fromEntries(houses.map(h => [h, distancesFrom(map, lands[h])]));
  // Never in a House's home lands: the Hearts rise in the no-man's land between them.
  const homeSectors = new Set(Object.keys(map.capitals || {}));
  const open = map.territories.filter(t => !state.territories[t.id]?.owner && t.type !== 'Половина острова' && t.type !== 'Столица');
  const scored = open.map(t => {
    const ds = houses.map(h => dist[h].get(t.id) ?? 30);
    const min = Math.min(...ds);
    const spread = Math.max(...ds) - min;
    // Far from everyone and about as far from each; a little farther from those who spread most.
    const lean = houses.reduce((sum, h, i) => sum + ((lands[h].length - avg) / Math.max(1, avg)) * ds[i], 0);
    return { id: t.id, min, middle: !homeSectors.has(t.house_sector), score: 2 * min - 1.5 * spread + lean };
  });
  // The no-man's land first, then lands two roads or more from every House; next to someone only if need be.
  const pool = scored.sort((a, b) => b.middle - a.middle || (b.min >= 2) - (a.min >= 2) || b.score - a.score || (a.id < b.id ? -1 : 1));
  const count = Math.min(HEART.maxDecoys, Math.max(1, houses.length - 1)) + 1;
  const roads = neighbours(map, { sea: false });
  const picked = [];
  for (const x of pool) {
    if (picked.length >= count) break;
    // Hearts do not stand side by side.
    if (picked.some(p => (roads.get(p) || []).some(([to]) => to === x.id))) continue;
    picked.push(x.id);
  }
  // Too few lands left to keep them apart: fill up with the best that remain.
  for (const x of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(x.id)) picked.push(x.id);
  }
  return picked;
}

function appear(game, map, nowMs) {
  const state = game.state;
  const heart = state.heart;
  const candidates = chooseHearts(game, map);
  if (!candidates.length) return;
  heart.candidates = candidates;
  // Which one is true is drawn from a secret the clients never see.
  heart.salt ||= crypto.randomBytes(12).toString('hex');
  heart.truth = candidates[hash(`${heart.salt}:${candidates.join(',')}`) % candidates.length];
  for (const id of candidates) {
    state.wild_guards[id] = Math.max(Number(state.wild_guards[id] || 0), HEART.heartGuards);
    state.territories[id].fort = true;
    heart.rings[id] = RINGS + 1;
  }
  state.journal.push({ kind: 'HEARTS_APPEARED', candidates: [...candidates], count: candidates.length, at: iso(nowMs) });
}

// A spy at a land or next to it learns which Hearts nearby are true.
export function spyLearns(state, map, house, target, nowMs = Date.now()) {
  const heart = state.heart;
  if (!heart?.candidates?.length) return [];
  const around = new Set([target, ...(neighbours(map, { sea: false }).get(target) || []).map(([to]) => to)]);
  const learnt = [];
  for (const id of heart.candidates) {
    if (!around.has(id)) continue;
    heart.known[house] ||= {};
    if (heart.known[house][id]) continue;
    heart.known[house][id] = id === heart.truth ? 'TRUE' : 'FALSE';
    learnt.push(id);
    state.journal.push({ kind: 'HEART_SPIED', house, houses: [house], territory: id, truth: id === heart.truth, at: iso(nowMs) });
  }
  return learnt;
}

// A Heart was taken: the true one shows itself, a decoy wakes the Horde.
export function heartOnCapture(game, map, territory, house, nowMs = Date.now()) {
  const state = game.state;
  const heart = state.heart;
  if (!heart || !isCandidate(state, territory) || !house) return;
  if (territory === heart.truth) {
    if (!heart.territory) {
      heart.territory = territory;
      heart.revealed = heart.candidates.filter(id => id !== heart.truth);
      state.journal.push({ kind: 'HEART_FOUND', house, houses: [house], territory, at: iso(nowMs) });
    }
    return;
  }
  if (!heart.revealed.includes(territory)) heart.revealed.push(territory);
  if (heart.woken.includes(territory)) return;
  heart.woken.push(territory);
  // A false Heart is no prize: the treasury is spent on nothing and the land
  // it stands on trusts its new master least of all.
  const purse = Number(state.houses[house]?.gold || 0);
  const burnt = Math.ceil(purse / 2);
  state.houses[house].gold = purse - burnt;
  if (state.order) state.order[territory] = Math.min(Number(state.order[territory] ?? 60), 15);
  state.journal.push({
    kind: 'FALSE_HEART', house, houses: [house], territory, gold: burnt,
    at: iso(nowMs)
  });
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
 * At every dawn: the wild guard grows back on lands left alone, the Hearts
 * appear on their day, the chroniclers expose a decoy, and the true Heart pays
 * its holder. Mutates `game`. Returns the houses that reached the target.
 */
export function heartDawn(game, map, constants, nowMs = Date.now(), day = null) {
  const heart = game.state.heart;
  if (!heart || !game.state.wild_guards) return [];
  const state = game.state;
  const rings = heart.rings || {};
  for (const t of map.territories) {
    if (state.territories[t.id]?.owner) continue;
    const cap = guardCap(rings[t.id] || 1, t.type, isCandidate(state, t.id));
    const now = Number(state.wild_guards[t.id] || 0);
    if (now < cap) state.wild_guards[t.id] = now + 1;
  }

  if (day !== null && !heart.candidates.length && day >= heart.appear_day) appear(game, map, nowMs);
  else if (heart.candidates.length && !heart.territory) {
    // A rumour: one more decoy is known to all.
    const hidden = heart.candidates.filter(id => id !== heart.truth && !heart.revealed.includes(id)).sort();
    if (hidden.length) {
      heart.revealed.push(hidden[0]);
      state.journal.push({ kind: 'HEART_RUMOUR', territory: hidden[0], left: heart.candidates.length - heart.revealed.length, at: iso(nowMs) });
    }
  }

  // The scourge of the century: it comes for every House on the same dawn.
  if (day !== null) {
    if (day === SCOURGE.day - 1 && !heart.scourge) {
      state.journal.push({ kind: 'SCOURGE_COMING', day: SCOURGE.day, sea: seaborne(map), at: iso(nowMs) });
    }
    if (day >= SCOURGE.day && !heart.scourge) scourge(game, map, nowMs);
  }

  const holder = heart.truth ? state.territories[heart.truth]?.owner || null : null;
  if (holder && holder === heart.holder) heart.streak += 1;
  else heart.streak = holder ? 1 : 0;
  if (holder !== heart.holder && holder) {
    state.journal.push({ kind: 'HEART_TAKEN', house: holder, houses: [holder], previous: heart.holder, territory: heart.truth, at: iso(nowMs) });
  }
  heart.holder = holder;
  if (holder) {
    const glory = HEART.holdBase + heart.streak;
    state.houses[holder].victory_points = Number(state.houses[holder].victory_points || 0) + glory;
    state.journal.push({
      kind: 'HEART_HELD', house: holder, houses: [holder], territory: heart.truth,
      streak: heart.streak, glory, total: state.houses[holder].victory_points, target: heart.target, at: iso(nowMs)
    });
  }
  const abandoned = game.lifecycle?.abandoned_houses || {};
  return Object.keys(state.houses || {})
    .filter(house => !abandoned[house] && Number(state.houses[house].victory_points || 0) >= heart.target);
}

// ---------- the scourge of the century ----------

// A world of islands is one where the Houses are cut off from one another:
// then the scourge comes by sea, and it is raiders. Otherwise it walks in
// from the wild lands.
function seaborne(map) {
  return ['archipelago', 'atoll', 'shattered', 'lake-isle'].includes(map.shape || '');
}

// Where the host sent for this House comes from: an unowned land on the far
// edge of its realm — the shore when the world is islands, the wilds when not.
function scourgeEntry(state, map, house) {
  const capital = map.capitals?.[house];
  const own = Object.keys(state.territories).filter(id => state.territories[id].owner === house);
  if (!capital && !own.length) return null;
  const near = neighbours(map, { sea: false });
  const from = new Set(own.length ? own : [capital]);
  const edge = new Set();
  for (const id of from) for (const [next] of near.get(id) || []) if (!state.territories[next]?.owner) edge.add(next);
  const free = [...edge];
  if (!free.length) {
    // Nothing free next door: it lands in the realm's own quietest corner.
    return own.sort((a, b) => Number(state.territories[a].warriors?.[house] || 0) - Number(state.territories[b].warriors?.[house] || 0))[0] || capital;
  }
  const coastal = id => (map.sea_lane_edges || []).some(([a, b]) => a === id || b === id)
    || (map.ports || []).includes?.(id);
  const want = seaborne(map) ? free.filter(coastal) : free;
  const pick = (want.length ? want : free).sort((a, b) =>
    Number(state.wild_guards?.[b] || 0) - Number(state.wild_guards?.[a] || 0) || (a < b ? -1 : 1))[0];
  return pick || capital;
}

// How strong the host sent for a House is: measured against its own, so the
// weak are not crushed and the strong are not tickled.
function scourgeMen(state, house) {
  const own = Object.values(state.territories)
    .reduce((sum, land) => sum + Number(land.warriors?.[house] || 0), 0);
  return Math.max(SCOURGE.floor, Math.min(SCOURGE.cap, Math.round(own * SCOURGE.share) + 3));
}

function scourge(game, map, nowMs) {
  const state = game.state;
  const heart = state.heart;
  const abandoned = game.lifecycle?.abandoned_houses || {};
  const houses = Object.keys(state.houses || {}).filter(h => !abandoned[h]
    && Object.values(state.territories).some(land => land.owner === h));
  if (!houses.length) return;
  heart.scourge = { at: iso(nowMs), sea: seaborne(map), broken: [] };
  for (const house of houses) {
    const from = scourgeEntry(state, map, house);
    if (!from) continue;
    const horde = spawnHorde(game, map, from, house, nowMs, scourgeMen(state, house));
    horde.started = true;
    horde.scourge = true;
  }
  state.journal.push({
    kind: 'SCOURGE_LANDED', houses, sea: heart.scourge.sea,
    men: houses.map(house => scourgeMen(state, house)), at: iso(nowMs)
  });
}

// ---------- the Horde ----------

function dayMs(game) {
  return Number(game.rounds?.round_duration_ms) > 0 ? Number(game.rounds.round_duration_ms) : 24 * 3600_000;
}

// The shortest road from a land to another (by land if it can, else by sea too).
function roadBetween(map, from, to) {
  for (const sea of [false, true]) {
    const near = neighbours(map, { sea });
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const at = queue.shift();
      if (at === to) break;
      for (const [next] of near.get(at) || []) {
        if (prev.has(next)) continue;
        prev.set(next, at);
        queue.push(next);
      }
    }
    if (!prev.has(to)) continue;
    const path = [];
    for (let at = to; at !== null; at = prev.get(at)) path.unshift(at);
    // Only lands are stepped on; sea points are crossed.
    return path.filter(id => map.territories.some(t => t.id === id));
  }
  return [from];
}

function spawnHorde(game, map, decoy, house, nowMs, men = HEART.hordeMen) {
  const state = game.state;
  const capital = map.capitals?.[house];
  const path = capital ? roadBetween(map, decoy, capital) : [decoy];
  state.hordes ||= [];
  state.heart.horde_seq = Number(state.heart.horde_seq || 0) + 1;
  const horde = {
    id: `H${state.heart.horde_seq}-${decoy}`,
    against: house,
    path,
    started: false,
    men,
    at: decoy,
    next_at: iso(nowMs)
  };
  state.hordes.push(horde);
  state.journal.push({ kind: 'HORDE_AWAKENED', house, houses: [house], territory: decoy, men: horde.men, toward: capital, at: iso(nowMs) });
  return horde;
}

// The Horde strikes a land of the House it hunts.
function hordeStrikes(game, map, constants, horde, land, nowMs) {
  const state = game.state;
  const t = state.territories[land];
  const house = horde.against;
  const defenders = Number(t.warriors?.[house] || 0);
  const hordeStrength = horde.men + HEART.fortune;
  let won = true;
  let defenderLosses = 0;
  let hordeLosses = 0;
  if (defenders > 0) {
    const comp = compAt(state, map, land, house);
    const defStrength = strengthOf(comp, defenders, { defending: true, stars: starsAt(state, land, house) }) + HEART.fortune;
    const walls = baseDefense(map, state, constants, land);
    hordeLosses = Math.min(horde.men, Math.ceil(defStrength / 2));
    defenderLosses = Math.min(defenders, headsLost(comp, defenders, Math.max(0, Math.ceil(hordeStrength / 2) - walls)));
    won = hordeStrength > defStrength && horde.men - hordeLosses > 0;
  }
  horde.men -= hordeLosses;
  const left = defenders - defenderLosses;
  // The capital: the Horde sacks it and is spent there, but the House is not unmade.
  if (land === map.capitals?.[house] && won) {
    moveRanks(state, map, land, null, house, 0, { losses: defenders });
    delete t.warriors[house];
    const purse = Number(state.houses[house]?.gold || 0);
    const burnt = Math.ceil(purse / 2);
    state.houses[house].gold = purse - burnt;
    if (state.order) state.order[land] = Math.min(Number(state.order[land] ?? 90), 30);
    state.journal.push({ kind: 'HORDE_SACKED', house, houses: [house], territory: land, defenders, losses: defenders, horde_losses: hordeLosses, gold: burnt, at: iso(nowMs) });
    horde.men = 0;
    return;
  }
  if (!won) {
    if (defenderLosses > 0) moveRanks(state, map, land, null, house, 0, { losses: defenderLosses });
    t.warriors[house] = left;
    if (left <= 0) delete t.warriors[house];
    state.journal.push({ kind: 'HORDE_BROKEN', house, houses: [house], territory: land, defenders, losses: defenderLosses, at: iso(nowMs) });
    horde.men = 0;
    return;
  }
  let retreatTo = null;
  if (left > 0) {
    retreatTo = legalDefenderRetreats(state, map, house, land, left, constants)[0] || null;
    moveRanks(state, map, land, retreatTo, house, retreatTo ? left : 0, { losses: defenderLosses + (retreatTo ? 0 : left) });
    if (retreatTo) state.territories[retreatTo].warriors[house] = Number(state.territories[retreatTo].warriors[house] || 0) + left;
  }
  delete t.warriors[house];
  leadArmiesAway(state, map, house, land, retreatTo);
  t.owner = null;
  if (state.order) delete state.order[land];
  if (state.capture_choices) delete state.capture_choices[land];
  // A part of the Horde stays behind in every land it takes.
  const stay = Math.max(1, Math.ceil(horde.men / 4));
  state.wild_guards[land] = Number(state.wild_guards[land] || 0) + stay;
  horde.men -= stay;
  state.journal.push({
    kind: 'HORDE_TOOK', house, houses: [house], territory: land, defenders, losses: defenderLosses,
    horde_losses: hordeLosses, stayed: stay, men: horde.men, retreat_to: retreatTo, at: iso(nowMs)
  });
}

// The Horde's road from where it stands to the hunted capital. A river with
// no bridge is crossed by a ford, which costs the Horde FORD_STEPS waiting.
export const FORD_STEPS = 2;
function hordeRoad(state, map, from, to) {
  const near = new Map();
  for (const [a, b] of map.land_edges || []) {
    const key = [a, b].sort().join('|');
    const ford = state.river_crossings?.[key] && !state.bridges?.[key]?.built;
    const w = ford ? 1 + FORD_STEPS : 1;
    (near.get(a) || near.set(a, []).get(a)).push([b, w]);
    (near.get(b) || near.set(b, []).get(b)).push([a, w]);
  }
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const queue = [from];
  while (queue.length) {
    queue.sort((x, y) => dist.get(x) - dist.get(y) || (x < y ? -1 : 1));
    const at = queue.shift();
    if (at === to) break;
    for (const [next, w] of near.get(at) || []) {
      const d = dist.get(at) + w;
      if (d < (dist.get(next) ?? Infinity)) { dist.set(next, d); prev.set(next, at); queue.push(next); }
    }
  }
  if (!dist.has(to)) return roadBetween(map, from, to);
  const path = [];
  for (let at = to; at !== undefined; at = prev.get(at)) { path.unshift(at); if (at === from) break; }
  return path;
}

function fordAhead(state, a, b) {
  const key = [a, b].sort().join('|');
  return Boolean(state.river_crossings?.[key] && !state.bridges?.[key]?.built);
}

// The Horde marches a land a step and strikes only the hunted House's lands.
// A burnt or missing bridge holds it up at the river for a while.
function hordeStep(next, map, constants, horde, at) {
  const state = next.state;
  if (!horde.started) {
    horde.started = true;
    if (state.territories[horde.at]?.owner === horde.against) hordeStrikes(next, map, constants, horde, horde.at, at);
    return;
  }
  const capital = map.capitals?.[horde.against];
  const road = capital ? hordeRoad(state, map, horde.at, capital) : [horde.at];
  horde.path = road;
  const ahead = road[1];
  if (!ahead) {
    horde.done = true;
    return;
  }
  if (fordAhead(state, horde.at, ahead) && Number(horde.ford || 0) < FORD_STEPS) {
    if (!horde.ford) state.journal.push({ kind: 'HORDE_FORDING', house: horde.against, houses: [horde.against], territory: horde.at, men: horde.men, at: iso(at) });
    horde.ford = Number(horde.ford || 0) + 1;
    return;
  }
  horde.ford = 0;
  horde.at = ahead;
  if (state.territories[ahead]?.owner === horde.against) hordeStrikes(next, map, constants, horde, ahead, at);
  if (ahead === capital) horde.done = true;
}

export function processHordes(game, map, constants, nowMs = Date.now()) {
  const hordes = game.state?.hordes || [];
  if (!hordes.some(h => h.men > 0 && Date.parse(h.next_at) <= nowMs)) return game;
  const next = structuredClone(game);
  const state = next.state;
  for (const horde of state.hordes) {
    const wasMen = horde.men;
    while (horde.men > 0 && Date.parse(horde.next_at) <= nowMs) {
      const at = Date.parse(horde.next_at);
      hordeStep(next, map, constants, horde, at);
      if (horde.men > 0 && (horde.done || horde.men < 3)) {
        state.journal.push({ kind: 'HORDE_SPENT', house: horde.against, houses: [horde.against], territory: horde.at, men: horde.men, at: iso(at) });
        // What is left of it settles where it stopped, if the land is free.
        if (!state.territories[horde.at]?.owner) state.wild_guards[horde.at] = Number(state.wild_guards[horde.at] || 0) + horde.men;
        horde.men = 0;
      }
      horde.next_at = iso(at + Math.round(dayMs(next) * HEART.hordeStepShare));
    }
    // The scourge sent for this House is broken: the realm sees who stood first.
    if (horde.scourge && wasMen > 0 && horde.men <= 0 && state.heart?.scourge) {
      const broken = state.heart.scourge.broken ||= [];
      const first = broken.length === 0;
      if (!broken.includes(horde.against)) {
        broken.push(horde.against);
        if (first) state.houses[horde.against].victory_points = Number(state.houses[horde.against].victory_points || 0) + HEART.heartGlory;
        state.journal.push({
          kind: 'SCOURGE_BROKEN', house: horde.against, houses: [horde.against],
          first, glory: first ? HEART.heartGlory : 0, at: iso(nowMs)
        });
      }
    }
  }
  state.hordes = state.hordes.filter(h => h.men > 0);
  reconcileRanks(state, map);
  next.updated_at = iso(nowMs);
  return next;
}

export function nextHordeDueAt(game) {
  return (game.state?.hordes || []).filter(h => h.men > 0).map(h => h.next_at).sort()[0] || null;
}
