import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { listQueueableMarches } from '../src/online/orders.mjs';
import { processRanks } from '../src/online/levy.mjs';
import { buildBridge, seedCrossings, aiBridgeChoice } from '../src/online/bridges.mjs';
import { crossingKey } from '../src/online/route-planner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true });
const H = houses[0];

function freshGame() {
  const game = createOnlineGame(map, constants, { id: 'bridges', nowMs: 1, characterCatalog });
  game.rounds = { round_duration_ms: 600_000 };
  return game;
}

test('no road across a river without a bridge; a bridge built from one bank opens it for all', () => {
  let game = freshGame();
  const capital = map.capitals[H];
  const [a, b] = map.land_edges.find(edge => edge.includes(capital));
  const other = a === capital ? b : a;
  seedCrossings(game.state, map, [{ a, b, x: 0, y: 0 }]);
  const key = crossingKey(a, b);
  const reach = () => listQueueableMarches(game, map, constants, H).some(m => m.from === capital && m.to === other);
  assert.equal(reach(), false, 'the river bars the road');
  game.state.houses[H].gold = 10;
  assert.equal(aiBridgeChoice(game, H), key);
  game = buildBridge(game, map, H, key, { nowMs: 1000 });
  assert.equal(game.state.houses[H].gold, 7);
  assert.equal(reach(), false, 'not while it is being built');
  assert.throws(() => buildBridge(game, map, H, key, { nowMs: 1000 }), /строится/);
  game = processRanks(game, map, Date.parse(game.state.bridges[key].ready_at));
  assert.equal(game.state.bridges[key].built, true);
  assert.equal(reach(), true);
  assert.ok(game.state.journal.some(e => e.kind === 'BRIDGE_BUILT'));
});

test('a bridge is built only from one\'s own bank', () => {
  const game = freshGame();
  const [a, b] = map.land_edges.find(edge => !edge.some(id => game.state.territories[id]?.owner));
  seedCrossings(game.state, map, [{ a, b, x: 0, y: 0 }]);
  game.state.houses[H].gold = 10;
  assert.throws(() => buildBridge(game, map, H, crossingKey(a, b)), /своего берега/);
});

test('roads and rivers of a generated map meet at crossings; a walled-in capital gets a bridge', async t => {
  // The painter needs d3-contour, which the bare check run does not install.
  const art0 = await import('../src/online/map-art.mjs').catch(() => null);
  if (!art0) { t.skip('d3-contour is not installed'); return; }
  const { buildMapArt } = art0;
  const small = generateMap(base, { ...constants0, houses: houses.slice(0, 3) }, { houses: houses.slice(0, 3), seed: 77, shape: 'inland', seaMesh: true, homePorts: false });
  const art = buildMapArt(small, { bounds: small.art.bounds, step: 3, seed: small.seed, rivers: small.art.rivers });
  assert.ok(art.crossings.length > 0);
  for (const c of art.crossings) assert.ok(small.land_edges.some(([x, y]) => (x === c.a && y === c.b) || (x === c.b && y === c.a)));
  const capital = small.capitals[houses[0]];
  const roads = small.land_edges.filter(e => e.includes(capital)).map(([x, y]) => ({ a: x, b: y, x: 0, y: 0 }));
  const state = seedCrossings({}, small, roads);
  assert.equal(Object.values(state.bridges).filter(b => b.built).length, 1);
});
