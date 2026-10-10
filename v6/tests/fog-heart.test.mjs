import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { seedHeart, heartDawn, HEART } from '../src/online/heart.mjs';
import { seedPopulation, hireUnits, NO_LIMIT } from '../src/online/units.mjs';
import { seedOrder } from '../src/online/order.mjs';
import { applyFog } from '../src/online/fog.mjs';
import { queueRecruitJob } from '../src/online/economy.mjs';
import { raiseLevy } from '../src/online/levy.mjs';
import { grantOnce } from '../src/core/scoring.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses, house_warrior_cap: NO_LIMIT, territory_warrior_cap: NO_LIMIT, rounds: 8 };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const [H, R] = houses;

function game() {
  const g = createOnlineGame(map, constants, { id: 'fog', nowMs: 1, characterCatalog });
  seedHeart(g, map); seedPopulation(g, map); seedOrder(g, map);
  g.rounds = { round_duration_ms: 600_000 };
  return g;
}

test('the fog hides what the new rules know about other Houses', () => {
  let g = game();
  g.state.houses[R].gold = 100;
  g = hireUnits(g, map, R, map.capitals[R], [0, 0, 0, 0, 0, 3]);
  heartDawn(g, map, constants, 10, HEART.appearDay);
  const view = structuredClone({ ...g, visibility: null });
  applyFog(view, map, H);
  const rc = map.capitals[R];
  assert.equal(view.state.ranks[rc], undefined, 'the makeup of an unseen host is unknown');
  assert.equal(view.state.population[rc], undefined, 'the people of an unseen land are unknown');
  assert.equal(view.state.order[rc], undefined);
  assert.equal(view.state.heart.truth, undefined);
  assert.equal(view.state.heart.salt, undefined);
  assert.ok(view.state.ranks[map.capitals[H]], 'our own host is known');
  assert.ok(view.state.population[map.capitals[H]] !== undefined);
});

test('old hiring is refused in games with troop kinds, and the new one in old games', () => {
  const g = game();
  assert.throws(() => queueRecruitJob(g, constants, { house: H, territory: map.capitals[H], warriors: 1 }), /по родам/);
  assert.throws(() => raiseLevy(g, map, constants, H, [1, 0, 0]), /по родам/);
  const old = createOnlineGame(map, constants, { id: 'old', nowMs: 1, characterCatalog });
  assert.throws(() => hireUnits(old, map, H, map.capitals[H], [1]), /по-старому/);
});

test('in a game of the Heart the old glory awards give nothing', () => {
  const g = game();
  assert.equal(grantOnce(g.state, H, 'VP-W2', 1), false);
  assert.equal(g.state.houses[H].victory_points || 0, 0);
});

test('a marriage opens the whole map: allies see each other lands, hosts and marches', () => {
  const g = game();
  const other = R;
  g.rounds = { ...g.rounds, mode: 'days' };
  g.diplomacy = { relations: { [[H, other].sort().join('::')]: 'ALLIANCE' } };
  // The ally holds a land far away, with men on it.
  const far = map.capitals[other];
  g.state.territories[far].owner = other;
  g.state.territories[far].warriors = { [other]: 4 };
  g.state.ranks = { [far]: { [other]: [0, 0, 0, 4, 0, 0] } };
  const view = structuredClone({ ...g, visibility: null });
  applyFog(view, map, H);
  assert.equal(view.state.territories[far].owner, other, 'the ally\'s land is on our map');
  assert.equal(view.state.territories[far].warriors[other], 4, 'and so is its host');
  assert.deepEqual(view.state.ranks[far][other], [0, 0, 0, 4, 0, 0], 'with its kinds');
  // Without the marriage the same land is under the clouds.
  const alone = structuredClone({ ...g, diplomacy: { relations: {} }, visibility: null });
  applyFog(alone, map, H);
  assert.equal(alone.state.territories[far].owner, null);
  assert.deepEqual(alone.state.territories[far].warriors, {});
});
