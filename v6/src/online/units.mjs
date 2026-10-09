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
import { RANKS, compAt, emptyComp, mergeStars, reconcileRanks, setStars, starsAt } from './ranks.mjs';

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
export function hireUnits(game, map, house, territory, counts, { nowMs = Date.now() } = {}) {
  const land = game.state.territories[territory];
  if (!land || land.owner !== house) throw new Error('нанимать можно только в своей земле');
  const want = cleanCounts(counts);
  const heads = want.reduce((a, b) => a + b, 0);
  if (!heads) throw new Error('кого нанять?');
  const allowed = new Set(kindsRaisedIn(map, territory));
  want.forEach((n, i) => { if (n && !allowed.has(i)) throw new Error(`${RANKS[i].name} здесь не набираются: нужна ${RANKS[i].where === 2 ? 'столица' : 'земля с городом'}`); });
  const people = Number(game.state.population?.[territory] || 0);
  if (heads > people) throw new Error(`в этой земле осталось людей: ${people}`);
  const gold = want.reduce((sum, n, i) => sum + n * RANKS[i].gold, 0);
  if (Number(game.state.houses[house].gold || 0) < gold) throw new Error(`нужно ${gold} золота`);

  const next = structuredClone(game);
  const state = next.state;
  reconcileRanks(state, map);
  const oldHeads = Number(land.warriors?.[house] || 0);
  const comp = compAt(state, map, territory, house);
  want.forEach((n, i) => { comp[i] += n; });
  state.houses[house].gold -= gold;
  state.population[territory] = people - heads;
  state.territories[territory].warriors[house] = oldHeads + heads;
  state.ranks ||= {};
  state.ranks[territory] ||= {};
  state.ranks[territory][house] = comp;
  // Fresh men dilute the experience of the host they join.
  setStars(state, territory, house, mergeStars(starsAt(game.state, territory, house), oldHeads, 0, heads));
  state.journal.push({ kind: 'UNITS_HIRED', house, houses: [house], territory, counts: want, gold, at: iso(nowMs) });
  next.updated_at = iso(nowMs);
  return next;
}

// Turns `count` men of one kind into a better kind, for the difference in price.
export function retrainUnits(game, map, house, territory, from, to, count, { nowMs = Date.now() } = {}) {
  const land = game.state.territories[territory];
  if (!land || land.owner !== house) throw new Error('переучивать можно только в своей земле');
  from = Number(from); to = Number(to); count = Math.floor(Number(count) || 0);
  if (!(to > from) || !RANKS[to] || !RANKS[from]) throw new Error('переучить можно только в более сильный род войск');
  if (!kindsRaisedIn(map, territory).includes(to)) throw new Error(`${RANKS[to].name} здесь не обучаются`);
  if (count < 1) throw new Error('сколько переучить?');
  const comp = compAt(game.state, map, territory, house);
  // Men already on the march are not here to learn.
  for (const order of game.orders || []) {
    if (order.status === 'PENDING' && order.action.house === house && order.action.from === territory && order.action.ranks) {
      for (let i = 0; i < comp.length; i += 1) comp[i] = Math.max(0, comp[i] - Number(order.action.ranks[i] || 0));
    }
  }
  if (comp[from] < count) throw new Error(`${RANKS[from].name}: здесь свободно только ${comp[from]}`);
  const gold = (RANKS[to].gold - RANKS[from].gold) * count;
  if (Number(game.state.houses[house].gold || 0) < gold) throw new Error(`нужно ${gold} золота`);
  const next = structuredClone(game);
  const stored = compAt(next.state, map, territory, house);
  stored[from] -= count;
  stored[to] += count;
  next.state.ranks ||= {};
  next.state.ranks[territory] ||= {};
  next.state.ranks[territory][house] = stored;
  next.state.houses[house].gold -= gold;
  next.state.journal.push({ kind: 'UNITS_RETRAINED', house, houses: [house], territory, from, to, count, gold, at: iso(nowMs) });
  next.updated_at = iso(nowMs);
  return next;
}

// Fields or a fair: the land's people grow a little every dawn.
export function buildGrowth(game, map, house, territory, { nowMs = Date.now() } = {}) {
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

// At dawn: lands with fields or a fair gain people, up to twice their start.
export function populationDawn(state, map) {
  if (!state.population) return;
  for (const id of Object.keys(state.growth || {})) {
    if (!state.growth[id]) continue;
    const type = landType(map, id);
    const cap = (PEOPLE.start[type] ?? 6) * PEOPLE.capFactor;
    state.population[id] = Math.min(cap, Number(state.population[id] || 0) + (PEOPLE.growth[type] ?? 1));
  }
}

// A land changed hands: some of its people flee or fall.
export function populationOnCapture(state, territory, previousOwner) {
  if (!state.population) return 0;
  const share = previousOwner ? PEOPLE.takenFromHouse : PEOPLE.takenFromWild;
  const people = Number(state.population[territory] || 0);
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
    kinds: RANKS.map((rank, i) => ({ index: i, name: rank.name, power: rank.power, gold: rank.gold, guard: rank.guard, where: rank.where })),
    growth_gold: PEOPLE.growthGold,
    growth_per_dawn: PEOPLE.growth
  };
}

// For the AI: what to hire where, with about half of its gold.
export function aiHireChoice(game, map, house) {
  const state = game.state;
  if (!state.population) return null;
  const gold = Number(state.houses[house]?.gold || 0);
  if (gold < 6) return null;
  const budget = Math.floor(gold * 0.6);
  const lands = Object.entries(state.territories)
    .filter(([id, t]) => t.owner === house && Number(state.population[id] || 0) > 0)
    .map(([id]) => id)
    .sort((a, b) => (kindsRaisedIn(map, b).length - kindsRaisedIn(map, a).length) || (Number(state.population[b]) - Number(state.population[a])) || (a < b ? -1 : 1));
  for (const id of lands) {
    const kinds = kindsRaisedIn(map, id);
    const people = Number(state.population[id] || 0);
    // The best kind it can afford at least two of.
    for (const k of [...kinds].reverse()) {
      const n = Math.min(people, Math.floor(budget / RANKS[k].gold));
      if (n >= 2) {
        const counts = emptyComp();
        counts[k] = n;
        return { territory: id, counts };
      }
    }
  }
  return null;
}
