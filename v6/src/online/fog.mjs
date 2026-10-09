// Fog of war for games played in days.
//
// A House starts knowing only its capital and the lands that border it; the
// rest of the world lies under clouds. It sees into its own lands, the lands
// next to them and the sea around its ports and fleets. Every land it has once
// seen stays on its map (explored), but armies show only where it sees now.
// Lands never seen are not sent at all: neither their owner nor their armies.

function addNeighbours(seen, edges, own) {
  for (const [a, b] of edges || []) {
    if (own.has(a)) seen.add(b);
    if (own.has(b)) seen.add(a);
  }
}

// Every territory and sea waypoint the House can see into.
export function visiblePositions(state, map, house) {
  const own = new Set();
  for (const [id, territory] of Object.entries(state.territories || {})) {
    if (territory.owner === house) own.add(id);
  }
  for (const [id, node] of Object.entries(state.sea_nodes || {})) {
    if (Number(node.warriors?.[house] || 0) > 0) own.add(id);
  }
  // A spy in place sees the land he watches and what lies around it.
  for (const id of Object.keys(state.spy_sight?.[house] || {})) own.add(id);
  // Where our warriors camp as guests, they see as far as at home.
  for (const [id, byHouse] of Object.entries(state.guests || {})) {
    if (Number(byHouse?.[house] || 0) > 0) own.add(id);
  }

  const seen = new Set(own);
  addNeighbours(seen, map.land_edges, own);
  if (!map.buildable_ports) {
    addNeighbours(seen, map.sea_lane_edges, own);
    return seen;
  }
  // Where ports are built, the open water shows only from a port or a fleet.
  const lookouts = new Set([...own].filter(id =>
    map.sea_waypoints?.[id] || state.territories?.[id]?.port || (map.starting_ports || []).includes(id)));
  addNeighbours(seen, map.sea_lane_edges, lookouts);
  return seen;
}

// Everything the House has ever seen: what it sees now and what it remembers.
export function exploredPositions(game, map, house) {
  const seen = visiblePositions(game.state, map, house);
  for (const id of game.exploration?.[house] || []) seen.add(id);
  return seen;
}

// Remembers for every House the lands it sees at this moment. Returns the same
// game when nobody discovered anything new.
export function recordExploration(game, map, houses, nowMs = Date.now()) {
  if (game.rounds?.mode !== 'days') return game;
  let next = null;
  for (const house of houses) {
    const known = new Set(game.exploration?.[house] || []);
    const fresh = [...visiblePositions(game.state, map, house)].filter(id => !known.has(id));
    if (!fresh.length) continue;
    next ||= structuredClone(game);
    next.exploration ||= {};
    next.exploration[house] = [...known, ...fresh].sort();
  }

  // Houses meet when one sees a land or a fleet of the other. The meeting is
  // mutual: from then on each exists for the other.
  const source = next || game;
  const met = [];
  for (const house of houses) {
    for (const id of visiblePositions(source.state, map, house)) {
      const owner = source.state.territories?.[id]?.owner ?? source.state.sea_nodes?.[id]?.owner ?? null;
      if (!owner || owner === house || !houses.includes(owner)) continue;
      if (!(source.contacts?.[house] || []).includes(owner)) met.push([house, owner]);
    }
  }
  if (met.length) {
    next ||= structuredClone(game);
    next.contacts ||= {};
    for (const [a, b] of met) {
      for (const [x, y] of [[a, b], [b, a]]) {
        const list = new Set(next.contacts[x] || []);
        list.add(y);
        next.contacts[x] = [...list].sort();
      }
    }
  }
  if (next) next.updated_at = new Date(nowMs).toISOString();
  return next || game;
}

// Remembers who held every land before its present master.
export function recordLandHistory(game, nowMs = Date.now()) {
  let next = null;
  for (const [id, territory] of Object.entries(game.state?.territories || {})) {
    const owner = territory.owner ?? null;
    const known = game.land_history?.[id];
    if (known ? known.now === owner : owner === null) continue;
    next ||= structuredClone(game);
    next.land_history ||= {};
    const entry = next.land_history[id] || { now: null, past: [] };
    if (entry.now) entry.past = [...entry.past, entry.now].slice(-6);
    entry.now = owner;
    next.land_history[id] = entry;
  }
  if (next) next.updated_at = new Date(nowMs).toISOString();
  return next || game;
}

// The Houses this one has met. Without fog everyone knows everyone.
export function knownHouses(game, house, houses) {
  if (game.rounds?.mode !== 'days' || game.lifecycle?.status !== 'RUNNING') {
    return houses.filter(other => other !== house);
  }
  return [...(game.contacts?.[house] || [])];
}

// What other Houses do in private: their marches, levies and building.
const PRIVATE_EVENTS = new Set([
  'LEVY_RAISED', 'DRILL_DONE', 'YARD_BUILT', 'RIDER_SENT', 'SEA_TOLL', 'BRIDGE_STARTED', 'WILD_BATTLE', 'UNITS_HIRED', 'UNITS_RETRAINED', 'GROWTH_BUILT', 'HEART_SPIED',
  'MARCH_QUEUED',
  'MARCH',
  'ROUTE_MARCH',
  'MARCH_FAILED',
  'RECRUIT_QUEUED',
  'RECRUIT_COMPLETE',
  'RECRUIT_FAILED',
  'FORT_QUEUED',
  'FORT_COMPLETE',
  'FORT_FAILED',
  'RECRUIT_CANCELLED',
  'FORT_CANCELLED',
  'COMMANDER_RECOVERED',
  'SPY_ARRIVED',
  'SPY_RETURNED',
  'GUEST_MARCH',
  'ROUND_ACTION_REFUNDED'
]);

// Removes from a game snapshot (already cloned for one client) everything the
// House cannot see. Mutates and returns `clientGame`.
export function applyFog(clientGame, map, house) {
  const state = clientGame.state;
  const seen = visiblePositions(state, map, house);
  const explored = exploredPositions(clientGame, map, house);

  for (const [id, territory] of Object.entries(state.territories || {})) {
    if (seen.has(id)) continue;
    territory.warriors = {};
    if (explored.has(id)) continue;
    // Under the clouds: the House does not know whose land this is.
    territory.owner = null;
    territory.fort = false;
  }
  for (const [id, node] of Object.entries(state.sea_nodes || {})) {
    if (seen.has(id)) continue;
    node.warriors = {};
    node.owner = null;
  }
  for (const id of Object.keys(state.guests || {})) {
    if (!seen.has(id)) delete state.guests[id];
  }
  // Which Heart is true is a secret, save what this House's spies learnt.
  if (state.heart) {
    const known = state.heart.known?.[house] || {};
    state.heart.known = { [house]: known };
    if (!state.heart.territory) delete state.heart.truth;
  }
  // The wild guard of lands never seen is not known.
  for (const id of Object.keys(state.wild_guards || {})) {
    if (!explored.has(id) && !seen.has(id)) delete state.wild_guards[id];
  }

  // Characters and armies of other Houses are known only where they can be seen.
  for (const [id, character] of Object.entries(state.characters || {})) {
    if (character.house === house) continue;
    // A prisoner in our hands is ours to see.
    if (character.captivity?.held_by === house) continue;
    if (character.location && seen.has(character.location)) continue;
    delete state.characters[id];
  }
  for (const [id, army] of Object.entries(state.armies || {})) {
    if (army.house === house) continue;
    if (army.territory && seen.has(army.territory)) continue;
    delete state.armies[id];
  }

  clientGame.orders = (clientGame.orders || []).filter(order => {
    if (order.action?.house === house) return true;
    // A foreign army on the march shows only while its road touches what we see.
    return order.status === 'PENDING' &&
      (seen.has(order.action?.from) || seen.has(order.action?.to));
  });

  // News of Houses not yet met does not reach this one.
  const known = new Set([house, ...(clientGame.contacts?.[house] || [])]);
  const named = item => [
    ...(item.details?.houses || []),
    item.details?.attacker, item.details?.defender, item.details?.house
  ].filter(Boolean);
  clientGame.audit_log = (clientGame.audit_log || []).filter(item => {
    if (PRIVATE_EVENTS.has(item.type)) return item.details?.house === house;
    const names = named(item);
    return !names.length || names.some(name => known.has(name));
  });
  delete clientGame.contacts;

  delete clientGame.exploration;
  delete clientGame.agents;
  if (state.spy_sight) state.spy_sight = { [house]: state.spy_sight[house] || {} };
  // The past of lands never seen is unknown too.
  for (const id of Object.keys(clientGame.land_history || {})) {
    if (!explored.has(id)) delete clientGame.land_history[id];
  }
  clientGame.visibility = {
    fog: true,
    visible: [...seen].sort(),
    explored: [...explored].sort()
  };
  return clientGame;
}
