import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { hireUnits, planRetrain, applyRetrain, buildGrowth, populationDawn, populationOnCapture, seedPopulation, kindsRaisedIn, PEOPLE, NO_LIMIT } from '../src/online/units.mjs';
import { compAt, starsAt, setStars } from '../src/online/ranks.mjs';
import { validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses, house_warrior_cap: NO_LIMIT, territory_warrior_cap: NO_LIMIT };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const H = houses[0];
const capital = map.capitals[H];
const village = map.territories.find(t => t.type === 'Деревня').id;

function game() {
  const g = seedPopulation(createOnlineGame(map, constants, { id: 'units', nowMs: 1, characterCatalog }), map);
  g.state.houses[H].gold = 200;
  g.state.territories[village].owner = H;
  return g;
}

test('a village raises light troops, the capital all of them; every man hired is one of the land\'s people', () => {
  assert.deepEqual(kindsRaisedIn(map, village), [0, 1, 2]);
  assert.deepEqual(kindsRaisedIn(map, capital), [0, 1, 2, 3, 4, 5]);
  let g = game();
  assert.throws(() => hireUnits(g, map, H, village, [0, 0, 0, 1]), /не набираются/);
  g = hireUnits(g, map, H, capital, [5, 0, 0, 0, 0, 2]);
  assert.equal(g.state.houses[H].gold, 200 - 5 - 20);
  assert.equal(g.state.population[capital], PEOPLE.start['Столица'] - 7);
  assert.equal(compAt(g.state, map, capital, H)[5], 2);
  assert.throws(() => hireUnits(g, map, H, village, [99, 0, 0]), /людей под рукой/);
  assert.deepEqual(validateState(g.state, map, constants), []);
});

test('a land short of people is filled out from the neighbours, each giving half at most', () => {
  let g = game();
  const neighbours = (map.land_edges || [])
    .filter(e => e[0] === village || e[1] === village)
    .map(e => (e[0] === village ? e[1] : e[0]))
    .filter(id => g.state.territories[id].owner === H);
  assert.ok(neighbours.length, 'the village has a neighbour of the same House');
  const here = g.state.population[village];
  const share = Math.floor(g.state.population[neighbours[0]] / 2);
  g = hireUnits(g, map, H, village, [here + 1, 0, 0]);
  assert.equal(g.state.population[village], 0, 'the land gave all it had');
  assert.equal(g.state.population[neighbours[0]], g.state.population[neighbours[0]], 'the rest came from the neighbours');
  const taken = neighbours.reduce((sum, id) => sum + Math.max(0, PEOPLE.start[map.territories.find(t => t.id === id).type] - g.state.population[id]), 0);
  assert.equal(taken, 1, 'only the one man missing was brought in');
  assert.ok(share >= 1);
  assert.deepEqual(validateState(g.state, map, constants), []);
});

test('there is no cap on troops: gold and people are the limit', () => {
  let g = game();
  g = hireUnits(g, map, H, capital, [25, 0, 0, 0, 0, 0]);
  assert.ok(g.state.territories[capital].warriors[H] > 25);
  assert.deepEqual(validateState(g.state, map, constants), []);
});

test('retraining pays the difference; new men dilute the experience of a host', () => {
  let g = game();
  g = hireUnits(g, map, H, capital, [4, 0, 0, 0, 0, 0]);
  const heads = g.state.territories[capital].warriors[H];
  setStars(g.state, capital, H, 3);
  // The lesson is ordered first and learned later; here both at once.
  const plan = planRetrain(g, map, H, capital, 0, 3, 2);
  assert.equal(plan.gold, 8);
  g.state.houses[H].gold -= plan.gold;
  g = applyRetrain(structuredClone(g), map, H, capital, plan.from, plan.to, plan.count, 1000);
  assert.equal(compAt(g.state, map, capital, H)[3], 2);
  assert.equal(g.state.houses[H].gold, 200 - 4 - 8);
  g = hireUnits(g, map, H, capital, [heads, 0, 0, 0, 0, 0]);
  assert.equal(starsAt(g.state, capital, H), 2, 'half the host is fresh: 3 stars become 1.5, rounded to 2');
});

test('people grow only with fields or a fair, and a taken land loses some', () => {
  let g = game();
  const before = g.state.population[village];
  populationDawn(g.state, map);
  assert.equal(g.state.population[village], before, 'no fields, no growth');
  g = buildGrowth(g, map, H, village);
  populationDawn(g.state, map);
  assert.equal(g.state.population[village], before + 1);
  populationOnCapture(g.state, village, houses[1]);
  assert.ok(g.state.population[village] < before + 1);
  assert.equal(g.state.growth[village], undefined, 'the fields are trampled');
});

test('a host that lost men can be made good to full strength, dearer the more seasoned it is', async () => {
  const { replenishQuote, replenishUnits } = await import('../src/online/units.mjs');
  let g = game();
  g = hireUnits(g, map, H, capital, [6, 0, 0, 0, 0, 0]);
  const full = g.state.territories[capital].warriors[H];
  // A battle: three men fall.
  g.state.territories[capital].warriors[H] = full - 3;
  setStars(g.state, capital, H, 2);
  const quote = replenishQuote(g.state, map, H, capital);
  assert.equal(quote.men, 3);
  assert.equal(quote.health, Math.round(((full - 3) / full) * 100));
  assert.equal(quote.gold, Math.ceil(3 * 1 * 2), 'two stars: twice the price');
  g = replenishUnits(g, map, H, capital);
  assert.equal(g.state.territories[capital].warriors[H], full);
  assert.equal(starsAt(g.state, capital, H), 2, 'the experience stays');
  assert.throws(() => replenishUnits(g, map, H, capital), /полной силе/);
});
