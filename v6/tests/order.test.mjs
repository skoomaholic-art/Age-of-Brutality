import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { seedPopulation, onLandTaken, NO_LIMIT } from '../src/online/units.mjs';
import { seedOrder, orderDawn, applyCaptureChoice, choiceOutcomes, garrisonToHold, revoltRisk, ORDER } from '../src/online/order.mjs';
import { seedHeart } from '../src/online/heart.mjs';
import { validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses, house_warrior_cap: NO_LIMIT, territory_warrior_cap: NO_LIMIT };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const [H, R] = houses;
const village = map.territories.find(t => t.type === 'Деревня').id;

function game() {
  const g = createOnlineGame(map, constants, { id: 'order', nowMs: 1, characterCatalog });
  seedHeart(g, map); seedPopulation(g, map); seedOrder(g, map);
  g.rounds = { ai_houses: [R] };
  return g;
}

function take(g, house, from) {
  g.state.territories[village].owner = house;
  g.state.territories[village].warriors = { [house]: 1 };
  delete g.state.wild_guards[village];
  onLandTaken(g, map, village, from, 10);
}

test('a land taken from the wild is calm, one taken from a House sullen; the taker chooses its fate', () => {
  let g = game();
  take(g, H, null);
  assert.equal(g.state.order[village], ORDER.fromWild);
  assert.ok(g.state.capture_choices[village], 'a player is asked');
  g = game();
  take(g, H, R);
  assert.equal(g.state.order[village], ORDER.fromHouse);
  g = game();
  take(g, R, H);
  assert.equal(g.state.capture_choices[village], undefined, 'the AI decides at once');
  // Its choice is its own, but never one that would leave the land ready to rise.
  const choice = g.state.journal.find(e => e.kind === 'CAPTURE_CHOICE');
  assert.ok(choice, 'the AI wrote its decision in the chronicle');
  assert.notEqual(revoltRisk(g.state.order[village], g.state.population[village], 0), 'HIGH');
});

test('mercy calms, sacking pays and brings the land to the edge of revolt', () => {
  const g = game();
  take(g, H, R);
  const people = g.state.population[village];
  const outcomes = choiceOutcomes(g.state, village);
  assert.ok(outcomes.SACK.gold > outcomes.TRIBUTE.gold && outcomes.TRIBUTE.gold > outcomes.MERCY.gold);
  assert.ok(outcomes.MERCY.order_after > outcomes.SACK.order_after);
  const gold = g.state.houses[H].gold;
  applyCaptureChoice(g.state, village, H, 'SACK', { nowMs: 20 });
  assert.equal(g.state.houses[H].gold, gold + outcomes.SACK.gold);
  assert.equal(g.state.population[village], people - outcomes.SACK.people_lost);
  assert.equal(g.state.order[village], 0);
  assert.equal(g.state.capture_choices[village], undefined);
});

test('a land in deep disorder with many people and a thin garrison rises at dawn', () => {
  const g = game();
  take(g, H, R);
  applyCaptureChoice(g.state, village, H, 'SACK', { nowMs: 20 });
  g.state.population[village] = 10;
  assert.equal(revoltRisk(g.state.order[village], 10, 1), 'HIGH');
  const risen = orderDawn(g.state, map, constants, 30);
  assert.deepEqual(risen, [village]);
  assert.equal(g.state.territories[village].owner, null);
  assert.ok(g.state.wild_guards[village] > 0, 'the rebels hold it');
  assert.ok(g.state.journal.some(e => e.kind === 'REVOLT'));
  assert.deepEqual(validateState(g.state, map, constants), []);
});

test('a big enough garrison holds a land in disorder, and order settles day by day', () => {
  const g = game();
  take(g, H, R);
  applyCaptureChoice(g.state, village, H, 'SACK', { nowMs: 20 });
  g.state.population[village] = 10;
  g.state.territories[village].warriors[H] = 6;
  assert.deepEqual(orderDawn(g.state, map, constants, 30), []);
  assert.equal(g.state.order[village], ORDER.drift + ORDER.garrisonDrift);
  const choice = game();
  take(choice, H, null);
  orderDawn(choice.state, map, constants, 40);
  assert.equal(choice.state.capture_choices[village], undefined, 'an open choice falls to mercy');
  assert.ok(choice.state.journal.some(e => e.kind === 'CAPTURE_CHOICE' && e.choice === 'MERCY'));
});

test('a land taken by force and left all but empty rises at the next dawn; a third of its people as garrison holds it', () => {
  // Tribute from a conquered land and a single man in its streets: the people rise.
  const thin = game();
  take(thin, H, R);
  applyCaptureChoice(thin.state, village, H, 'TRIBUTE', { nowMs: 20 });
  thin.state.territories[village].warriors = { [H]: 1 };
  const people = thin.state.population[village];
  assert.equal(revoltRisk(thin.state.order[village], people, 1), 'HIGH');
  assert.deepEqual(orderDawn(thin.state, map, constants, 100), [village], 'the land is lost to the wild folk');
  assert.equal(thin.state.territories[village].owner, null);

  // The same land with a third of its people under arms stays, and settles.
  const held = game();
  take(held, H, R);
  applyCaptureChoice(held.state, village, H, 'TRIBUTE', { nowMs: 20 });
  const need = garrisonToHold(held.state.population[village]);
  held.state.territories[village].warriors = { [H]: need };
  const before = held.state.order[village];
  assert.deepEqual(orderDawn(held.state, map, constants, 100), []);
  assert.equal(held.state.territories[village].owner, H);
  assert.ok(held.state.order[village] > before, 'a garrison settles the streets day by day');
});
