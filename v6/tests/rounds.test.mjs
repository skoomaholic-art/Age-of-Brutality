import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { normalizeOnlineEconomy, processEconomy } from '../src/online/economy.mjs';
import { calculateNextDueAt } from '../src/online/scheduling.mjs';
import { processRounds } from '../src/online/ai.mjs';
import {
  houseRoundStatus,
  passRound,
  roundsEnabled,
  roundsView,
  startRounds
} from '../src/online/rounds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const HOUSE = 'Варкайр';
const T0 = 1_000_000;

// A started six-player game: every House is claimed by a (fake) player.
function multiplayerGame(nowMs = T0) {
  let game = createOnlineGame(map, constants, {
    id: 'rounds-test',
    nowMs,
    accessMode: 'PLAYER_BOUND',
    inviteCode: null
  });
  game = normalizeOnlineEconomy(game, nowMs);
  game.lifecycle.status = 'RUNNING';
  game.lifecycle.house_claims = Object.fromEntries(
    constants.houses.map(house => [house, `player-${house}`])
  );
  return startRounds(game, map, constants, { nowMs });
}

function tick(game, nowMs) {
  let next = processDueOrders(game, map, constants, nowMs);
  next = processEconomy(next, map, constants, nowMs);
  return processRounds(next, map, constants, { nowMs });
}

function recruit(game, house, nowMs, warriors = 1) {
  return executeCommand(
    game,
    map,
    constants,
    { type: 'RECRUIT', house, territory: map.capitals[house], warriors },
    { nowMs }
  ).game;
}

function passAll(game, nowMs, except = []) {
  let next = game;
  for (const house of constants.houses) {
    if (except.includes(house)) continue;
    if (!houseRoundStatus(next, house).done) next = passRound(next, house, nowMs);
  }
  return next;
}

test('starting a game opens round 1 with income paid and three actions per House', () => {
  const game = multiplayerGame();

  assert.equal(game.rounds.number, 1);
  assert.equal(game.state.round, 1);
  assert.equal(game.next_income_at, null);
  // 8 starting gold + 4 from the home capital.
  assert.equal(game.state.houses[HOUSE].gold, 12);
  for (const house of constants.houses) {
    assert.deepEqual(
      { left: houseRoundStatus(game, house).left, done: houseRoundStatus(game, house).done },
      { left: 3, done: false }
    );
  }
});

test('a game played in rounds is not paid by the wall-clock income timer', () => {
  const game = multiplayerGame();
  const later = processEconomy(game, map, constants, T0 + 10 * 60_000);
  assert.equal(later.state.houses[HOUSE].gold, game.state.houses[HOUSE].gold);
});

test('each command spends one action and the fourth is rejected without changing the game', () => {
  let game = multiplayerGame();
  game = recruit(game, HOUSE, T0 + 1);
  game = recruit(game, HOUSE, T0 + 2);
  game = recruit(game, HOUSE, T0 + 3);
  assert.equal(houseRoundStatus(game, HOUSE).left, 0);

  const before = JSON.stringify(game);
  assert.throws(() => recruit(game, HOUSE, T0 + 4), /no actions left this round/);
  assert.equal(JSON.stringify(game), before);
});

test('a command that is rejected on its own merits does not spend an action', () => {
  const game = multiplayerGame();
  assert.throws(() => recruit(game, HOUSE, T0 + 1, 9), /recruit must be 1\.\.3/);
  assert.equal(houseRoundStatus(game, HOUSE).left, 3);
});

test('a House that ended its round cannot act or end it twice', () => {
  let game = multiplayerGame();
  game = passRound(game, HOUSE, T0 + 1);
  assert.equal(houseRoundStatus(game, HOUSE).done, true);
  assert.throws(() => recruit(game, HOUSE, T0 + 2), /round already ended for this House/);
  assert.throws(() => passRound(game, HOUSE, T0 + 3), /round already ended for this House/);
});

test('the round advances only when every House is done and no order is still pending', () => {
  let game = multiplayerGame();
  game = recruit(game, HOUSE, T0 + 1);
  game = passAll(game, T0 + 2, ['Сайрвен']);

  game = tick(game, T0 + 3);
  assert.equal(game.rounds.number, 1, 'one House has not finished');

  game = passRound(game, 'Сайрвен', T0 + 4);
  game = tick(game, T0 + 5);
  assert.equal(game.rounds.number, 1, 'the recruit job is still pending');

  const goldBefore = game.state.houses['Сайрвен'].gold;
  game = tick(game, T0 + 60_000);
  assert.equal(game.rounds.number, 2);
  assert.equal(houseRoundStatus(game, HOUSE).left, 3);
  assert.equal(game.state.houses['Сайрвен'].gold, goldBefore + 4, 'income at the start of round 2');
});

test('a multiplayer round closes at its deadline even if a House never acts', () => {
  let game = multiplayerGame();
  const deadline = Date.parse(game.rounds.deadline_at);
  assert.equal(calculateNextDueAt(game), game.rounds.deadline_at);

  game = tick(game, deadline - 1);
  assert.equal(game.rounds.number, 1);
  assert.throws(() => recruit(game, HOUSE, deadline + 1), /round time expired/);

  game = tick(game, deadline + 1);
  assert.equal(game.rounds.number, 2);
});

test('an order that fails to resolve gives the action back', () => {
  let game = multiplayerGame();
  const capital = map.capitals[HOUSE];
  const march = executeCommand(
    game,
    map,
    constants,
    { type: 'MARCH', house: HOUSE, from: capital, to: 'W02', warriors: 1 },
    { nowMs: T0 + 1 }
  );
  game = march.game;
  assert.equal(houseRoundStatus(game, HOUSE).used, 1);

  // The army leaves before the order resolves, so the march can no longer happen.
  delete game.state.territories[capital].warriors[HOUSE];
  game.state.territories[capital].owner = null;
  for (const character of Object.values(game.state.characters || {})) {
    if (character.location === capital) character.location = null;
  }

  game = processDueOrders(game, map, constants, T0 + 60_000);
  assert.equal(game.orders[0].status, 'FAILED');
  game = processRounds(game, map, constants, { nowMs: T0 + 60_001 });
  assert.equal(houseRoundStatus(game, HOUSE).used, 0);
});

test('after the sixth round the game finishes itself and names the leader as winner', () => {
  let game = multiplayerGame();
  game.state.houses['Ортайн'].victory_points = 3;

  let now = T0;
  for (let round = 1; round <= constants.rounds; round += 1) {
    assert.equal(game.rounds.number, round);
    assert.equal(game.lifecycle.status, 'RUNNING');
    now += 1_000;
    game = passAll(game, now);
    now += 1_000;
    game = tick(game, now);
  }

  assert.equal(game.lifecycle.status, 'FINISHED');
  assert.equal(game.lifecycle.finish_reason, 'ROUND_LIMIT');
  assert.deepEqual(game.rounds.winners, ['Ортайн']);
  assert.deepEqual(roundsView(game).winners, ['Ортайн']);
  assert.equal(game.rounds.number, constants.rounds);
  assert.equal(calculateNextDueAt(game), null);
  assert.throws(() => recruit(game, HOUSE, now + 1), /game is not running/);

  assert.deepEqual(tick(game, now + 10 * 60_000), game, 'a finished game is left alone');
});

test('games started before rounds existed keep the old real-time behaviour', () => {
  let game = createOnlineGame(map, constants, { id: 'legacy', nowMs: T0 });
  game = normalizeOnlineEconomy(game, T0);
  assert.equal(roundsEnabled(game), false);
  assert.equal(roundsView(game), null);
  assert.ok(game.next_income_at, 'timer income stays on');

  for (let i = 1; i <= 4; i += 1) game = recruit(game, HOUSE, T0 + i);
  assert.equal(game.jobs.length, 4, 'no three-action limit without rounds');
  assert.equal(processRounds(game, map, constants, { nowMs: T0 + 10 }), game);
});
