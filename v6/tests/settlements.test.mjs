// Settlements climbing their steps, and lands burnt to the ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { calculateHouseIncome } from '../src/core/economy.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy, processEconomy, queueGrowJob, queueRebuildJob } from '../src/online/economy.mjs';
import { normalizeAudit } from '../src/online/audit.mjs';
import { startRounds } from '../src/online/rounds.mjs';
import { seedPopulation, kindsRaisedIn } from '../src/online/units.mjs';
import { seedOrder, applyCaptureChoice, orderOnCapture, choiceOutcomes } from '../src/online/order.mjs';
import { landKind, isWaste, GROWS, REBUILD } from '../src/online/settlements.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const T0 = 1_700_000_000_000;
const HOUSE = constants.houses[0];

function freshGame() {
  let game = createOnlineGame(map, constants, { id: 'tiers', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  seedPopulation(game, map);
  seedOrder(game, map);
  game.lifecycle.status = 'RUNNING';
  return startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs: 600_000 });
}

// A village of ours to work on.
function villageOf(game) {
  const found = map.territories.find(t => t.type === 'Деревня' && t.house_sector === HOUSE);
  game.state.territories[found.id].owner = HOUSE;
  return found.id;
}

test('a village climbs to a great village, and the step takes gold, people and time', () => {
  const game = freshGame();
  const id = villageOf(game);
  game.state.population[id] = 10;
  game.state.houses[HOUSE].gold = 50;

  assert.throws(() => queueGrowJob(game, map, HOUSE, id, { nowMs: T0 }), /душ/);
  game.state.population[id] = GROWS['Деревня'].people;
  const queued = queueGrowJob(game, map, HOUSE, id, { nowMs: T0 });
  assert.equal(queued.state.houses[HOUSE].gold, 50 - GROWS['Деревня'].gold);
  assert.equal(landKind(queued.state, map, id), 'Деревня', 'nothing is built in an instant');
  assert.ok(queued.state.journal.some(e => e.kind === 'GROW_QUEUED'));

  const job = queued.jobs[queued.jobs.length - 1];
  const early = processEconomy(queued, map, constants, Date.parse(job.due_at) - 1000);
  assert.equal(landKind(early.state, map, id), 'Деревня');
  const done = processEconomy(queued, map, constants, Date.parse(job.due_at));
  assert.equal(landKind(done.state, map, id), 'Большая деревня');
  assert.ok(done.state.journal.some(e => e.kind === 'LAND_GREW' && e.into === 'Большая деревня'));
});

test('a small town pays better and raises better men than a village', () => {
  const game = freshGame();
  const id = villageOf(game);
  const before = calculateHouseIncome(game.state, map, constants, HOUSE);
  const villageKinds = kindsRaisedIn(map, id, game.state).length;

  game.state.tier = { [id]: 'Малый город' };
  const after = calculateHouseIncome(game.state, map, constants, HOUSE);
  assert.ok(after.gold > before.gold, 'a town pays more than the village it grew from');
  assert.ok(kindsRaisedIn(map, id, game.state).length > villageKinds, 'and raises kinds a village cannot');
});

test('a land burnt to the ground is nobody’s, pays nothing, and can be raised again', () => {
  const game = freshGame();
  const id = villageOf(game);
  game.state.population[id] = 12;
  game.state.houses[HOUSE].gold = 20;

  // The taker is offered the torch among the other choices.
  orderOnCapture(game.state, id, HOUSE, null, { nowMs: T0 });
  const outcomes = choiceOutcomes(game.state, id);
  assert.ok(outcomes.RAZE, 'burning it down is one of the choices');
  assert.equal(outcomes.RAZE.people_lost, 12);

  // The host that burned the town is standing in it.
  const home = map.capitals[HOUSE];
  game.state.territories[home].owner = HOUSE;
  game.state.territories[id].warriors = { [HOUSE]: 3 };
  const atHomeBefore = Number(game.state.territories[home].warriors?.[HOUSE] || 0);

  const goldBefore = game.state.houses[HOUSE].gold;
  applyCaptureChoice(game.state, id, HOUSE, 'RAZE', { nowMs: T0, map });

  // It does not burn with the town: it falls back to the nearest land of ours.
  assert.deepEqual(game.state.territories[id].warriors, {});
  assert.equal(Number(game.state.territories[home].warriors[HOUSE] || 0), atHomeBefore + 3);
  assert.ok(isWaste(game.state, id));
  assert.equal(game.state.territories[id].owner, null, 'the ashes belong to nobody');
  assert.equal(game.state.population[id], 0);
  assert.equal(game.state.houses[HOUSE].gold, goldBefore + 24);
  assert.equal(calculateHouseIncome(game.state, map, constants, HOUSE).gold,
    calculateHouseIncome({ ...game.state, territories: { ...game.state.territories } }, map, constants, HOUSE).gold);
  assert.ok(game.state.journal.some(e => e.kind === 'LAND_RAZED'));

  // Men must stand on the ashes before a village rises there again.
  game.state.houses[HOUSE].gold = 20;
  assert.throws(() => queueRebuildJob(game, map, HOUSE, id, { nowMs: T0 }), /с воинами/);
  game.state.territories[id].warriors = { [HOUSE]: 2 };
  const queued = queueRebuildJob(game, map, HOUSE, id, { nowMs: T0 });
  assert.equal(queued.state.houses[HOUSE].gold, 20 - REBUILD.gold);
  const job = queued.jobs[queued.jobs.length - 1];
  const done = processEconomy(queued, map, constants, Date.parse(job.due_at));
  assert.equal(landKind(done.state, map, id), 'Деревня');
  assert.equal(done.state.territories[id].owner, HOUSE);
  assert.equal(done.state.population[id], REBUILD.people);
  assert.ok(done.state.journal.some(e => e.kind === 'LAND_REBUILT'));
});

test('open country and the riches of the ground are laid out evenly round every House', async () => {
  const { generateMap } = await import('../src/online/mapgen.mjs');
  const { seedLands, isWaste, richesAt, wasNeverSettled } = await import('../src/online/settlements.mjs');
  const { seedHeart } = await import('../src/online/heart.mjs');
  const houses = constants.houses.slice(0, 4);
  const world = generateMap(map, { ...constants, houses }, { houses, seed: 21, shape: 'mainland', seaMesh: true, homePorts: false });

  let game = createOnlineGame(world, { ...constants, houses }, { id: 'lands', nowMs: T0 });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  seedHeart(game, world);
  seedPopulation(game, world);
  seedOrder(game, world);
  seedLands(game, world);

  // Whatever one House's k-th land is, every other House's k-th land is too.
  for (let k = 1; k <= 6; k += 1) {
    const mine = world.territories.filter(t => /^[A-F][1-6]$/.test(t.id) && t.id.endsWith(String(k)));
    const bare = new Set(mine.map(t => isWaste(game.state, t.id)));
    const rich = new Set(mine.map(t => game.state.riches?.[t.id] || ''));
    assert.equal(bare.size, 1, `the ${k}-th land is the same kind of ground for everyone`);
    assert.equal(rich.size, 1, `the ${k}-th land holds the same for everyone`);
  }

  // Open country is empty of people and of guards, and reads as never settled.
  const empty = Object.keys(game.state.empty || {});
  assert.ok(empty.length > 0, 'there is open country somewhere');
  for (const id of empty) {
    assert.ok(isWaste(game.state, id));
    assert.ok(wasNeverSettled(game.state, id));
    assert.equal(game.state.population[id], 0);
    assert.equal(Number(game.state.wild_guards?.[id] || 0), 0, 'nobody holds it');
  }

  // And a seam of iron pays its holder at every dawn.
  const ore = Object.entries(game.state.riches || {}).find(([, kind]) => kind === 'рудник');
  if (ore) {
    const [id] = ore;
    game.state.territories[id].owner = houses[0];
    const withOre = calculateHouseIncome(game.state, world, { ...constants, houses }, houses[0]);
    game.state.riches = {};
    const without = calculateHouseIncome(game.state, world, { ...constants, houses }, houses[0]);
    assert.equal(withOre.gold - without.gold, richesAt({ riches: { [id]: 'рудник' } }, id).gold);
  }
});
