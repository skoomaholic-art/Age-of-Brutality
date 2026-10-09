import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { startRounds, advanceRound } from '../src/online/rounds.mjs';
import { seedHeart, heartLayout, heartDawn, menToTakeWild, HEART } from '../src/online/heart.mjs';
import { validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const adjacency = buildAdjacency(map.land_edges);
const H = houses[0];
const capital = map.capitals[H];

function heartGame() {
  const game = createOnlineGame(map, constants, { id: 'heart', nowMs: 1, characterCatalog });
  return seedHeart(game, map);
}

test('rings grow from the capitals towards the Heart, and so does the wild guard', () => {
  const { rings, heart } = heartLayout(map);
  assert.ok(heart);
  assert.equal(rings[capital], 0);
  const game = heartGame();
  const guards = game.state.wild_guards;
  assert.equal(game.state.heart.territory, heart);
  assert.equal(guards[capital], undefined, 'capitals have no wild guard');
  assert.equal(guards[heart], HEART.heartGuards);
  assert.equal(game.state.territories[heart].fort, true, 'the Heart stands behind walls');
  // Every free land: the deeper its ring, the bigger its guard.
  const byRing = {};
  for (const t of map.territories) {
    if (t.id === heart || rings[t.id] === 0 || t.type === 'Город') continue;
    (byRing[rings[t.id]] ||= new Set()).add(guards[t.id]);
  }
  const ringsSeen = Object.keys(byRing).map(Number).sort();
  for (let i = 1; i < ringsSeen.length; i += 1) {
    assert.ok(Math.min(...byRing[ringsSeen[i]]) > Math.max(...byRing[ringsSeen[i - 1]]));
  }
  assert.deepEqual(validateState(game.state, map, constants), []);
});

test('a free land is fought for: too few men are beaten back, enough men take it and earn its glory once', () => {
  let game = heartGame();
  const near = [...adjacency.get(capital)].find(id => game.state.heart.rings[id] === 1 && map.territories.find(t => t.id === id).type !== 'Город');
  assert.ok(near, 'a ring-1 land next to the capital');
  game.state.wild_guards[near] = 5;
  game.state.territories[capital].warriors[H] = 8;

  game = executeCommand(game, map, constants, { type: 'MARCH', house: H, from: capital, to: near, warriors: 2 }, { nowMs: 10 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders.at(-1).due_at));
  let fight = game.state.journal.filter(e => e.kind === 'WILD_BATTLE').at(-1);
  assert.ok(fight, JSON.stringify(game.orders.at(-1).failure_reason || game.state.journal.slice(-3)));
  assert.equal(fight.success, false);
  assert.equal(game.state.territories[near].owner, null);
  assert.ok(game.state.wild_guards[near] < 5, 'the guard bled too');

  const need = menToTakeWild(game.state.wild_guards[near]);
  const vp = Number(game.state.houses[H].victory_points || 0);
  game = executeCommand(game, map, constants, { type: 'MARCH', house: H, from: capital, to: near, warriors: need }, { nowMs: 100_000 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders.at(-1).due_at));
  fight = game.state.journal.filter(e => e.kind === 'WILD_BATTLE').at(-1);
  assert.equal(fight.success, true);
  assert.equal(game.state.territories[near].owner, H);
  assert.equal(game.state.wild_guards[near], undefined);
  assert.equal(game.state.houses[H].victory_points, vp + 1, 'ring 1 gives one glory');
  assert.deepEqual(validateState(game.state, map, constants), []);
});

test('at dawn the guard grows back and the Heart pays its holder more each dawn', () => {
  const game = heartGame();
  const heart = game.state.heart.territory;
  const some = Object.keys(game.state.wild_guards).find(id => id !== heart);
  game.state.wild_guards[some] = 0;
  heartDawn(game, map, constants, 1000);
  assert.equal(game.state.wild_guards[some], 1);

  game.state.territories[heart].owner = H;
  game.state.territories[heart].warriors = { [H]: 3 };
  delete game.state.wild_guards[heart];
  const start = Number(game.state.houses[H].victory_points || 0);
  heartDawn(game, map, constants, 2000);
  heartDawn(game, map, constants, 3000);
  assert.equal(game.state.houses[H].victory_points, start + 3 + 4);
  assert.equal(game.state.heart.streak, 2);
  assert.ok(game.state.journal.some(e => e.kind === 'HEART_TAKEN'));
  // Lost and retaken: the count starts again.
  game.state.territories[heart].owner = houses[1];
  game.state.territories[heart].warriors = { [houses[1]]: 3 };
  heartDawn(game, map, constants, 4000);
  assert.equal(game.state.heart.streak, 1);
});

test('the age ends at the dawn someone reaches the glory target', () => {
  let game = heartGame();
  game.lifecycle.status = 'RUNNING';
  game.lifecycle.house_claims = Object.fromEntries(houses.map(h => [h, `p-${h}`]));
  game = startRounds(game, map, constants, { nowMs: 1, mode: 'days', dayMs: 600_000 });
  assert.equal(game.rounds.max, HEART.days);
  const heart = game.state.heart.territory;
  game.state.territories[heart].owner = H;
  game.state.territories[heart].warriors = { [H]: 3 };
  delete game.state.wild_guards[heart];
  game.state.houses[H].victory_points = HEART.target - 3;
  game = advanceRound(game, map, constants, { nowMs: 700_000 });
  assert.equal(game.lifecycle.status, 'FINISHED');
  assert.equal(game.lifecycle.finish_reason, 'HEART');
  assert.deepEqual(game.rounds.winners, [H]);
});
