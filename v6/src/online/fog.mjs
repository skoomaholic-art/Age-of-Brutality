// Fog of war for games played in days: a House sees its own lands, the lands
// next to them and the sea around its ports and fleets. Who owns a land is
// common knowledge, as on a political map; where armies stand is not.

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
    if (node.owner === house) own.add(id);
  }

  const seen = new Set(own);
  addNeighbours(seen, map.land_edges, own);
  addNeighbours(seen, map.sea_lane_edges, own);
  return seen;
}

// What other Houses do in private: their marches, levies and building.
const PRIVATE_EVENTS = new Set([
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
  'ROUND_ACTION_REFUNDED'
]);

// Removes from a game snapshot (already cloned for one client) everything the
// House cannot see. Mutates and returns `clientGame`.
export function applyFog(clientGame, map, house) {
  const state = clientGame.state;
  const seen = visiblePositions(state, map, house);

  for (const [id, territory] of Object.entries(state.territories || {})) {
    if (seen.has(id)) continue;
    territory.warriors = {};
  }
  for (const [id, node] of Object.entries(state.sea_nodes || {})) {
    if (seen.has(id)) continue;
    node.warriors = {};
    node.owner = null;
  }

  // Characters and armies of other Houses are known only where they can be seen.
  for (const [id, character] of Object.entries(state.characters || {})) {
    if (character.house === house) continue;
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

  clientGame.audit_log = (clientGame.audit_log || []).filter(item => {
    if (!PRIVATE_EVENTS.has(item.type)) return true;
    return item.details?.house === house;
  });

  clientGame.visibility = { fog: true, visible: [...seen].sort() };
  return clientGame;
}
