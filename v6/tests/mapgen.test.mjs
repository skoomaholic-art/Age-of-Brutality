import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { DRY_SHAPES, generateMap, mapPlan, MAP_SHAPES, MAP_SIZE_KEYS, MAP_WARPS, pickMapShape, recommendedSize } from '../src/online/mapgen.mjs';
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

for (const shape of MAP_SHAPES) for (const count of [2, 4, 6]) CASES.push([count, shape, MAP_WARPS[(count + shape.length) % MAP_WARPS.length], true]);

for (const [count, shape, warp, seaMesh] of CASES) {
  test(`a map for ${count} Houses (${shape}, ${warp}${seaMesh ? ', open sea' : ''}) is fair and whole`, () => {
    const houses = constants.houses.slice(0, count);
    const map = generateMap(base, constants, { houses, seed: 100 + count, shape, warp, seaMesh: Boolean(seaMesh) });
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

test('the size of the world is chosen apart from the number of Houses', () => {
  const houses = constants.houses.slice(0, 4);
  const made = {};
  for (const size of MAP_SIZE_KEYS) {
    const map = generateMap(base, constants, { houses, seed: 77, shape: 'wheel', size });
    assert.equal(map.size, size);
    assert.equal(map.territories.length, mapPlan(4, 'wheel', size).lands);
    const b = map.art.bounds;
    made[size] = { span: b.x1 - b.x0, lands: map.territories.length };
    // Every House still has its own seven lands, whatever the size.
    for (const house of houses) {
      assert.equal(map.territories.filter(t => t.house_sector === house).length, 7);
    }
  }
  assert.ok(made.small.span < made.medium.span, 'малая теснее средней');
  assert.ok(made.medium.span < made.large.span, 'большая просторнее средней');
  assert.ok(made.large.span < made.huge.span, 'огромная просторнее большой');
  assert.ok(made.huge.lands >= made.small.lands, 'на просторе земель не меньше');
  // An unknown size is simply the middling one.
  assert.equal(generateMap(base, constants, { houses, seed: 77, shape: 'wheel', size: 'гигантская' }).size, 'medium');
  assert.equal(recommendedSize(2), 'small');
  assert.equal(recommendedSize(6), 'huge');
});

test('a world is made in a season of the creator’s choosing; snows lie north and sands south in either', () => {
  const houses = constants.houses.slice(0, 4);
  const winter = generateMap(base, constants, { houses, seed: 55, shape: 'wheel', season: 'winter' });
  const summer = generateMap(base, constants, { houses, seed: 55, shape: 'wheel', season: 'summer' });
  assert.equal(winter.season, 'зима');
  assert.equal(summer.season, 'лето');
  // The season a world is born in only says which weather it opens with: the
  // year turns while it is played, so the ground itself is laid out the same.
  assert.deepEqual(winter.terrain, summer.terrain);
  // Over many worlds both snows and sands turn up, each at its own end of the map.
  let snows = 0;
  let sands = 0;
  for (let seed = 1; seed <= 25; seed += 1) {
    const world = generateMap(base, constants, { houses, seed, shape: 'wheel' });
    const span = world.art.bounds.y1 - world.art.bounds.y0;
    for (const [id, kind] of Object.entries(world.terrain)) {
      if (kind === 'снега') { snows += 1; assert.ok(world.coordinates[id].y < span * 0.55, `${id} lies in the north`); }
      if (kind === 'пустыня') { sands += 1; assert.ok(world.coordinates[id].y > span * 0.45, `${id} lies in the south`); }
    }
  }
  assert.ok(snows > 0 && sands > 0, 'both snows and sands are laid somewhere');
  // Left to chance, both seasons come up over many seeds.
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed += 1) seen.add(generateMap(base, constants, { houses, seed, shape: 'wheel' }).season);
  assert.deepEqual([...seen].sort(), ['зима', 'лето']);
});


test('the lot falls on dry land as often as on water', () => {
  for (const count of [2, 4, 6]) {
    let dry = 0;
    const rolls = 600;
    for (let seed = 1; seed <= rolls; seed += 1) {
      const { shape, warp } = pickMapShape(count, seed);
      assert.ok(MAP_SHAPES.includes(shape));
      assert.ok(MAP_WARPS.includes(warp));
      if (DRY_SHAPES.includes(shape)) dry += 1;
    }
    const share = dry / rolls;
    assert.ok(share > 0.4 && share < 0.6, `${count} houses: dry land came up ${(share * 100).toFixed(0)}% of the time`);
  }
});

test('the middle of the world is a country of its own, not a line between realms', () => {
  for (const shape of ['wheel', 'mainland', 'peninsulas']) {
    for (const count of [4, 6]) {
      const houses = constants.houses.slice(0, count);
      const world = generateMap(base, { ...constants, houses }, { houses, seed: 9 + count, shape });
      const free = world.territories.filter(t => !houses.includes(t.house_sector));
      assert.ok(free.length >= count * 3,
        `${shape}/${count}: ${free.length} free lands between the realms, wanted at least ${count * 3}`);
      // And something stands on it: the free city and the inner ring are settled.
      const settled = free.filter(t => t.type !== 'Дикая земля').length;
      assert.ok(settled >= 2, `${shape}/${count}: the middle holds ${settled} settled lands`);
      // Every free land can be walked to from somewhere.
      const degree = {};
      for (const [a, b] of world.land_edges) { degree[a] = (degree[a] || 0) + 1; degree[b] = (degree[b] || 0) + 1; }
      for (const t of free) assert.ok(degree[t.id] > 0 || (world.ports || []).includes(t.id), `${t.id} can be reached`);
    }
  }
});

test('the picture is cut to the lands: the world fills its own frame', () => {
  for (const shape of MAP_SHAPES) {
    for (const count of [2, 4, 6]) {
      const houses = constants.houses.slice(0, count);
      const world = generateMap(base, { ...constants, houses }, { houses, seed: 4 + count, shape, seaMesh: true });
      const b = world.art.bounds;
      const points = Object.values(world.coordinates);
      const near = 30; // half a land: what the painter draws around a settlement
      const wide = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) + near * 2;
      const tall = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) + near * 2;
      const share = (wide * tall) / ((b.x1 - b.x0) * (b.y1 - b.y0));
      // And the frame itself has the shape of the window it is shown in.
      assert.ok(Math.abs((b.x1 - b.x0) / (b.y1 - b.y0) - 760 / 490) < 0.02, `${shape}/${count}: the frame is the shape of the map window`);
      assert.ok(share > 0.7, `${shape}/${count}: the lands take ${(share * 100).toFixed(0)}% of the frame`);
      // And no sea mark lies outside the picture.
      for (const [id, point] of Object.entries(world.sea_waypoints || {})) {
        assert.ok(point.x >= b.x0 && point.x <= b.x1 && point.y >= b.y0 && point.y <= b.y1, `${id} is inside the frame`);
      }
    }
  }
});

test('realms touch: a House has neighbours on its borders, not only across the middle of the world', () => {
  for (const shape of ['wheel', 'mainland']) {
    for (const count of [3, 4, 6]) {
      const houses = constants.houses.slice(0, count);
      const world = generateMap(base, { ...constants, houses }, { houses, seed: 17 + count, shape });
      const near = {};
      for (const [a, b] of world.land_edges) { (near[a] ||= []).push(b); (near[b] ||= []).push(a); }
      const steps = (from, to) => {
        const seen = new Map([[from, 0]]);
        const queue = [from];
        while (queue.length) {
          const at = queue.shift();
          if (at === to) return seen.get(at);
          for (const next of near[at] || []) if (!seen.has(next)) { seen.set(next, seen.get(at) + 1); queue.push(next); }
        }
        return Infinity;
      };
      const caps = Object.entries(world.capitals);
      const profiles = caps.map(([house, id]) =>
        caps.filter(([other]) => other !== house).map(([, other]) => steps(id, other)).sort((a, b) => a - b).join(','));
      // The same road profile for everyone: nobody is born cornered.
      assert.equal(new Set(profiles).size, 1, `${shape}/${count}: ${[...new Set(profiles)].join(' | ')}`);
      // And the nearest neighbour is nearer than the far side of the world.
      const sorted = profiles[0].split(',').map(Number);
      assert.ok(sorted[0] <= 4, `${shape}/${count}: the nearest neighbour is ${sorted[0]} roads away`);
      if (count > 3) assert.ok(sorted[sorted.length - 1] > sorted[0], `${shape}/${count}: all neighbours are equally far`);
      // Nobody is reached only through the free city: there are roads round it.
      const hub = 'X0';
      if (world.territories.some(t => t.id === hub)) {
        const without = {};
        for (const [a, b] of world.land_edges) {
          if (a === hub || b === hub) continue;
          (without[a] ||= []).push(b); (without[b] ||= []).push(a);
        }
        const reach = (from, to) => {
          const seen = new Set([from]);
          const queue = [from];
          while (queue.length) {
            const at = queue.shift();
            if (at === to) return true;
            for (const next of without[at] || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
          }
          return false;
        };
        for (let i = 1; i < caps.length; i += 1) {
          assert.ok(reach(caps[0][1], caps[i][1]), `${shape}/${count}: ${caps[i][0]} is reached only through the free city`);
        }
      }
    }
  }
});
