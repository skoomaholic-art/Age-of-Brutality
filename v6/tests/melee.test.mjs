import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { declareWarInPlace, relationOf, RELATION } from '../src/online/diplomacy.mjs';
import { processCampFights, meleeSides, standingOn } from '../src/online/melee.mjs';
import { validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel' });
const [H, G, A, K] = houses;

// A land L held by H, a land O of A next to it, with nobody else around.
function scene() {
  const game = createOnlineGame(map, constants, { id: 'melee', nowMs: 1, characterCatalog });
  game.rounds = { round_duration_ms: 600_000 };
  const capitals = new Set(Object.values(map.capitals));
  const [L, O] = map.land_edges.find(([a, b]) => !capitals.has(a) && !capitals.has(b) && map.territories.find(t => t.id === a).type === 'Деревня');
  game.state.territories[L].owner = H;
  game.state.territories[L].warriors = { [H]: 2 };
  game.state.territories[O].owner = A;
  game.state.territories[O].warriors = { [A]: 6 };
  game.state.passage = { [H]: [G, K] };
  game.state.guests = { [L]: { [G]: 3 } };
  return { game, L, O };
}

test('an army storming a land fights the owner and the guests at war with it together', () => {
  let { game, L, O } = scene();
  declareWarInPlace(game, A, G, { nowMs: 2 });
  assert.deepEqual(meleeSides(game, standingOn(game.state, L), A, H), { attackers: [A], defenders: [H, G] });
  game = executeCommand(game, map, constants, { type: 'MARCH', house: A, from: O, to: L, warriors: 4 }, { nowMs: 10 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  const order = game.orders[0];
  assert.equal(order.status, 'RESOLVED', order.failure_reason);
  assert.equal(order.result.kind, 'MELEE');
  const battle = game.state.journal.find(e => e.kind === 'BATTLE');
  assert.ok(battle.melee);
  assert.deepEqual(battle.defenders.map(d => d.house), [H, G]);
  // 4 men against 2 + 3 and the walls: the land holds, the attackers go home.
  assert.equal(battle.attackerWins, false);
  assert.equal(game.state.territories[L].owner, H);
  assert.equal(game.state.territories[O].warriors[A], 2 + battle.attackerSurvivors);
  assert.equal(relationOf(game, A, H), RELATION.WAR, 'the owner is now at war with the attacker');
  assert.deepEqual(validateState(game.state, map, constants), []);
});

test('a strong enough army takes the land; beaten guests are led home', () => {
  let { game, L, O } = scene();
  game.state.territories[O].warriors = { [A]: 12 };
  declareWarInPlace(game, A, G, { nowMs: 2 });
  game = executeCommand(game, map, constants, { type: 'MARCH', house: A, from: O, to: L, warriors: 12 }, { nowMs: 10 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  const battle = game.state.journal.find(e => e.kind === 'BATTLE');
  assert.equal(battle.attackerWins, true);
  assert.equal(battle.captor, A);
  assert.equal(game.state.territories[L].owner, A);
  assert.equal(game.state.guests?.[L]?.[G] || 0, 0, 'the beaten guests do not stay');
  assert.deepEqual(validateState(game.state, map, constants), []);
});

test('without guests in it a land is stormed the usual way', () => {
  let { game, L, O } = scene();
  game.state.guests = {};
  game = executeCommand(game, map, constants, { type: 'MARCH', house: A, from: O, to: L, warriors: 4 }, { nowMs: 10 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  assert.notEqual(game.orders[0].result.kind, 'MELEE');
});

test('guests camped side by side fight when war breaks out between them; the beaten go home', () => {
  let { game, L } = scene();
  game.state.guests[L][K] = 1;
  declareWarInPlace(game, K, G, { nowMs: 2 });
  game = processCampFights(game, map, constants, 100);
  const battle = game.state.journal.find(e => e.kind === 'BATTLE');
  assert.ok(battle?.melee);
  assert.equal(battle.attacker, K);
  assert.equal(battle.attackerWins, false);
  assert.equal(game.state.guests[L][G] > 0, true, 'the winner keeps his camp');
  assert.equal(game.state.guests[L][K] || 0, 0, 'the loser has left');
  assert.equal(game.state.territories[L].owner, H, 'the owner stood aside');
  // Nothing more to fight about.
  const again = processCampFights(game, map, constants, 200);
  assert.equal(again, game);
});

test('a guest at war with his host fights him for the land', () => {
  let { game, L } = scene();
  game.state.guests[L][G] = 9;
  declareWarInPlace(game, G, H, { nowMs: 2 });
  game = processCampFights(game, map, constants, 100);
  const battle = game.state.journal.find(e => e.kind === 'BATTLE');
  assert.equal(battle.attackerWins, true);
  assert.equal(game.state.territories[L].owner, G);
  assert.ok(game.state.territories[L].warriors[G] > 0);
  assert.equal(game.state.guests?.[L]?.[G] || 0, 0);
  assert.deepEqual(validateState(game.state, map, constants), []);
});
