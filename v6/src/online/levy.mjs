// The levy, the drill and the drill yard as commands, and their clock.
import { queueTimedOrder } from './orders.mjs';
import {
  DRILL, LEVY, RANKS, YARD, compAt, compSum, drawLevy, drillTime, drillableComp, drillingCount,
  emptyComp, levyView, promote, reconcileRanks, yardOf, yardReady, yardTime, describeComp
} from './ranks.mjs';

function totalHouseWarriors(state, house) {
  let total = 0;
  for (const t of Object.values(state.territories || {})) total += Number(t.warriors?.[house] || 0);
  for (const node of Object.values(state.sea_nodes || {})) total += Number(node.warriors?.[house] || 0);
  for (const byHouse of Object.values(state.guests || {})) total += Number(byHouse?.[house] || 0);
  return total;
}

function heads(territory) {
  return Object.values(territory?.warriors || {}).reduce((a, b) => a + Number(b || 0), 0);
}

// "Собрать войска": men of the three ranks from the lands that give them.
// Villagers and townsmen walk to the capital along the roads; the capital's
// own men-at-arms stand ready at once.
export function raiseLevy(game, map, constants, house, counts, { nowMs = Date.now() } = {}) {
  const capital = map.capitals?.[house];
  if (!capital || game.state.territories[capital]?.owner !== house) throw new Error('без столицы войска не собрать');
  let next = structuredClone(game);
  const want = [0, 1, 2].map(rank => Math.max(0, Math.floor(Number(counts?.[rank] || 0))));
  if (!want.some(Boolean)) throw new Error('сколько людей собрать?');
  const view = levyView(next, map, house, nowMs);
  let gold = 0;
  for (const rank of [0, 1, 2]) {
    if (want[rank] > view[rank].available) throw new Error(`${RANKS[rank].name}: сейчас можно собрать не больше ${view[rank].available}`);
    gold += want[rank] * view[rank].gold;
  }
  if (Number(next.state.houses[house].gold || 0) < gold) throw new Error(`нужно ${gold} золота`);
  const room = constants.house_warrior_cap - totalHouseWarriors(next.state, house);
  if (want.reduce((a, b) => a + b, 0) > room) throw new Error(`войско Дома не может быть больше ${constants.house_warrior_cap}`);

  next.state.houses[house].gold -= gold;
  reconcileRanks(next.state, map);
  const marches = [];
  for (const rank of [0, 1, 2]) {
    if (!want[rank]) continue;
    for (const { territory, count } of drawLevy(next, map, house, rank, want[rank], nowMs)) {
      const land = next.state.territories[territory];
      const fits = Math.min(count, constants.territory_warrior_cap - heads(land));
      if (fits <= 0) continue;
      land.warriors[house] = Number(land.warriors[house] || 0) + fits;
      // The newcomers are counted as their own rank.
      next.state.ranks ||= {};
      next.state.ranks[territory] ||= {};
      const comp = [...(next.state.ranks[territory][house] || emptyComp())];
      comp[rank] += fits;
      next.state.ranks[territory][house] = comp;
      if (territory !== capital) marches.push({ territory, count: fits, rank });
    }
  }
  // The new men set off for the capital; where no road leads there, they stay.
  for (const march of marches) {
    const ranks = emptyComp();
    ranks[march.rank] = march.count;
    try {
      next = queueTimedOrder(next, map, constants, {
        type: 'MARCH', mode: 'LAND', house, from: march.territory, to: capital, warriors: march.count, ranks
      }, { nowMs }).game;
    } catch {
      // A levy with no road home waits where it was raised.
    }
  }
  next.state.journal.push({
    kind: 'LEVY_RAISED', house, houses: [house], counts: want, gold, at: new Date(nowMs).toISOString()
  });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// "Учения": raise a rank for chosen warriors of the capital garrison.
export function startDrill(game, map, house, counts, { nowMs = Date.now() } = {}) {
  const next = structuredClone(game);
  reconcileRanks(next.state, map);
  const take = [0, 1, 2, 3].map(rank => Math.max(0, Math.floor(Number(counts?.[rank] || 0))));
  const total = take.reduce((a, b) => a + b, 0);
  if (!total) throw new Error('кого учить?');
  const yard = yardReady(next, house, nowMs);
  const top = yard ? DRILL.maxWithYard : DRILL.maxWithoutYard;
  for (let rank = 0; rank < 4; rank += 1) {
    if (take[rank] && rank + 1 > top) throw new Error(`${RANKS[rank].name} учатся дальше только на учебном дворе`);
  }
  const places = (yard ? DRILL.placesWithYard : DRILL.places) - drillingCount(next, house);
  if (total > places) throw new Error(`на учениях сейчас места ещё для ${Math.max(0, places)}`);
  const free = drillableComp(next, map, house);
  for (let rank = 0; rank < 4; rank += 1) {
    if (take[rank] > free[rank]) throw new Error(`${RANKS[rank].name}: в столице свободно только ${free[rank]}`);
  }
  const gold = take.reduce((sum, n, rank) => sum + n * DRILL.goldPerStep[rank], 0);
  if (Number(next.state.houses[house].gold || 0) < gold) throw new Error(`нужно ${gold} золота`);
  next.state.houses[house].gold -= gold;
  next.drills ||= {};
  next.drills[house] ||= [];
  const counts5 = [...take, 0];
  next.drills[house].push({ id: `D${Date.now().toString(36)}${next.drills[house].length}`, counts: counts5, due_at: new Date(nowMs + drillTime(next)).toISOString(), started_at: new Date(nowMs).toISOString() });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

export function buildYard(game, map, house, { nowMs = Date.now() } = {}) {
  const capital = map.capitals?.[house];
  if (!capital || game.state.territories[capital]?.owner !== house) throw new Error('учебный двор ставят только в своей столице');
  if (yardOf(game, house)) throw new Error('учебный двор уже есть');
  if (Number(game.state.houses[house].gold || 0) < YARD.gold) throw new Error(`нужно ${YARD.gold} золота`);
  const next = structuredClone(game);
  next.state.houses[house].gold -= YARD.gold;
  next.yards ||= {};
  next.yards[house] = { started_at: new Date(nowMs).toISOString(), ready_at: new Date(nowMs + yardTime(next)).toISOString() };
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// A port on a shore: from here fleets set out into the open water.
export const PORT = Object.freeze({ gold: 4, dayShare: 1 / 3 });
export function buildPort(game, map, house, territory, { nowMs = Date.now() } = {}) {
  if (!map.buildable_ports) throw new Error('на этой карте порты уже стоят где положено');
  const land = game.state.territories[territory];
  if (!land || land.owner !== house) throw new Error('порт строят только на своей земле');
  if (!(map.ports || []).includes(territory)) throw new Error('эта земля не выходит к воде');
  if (land.port || (map.starting_ports || []).includes(territory)) throw new Error('порт здесь уже есть');
  if (land.port_ready_at) throw new Error('порт уже строится');
  if (Number(game.state.houses[house].gold || 0) < PORT.gold) throw new Error(`нужно ${PORT.gold} золота`);
  const next = structuredClone(game);
  next.state.houses[house].gold -= PORT.gold;
  const dayMsValue = Number(next.rounds?.round_duration_ms) > 0 ? Number(next.rounds.round_duration_ms) : 24 * 3600_000;
  next.state.territories[territory].port_ready_at = new Date(nowMs + Math.round(dayMsValue * PORT.dayShare)).toISOString();
  next.state.territories[territory].port_builder = house;
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// The clock: drills end, yards are finished, the ranks follow the heads.
export function processRanks(game, map, nowMs = Date.now()) {
  let next = null;
  const edit = () => (next ||= structuredClone(game));
  for (const [house, list] of Object.entries(game.drills || {})) {
    for (const drill of list) {
      if (Date.parse(drill.due_at) > nowMs) continue;
      const g = edit();
      g.drills[house] = g.drills[house].filter(item => item.id !== drill.id);
      const capital = map.capitals?.[house];
      if (!capital || g.state.territories[capital]?.owner !== house) continue;
      reconcileRanks(g.state, map);
      const comp = g.state.ranks?.[capital]?.[house] ? [...g.state.ranks[capital][house]] : compAt(g.state, map, capital, house);
      const risen = emptyComp();
      for (let rank = 3; rank >= 0; rank -= 1) {
        const n = Math.min(Number(drill.counts[rank] || 0), comp[rank]);
        comp[rank] -= n; comp[rank + 1] += n; risen[rank + 1] += n;
      }
      g.state.ranks ||= {};
      g.state.ranks[capital] ||= {};
      g.state.ranks[capital][house] = comp;
      g.state.journal.push({ kind: 'DRILL_DONE', house, houses: [house], counts: drill.counts, risen, risen_text: describeComp(risen), at: new Date(nowMs).toISOString() });
    }
  }
  for (const [id, land] of Object.entries(game.state.territories || {})) {
    if (!land.port_ready_at || Date.parse(land.port_ready_at) > nowMs) continue;
    const g = edit();
    const here = g.state.territories[id];
    delete here.port_ready_at;
    here.port = true;
    g.state.journal.push({ kind: 'PORT_BUILT', house: here.owner, builder: here.port_builder || here.owner, territory: id, houses: [here.owner].filter(Boolean), at: new Date(nowMs).toISOString() });
    delete here.port_builder;
  }
  for (const [house, yard] of Object.entries(game.yards || {})) {
    if (yard.announced || Date.parse(yard.ready_at) > nowMs) continue;
    const g = edit();
    g.yards[house].announced = true;
    g.state.journal.push({ kind: 'YARD_BUILT', house, houses: [house], at: new Date(nowMs).toISOString() });
  }
  const base = next || game;
  const probe = structuredClone(base.state);
  if (reconcileRanks(probe, map)) {
    edit().state = probe;
  }
  if (next) next.updated_at = new Date(nowMs).toISOString();
  return next || game;
}

export function ranksView(game, map, house, nowMs = Date.now()) {
  return {
    levy: levyView(game, map, house, nowMs),
    drill_free: drillableComp(game, map, house),
    drills: game.drills?.[house] || [],
    drill_places: (yardReady(game, house, nowMs) ? DRILL.placesWithYard : DRILL.places) - drillingCount(game, house),
    drill_top: yardReady(game, house, nowMs) ? DRILL.maxWithYard : DRILL.maxWithoutYard,
    drill_gold: DRILL.goldPerStep,
    drill_ms: drillTime(game),
    yard: yardOf(game, house),
    yard_gold: YARD.gold,
    yard_ms: yardTime(game)
  };
}

export { promote };
