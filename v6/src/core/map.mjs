import fs from 'node:fs';

export function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

export function edgeKey(a, b) {
  return [a, b].sort().join('::');
}

export function buildAdjacency(edges) {
  const out = new Map();
  const add = (a, b) => {
    if (!out.has(a)) out.set(a, new Set());
    out.get(a).add(b);
  };
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }
  return out;
}

export function validateMap(map) {
  const errors = [];
  const ids = map.territories.map(t => t.id);
  const idSet = new Set(ids);
  const ports = new Set(map.ports);
  const capitalIds = Object.values(map.capitals);

  if (ids.length !== 52) errors.push(`expected 52 territories, got ${ids.length}`);
  if (idSet.size !== ids.length) errors.push('territory ids must be unique');
  if (map.land_edges.length !== 96) errors.push(`expected 96 land edges from V5.4.3 geometry, got ${map.land_edges.length}`);
  if (map.sea_edges.length !== 20) errors.push(`expected 20 sea edges from V5.4.3 geometry, got ${map.sea_edges.length}`);
  if (ports.size !== 16) errors.push(`expected 16 ports, got ${ports.size}`);
  if (new Set(capitalIds).size !== 6) errors.push('six capitals must be unique');

  for (const p of ports) if (!idSet.has(p)) errors.push(`unknown port ${p}`);
  for (const [kind, edges] of [['land', map.land_edges], ['sea', map.sea_edges]]) {
    const seen = new Set();
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        errors.push(`${kind} edge must have two endpoints: ${JSON.stringify(edge)}`);
        continue;
      }
      const [a, b] = edge;
      if (!idSet.has(a) || !idSet.has(b)) errors.push(`${kind} edge has unknown endpoint ${a}-${b}`);
      if (a === b) errors.push(`${kind} self-edge ${a}`);
      const k = edgeKey(a, b);
      if (seen.has(k)) errors.push(`duplicate ${kind} edge ${k}`);
      seen.add(k);
      if (kind === 'sea' && (!ports.has(a) || !ports.has(b))) errors.push(`sea edge endpoint is not a port: ${a}-${b}`);
    }
  }

  for (const [house, id] of Object.entries(map.capitals)) {
    const t = map.territories.find(x => x.id === id);
    if (!t) errors.push(`capital ${house} points to missing territory ${id}`);
    else {
      if (t.type !== 'Столица') errors.push(`${house} capital ${id} is ${t.type}`);
      if (t.house_sector !== house) errors.push(`${house} capital ${id} belongs to ${t.house_sector}`);
    }
  }

  const land = new Set(map.land_edges.map(([a,b]) => edgeKey(a,b)));
  for (const [island, halves] of Object.entries(map.islands)) {
    if (halves.length !== 2) errors.push(`${island} must have two halves`);
    else if (!land.has(edgeKey(halves[0], halves[1]))) errors.push(`${island} halves must share a land edge`);
  }

  return errors;
}
