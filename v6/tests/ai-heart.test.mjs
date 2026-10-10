import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { seedHeart, heartDawn, HEART } from '../src/online/heart.mjs';
import { seedPopulation, aiHireChoice } from '../src/online/units.mjs';
import { seedOrder, aiCaptureChoice, ORDER } from '../src/online/order.mjs';
import { RANKS } from '../src/online/ranks.mjs';
import { chooseGoal, heartPlan, garrisonToKeep } from '../src/online/ai-heart.mjs';

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
  const g = createOnlineGame(map, constants, { id: 'ai-heart', nowMs: 1, characterCatalog });
  g.rounds = { round_duration_ms: 800_000, number: 3 };
  seedHeart(g, map); seedPopulation(g, map); seedOrder(g, map);
  heartDawn(g, map, constants, 10, HEART.appearDay);
  return g;
}

test('before the Hearts are known the House goes for one of them; a decoy never tempts it once exposed', () => {
  const g = game();
  const goal = chooseGoal(g, map, H);
  assert.equal(goal.kind, 'HEART');
  assert.ok(g.state.heart.candidates.includes(goal.target));
  // Every candidate exposed as a decoy save the truth, which it does not know: it goes for the last one.
  const { candidates, truth } = g.state.heart;
  g.state.heart.revealed = candidates.filter(id => id !== truth);
  assert.deepEqual(chooseGoal(g, map, H), { kind: 'HEART', target: truth });
  // All exposed and the truth taken by another: it expands, never onto a decoy.
  g.state.heart.territory = truth;
  g.state.territories[truth].owner = houses[1];
  assert.deepEqual(chooseGoal(g, map, H), { kind: 'HEART', target: truth });
  g.state.territories[truth].owner = H;
  const hold = chooseGoal(g, map, H);
  assert.deepEqual(hold, { kind: 'HOLD', target: truth });
  assert.deepEqual(heartPlan(g, map, constants, H), { goal: hold, stage: truth, target: null });
  g.state.territories[truth].warriors = { [H]: 9 };
  assert.equal(garrisonToKeep(g.state, map, H, truth), 9, 'the Heart keeps every man');
});

test('the plan musters at the own land nearest the goal and strikes the next land on the road', () => {
  const g = game();
  const plan = heartPlan(g, map, constants, H);
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
