// Rivers and bridges. Where a road meets a river there is no crossing until a
// bridge is built. A House builds one from its own bank (it must hold at least
// one end of the road); once standing, the bridge serves everyone.
//
// state.river_crossings  { "A|B": { a, b, x, y } }   found once, when the game is made
// state.bridges          { "A|B": { built, ready_at, builder } }
import { crossingKey } from './route-planner.mjs';

export const BRIDGE = Object.freeze({ gold: 3, dayShare: 1 / 4 });

function dayMs(game) {
  return Number(game.rounds?.round_duration_ms) > 0 ? Number(game.rounds.round_duration_ms) : 24 * 3600_000;
}

// Records the crossings of a new game. A capital whose every road crosses a
// river gets one bridge from the start, so no House begins walled in.
export function seedCrossings(state, map, crossings) {
  state.river_crossings = {};
  state.bridges = {};
  for (const c of crossings || []) state.river_crossings[crossingKey(c.a, c.b)] = { a: c.a, b: c.b, x: c.x, y: c.y };
  for (const capital of Object.values(map.capitals || {})) {
    const roads = (map.land_edges || []).filter(([a, b]) => a === capital || b === capital);
    if (!roads.length) continue;
    const keys = roads.map(([a, b]) => crossingKey(a, b));
    if (keys.every(key => state.river_crossings[key])) state.bridges[keys.sort()[0]] = { built: true, builder: null };
  }
  return state;
}

// Whose land the ford lies in. A road crosses the river at one point, and that
// point falls on one side of the border: the House that holds that land is the
// one that can throw a bridge over it.
export function crossingBank(map, crossing) {
  const a = map?.coordinates?.[crossing?.a];
  const b = map?.coordinates?.[crossing?.b];
  if (!a || !b || !Number.isFinite(crossing.x) || !Number.isFinite(crossing.y)) return null;
  const toA = Math.hypot(a.x - crossing.x, a.y - crossing.y);
  const toB = Math.hypot(b.x - crossing.x, b.y - crossing.y);
  return toA <= toB ? crossing.a : crossing.b;
}

export function buildBridge(game, map, house, key, { nowMs = Date.now() } = {}) {
  const crossing = game.state.river_crossings?.[key];
  if (!crossing) throw new Error('здесь нет реки');
  const bridge = game.state.bridges?.[key];
  if (bridge?.built) throw new Error('мост уже стоит');
  if (bridge?.ready_at) throw new Error('мост уже строится');
  const bank = crossingBank(map, crossing);
  if (bank) {
    if (game.state.territories?.[bank]?.owner !== house) {
      const name = map.territories?.find(t => t.id === bank)?.name || bank;
      throw new Error(`брод лежит в земле ${name}: мост ставит тот, кто ею владеет`);
    }
  } else {
    const ownA = game.state.territories?.[crossing.a]?.owner === house;
    const ownB = game.state.territories?.[crossing.b]?.owner === house;
    if (!ownA && !ownB) throw new Error('мост строят со своего берега: нужна земля на одном из концов дороги');
  }
  if (Number(game.state.houses[house].gold || 0) < BRIDGE.gold) throw new Error(`нужно ${BRIDGE.gold} золота`);
  const next = structuredClone(game);
  next.state.houses[house].gold -= BRIDGE.gold;
  next.state.bridges ||= {};
  next.state.bridges[key] = {
    built: false,
    builder: house,
    ready_at: new Date(nowMs + Math.round(dayMs(next) * BRIDGE.dayShare)).toISOString()
  };
  next.state.journal.push({ kind: 'BRIDGE_STARTED', house, houses: [house], a: crossing.a, b: crossing.b, at: new Date(nowMs).toISOString() });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// A House burns a bridge from its own bank: no one crosses there until it is
// built again. Useful against an enemy, or to hold up the Horde at the river.
export function burnBridge(game, map, house, key, { nowMs = Date.now() } = {}) {
  const crossing = game.state.river_crossings?.[key];
  if (!crossing) throw new Error('здесь нет реки');
  const bridge = game.state.bridges?.[key];
  if (!bridge?.built && !bridge?.ready_at) throw new Error('моста здесь нет');
  const ownA = game.state.territories?.[crossing.a]?.owner === house;
  const ownB = game.state.territories?.[crossing.b]?.owner === house;
  if (!ownA && !ownB) throw new Error('жечь мост можно только со своего берега');
  const next = structuredClone(game);
  delete next.state.bridges[key];
  const owners = [crossing.a, crossing.b].map(id => next.state.territories?.[id]?.owner).filter(Boolean);
  next.state.journal.push({ kind: 'BRIDGE_BURNT', house, houses: [...new Set([house, ...owners])], a: crossing.a, b: crossing.b, at: new Date(nowMs).toISOString() });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// The clock: bridges under construction are finished. Returns the same game when nothing changed.
export function processBridges(game, nowMs = Date.now()) {
  let next = null;
  for (const [key, bridge] of Object.entries(game.state?.bridges || {})) {
    if (bridge.built || !bridge.ready_at || Date.parse(bridge.ready_at) > nowMs) continue;
    next ||= structuredClone(game);
    const here = next.state.bridges[key];
    here.built = true;
    delete here.ready_at;
    const crossing = next.state.river_crossings?.[key] || {};
    const owners = [crossing.a, crossing.b].map(id => next.state.territories?.[id]?.owner).filter(Boolean);
    next.state.journal.push({
      kind: 'BRIDGE_BUILT', house: here.builder, houses: [...new Set([here.builder, ...owners].filter(Boolean))],
      a: crossing.a, b: crossing.b, at: new Date(nowMs).toISOString()
    });
  }
  if (next) next.updated_at = new Date(nowMs).toISOString();
  return next || game;
}

export function nextBridgeDueAt(game) {
  return Object.values(game.state?.bridges || {}).filter(b => !b.built && b.ready_at).map(b => b.ready_at).sort()[0] || null;
}

// For the AI: a crossing worth bridging from its own bank, if it can pay.
export function aiBridgeChoice(game, house, map = null) {
  const gold = Number(game.state.houses?.[house]?.gold || 0);
  if (gold < BRIDGE.gold + 3) return null;
  for (const [key, crossing] of Object.entries(game.state.river_crossings || {}).sort()) {
    const bridge = game.state.bridges?.[key];
    if (bridge?.built || bridge?.ready_at) continue;
    const bank = map ? crossingBank(map, crossing) : null;
    if (bank) {
      if (game.state.territories?.[bank]?.owner === house) return key;
      continue;
    }
    const a = game.state.territories?.[crossing.a]?.owner;
    const b = game.state.territories?.[crossing.b]?.owner;
    if (a === house || b === house) return key;
  }
  return null;
}
