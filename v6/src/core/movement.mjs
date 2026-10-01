import { buildAdjacency, edgeKey } from './map.mjs';
import { warriorsAt } from './state.mjs';

export function hasPassageRight(state, movingHouse, territoryOwner) {
  if (!territoryOwner || territoryOwner === movingHouse) return territoryOwner === movingHouse;
  return state.passage_rights.some(r => r.active !== false && r.from === movingHouse && r.through === territoryOwner);
}

function mayBeIntermediate(state, house, territoryId) {
  const owner = state.territories[territoryId]?.owner ?? null;
  return owner === house || hasPassageRight(state, house, owner);
}

export function findLegalLandPaths(state, map, house, from, to, maxSegments = 2) {
  if (from === to) return [];
  const adj = buildAdjacency(map.land_edges);
  if (!adj.has(from) || !adj.has(to)) return [];
  const paths = [];
  if (adj.get(from).has(to)) paths.push([from, to]);
  if (maxSegments >= 2) {
    for (const mid of adj.get(from)) {
      if (mid === to || !mayBeIntermediate(state, house, mid)) continue;
      if (adj.get(mid)?.has(to)) paths.push([from, mid, to]);
    }
  }
  return paths;
}

export function classifyDestination(state, house, to) {
  const owner = state.territories[to]?.owner ?? null;
  if (owner === house) return 'FRIENDLY';
  if (owner === null) return 'NEUTRAL';
  return 'ENEMY';
}

export function validateMarch(state, map, constants, move) {
  const { house, from, to, warriors, mode = 'LAND', path = null } = move;
  const errors = [];
  const ids = new Set(map.territories.map(t => t.id));
  if (!constants.houses.includes(house)) errors.push(`unknown house ${house}`);
  if (!ids.has(from)) errors.push(`unknown origin ${from}`);
  if (!ids.has(to)) errors.push(`unknown destination ${to}`);
  if (from === to) errors.push('origin and destination must differ');
  if (errors.length) return errors;

  if (state.territories[from].owner !== house) errors.push(`${house} does not control origin ${from}`);
  const available = warriorsAt(state, from, house);
  if (!Number.isInteger(warriors) || warriors < 1) errors.push('warriors must be a positive integer');
  if (warriors > available) errors.push(`requested ${warriors}, only ${available} available at ${from}`);

  const destinationClass = classifyDestination(state, house, to);
  if (destinationClass === 'FRIENDLY') {
    const destTotal = Object.values(state.territories[to].warriors || {}).reduce((a,b) => a + Number(b || 0), 0);
    if (destTotal + warriors > constants.territory_warrior_cap) errors.push(`destination ${to} would exceed warrior cap ${constants.territory_warrior_cap}`);
  }

  if (mode === 'SEA') {
    const ports = new Set(map.ports);
    const sea = new Set(map.sea_edges.map(([a,b]) => edgeKey(a,b)));
    if (!ports.has(from)) errors.push(`origin ${from} is not a port`);
    if (!ports.has(to)) errors.push(`destination ${to} is not a port`);
    if (!sea.has(edgeKey(from, to))) errors.push(`no direct sea route ${from}-${to}`);
    if (path && path.length !== 2) errors.push('sea March must contain exactly one sea segment');
  } else if (mode === 'LAND') {
    const legalPaths = findLegalLandPaths(state, map, house, from, to, constants.march.max_land_segments);
    if (!legalPaths.length) errors.push(`no legal land path from ${from} to ${to}`);
    if (path) {
      const same = legalPaths.some(p => p.length === path.length && p.every((x,i) => x === path[i]));
      if (!same) errors.push(`declared land path is not legal: ${path.join(' -> ')}`);
    }
  } else {
    errors.push(`unknown march mode ${mode}`);
  }
  return errors;
}

export function applyFriendlyMarch(state, map, constants, move) {
  const errors = validateMarch(state, map, constants, move);
  if (errors.length) throw new Error(errors.join('; '));
  if (classifyDestination(state, move.house, move.to) !== 'FRIENDLY') {
    throw new Error('applyFriendlyMarch only resolves movement into a friendly territory; neutral/enemy destinations require encounter resolution');
  }
  const next = structuredClone(state);
  next.territories[move.from].warriors[move.house] -= move.warriors;
  if (next.territories[move.from].warriors[move.house] === 0) delete next.territories[move.from].warriors[move.house];
  next.territories[move.to].warriors[move.house] = (next.territories[move.to].warriors[move.house] || 0) + move.warriors;
  next.journal.push({kind:'MARCH', ...move, destination:'FRIENDLY'});
  return next;
}
