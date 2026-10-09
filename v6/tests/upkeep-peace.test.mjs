import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { seedPopulation, hireUnits, upkeepOf, upkeepDawn, NO_LIMIT } from '../src/online/units.mjs';
import { declareWar, declareWarInPlace, proposeDeal, acceptDeal, relationOf, RELATION, inTruce, isOathbreaker, aiVerdict } from '../src/online/diplomacy.mjs';
import { compAt } from '../src/online/ranks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses, house_warrior_cap: NO_LIMIT, territory_warrior_cap: NO_LIMIT };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const [H, R] = houses;
const capital = map.capitals[H];

function game() {
  const g = seedPopulation(createOnlineGame(map, constants, { id: 'upkeep', nowMs: 1, characterCatalog }), map);
  g.rounds = { round_duration_ms: 600_000 };
  return g;
}

test('troops are paid every dawn by their kind; the unpaid desert, cheapest first', () => {
  let g = game();
  g.state.houses[H].gold = 100;
  g = hireUnits(g, map, H, capital, [8, 0, 0, 0, 0, 2]);
  const heads = g.state.territories[capital].warriors[H];
  const cost = upkeepOf(g.state, map, H);
  assert.equal(cost.gold, Math.ceil((heads - 2) * 0.25 + 2 * 2));
  g.state.houses[H].gold = 100;
  upkeepDawn(g, map, 10);
  assert.equal(g.state.houses[H].gold, 100 - cost.gold);
  // Two gold short: eight peasants (a quarter each) go home.
  g.state.houses[H].gold = cost.gold - 2;
  upkeepDawn(g, map, 20);
  assert.equal(g.state.territories[capital].warriors[H], heads - 8);
  assert.equal(g.state.houses[H].gold, 0);
  assert.ok(g.state.territories[capital].warriors[H] < heads, 'some went home');
  assert.equal(compAt(g.state, map, capital, H)[5], 2, 'the knights stayed: the cheapest leave first');
  assert.ok(g.state.journal.some(e => e.kind === 'DESERTION'));
});

test('peace is made by letter; it opens a truce, and breaking it makes an oathbreaker', () => {
  let g = game();
  g = declareWar(g, constants, H, R, { nowMs: 5 });
  assert.throws(() => proposeDeal(g, constants, map, H, R, { give: [{ type: 'GOLD', amount: 1 }] }, { nowMs: 6 }), /сначала мир/);
  g.state.houses[H].gold = 10;
  g = proposeDeal(g, constants, map, H, R, { give: [{ type: 'PEACE' }, { type: 'GOLD', amount: 3 }] }, { nowMs: 6 });
  assert.equal(aiVerdict(g, map, H, R).accept, true, 'an AI that is not the stronger takes peace');
  g = acceptDeal(g, constants, map, R, H, { nowMs: 7 });
  assert.equal(relationOf(g, H, R), RELATION.NEUTRAL);
  assert.ok(inTruce(g, H, R, 8));
  assert.equal(g.state.houses[R].gold >= 3, true);
  declareWarInPlace(g, H, R, { nowMs: 9 });
  assert.equal(isOathbreaker(g, H), true);
  assert.ok(g.state.journal.some(e => e.kind === 'WAR_DECLARED' && e.truce_broken));
});
