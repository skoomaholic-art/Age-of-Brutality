import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, validateMap, edgeKey } from '../src/core/map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));

test('provenance-locked map validates', () => {
  assert.deepEqual(validateMap(map), []);
  assert.equal(map.territories.length, 52);
  assert.equal(map.land_edges.length, 96);
  assert.equal(map.sea_edges.length, 20);
  assert.equal(map.ports.length, 16);
});

test('capitals are restored to Step 9 ids', () => {
  assert.deepEqual(map.capitals, {
    'Варкайр':'W01','Сайрвен':'W08','Ортайн':'W15',
    'Эркай':'E01','Тасвар':'E08','Айрель':'E15'
  });
});

test('west coast uses the symmetric 2-3-2 sea access pattern', () => {
  const edges = new Set(map.sea_edges.map(([a,b]) => edgeKey(a,b)));

  for (const [a,b] of [
    ['S01-A','W07'],
    ['S01-A','W14'],
    ['S03-A','W07'],
    ['S03-A','W14'],
    ['S03-A','W18'],
    ['S04-A','W14'],
    ['S04-A','W18'],
    ['S03-A','S01-B'],
    ['S03-A','S04-B']
  ]) {
    assert.ok(edges.has(edgeKey(a,b)), `missing corrected sea route ${a}-${b}`);
  }

  const land = new Set(map.land_edges.map(([a,b]) => edgeKey(a,b)));
  assert.ok(
    land.has(edgeKey('S03-A','S03-B')),
    'missing Короны A-Короны B land connection'
  );

  for (const [a,b] of [
    ['S01-A','W05'],
    ['S01-A','W12'],
    ['S04-A','W12'],
    ['S04-A','W19'],
    ['S03-A','W05'],
    ['S03-A','W12'],
    ['S03-A','W19']
  ]) {
    assert.equal(edges.has(edgeKey(a,b)), false, `stale route remains ${a}-${b}`);
  }

  assert.deepEqual(
    ['W07','W14','W18'].filter(id => map.ports.includes(id)),
    ['W07','W14','W18']
  );
  assert.equal(map.ports.includes('W05'), false);
  assert.equal(map.ports.includes('W12'), false);
  assert.equal(map.ports.includes('W19'), false);
});

test('every sea route has port endpoints and island halves are land-connected', () => {
  const ports = new Set(map.ports);
  for (const [a,b] of map.sea_edges) assert.ok(ports.has(a) && ports.has(b), `${a}-${b}`);
  const land = new Set(map.land_edges.map(([a,b]) => edgeKey(a,b)));
  for (const halves of Object.values(map.islands)) assert.ok(land.has(edgeKey(...halves)));
});


test('east coast mirrors the west 2-3-2 sea access pattern', () => {
  const edges = new Set(map.sea_edges.map(([a,b]) => edgeKey(a,b)));
  const expected = {
    'S02-B':['E05','E12'],
    'S03-B':['E05','E12','E19'],
    'S05-B':['E12','E19']
  };

  for (const [island, coast] of Object.entries(expected)) {
    for (const mainland of coast) {
      assert.ok(
        edges.has(edgeKey(island, mainland)),
        `missing mirrored sea route ${island}-${mainland}`
      );
    }
  }
});

test('each central island half pair shares land and never sea', () => {
  const land = new Set(map.land_edges.map(([a,b]) => edgeKey(a,b)));
  const sea = new Set(map.sea_edges.map(([a,b]) => edgeKey(a,b)));

  for (const [island, halves] of Object.entries(map.islands)) {
    assert.equal(halves.length, 2, island);
    assert.ok(land.has(edgeKey(...halves)), `${island} lacks land border`);
    assert.equal(sea.has(edgeKey(...halves)), false, `${island} halves must not use a sea edge`);
  }
});

test('branched sea-lane graph is connected and has no dead-end waypoint', () => {
  const waypointIds = new Set(Object.keys(map.sea_waypoints || {}));
  assert.equal(waypointIds.size, 10);
  assert.equal(map.sea_lane_edges.length, 32);

  const adj = new Map();
  const add = (a,b) => {
    if (!adj.has(a)) adj.set(a,new Set());
    adj.get(a).add(b);
  };
  for (const [a,b] of map.sea_lane_edges) {
    add(a,b);
    add(b,a);
  }

  for (const id of waypointIds) {
    assert.ok((adj.get(id)?.size || 0) >= 2, `${id} is a dead end`);
    assert.ok((adj.get(id)?.size || 0) <= 5, `${id} is over-connected`);
  }

  const start = map.sea_lane_edges[0][0];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    for (const next of adj.get(node) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  for (const [a,b] of map.sea_lane_edges) {
    assert.ok(seen.has(a) && seen.has(b), `disconnected lane edge ${a}-${b}`);
  }
});

test('sea-lane geometry avoids long map-spanning segments', () => {
  const allCoordinates = {
    ...map.coordinates,
    ...(map.sea_waypoints || {})
  };
  const distance = (a,b) => Math.hypot(
    Number(allCoordinates[a].x) - Number(allCoordinates[b].x),
    Number(allCoordinates[a].y) - Number(allCoordinates[b].y)
  );

  for (const [a,b] of map.sea_lane_edges) {
    assert.ok(
      distance(a,b) <= 140,
      `sea lane ${a}-${b} is too long: ${distance(a,b).toFixed(1)}`
    );
  }
});
