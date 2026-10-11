// What becomes of a host and its lord when the ground is pulled from under them.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { rescueStrandedCommanders } from '../src/online/fate.mjs';
import { applySeaToll } from '../src/online/sea-toll.mjs';
import { peopleAt, populationDawn, seedPopulation } from '../src/online/units.mjs';
import { compAt } from '../src/online/ranks.mjs';
import { validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const adjacency = buildAdjacency(map.land_edges);
const HOUSE = 'Варкайр';
const RIVAL = 'Сайрвен';
const CAPITAL = map.capitals[HOUSE];
const T0 = 1_000_000;

function game() {
  const g = createOnlineGame(map, constants, { id: 'mishap', nowMs: T0, characterCatalog });
  g.lifecycle.status = 'RUNNING';
  g.rounds = { round_duration_ms: 600_000, number: 2, mode: 'rounds' };
  return g;
}

test('a march whose home falls on the way is given up, and nobody walks a road that has no host behind it', () => {
  let g = game();
  const near = [...adjacency.get(CAPITAL)].find(id => map.territories.find(t => t.id === id).type !== 'Столица');
  g.state.territories[CAPITAL].warriors[HOUSE] = 6;
  g.state.territories[near].owner = HOUSE;
  g.state.territories[near].warriors = { [HOUSE]: 1 };
  const far = [...adjacency.get(near)].find(id => id !== CAPITAL);
  g = executeCommand(g, map, constants, { type: 'MARCH', house: HOUSE, from: CAPITAL, to: near, warriors: 4 }, { nowMs: T0 }).game;
  const order = g.orders.at(-1);
  assert.equal(order.status, 'PENDING');
  // The capital changes hands before the host arrives: its men went with it.
  g.state.territories[CAPITAL].owner = RIVAL;
  g.state.territories[CAPITAL].warriors = { [RIVAL]: 3 };
  g = processDueOrders(g, map, constants, Date.parse(order.due_at));
  const after = g.orders.find(item => item.id === order.id);
  assert.equal(after.status, 'FAILED');
  assert.ok(g.state.journal.some(e => e.kind === 'MARCH_LOST'), 'the chronicle says the march was given up');
  assert.equal(g.state.territories[near].warriors[HOUSE], 1, 'nobody arrived out of nowhere');
  assert.deepEqual(validateState(g.state, map, constants), [], void far);
});

test('a host that lost men at home marches on with those it has, the strongest first', () => {
  let g = game();
  const near = [...adjacency.get(CAPITAL)].find(id => map.territories.find(t => t.id === id).type !== 'Столица');
  g.state.territories[CAPITAL].warriors[HOUSE] = 6;
  g.state.ranks = { [CAPITAL]: { [HOUSE]: [3, 0, 0, 2, 0, 1] } };
  g.state.territories[near].owner = HOUSE;
  g.state.territories[near].warriors = { [HOUSE]: 1 };
  g = executeCommand(g, map, constants, { type: 'MARCH', house: HOUSE, from: CAPITAL, to: near, warriors: 5 }, { nowMs: T0 }).game;
  const order = g.orders.at(-1);
  // Only two men are left at home by the time the march is due.
  g.state.territories[CAPITAL].warriors[HOUSE] = 2;
  g = processDueOrders(g, map, constants, Date.parse(order.due_at));
  const after = g.orders.find(item => item.id === order.id);
  assert.ok(g.state.journal.some(e => e.kind === 'MARCH_THINNED'), 'the chronicle says the host thinned');
  assert.equal(after.status, 'RESOLVED');
  assert.equal(g.state.territories[near].warriors[HOUSE], 3, 'one stood there, two came');
  assert.deepEqual(validateState(g.state, map, constants), []);
});

test('the sea takes men by kind, weakest first, and the books of the fleet follow', () => {
  const g = game();
  const seaId = Object.keys(map.sea_waypoints || {})[0] || Object.keys(g.state.sea_nodes || {})[0];
  g.state.sea_nodes[seaId] = { owner: HOUSE, warriors: { [HOUSE]: 10 }, days_at_sea: { [HOUSE]: 3 } };
  g.state.ranks = { [seaId]: { [HOUSE]: [5, 0, 0, 5, 0, 0] } };
  const losses = applySeaToll(g.state, T0, map);
  assert.equal(losses.length, 1);
  const left = Number(g.state.sea_nodes[seaId].warriors[HOUSE]);
  assert.ok(left < 10 && left > 0);
  const comp = compAt(g.state, map, seaId, HOUSE);
  assert.equal(comp[3], 5, 'the men-at-arms are kept');
  assert.equal(comp.reduce((sum, n) => sum + n, 0), left, 'the books agree with the heads');
  const entry = g.state.journal.find(e => e.kind === 'SEA_TOLL');
  assert.equal(entry.days, 4, 'the chronicle counts the dawns at sea');
});

test('a lord whose fleet is gone comes ashore, or goes down with it when no shore is his', () => {
  const g = game();
  const seaId = Object.keys(map.sea_waypoints || {})[0] || Object.keys(g.state.sea_nodes || {})[0];
  g.state.sea_nodes[seaId] = { owner: null, warriors: {} };
  const lord = Object.values(g.state.characters).find(c => c.house === HOUSE && c.alive);
  g.state.armies = { 'A-1': { id: 'A-1', house: HOUSE, commander_id: lord.id, territory: seaId, moving_order_id: null } };
  lord.mode = 'ARMY';
  lord.army_id = 'A-1';
  lord.location = { kind: 'SEA_WAYPOINT', waypoint: seaId };
  const ashore = rescueStrandedCommanders(g, map, T0);
  assert.equal(ashore.state.armies['A-1'].territory, CAPITAL, 'the nearest land of his own House');
  assert.ok(ashore.state.journal.some(e => e.kind === 'COMMANDER_ASHORE'));
  // A House with no land at all: the sea keeps him.
  const lost = structuredClone(g);
  for (const land of Object.values(lost.state.territories)) if (land.owner === HOUSE) { land.owner = RIVAL; land.warriors = {}; }
  const drowned = rescueStrandedCommanders(lost, map, T0);
  assert.equal(drowned.state.characters[lord.id].alive, false);
  assert.ok(drowned.state.journal.some(e => e.kind === 'COMMANDER_DROWNED'));
  assert.equal(drowned.state.armies['A-1'], undefined);
});

test('a broken count of people is read as none and mended at dawn', () => {
  const g = game();
  seedPopulation(g, map);
  g.state.population[CAPITAL] = Number('сколько-то');
  g.state.population.X0 = -4;
  assert.equal(peopleAt(g.state, CAPITAL), 0);
  assert.equal(peopleAt(g.state, 'X0'), 0);
  assert.equal(peopleAt(g.state, 'нет такой земли'), 0);
  populationDawn(g.state, map);
  assert.equal(g.state.population[CAPITAL], 0, 'a NaN never spreads further');
  assert.equal(g.state.population.X0, 0);
  assert.ok(Number.isInteger(g.state.population[CAPITAL]));
});
