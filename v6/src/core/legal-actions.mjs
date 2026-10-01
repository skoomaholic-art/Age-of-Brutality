import { buildAdjacency } from './map.mjs';
import { warriorsAt } from './state.mjs';
import { validateMarch } from './movement.mjs';

export function enumerateMarches(state, map, constants, house) {
  const landAdj = buildAdjacency(map.land_edges);
  const seaAdj = buildAdjacency(map.sea_edges);
  const ports = new Set(map.ports);
  const actions = [];

  for (const [from, terr] of Object.entries(state.territories)) {
    if (terr.owner !== house) continue;
    const count = warriorsAt(state, from, house);
    if (count < 1) continue;

    const candidateLand = new Set(landAdj.get(from) || []);
    for (const mid of landAdj.get(from) || []) {
      const owner = state.territories[mid]?.owner ?? null;
      const pass = owner === house || state.passage_rights.some(r => r.active !== false && r.from === house && r.through === owner);
      if (!pass) continue;
      for (const to of landAdj.get(mid) || []) if (to !== from) candidateLand.add(to);
    }

    for (const to of candidateLand) {
      for (let warriors = 1; warriors <= count; warriors++) {
        const action = {type:'MARCH', mode:'LAND', house, from, to, warriors};
        if (validateMarch(state, map, constants, action).length === 0) actions.push(action);
      }
    }

    if (ports.has(from)) {
      for (const to of seaAdj.get(from) || []) {
        for (let warriors = 1; warriors <= count; warriors++) {
          const action = {type:'MARCH', mode:'SEA', house, from, to, warriors};
          if (validateMarch(state, map, constants, action).length === 0) actions.push(action);
        }
      }
    }
  }
  return actions;
}

export function assertLegalAction(action, legalActions) {
  const key = a => JSON.stringify([a.type,a.mode,a.house,a.from,a.to,a.warriors]);
  const allowed = new Set(legalActions.map(key));
  if (!allowed.has(key(action))) throw new Error('action was not emitted by LEGAL_ACTIONS');
  return true;
}
