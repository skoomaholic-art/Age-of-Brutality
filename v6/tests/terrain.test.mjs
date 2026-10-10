import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { generateMap, MAP_SHAPES } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { listQueueableMarches } from '../src/online/orders.mjs';
import { attritionDawn, attritionView, wearLoss } from '../src/online/attrition.mjs';
import { TERRAIN, roadSlow, terrainOf, wearAt } from '../src/online/terrain.mjs';
import { validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses, house_warrior_cap: 9999, territory_warrior_cap: 9999 };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const H = houses[0];
const capital = map.capitals[H];

function game() {
  const g = createOnlineGame(map, constants, { id: 'terrain', nowMs: 1, characterCatalog });
  g.rounds = { round_duration_ms: 600_000, number: 3 };
  return g;
}

test('every generated map has rough ground in the wild, never under a capital', () => {
  for (const shape of MAP_SHAPES) {
    for (const count of [2, 4, 6]) {
      const list = constants0.houses.slice(0, count);
      const m = generateMap(base, { ...constants0, houses: list }, { houses: list, seed: 30 + count, shape, seaMesh: true });
      const rough = Object.keys(m.terrain || {});
      assert.ok(rough.length > 0, `${shape}/${count}: no rough ground at all`);
      for (const kind of Object.values(m.terrain)) assert.ok(TERRAIN[kind], `unknown terrain ${kind}`);
      for (const capitalId of Object.values(m.capitals)) assert.equal(m.terrain[capitalId], undefined, 'a capital stands on plain ground');
      // A wall of rock closes a road but never cuts a land off from the world.
      const adjacency = buildAdjacency(m.land_edges);
      const seen = new Set([m.capitals[list[0]]]);
      const queue = [...seen];
      const bySea = buildAdjacency([...m.land_edges, ...m.sea_lane_edges]);
      while (queue.length) for (const next of bySea.get(queue.shift()) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      for (const t of m.territories) assert.ok(seen.has(t.id), `${shape}/${count}: ${t.id} is cut off`);
      for (const [a, b] of m.ridges || []) assert.ok(!adjacency.get(a)?.has(b), 'a ridge is no road');
    }
  }
});

test('a march through the mountains takes longer than one over the plain', () => {
  const rough = { ...map, terrain: { ...map.terrain } };
  const plain = { ...map, terrain: {} };
  const neighbour = [...buildAdjacency(map.land_edges).get(capital)][0];
  rough.terrain[neighbour] = 'горы';
  assert.ok(roadSlow(rough, capital, neighbour) > roadSlow(plain, capital, neighbour));
  const g = { ...game(), state: game().state };
  const slowRoute = listQueueableMarches({ ...g }, rough, constants, H).find(a => a.from === capital && a.to === neighbour);
  const fastRoute = listQueueableMarches({ ...g }, plain, constants, H).find(a => a.from === capital && a.to === neighbour);
  assert.ok(slowRoute.route_duration_ms > fastRoute.route_duration_ms, 'the mountain road is the slower one');
});

test('a host standing on rough ground melts away at dawn, weakest first, never to the last man', () => {
  const g = game();
  const neighbour = [...buildAdjacency(map.land_edges).get(capital)][0];
  const rough = { ...map, terrain: { ...map.terrain, [neighbour]: 'пустыня' } };
  g.state.territories[neighbour].owner = H;
  g.state.territories[neighbour].warriors = { [H]: 10 };
  g.state.ranks = { [neighbour]: { [H]: [4, 0, 0, 3, 0, 3] } };
  attritionDawn(g, rough, 1000);
  const left = Number(g.state.territories[neighbour].warriors[H]);
  assert.ok(left < 10 && left >= 8, `десять в пустыне стали ${left}`);
  assert.equal(g.state.ranks[neighbour][H][5], 3, 'the knights are the last to fall');
  assert.ok(g.state.journal.some(e => e.kind === 'ATTRITION' && e.why === 'в пустыне'));
  // The plain takes nobody.
  g.state.territories[capital].warriors = { [H]: 6 };
  attritionDawn(g, { ...map, terrain: {} }, 2000);
  assert.equal(g.state.territories[capital].warriors[H], 6);
  // A lone man is never taken by the road.
  assert.equal(wearLoss(1, 0.9, 0), 0);
  assert.deepEqual(validateState(g.state, map, constants), []);
});

test('the skull tells the host why it bleeds: rough ground, the open sea, a reef', () => {
  const g = game();
  const neighbour = [...buildAdjacency(map.land_edges).get(capital)][0];
  const rough = { ...map, terrain: { ...map.terrain, [neighbour]: 'болота' }, reefs: [] };
  g.state.territories[neighbour].owner = H;
  g.state.territories[neighbour].warriors = { [H]: 9 };
  const view = attritionView(g.state, rough);
  assert.equal(view[neighbour][H].why, 'в болотах');
  assert.ok(view[neighbour][H].men >= 1);
  assert.equal(terrainOf(rough, capital), 'равнина');
  assert.equal(attritionView(g.state, { ...map, terrain: {} })[neighbour], undefined);
  // At sea: the days out of sight of land, and the rocks underneath.
  const seaId = Object.keys(map.sea_waypoints)[0];
  g.state.sea_nodes[seaId].warriors = { [H]: 5 };
  g.state.sea_nodes[seaId].days_at_sea = { [H]: 2 };
  assert.equal(wearAt(map, g.state, seaId, H).why, 'в море');
  assert.equal(wearAt({ ...map, reefs: [seaId] }, g.state, seaId, H).why, 'на рифах');
});
