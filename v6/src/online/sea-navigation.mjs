import { buildAdjacency } from '../core/map.mjs';
import { classifyDestination } from '../core/movement.mjs';
import { warriorsAt } from '../core/state.mjs';

function waypointIds(map) {
  return new Set(Object.keys(map.sea_waypoints || {}));
}

function territoryIds(map) {
  return new Set((map.territories || []).map(item => item.id));
}

function portIds(map) {
  return new Set(map.ports || []);
}

function sameIslandPair(map, a, b) {
  const ta = (map.territories || []).find(item => item.id === a);
  const tb = (map.territories || []).find(item => item.id === b);
  return Boolean(
    ta?.is_central_half &&
    tb?.is_central_half &&
    ta.island &&
    ta.island === tb.island
  );
}

export function buildSeaLaneAdjacency(map) {
  return buildAdjacency(map.sea_lane_edges || []);
}

export function listSeaLaneDestinations(map, from) {
  const ports = portIds(map);
  const territories = territoryIds(map);
  const waypoints = waypointIds(map);
  const adj = buildSeaLaneAdjacency(map);

  if (!ports.has(from) || !adj.has(from)) return [];

  const found = new Map();
  const queue = [[from, [from]]];
  const bestDepth = new Map([[from, 0]]);

  while (queue.length) {
    const [node, path] = queue.shift();
    const depth = path.length - 1;

    const neighbours = [...(adj.get(node) || [])].sort();
    for (const next of neighbours) {
      if (next === from || path.includes(next)) continue;
      const nextPath = [...path, next];

      if (ports.has(next)) {
        if (!sameIslandPair(map, from, next)) {
          const existing = found.get(next);
          if (
            !existing ||
            nextPath.length < existing.path.length ||
            (
              nextPath.length === existing.path.length &&
              nextPath.join('|') < existing.path.join('|')
            )
          ) {
            found.set(next, {
              to: next,
              path: nextPath,
              segments: nextPath.length - 1
            });
          }
        }
        continue;
      }

      // A territory is always a stop. Routes only traverse non-territory
      // sea waypoints between their origin and destination ports.
      if (territories.has(next)) continue;
      if (!waypoints.has(next)) continue;

      const nextDepth = depth + 1;
      const previousBest = bestDepth.get(next);
      if (previousBest != null && previousBest < nextDepth) continue;
      bestDepth.set(next, nextDepth);
      queue.push([next, nextPath]);
    }
  }

  return [...found.values()].sort((a, b) =>
    a.segments - b.segments ||
    String(a.to).localeCompare(String(b.to))
  );
}

export function findSeaLaneRoute(map, from, to) {
  return listSeaLaneDestinations(map, from)
    .find(item => item.to === to) || null;
}

export function validateOnlineSeaMarch(state, map, constants, move) {
  const errors = [];
  const ports = portIds(map);
  const ids = territoryIds(map);
  const { house, from, to, warriors } = move;

  if (!constants.houses.includes(house)) errors.push(`unknown house ${house}`);
  if (!ids.has(from)) errors.push(`unknown origin ${from}`);
  if (!ids.has(to)) errors.push(`unknown destination ${to}`);
  if (from === to) errors.push('origin and destination must differ');
  if (errors.length) return errors;

  if (state.territories[from].owner !== house) {
    errors.push(`${house} does not control origin ${from}`);
  }

  const available = warriorsAt(state, from, house);
  if (!Number.isInteger(warriors) || warriors < 1) {
    errors.push('warriors must be a positive integer');
  }
  if (warriors > available) {
    errors.push(`requested ${warriors}, only ${available} available at ${from}`);
  }

  if (!ports.has(from)) errors.push(`origin ${from} is not a sea-network port`);
  if (!ports.has(to)) errors.push(`destination ${to} is not a sea-network port`);

  const route = findSeaLaneRoute(map, from, to);
  if (!route) {
    errors.push(`no sea-lane route from ${from} to ${to}`);
  } else if (Array.isArray(move.path)) {
    const same =
      route.path.length === move.path.length &&
      route.path.every((id, index) => id === move.path[index]);
    if (!same) {
      errors.push(`declared sea path is not legal: ${move.path.join(' -> ')}`);
    }
  }

  if (sameIslandPair(map, from, to)) {
    errors.push('two halves of the same island are connected by land, not sea');
  }

  if (classifyDestination(state, house, to) === 'FRIENDLY') {
    const total = Object.values(state.territories[to].warriors || {})
      .reduce((sum, value) => sum + Number(value || 0), 0);
    if (total + Number(warriors || 0) > constants.territory_warrior_cap) {
      errors.push(
        `destination ${to} would exceed warrior cap ${constants.territory_warrior_cap}`
      );
    }
  }

  return errors;
}

export function enumerateOnlineSeaMarches(state, map, constants, house) {
  const ports = portIds(map);
  const actions = [];

  for (const [from, territory] of Object.entries(state.territories || {})) {
    if (territory.owner !== house || !ports.has(from)) continue;
    const count = warriorsAt(state, from, house);
    if (count < 1) continue;

    for (const route of listSeaLaneDestinations(map, from)) {
      for (let warriors = 1; warriors <= count; warriors += 1) {
        const action = {
          type: 'MARCH',
          mode: 'SEA',
          house,
          from,
          to: route.to,
          warriors,
          path: [...route.path],
          sea_segments: route.segments
        };
        if (!validateOnlineSeaMarch(state, map, constants, action).length) {
          actions.push(action);
        }
      }
    }
  }

  return actions;
}

export function seaRouteMap(map, action) {
  const route = findSeaLaneRoute(map, action.from, action.to);
  if (!route) throw new Error(`no sea-lane route from ${action.from} to ${action.to}`);

  return {
    ...map,
    sea_edges: [
      ...(map.sea_edges || []),
      [action.from, action.to]
    ]
  };
}

export function coreSeaAction(action) {
  const {
    path,
    sea_segments,
    ...core
  } = action;
  return core;
}
