import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { seedWild, wildDawn, WILD } from '../src/online/wild.mjs';
import { seedPopulation, aiHireChoice } from '../src/online/units.mjs';
import { seedOrder, aiCaptureChoice, ORDER } from '../src/online/order.mjs';
import { RANKS } from '../src/online/ranks.mjs';
import { chooseGoal, housePlan, garrisonToKeep } from '../src/online/ai-goals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses, house_warrior_cap: 9999, territory_warrior_cap: 9999 };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const adjacency = buildAdjacency(map.land_edges);
const H = houses[0];
const capital = map.capitals[H];

function game() {
  const g = createOnlineGame(map, constants, { id: 'ai-goals', nowMs: 1, characterCatalog });
  g.rounds = { round_duration_ms: 800_000, number: 3 };
  seedWild(g, map); seedPopulation(g, map); seedOrder(g, map);
  wildDawn(g, map, constants, 10, 2);
  return g;
}

test('a House goes for the deepest free land it can reach, and turns on a neighbour when none is left', () => {
  const g = game();
  const goal = chooseGoal(g, map, H);
  assert.equal(goal.kind, 'EXPAND');
  assert.ok(g.state.wild_guards[goal.target] !== undefined, 'a free land held by the wild guard');
  assert.equal(g.state.territories[goal.target].owner, null);
  // The deeper the ring, the more the chroniclers make of it.
  const rings = g.state.wild.rings;
  const reachable = Object.keys(g.state.wild_guards)
    .filter(id => [...(adjacency.get(id) || [])].some(n => g.state.territories[n].owner === H));
  const best = Math.max(...reachable.map(id => rings[id] || 1));
  assert.equal(rings[goal.target], best);

  // Nothing free left within reach: it looks at its neighbours instead.
  for (const id of Object.keys(g.state.wild_guards)) {
    g.state.territories[id].owner = houses[1];
    delete g.state.wild_guards[id];
  }
  const war = chooseGoal(g, map, H);
  assert.equal(war.kind, 'TAKE');
  assert.equal(g.state.territories[war.target].owner, houses[1]);
});

test('the plan musters at the own land nearest the goal and strikes the next land on the road', () => {
  const g = game();
  const plan = housePlan(g, map, constants, H);
  assert.ok(plan);
  assert.equal(g.state.territories[plan.stage].owner, H);
  assert.ok(adjacency.get(plan.stage).has(plan.target));
  assert.notEqual(g.state.territories[plan.target].owner, H);
});

test('the House hires the most strength its purse allows, keeping a dawn of upkeep', () => {
  const g = game();
  g.state.houses[H].gold = 12;
  const hire = aiHireChoice(g, map, H, capital);
  assert.ok(hire);
  const power = hire.counts.reduce((s, n, i) => s + n * RANKS[i].power, 0);
  assert.ok(power >= 8, `strength ${power}`);
  g.state.houses[H].gold = 2;
  assert.equal(aiHireChoice(g, map, H, capital), null);
});

test('an AI House shows mercy where tribute would raise the people, sacks when its purse is empty', () => {
  const g = game();
  const land = [...adjacency.get(capital)][0];
  g.state.territories[land].owner = H;
  g.state.population[land] = ORDER.revoltPeople + 2;
  g.state.order[land] = ORDER.revolt - 1;
  assert.equal(aiCaptureChoice(g.state, land, H), 'MERCY');
  g.state.order[land] = ORDER.disorder + 5;
  g.state.houses[H].gold = 0;
  assert.equal(aiCaptureChoice(g.state, land, H), 'SACK');
  g.state.houses[H].gold = 10;
  assert.equal(aiCaptureChoice(g.state, land, H), 'TRIBUTE');
});
