import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { generateMap, mapPlan, MAP_SHAPES, MAP_WARPS } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { validateState } from '../src/core/state.mjs';
import { listQueueableMarches } from '../src/online/orders.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));

function distances(map, from) {
  const adjacency = buildAdjacency(map.land_edges);
  const seen = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    for (const next of adjacency.get(at) || []) {
      if (seen.has(next)) continue;
      seen.set(next, seen.get(at) + 1);
      queue.push(next);
    }
  }
  return seen;
}

const CASES = [];
for (let count = 2; count <= 6; count += 1) CASES.push([count, 'wheel', 'none']);
MAP_SHAPES.forEach((shape, i) => [3, 4, 6].forEach((count, j) => CASES.push([count, shape, MAP_WARPS[(i + j) % MAP_WARPS.length]])));
CASES.push([2, 'archipelago', 'stretch'], [2, 'inland', 'crescent']);
for (const shape of MAP_SHAPES) for (const count of [2, 3, 5]) for (const warp of ['spiral', 'hourglass', 'ripple', 'zigzag', 'shear', 'teardrop']) if ((count + warp.length + shape.length) % 4 === 0) CASES.push([count, shape, warp]);
for (const shape of MAP_SHAPES) CASES.push([2, shape, 'none'], [5, shape, 'none']);

for (const [count, shape, warp] of CASES) {
  test(`a map for ${count} Houses (${shape}, ${warp}) is fair and whole`, () => {
    const houses = constants.houses.slice(0, count);
    const map = generateMap(base, constants, { houses, seed: 100 + count, shape, warp });
    const ids = new Set(map.territories.map(t => t.id));
    assert.equal(ids.size, map.territories.length, 'ids are unique');
    assert.equal(map.territories.length, mapPlan(count, map.shape).lands);
    assert.equal(new Set(map.territories.map(t => t.name)).size, map.territories.length, 'names are unique');

    for (const [a, b] of map.land_edges) assert.ok(ids.has(a) && ids.has(b));
    for (const [a, b] of map.sea_lane_edges) {
      assert.ok(ids.has(a) || map.sea_waypoints[a], a);
      assert.ok(ids.has(b) || map.sea_waypoints[b], b);
    }

    // Every House has the same home and the same road to its neighbours.
    const adjacency = buildAdjacency(map.land_edges);
    const type = id => map.territories.find(t => t.id === id).type;
    const profiles = houses.map(house => {
      const capital = map.capitals[house];
      const around = [...adjacency.get(capital)].map(type).sort().join(',');
      const home = map.territories.filter(t => t.house_sector === house).map(t => t.type).sort().join(',');
      const reach = distances(map, capital);
      const toRivals = houses.filter(h => h !== house).map(h => reach.get(map.capitals[h])).sort().join(',');
      const ports = map.territories.filter(t => t.house_sector === house && map.ports.includes(t.id)).length;
      const degree = [...reach.values()].filter(d => d <= 2).length;
      return JSON.stringify({ around, home, toRivals, ports, degree, hub: reach.get('X0') });
    });
    assert.equal(new Set(profiles).size, 1, 'all Houses start alike: ' + profiles.join(' | '));
    assert.match(profiles[0], /"around":"Город,Деревня,Деревня,Деревня,Дикая земля,Дикая земля"/);

    // Every land can be reached from every home, by land or by sea.
    const both = { land_edges: [...map.land_edges, ...map.sea_lane_edges] };
    const reach = distances(both, map.capitals[houses[0]]);
    for (const t of map.territories) assert.ok(reach.has(t.id), `${t.id} is reachable`);
    if (map.shape === 'wheel') {
      const byLand = distances(map, map.capitals[houses[0]]);
      for (const t of map.territories) if (t.type !== 'Половина острова') assert.ok(byLand.has(t.id), `${t.id} is reachable by land`);
    }

    // Lands do not sit on top of each other.
    const points = Object.values(map.coordinates);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        assert.ok(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) > 28);
      }
    }

    // The rules run on it.
    const scoped = { ...constants, houses };
    const game = createOnlineGame(map, scoped, { id: `gen-${count}`, nowMs: 1, characterCatalog });
    assert.deepEqual(validateState(game.state, map, scoped), []);
    assert.deepEqual(Object.keys(game.state.houses), houses);
    assert.ok(listQueueableMarches(game, map, scoped, houses[0]).length > 0);
  });
}

test('the same seed gives the same map, another seed another one', () => {
  const houses = constants.houses.slice(0, 4);
  const a = generateMap(base, constants, { houses, seed: 7 });
  const b = generateMap(base, constants, { houses, seed: 7 });
  const c = generateMap(base, constants, { houses, seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.coordinates, c.coordinates);
});

test('maps grow with the number of Houses', () => {
  const sizes = [2, 3, 4, 5, 6].map(count => mapPlan(count).lands);
  for (let i = 1; i < sizes.length; i += 1) assert.ok(sizes[i] > sizes[i - 1], sizes.join(','));
});
