import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { listQueueableMarches, setViaRoute } from '../src/online/orders.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { buildPort, processRanks } from '../src/online/levy.mjs';
import { visiblePositions } from '../src/online/fog.mjs';

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
  const game = createOnlineGame(map, constants, { id: 'ports', nowMs: 1, characterCatalog });
  game.rounds = { round_duration_ms: 600_000 };
  return game;
}

test('a fleet sets out only from a port; a port can be built on a shore', () => {
  let game = freshGame();
  const coast = map.ports.find(id => id.startsWith('A') && !map.starting_ports.includes(id));
  assert.ok(coast, 'a home shore without a harbour');
  game.state.territories[coast].owner = H;
  game.state.territories[coast].warriors = { [H]: 2 };
  const toSea = () => listQueueableMarches(game, map, constants, H).some(a => a.from === coast && map.sea_waypoints[a.to]);
  assert.equal(toSea(), false, 'no port, no sailing');
  assert.equal([...visiblePositions(game.state, map, H)].some(id => map.sea_waypoints[id] && map.sea_lane_edges.some(e => e.includes(coast) && e.includes(id))), false);
  game.state.houses[H].gold = 10;
  game = buildPort(game, map, H, coast, { nowMs: 1000 });
  game = processRanks(game, map, Date.parse(game.state.territories[coast].port_ready_at));
  assert.equal(game.state.territories[coast].port, true);
  assert.equal(toSea(), true, 'the new port opens the sea');
  const start = map.starting_ports.find(id => id.startsWith('A'));
  assert.ok(listQueueableMarches(game, map, constants, H).some(a => a.from === start && map.sea_waypoints[a.to]) || game.state.territories[start].warriors?.[H] === undefined);
});

test('an army can go by the points the player picks', () => {
  let game = freshGame();
  const capital = map.capitals[H];
  const marches = listQueueableMarches(game, map, constants, H).filter(a => a.from === capital && a.mode === 'LAND' && a.path.length === 2);
  assert.ok(marches.length >= 2);
  const a = marches[0];
  const b = marches.find(m => m.to !== a.to);
  game.state.territories[b.to].owner = H;
  game = executeCommand(game, map, constants, { type: 'MARCH', house: H, from: capital, to: a.to, warriors: 1 }, { nowMs: 5 }).game;
  const order = game.orders[0];
  const plain = order.duration_ms;
  setViaRoute(game, map, constants, order, [b.to], 5);
  assert.ok(order.duration_ms > plain, 'the way round is longer');
  assert.deepEqual(order.travel_segments.map(s => s.to).slice(0, 1), [b.to]);
});
