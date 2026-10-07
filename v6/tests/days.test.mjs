import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { listQueueableMarches, processDueOrders } from '../src/online/orders.mjs';
import { normalizeOnlineEconomy, processEconomy } from '../src/online/economy.mjs';
import { processRounds } from '../src/online/ai.mjs';
import { applyFog, visiblePositions } from '../src/online/fog.mjs';
import { syncAuditFromJournal, normalizeAudit } from '../src/online/audit.mjs';
import {
  GAME_PACES,
  passRound,
  roundsView,
  startRounds
} from '../src/online/rounds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const adjacency = buildAdjacency(map.land_edges);
const T0 = 1_000_000;
const DAY = 600_000;
const HOUSE = 'Варкайр';
const RIVAL = 'Сайрвен';
const CAPITAL = map.capitals[HOUSE];

// A started game played in days. `claims` lists the Houses that have a player.
function daysGame({ claims = constants.houses, dayMs = DAY } = {}) {
  let game = createOnlineGame(map, constants, {
    id: 'days-test',
    nowMs: T0,
    accessMode: 'PLAYER_BOUND',
    inviteCode: null,
    characterCatalog
  });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  game.lifecycle.status = 'RUNNING';
  game.lifecycle.house_claims = Object.fromEntries(claims.map(house => [house, `p-${house}`]));
  return startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs });
}

function tick(game, nowMs) {
  let next = processDueOrders(game, map, constants, nowMs);
  next = processEconomy(next, map, constants, nowMs);
  return processRounds(next, map, constants, { nowMs });
}

function neighbourOfType(type) {
  const id = [...adjacency.get(CAPITAL)].find(
    other => map.territories.find(t => t.id === other).type === type
  );
  assert.ok(id, `the capital has a neighbouring ${type}`);
  return id;
}

function march(game, from, to, warriors, nowMs, house = HOUSE) {
  return executeCommand(game, map, constants, { type: 'MARCH', house, from, to, warriors }, { nowMs }).game;
}

test('a game in days pays income at the start, sets a day clock and has no order limit', () => {
  let game = daysGame();
  assert.equal(game.rounds.mode, 'days');
  assert.equal(game.state.houses[HOUSE].gold, 12);
  assert.equal(Date.parse(game.rounds.deadline_at), T0 + DAY);
  assert.equal(roundsView(game).day_ms, DAY);

  for (let i = 1; i <= 4; i += 1) {
    game = executeCommand(
      game, map, constants,
      { type: 'RECRUIT', house: HOUSE, territory: CAPITAL, warriors: 1 },
      { nowMs: T0 + i }
    ).game;
  }
  assert.equal(game.jobs.length, 4, 'more than three orders in one day are fine');
  assert.throws(() => passRound(game, HOUSE, T0 + 9), /rounds are not enabled/);
});

test('one road takes a sixth of the game day and build times scale with it', () => {
  let game = daysGame();
  const village = neighbourOfType('Деревня');
  const offered = listQueueableMarches(game, map, constants, HOUSE)
    .find(action => action.to === village && action.warriors === 2);
  assert.equal(offered.route_duration_ms, DAY / 6, 'the client is told the real travel time');

  game = march(game, CAPITAL, village, 2, T0 + 1);
  assert.equal(game.orders[0].duration_ms, DAY / 6);

  game = executeCommand(
    game, map, constants,
    { type: 'RECRUIT', house: HOUSE, territory: CAPITAL, warriors: 1 },
    { nowMs: T0 + 2 }
  ).game;
  const built = Date.parse(game.jobs[0].due_at) - Date.parse(game.jobs[0].created_at);
  assert.equal(built, Math.round(4_000 * (DAY / 18_000)));
});

test('the day changes on the clock while armies keep marching, and the days keep their length', () => {
  let game = daysGame({ dayMs: 60_000 });
  const village = neighbourOfType('Деревня');
  // Issued just before midnight: still on the road when the day changes.
  game = march(game, CAPITAL, village, 2, T0 + 59_000);

  const gold = game.state.houses[RIVAL].gold;
  game = tick(game, T0 + 61_500);
  assert.equal(game.rounds.number, 2);
  assert.equal(game.orders[0].status, 'PENDING');
  assert.equal(game.state.houses[RIVAL].gold, gold + 4, 'income at the day change');
  assert.equal(Date.parse(game.rounds.deadline_at), T0 + 120_000, 'day 2 ends two days after the start');
});

test('after the sixth day the game finishes itself, even if the server slept through the days', () => {
  let game = daysGame({ dayMs: 60_000 });
  game.state.houses['Ортайн'].victory_points = 3;

  // The server wakes up long after the last day: each tick closes one day.
  const late = T0 + 100 * 60_000;
  for (let i = 0; i < 6; i += 1) {
    assert.equal(game.lifecycle.status, 'RUNNING');
    game = tick(game, late + i);
  }
  assert.equal(game.lifecycle.status, 'FINISHED');
  assert.deepEqual(game.rounds.winners, ['Ортайн']);
});

test('without dice a neutral land falls exactly when the warriors outnumber its resistance', () => {
  const village = neighbourOfType('Деревня'); // resistance 1

  let weak = march(daysGame(), CAPITAL, village, 1, T0 + 1);
  weak = processDueOrders(weak, map, constants, T0 + DAY);
  assert.equal(weak.state.territories[village].owner, null, 'one warrior is not enough');
  assert.equal(weak.orders[0].result.success, false);

  let enough = march(daysGame(), CAPITAL, village, 2, T0 + 1);
  enough = processDueOrders(enough, map, constants, T0 + DAY);
  assert.equal(enough.state.territories[village].owner, HOUSE);
  assert.equal(enough.orders[0].result.roll, 7, 'the throw is fixed at the average');
});

test('without dice the larger force wins a battle and a tie goes to the defender', () => {
  const field = neighbourOfType('Деревня');
  const fight = defenders => {
    let game = daysGame();
    game.state.territories[field].owner = RIVAL;
    game.state.territories[field].warriors = { [RIVAL]: defenders };
    // Two attackers march; the capital keeps a garrison for its commander.
    game = march(game, CAPITAL, field, 2, T0 + 1);
    game = processDueOrders(game, map, constants, T0 + DAY);
    return game.orders[0].result;
  };

  assert.equal(fight(1).attackerWins, true, '2 against 1');
  assert.equal(fight(2).attackerWins, false, '2 against 2: the defender holds');
  assert.equal(fight(3).attackerWins, false, '2 against 3');
});

test('a House sees its own lands and their neighbours, and nothing of armies beyond', () => {
  const game = daysGame();
  const seen = visiblePositions(game.state, map, HOUSE);
  assert.ok(seen.has(CAPITAL));
  for (const neighbour of adjacency.get(CAPITAL)) assert.ok(seen.has(neighbour));

  const far = map.capitals[RIVAL];
  assert.equal(seen.has(far), false);

  const client = applyFog(structuredClone(game), map, HOUSE);
  assert.deepEqual(client.state.territories[far].warriors, {}, 'the rival garrison is hidden');
  assert.equal(client.state.territories[far].owner, RIVAL, 'who owns the land stays known');
  assert.equal(client.state.territories[CAPITAL].warriors[HOUSE], 4);
  assert.equal(client.visibility.visible.includes(far), false);
  assert.ok(
    Object.values(client.state.characters).every(character => character.house === HOUSE),
    'foreign commanders out of sight are not sent'
  );
});

test('fog hides what other Houses order but not what happens in the open', () => {
  let game = daysGame();
  const rivalCapital = map.capitals[RIVAL];
  const rivalVillage = [...adjacency.get(rivalCapital)].find(
    other => map.territories.find(t => t.id === other).type === 'Деревня'
  );
  game = march(game, rivalCapital, rivalVillage, 2, T0 + 1, RIVAL);
  game = march(game, CAPITAL, neighbourOfType('Деревня'), 2, T0 + 2);
  game = processDueOrders(game, map, constants, T0 + DAY);
  game = syncAuditFromJournal(game, map, { nowMs: T0 + DAY, emit: () => {} });

  const client = applyFog(structuredClone(game), map, HOUSE);
  const foreignOrders = client.orders.filter(order => order.action.house === RIVAL);
  assert.equal(foreignOrders.length, 0, 'a march far away is not sent to the client');
  assert.ok(client.orders.some(order => order.action.house === HOUSE));

  const types = client.audit_log.map(item => `${item.type}:${item.details?.house || ''}`);
  assert.equal(types.some(entry => entry === `MARCH_QUEUED:${RIVAL}`), false);
  assert.ok(types.some(entry => entry === `MARCH_QUEUED:${HOUSE}`));
  assert.ok(
    client.audit_log.some(item => item.type === 'NEUTRAL_CAPTURE' && item.details?.house === RIVAL),
    'a land changing hands is public'
  );
});

test('Houses without a player are played by the House AI in multiplayer too', () => {
  const game = daysGame({ claims: [HOUSE, RIVAL] });
  assert.equal(game.rounds.ai_houses.length, 4);
  assert.equal(game.rounds.ai_houses.includes(HOUSE), false);

  let now = T0;
  let next = game;
  for (let i = 0; i < 40; i += 1) {
    now += 15_000;
    next = tick(next, now);
  }
  const aiOrders = next.orders.filter(order => game.rounds.ai_houses.includes(order.action.house));
  assert.ok(aiOrders.length > 0, 'the AI Houses issue orders');
  assert.equal(next.orders.some(order => [HOUSE, RIVAL].includes(order.action.house)), false);
});

test('every tempo offered to players is a whole number of minutes', () => {
  for (const pace of Object.values(GAME_PACES)) assert.equal(pace.day_ms % 60_000, 0);
});
