// Troops and people (games of the Heart).
//
// Every land has its people. Troops are hired in a land for gold, and every
// man hired is one of its people: a land hired out runs dry. People do not
// come back by themselves: only fields (in a village) or a fair (in a town or
// the capital) make them grow, a little every dawn. Taking a land costs some
// of its people too, more when it is taken from another House.
//
// There are no limits on the number of troops: gold and people are the limit.
// A village raises the light kinds, a town the middle ones, the capital all.
// Troops already standing can be retrained into a better kind where that kind
// is raised, for the difference in price.
import { buildAdjacency } from '../core/map.mjs';
import { orderOnCapture } from './order.mjs';
import { heartOnCapture } from './heart.mjs';
import { addPeak, peakAt, RANKS, compAt, emptyComp, mergeStars, reconcileRanks, setStars, starsAt } from './ranks.mjs';

export const PEOPLE = Object.freeze({
  start: { 'Столица': 30, 'Город': 20, 'Деревня': 12, 'Дикая земля': 4, 'Половина острова': 6 },
  growth: { 'Столица': 3, 'Город': 2, 'Деревня': 1, 'Дикая земля': 1, 'Половина острова': 1 },
  // Growth stops at twice the starting number.
  capFactor: 2,
  growthGold: { 'Столица': 6, 'Город': 5, 'Деревня': 3, 'Дикая земля': 3, 'Половина острова': 3 },
  takenFromWild: 0.1,
  takenFromHouse: 0.2
});

// A game played with troop kinds and people, without limits on troops.
export const NO_LIMIT = 9999;

const LEVEL = { 'Деревня': 0, 'Дикая земля': 0, 'Половина острова': 0, 'Город': 1, 'Столица': 2 };

export function unitsMode(state) {
  return Boolean(state?.population);
}

function landType(map, id) {
  return map.territories.find(t => t.id === id)?.type;
}

export function seedPopulation(game, map) {
  game.state.population = {};
  for (const t of map.territories) game.state.population[t.id] = PEOPLE.start[t.type] ?? 6;
  game.state.growth = {};
  game.state.peak = {};
  // The hosts standing at the start are at full strength.
  for (const [id, t] of Object.entries(game.state.territories)) {
    for (const [house, n] of Object.entries(t.warriors || {})) {
      if (Number(n) > 0) (game.state.peak[id] ||= {})[house] = compAt(game.state, map, id, house);
    }
  }
  return game;
}

export function kindsRaisedIn(map, id) {
  const level = LEVEL[landType(map, id)] ?? 0;
  return RANKS.map((rank, i) => i).filter(i => RANKS[i].where <= level);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function cleanCounts(counts) {
  return RANKS.map((_, i) => Math.max(0, Math.floor(Number(counts?.[i] || 0))));
}

// Hires troops in one of one's own lands. Mutates nothing; returns the new game.
const OLD_RULES = 'в этом веке войска нанимают в столице по-старому';
function assertNewRules(game) {
  if (!game.state?.population) throw new Error(OLD_RULES);
}

// Where the men come from. A land gives its own people first; what it cannot
// give is brought in from the House's neighbouring lands, but no settlement
// gives away more than half of its people: a land stripped bare is no land.
export const NEIGHBOUR_SHARE = 0.5;

export function recruitPool(state, map, house, territory) {
  const own = peopleAt(state, territory);
  const adjacency = buildAdjacency(map.land_edges);
  const near = [];
  for (const id of adjacency.get(territory) || []) {
    if (state.territories[id]?.owner !== house) continue;
    const share = Math.floor(peopleAt(state, id) * NEIGHBOUR_SHARE);
    if (share > 0) near.push({ id, share });
  }
  near.sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1));
  return { territory, own, near, total: own + near.reduce((sum, n) => sum + n.share, 0) };
}

// Takes the men out of the land and its neighbours, the land first.
function drawPeople(state, pool, heads) {
  const drawn = [];
  let left = heads;
  const takeHere = Math.min(pool.own, left);
  if (takeHere > 0) {
    state.population[pool.territory] = pool.own - takeHere;
    drawn.push({ territory: pool.territory, people: takeHere });
    left -= takeHere;
  }
  for (const near of pool.near) {
    if (left <= 0) break;
    const take = Math.min(near.share, left);
    state.population[near.id] = peopleAt(state, near.id) - take;
    drawn.push({ territory: near.id, people: take });
    left -= take;
  }
  return drawn;
}

export function hireUnits(game, map, house, territory, counts, { nowMs = Date.now() } = {}) {
  assertNewRules(game);
  const land = game.state.territories[territory];
  if (!land || land.owner !== house) throw new Error('нанимать можно только в своей земле');
  const want = cleanCounts(counts);
  const heads = want.reduce((a, b) => a + b, 0);
  if (!heads) throw new Error('кого нанять?');
  const allowed = new Set(kindsRaisedIn(map, territory));
  want.forEach((n, i) => { if (n && !allowed.has(i)) throw new Error(`${RANKS[i].name} здесь не набираются: нужна ${RANKS[i].where === 2 ? 'столица' : 'земля с городом'}`); });
  const pool = recruitPool(game.state, map, house, territory);
  if (heads > pool.total) throw new Error(`людей под рукой: ${pool.total} (в земле ${pool.own}, из округи ${pool.total - pool.own})`);
  const gold = want.reduce((sum, n, i) => sum + n * RANKS[i].gold, 0);
  if (Number(game.state.houses[house].gold || 0) < gold) throw new Error(`нужно ${gold} золота`);

  const next = structuredClone(game);
  const state = next.state;
  reconcileRanks(state, map);
  const oldHeads = Number(land.warriors?.[house] || 0);
  const comp = compAt(state, map, territory, house);
  want.forEach((n, i) => { comp[i] += n; });
  state.houses[house].gold -= gold;
  const drawn = drawPeople(state, pool, heads);
  state.territories[territory].warriors[house] = oldHeads + heads;
  state.ranks ||= {};
  state.ranks[territory] ||= {};
  state.ranks[territory][house] = comp;
  state.peak ||= {};
  (state.peak[territory] ||= {})[house] = peakAt(game.state, map, territory, house).map((n, i) => n + want[i]);
  // Fresh men dilute the experience of the host they join.
  setStars(state, territory, house, mergeStars(starsAt(game.state, territory, house), oldHeads, 0, heads));
  state.journal.push({ kind: 'UNITS_HIRED', house, houses: [house], territory, counts: want, gold, drawn, at: iso(nowMs) });
  next.updated_at = iso(nowMs);
  return next;
}

// ---------- making good the losses ----------
// A host that has fought is short of men: the wounded and fallen. Making them
// good brings it back to full strength and keeps its experience; it costs the
// price of the men, more for a seasoned host (half again per star), and one
// of the land's people for each.
export const REPLENISH_STAR_SHARE = 0.5;

export function replenishQuote(state, map, house, territory) {
  const land = state.territories?.[territory];
  const comp = compAt(state, map, territory, house);
  const peak = peakAt(state, map, territory, house);
  const missing = peak.map((n, i) => Math.max(0, n - comp[i]));
  const men = missing.reduce((a, b) => a + b, 0);
  const stars = starsAt(state, territory, house);
  const gold = Math.ceil(missing.reduce((sum, n, i) => sum + n * RANKS[i].gold, 0) * (1 + REPLENISH_STAR_SHARE * stars));
  const heads = comp.reduce((a, b) => a + b, 0);
  const full = peak.reduce((a, b) => a + b, 0);
  return {
    missing, men, gold, stars,
    health: full ? Math.round((heads / full) * 100) : 100,
    people: peopleAt(state, territory),
    own: land?.owner === house
  };
}

export function replenishUnits(game, map, house, territory, { nowMs = Date.now() } = {}) {
  assertNewRules(game);
  const quote = replenishQuote(game.state, map, house, territory);
  if (!quote.own) throw new Error('пополнять можно только в своей земле');
  if (!quote.men) throw new Error('отряд и так в полной силе');
  if (quote.people < quote.men) throw new Error(`в этой земле осталось людей: ${quote.people}, а нужно ${quote.men}`);
  if (Number(game.state.houses[house].gold || 0) < quote.gold) throw new Error(`нужно ${quote.gold} золота`);
  const next = structuredClone(game);
  const state = next.state;
  reconcileRanks(state, map);
  const comp = compAt(state, map, territory, house);
  quote.missing.forEach((n, i) => { comp[i] += n; });
  state.territories[territory].warriors[house] = comp.reduce((a, b) => a + b, 0);
  state.ranks[territory] ||= {};
  state.ranks[territory][house] = comp;
  state.houses[house].gold -= quote.gold;
  state.population[territory] -= quote.men;
  // The experience stays with the host.
  setStars(state, territory, house, quote.stars);
  state.journal.push({ kind: 'UNITS_REPLENISHED', house, houses: [house], territory, men: quote.men, gold: quote.gold, at: iso(nowMs) });
  next.updated_at = iso(nowMs);
  return next;
}

// Turns `count` men of one kind into a better kind, for the difference in price.
// What a retraining would cost and whether it may be ordered at all. The men
// learn over time, so this only settles the terms; `applyRetrain` finishes it.
export function planRetrain(game, map, house, territory, from, to, count) {
  assertNewRules(game);
  const land = game.state.territories[territory];
  if (!land || land.owner !== house) throw new Error('переучивать можно только в своей земле');
  from = Number(from); to = Number(to); count = Math.floor(Number(count) || 0);
  if (!(to > from) || !RANKS[to] || !RANKS[from]) throw new Error('переучить можно только в более сильный род войск');
  if (!kindsRaisedIn(map, territory).includes(to)) throw new Error(`${RANKS[to].name} здесь не обучаются`);
  if (count < 1) throw new Error('сколько переучить?');
  const comp = compAt(game.state, map, territory, house);
  // Men already on the march, or already sent to learn, are not here.
  for (const order of game.orders || []) {
    if (order.status === 'PENDING' && order.action.house === house && order.action.from === territory && order.action.ranks) {
      for (let i = 0; i < comp.length; i += 1) comp[i] = Math.max(0, comp[i] - Number(order.action.ranks[i] || 0));
    }
  }
  for (const job of game.jobs || []) {
    if (job.status === 'PENDING' && job.type === 'RETRAIN' && job.house === house && job.territory === territory) {
      comp[Number(job.from)] = Math.max(0, comp[Number(job.from)] - Number(job.count || 0));
    }
  }
  if (comp[from] < count) throw new Error(`${RANKS[from].name}: здесь свободно только ${comp[from]}`);
  const gold = (RANKS[to].gold - RANKS[from].gold) * count;
  if (Number(game.state.houses[house].gold || 0) < gold) throw new Error(`нужно ${gold} золота`);
  return { from, to, count, gold };
}

// The lesson is learned: the men now stand under another banner.
export function applyRetrain(next, map, house, territory, from, to, count, nowMs) {
  const stored = compAt(next.state, map, territory, house);
  if (stored[from] < count) throw new Error(`${RANKS[from].name}: учиться уже некому`);
  stored[from] -= count;
  stored[to] += count;
  next.state.ranks ||= {};
  next.state.ranks[territory] ||= {};
  next.state.ranks[territory][house] = stored;
  // The host's full strength follows: the retrained men count by their new kind.
  if (next.state.peak?.[territory]?.[house]) {
    const peak = next.state.peak[territory][house];
    const moved = Math.min(count, Number(peak[from] || 0));
    peak[from] = Number(peak[from] || 0) - moved;
    peak[to] = Number(peak[to] || 0) + moved;
  }
  next.state.journal.push({ kind: 'UNITS_RETRAINED', house, houses: [house], territory, from, to, count, gold: 0, at: iso(nowMs) });
  return next;
}

// Fields or a fair: the land's people grow a little every dawn.
export function buildGrowth(game, map, house, territory, { nowMs = Date.now() } = {}) {
  assertNewRules(game);
  const land = game.state.territories[territory];
  if (!land || land.owner !== house) throw new Error('строить можно только в своей земле');
  if (game.state.growth?.[territory]) throw new Error('здесь уже есть');
  const type = landType(map, territory);
  const gold = PEOPLE.growthGold[type] ?? 3;
  if (Number(game.state.houses[house].gold || 0) < gold) throw new Error(`нужно ${gold} золота`);
  const next = structuredClone(game);
  next.state.houses[house].gold -= gold;
  next.state.growth ||= {};
  next.state.growth[territory] = true;
  next.state.journal.push({ kind: 'GROWTH_BUILT', house, houses: [house], territory, at: iso(nowMs) });
  next.updated_at = iso(nowMs);
  return next;
}

export function growthName(map, territory) {
  return (LEVEL[landType(map, territory)] ?? 0) >= 1 ? 'Ярмарка' : 'Поля';
}

// A land's people, as a whole number that can be counted on: an old save or a
// broken write never leaves a NaN to spread through the rules.
export function peopleAt(state, id) {
  const people = Math.floor(Number(state?.population?.[id]));
  return Number.isFinite(people) && people > 0 ? people : 0;
}

// At dawn: lands with fields or a fair gain people, up to twice their start.
export function populationDawn(state, map) {
  if (!state.population) return;
  // Whatever an old save holds, the count is a whole number again.
  for (const id of Object.keys(state.population)) state.population[id] = peopleAt(state, id);
  for (const id of Object.keys(state.growth || {})) {
    if (!state.growth[id]) continue;
    const type = landType(map, id);
    const cap = (PEOPLE.start[type] ?? 6) * PEOPLE.capFactor;
    state.population[id] = Math.min(cap, peopleAt(state, id) + (PEOPLE.growth[type] ?? 1));
  }
}

// A land changed hands (games with people): people lost, order low, a choice for the taker.
export function onLandTaken(game, map, territory, previousOwner, nowMs = Date.now()) {
  const state = game.state;
  const house = state.territories[territory]?.owner;
  // A Heart taken: the true one shows itself, a decoy wakes the Horde.
  heartOnCapture(game, map, territory, house, nowMs);
  if (!state.population) return;
  populationOnCapture(state, territory, previousOwner);
  if (house) orderOnCapture(state, territory, house, previousOwner, { nowMs, ai: (game.rounds?.ai_houses || []).includes(house) });
}

// A land changed hands: some of its people flee or fall.
export function populationOnCapture(state, territory, previousOwner) {
  if (!state.population) return 0;
  const share = previousOwner ? PEOPLE.takenFromHouse : PEOPLE.takenFromWild;
  const people = peopleAt(state, territory);
  const lost = Math.ceil(people * share);
  state.population[territory] = people - lost;
  // The fields of the old owner are trampled when a House takes it by force.
  if (previousOwner && state.growth?.[territory]) delete state.growth[territory];
  return lost;
}

export function unitsView(game, map, house) {
  const state = game.state;
  if (!state.population) return null;
  return {
    kinds: RANKS.map((rank, i) => ({ index: i, name: rank.name, power: rank.power, gold: rank.gold, guard: rank.guard, where: rank.where, upkeep: rank.upkeep })),
    growth_gold: PEOPLE.growthGold,
    replenish_star_share: REPLENISH_STAR_SHARE,
    growth_per_dawn: PEOPLE.growth
  };
}

// ---------- upkeep ----------
// Every dawn a House pays for its troops: a peasant a quarter of a gold piece,
// a knight two. What it cannot pay, it pays in men: the unpaid desert, the
// cheapest first, from the biggest hosts, never men already on the march.

function positions(state) {
  const out = [];
  for (const [id, t] of Object.entries(state.territories || {})) for (const [house, n] of Object.entries(t.warriors || {})) if (Number(n) > 0) out.push({ key: id, house, heads: Number(n), kind: 'LAND' });
  for (const [id, node] of Object.entries(state.sea_nodes || {})) for (const [house, n] of Object.entries(node.warriors || {})) if (Number(n) > 0) out.push({ key: id, house, heads: Number(n), kind: 'SEA' });
  for (const [id, byHouse] of Object.entries(state.guests || {})) for (const [house, n] of Object.entries(byHouse || {})) if (Number(n) > 0) out.push({ key: `g:${id}`, land: id, house, heads: Number(n), kind: 'GUEST' });
  return out;
}

export function upkeepOf(state, map, house) {
  let total = 0, heads = 0;
  for (const p of positions(state)) {
    if (p.house !== house) continue;
    const comp = compAt(state, map, p.key, house);
    comp.forEach((n, i) => { total += n * RANKS[i].upkeep; heads += n; });
  }
  return { gold: Math.ceil(total - 1e-9), heads };
}

export function upkeepDawn(game, map, nowMs = Date.now()) {
  const state = game.state;
  if (!state.population) return;
  reconcileRanks(state, map);
  for (const house of Object.keys(state.houses || {})) {
    const { gold } = upkeepOf(state, map, house);
    if (!gold) continue;
    const purse = Math.max(0, Number(state.houses[house].gold || 0));
    if (purse >= gold) {
      state.houses[house].gold = purse - gold;
      continue;
    }
    state.houses[house].gold = 0;
    let unpaid = gold - purse;
    let deserted = 0;
    // Men already on the march stay with their banner.
    const marching = {};
    for (const order of game.orders || []) {
      if (order.status === 'PENDING' && order.action?.house === house) marching[order.action.from] = Number(marching[order.action.from] || 0) + Number(order.action.warriors || 0);
    }
    const hosts = positions(state).filter(p => p.house === house).sort((a, b) => b.heads - a.heads || (a.key < b.key ? -1 : 1));
    for (const p of hosts) {
      if (unpaid <= 0) break;
      const free = p.heads - Number(marching[p.land || p.key] || 0);
      if (free <= 0) continue;
      const comp = compAt(state, map, p.key, house);
      const before = [...comp];
      let gone = 0;
      for (let i = 0; i < comp.length && unpaid > 0 && gone < free; i += 1) {
        while (comp[i] > 0 && unpaid > 0 && gone < free) { comp[i] -= 1; gone += 1; unpaid -= RANKS[i].upkeep; }
      }
      if (!gone) continue;
      deserted += gone;
      const left = p.heads - gone;
      const holder = p.kind === 'LAND' ? state.territories[p.key].warriors : p.kind === 'SEA' ? state.sea_nodes[p.key].warriors : state.guests[p.land];
      if (left > 0) holder[house] = left; else delete holder[house];
      state.ranks[p.key] ||= {};
      state.ranks[p.key][house] = comp;
      // Deserters are gone for good: the host's full strength shrinks.
      addPeak(state, p.key, house, before.map((n, i) => n - comp[i]), -1);
      if (p.kind === 'SEA') {
        const afloat = Object.keys(holder).filter(h => Number(holder[h] || 0) > 0);
        state.sea_nodes[p.key].owner = afloat.length === 1 ? afloat[0] : null;
        if (left <= 0 && state.sea_nodes[p.key].days_at_sea) delete state.sea_nodes[p.key].days_at_sea[house];
      }
      if (p.kind === 'GUEST' && !Object.keys(state.guests[p.land]).length) delete state.guests[p.land];
    }
    if (deserted > 0) state.journal.push({ kind: 'DESERTION', house, houses: [house], owed: gold, paid: purse, deserted, at: iso(nowMs) });
  }
  reconcileRanks(state, map);
}

// For the AI: what to hire where, with about half of its gold.
export function aiHireChoice(game, map, house, prefer = null) {
  const state = game.state;
  if (!state.population) return null;
  const gold = Number(state.houses[house]?.gold || 0);
  if (gold < 3) return null;
  // Keep enough for a dawn of upkeep, of the old men and the new.
  const upkeep = upkeepOf(state, map, house).gold;
  const lands = Object.entries(state.territories)
    .filter(([id, t]) => t.owner === house && peopleAt(state, id) > 0)
    .map(([id]) => id)
    .sort((a, b) => (b === prefer) - (a === prefer) || (kindsRaisedIn(map, b).length - kindsRaisedIn(map, a).length) || (peopleAt(state, b) - peopleAt(state, a)) || (a < b ? -1 : 1));
  let best = null;
  for (const id of lands) {
    const people = peopleAt(state, id);
    // The kind that buys the most strength here; among equals the stronger men.
    for (const k of kindsRaisedIn(map, id)) {
      let n = Math.min(people, Math.floor(gold / RANKS[k].gold));
      while (n > 0 && n * RANKS[k].gold + upkeep + Math.ceil(n * RANKS[k].upkeep) > gold) n -= 1;
      if (n < 1) continue;
      const power = n * RANKS[k].power;
      const better = !best || power > best.power || (power === best.power && (id === prefer) > (best.territory === prefer)) || (power === best.power && id === best.territory && RANKS[k].power > RANKS[best.k].power);
      if (better) best = { territory: id, k, n, power };
    }
    // The stage first: once it can take men, hire there.
    if (best && best.territory === prefer && best.n >= 2) break;
  }
  if (!best) return null;
  const counts = emptyComp();
  counts[best.k] = best.n;
  return { territory: best.territory, counts };
}
