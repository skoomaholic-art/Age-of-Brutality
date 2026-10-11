import { buildAdjacency } from '../core/map.mjs';
import { classifyDestination } from '../core/movement.mjs';
import { warriorsAt } from '../core/state.mjs';

export function isSeaWaypoint(map, id) {
  return Boolean(map.sea_waypoints?.[id]);
}

function territoryIds(map) {
  return new Set((map.territories || []).map(item => item.id));
}

function portIds(map) {
  return new Set(map.ports || []);
}

export function normalizeOnlineSeaState(state, map) {
  const next = structuredClone(state);
  next.sea_nodes ||= {};

  const allowed = new Set(Object.keys(map.sea_waypoints || {}));
  for (const id of allowed) {
    const current = next.sea_nodes[id] || {};
    const warriors = {};

    for (const [house, count] of Object.entries(current.warriors || {})) {
      const n = Number(count || 0);
      if (Number.isInteger(n) && n > 0) warriors[house] = n;
    }

    const positiveHouses = Object.keys(warriors);
    next.sea_nodes[id] = {
      owner: positiveHouses.length === 1
        ? positiveHouses[0]
        : null,
      warriors
    };
  }

  for (const id of Object.keys(next.sea_nodes)) {
    if (!allowed.has(id)) delete next.sea_nodes[id];
  }

  return next;
}

export function onlineWarriorsAt(state, id, house) {
  if (state.territories?.[id]) return warriorsAt(state, id, house);
  return Number(state.sea_nodes?.[id]?.warriors?.[house] || 0);
}

export function onlineNodeOwner(state, id) {
  if (state.territories?.[id]) return state.territories[id].owner ?? null;
  return state.sea_nodes?.[id]?.owner ?? null;
}

export function buildSeaLaneAdjacency(map) {
  return buildAdjacency(map.sea_lane_edges || []);
}

export function listSeaLaneDestinations(map, from) {
  const ports = portIds(map);
  const waypoints = new Set(Object.keys(map.sea_waypoints || {}));
  const adj = buildSeaLaneAdjacency(map);

  const originAllowed = ports.has(from) || waypoints.has(from);
  if (!originAllowed || !adj.has(from)) return [];

  return [...(adj.get(from) || [])]
    .filter(to => ports.has(to) || waypoints.has(to))
    .sort()
    .map(to => ({
      to,
      path:[from, to],
      segments:1,
      destination_kind: waypoints.has(to) ? 'SEA_WAYPOINT' : 'PORT'
    }));
}

export function findSeaLaneRoute(map, from, to) {
  return listSeaLaneDestinations(map, from)
    .find(item => item.to === to) || null;
}

export function validateOnlineSeaMarch(state, map, constants, move) {
  const errors = [];
  const ports = portIds(map);
  const waypoints = new Set(Object.keys(map.sea_waypoints || {}));
  const ids = territoryIds(map);
  const { house, from, to, warriors } = move;

  if (!constants.houses.includes(house)) errors.push(`unknown house ${house}`);
  if (!ids.has(from) && !waypoints.has(from)) errors.push(`unknown origin ${from}`);
  if (!ids.has(to) && !waypoints.has(to)) errors.push(`unknown destination ${to}`);
  if (from === to) errors.push('origin and destination must differ');
  if (errors.length) return errors;

  if (ids.has(from) && !ports.has(from)) {
    errors.push(`origin ${from} is not a sea-network port`);
  }

  const originOwner = onlineNodeOwner(state, from);
  if (originOwner !== house) {
    errors.push(`${house} does not control sea origin ${from}`);
  }

  const available = onlineWarriorsAt(state, from, house);
  if (!Number.isInteger(warriors) || warriors < 1) {
    errors.push('warriors must be a positive integer');
  }
  if (warriors > available) {
    errors.push(`requested ${warriors}, only ${available} available at ${from}`);
  }

  const route = findSeaLaneRoute(map, from, to);
  if (!route) {
    errors.push(`no adjacent sea-lane segment from ${from} to ${to}`);
  } else if (Array.isArray(move.path)) {
    const same =
      route.path.length === move.path.length &&
      route.path.every((id, index) => id === move.path[index]);
    if (!same) {
      errors.push(`declared sea path is not legal: ${move.path.join(' -> ')}`);
    }
  }

  if (waypoints.has(to)) {
    const target = state.sea_nodes?.[to] || {owner:null, warriors:{}};
    if (target.owner && target.owner !== house) {
      errors.push(
        `sea waypoint ${to} is occupied by ${target.owner}; sea combat is not implemented`
      );
    }

    const total = Object.values(target.warriors || {})
      .reduce((sum, value) => sum + Number(value || 0), 0);
    if (total + Number(warriors || 0) > constants.territory_warrior_cap) {
      errors.push(
        `sea waypoint ${to} would exceed warrior cap ${constants.territory_warrior_cap}`
      );
    }
  } else {
    const destinationClass = classifyDestination(state, house, to);
    if (destinationClass === 'FRIENDLY') {
      const total = Object.values(state.territories[to].warriors || {})
        .reduce((sum, value) => sum + Number(value || 0), 0);
      if (total + Number(warriors || 0) > constants.territory_warrior_cap) {
        errors.push(
          `destination ${to} would exceed warrior cap ${constants.territory_warrior_cap}`
        );
      }
    }
  }

  return errors;
}

export function enumerateOnlineSeaMarches(state, map, constants, house) {
  const ports = portIds(map);
  const waypoints = new Set(Object.keys(map.sea_waypoints || {}));
  const origins = [];

  for (const [id, territory] of Object.entries(state.territories || {})) {
    if (
      territory.owner === house &&
      ports.has(id) &&
      onlineWarriorsAt(state, id, house) > 0
    ) {
      origins.push(id);
    }
  }

  for (const id of waypoints) {
    if (
      state.sea_nodes?.[id]?.owner === house &&
      onlineWarriorsAt(state, id, house) > 0
    ) {
      origins.push(id);
    }
  }

  const actions = [];
  for (const from of origins) {
    const count = onlineWarriorsAt(state, from, house);
    for (const route of listSeaLaneDestinations(map, from)) {
      for (let warriors = 1; warriors <= count; warriors += 1) {
        const action = {
          type:'MARCH',
          mode:'SEA',
          house,
          from,
          to:route.to,
          warriors,
          path:[...route.path],
          sea_segments:1,
          destination_kind:route.destination_kind
        };

        if (!validateOnlineSeaMarch(state, map, constants, action).length) {
          actions.push(action);
        }
      }
    }
  }

  return actions;
}

function removeWarriors(next, from, house, warriors) {
  const source = next.territories?.[from] || next.sea_nodes?.[from];
  if (!source) throw new Error(`unknown sea origin ${from}`);

  source.warriors[house] = Number(source.warriors?.[house] || 0) - warriors;
  if (source.warriors[house] <= 0) delete source.warriors[house];

  if (next.sea_nodes?.[from]) {
    const remaining = Object.keys(source.warriors || {})
      .filter(key => Number(source.warriors[key] || 0) > 0);
    source.owner = remaining.length === 1 ? remaining[0] : null;
  }
}

export function resolveSeaWaypointMove(state, map, constants, action) {
  const errors = validateOnlineSeaMarch(state, map, constants, action);
  if (errors.length) throw new Error(errors.join('; '));
  if (!isSeaWaypoint(map, action.to)) {
    throw new Error('resolveSeaWaypointMove requires sea waypoint destination');
  }

  const next = structuredClone(state);
  removeWarriors(next, action.from, action.house, action.warriors);

  const target = next.sea_nodes[action.to];
  target.owner = action.house;
  target.warriors[action.house] =
    Number(target.warriors[action.house] || 0) + action.warriors;

  next.journal.push({
    kind:'SEA_WAYPOINT_MARCH',
    house:action.house,
    from:action.from,
    to:action.to,
    warriors:action.warriors,
    path:[...(action.path || [action.from, action.to])]
  });

  return next;
}

export function createSeaLandingBridge(state, map, action) {
  if (!isSeaWaypoint(map, action.from) || !state.territories?.[action.to]) {
    return null;
  }

  const bridgedState = structuredClone(state);
  const bridgedMap = structuredClone({ ...map });
  const warriors = onlineWarriorsAt(state, action.from, action.house);

  bridgedState.territories[action.from] = {
    owner:action.house,
    warriors:{[action.house]:warriors},
    fort:false
  };

  bridgedMap.territories.push({
    id:action.from,
    name:action.from,
    house_sector:'Море',
    type:'Половина острова',
    gold_income:0,
    is_central_half:false,
    island:null,
    island_bonus:null,
    icon:''
  });

  if (!bridgedMap.ports.includes(action.from)) {
    bridgedMap.ports.push(action.from);
  }
  bridgedMap.sea_edges = [
    ...(bridgedMap.sea_edges || []),
    [action.from, action.to]
  ];

  return {state:bridgedState, map:bridgedMap};
}

export function finishSeaLandingBridge(originalState, bridgedState, action) {
  const next = structuredClone(bridgedState);
  const synthetic = next.territories[action.from];
  const remaining = Number(synthetic?.warriors?.[action.house] || 0);

  delete next.territories[action.from];
  next.sea_nodes ||= {};
  next.sea_nodes[action.from] ||= {owner:null, warriors:{}};
  next.sea_nodes[action.from].warriors = remaining > 0
    ? {[action.house]:remaining}
    : {};
  next.sea_nodes[action.from].owner = remaining > 0
    ? action.house
    : null;

  return next;
}

export function seaRouteMap(map, action) {
  return {
    ...map,
    sea_edges:[
      ...(map.sea_edges || []),
      [action.from, action.to]
    ]
  };
}

export function coreSeaAction(action) {
  const {
    path,
    sea_segments,
    destination_kind,
    ...core
  } = action;
  return core;
}
