import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders, haltOrder, resumeOrder, redirectOrder, setHaltPoint, orderPlace, FIELD_FOREVER, listQueueableMarches } from '../src/online/orders.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit, syncAuditFromJournal } from '../src/online/audit.mjs';
import { startRounds } from '../src/online/rounds.mjs';
import { recordExploration } from '../src/online/fog.mjs';
import { calculateNextDueAt } from '../src/online/scheduling.mjs';
import { nextEncounter, processEncounters } from '../src/online/encounters.mjs';
import {
  RELATION,
  acceptAlliance,
  answerAiOffers,
  diplomacyView,
  offerAlliance,
  relationOf
} from '../src/online/diplomacy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const adjacency = buildAdjacency(map.land_edges);
const T0 = 1_000_000;
const HOUSE = 'Варкайр';
const RIVAL = 'Сайрвен';
const THIRD = 'Ортайн';
const CAPITAL = map.capitals[HOUSE];
const NEXT = [...adjacency.get(CAPITAL)][0];

// Варкайр holds its capital, Сайрвен the land next door; `mine`/`theirs` warriors.
function borderGame(mine, theirs) {
  return recordExploration(rawBorderGame(mine, theirs), map, constants.houses, T0);
}

function rawBorderGame(mine, theirs) {
  let game = createOnlineGame(map, constants, {
    id: 'enc-test', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null, characterCatalog
  });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  game.lifecycle.status = 'RUNNING';
  game.lifecycle.house_claims = Object.fromEntries(constants.houses.map(h => [h, `p-${h}`]));
  game = startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs: 600_000 });
  game.state.territories[CAPITAL].warriors = { [HOUSE]: mine + 1 };
  game.state.territories[NEXT].owner = RIVAL;
  game.state.territories[NEXT].warriors = { [RIVAL]: theirs + 1 };
  return game;
}


function marchTo(game, to, warriors = 2) {
  return executeCommand(game, map, constants, { type: 'MARCH', house: HOUSE, from: CAPITAL, to, warriors }, { nowMs: T0 }).game;
}
function freeTargets(game) {
  return [...new Set(listQueueableMarches(game, map, constants, HOUSE).filter(a => a.from === CAPITAL && a.to !== NEXT && a.mode === 'LAND').map(a => a.to))];
}

test('an army stopped on the road waits there and goes on when told', () => {
  let game = borderGame(4, 1);
  const [to] = freeTargets(game);
  game = marchTo(game, to);
  const order = game.orders[0];
  const due = Date.parse(order.due_at);
  const mid = Math.round((T0 + due) / 2);
  game = haltOrder(game, HOUSE, order.id, { nowMs: mid });
  assert.equal(game.orders[0].due_at, FIELD_FOREVER);
  game = processDueOrders(game, map, constants, due + 10);
  assert.equal(game.orders[0].status, 'PENDING', 'a camp does not arrive');
  const later = due + 50_000;
  game = resumeOrder(game, HOUSE, order.id, { nowMs: later });
  assert.equal(Date.parse(game.orders[0].due_at), later + (due - mid));
  game = processDueOrders(game, map, constants, later + (due - mid));
  assert.equal(game.orders[0].status, 'RESOLVED');
});

test('an army turned home comes back to where it set out', () => {
  let game = borderGame(4, 1);
  const [to] = freeTargets(game);
  game = marchTo(game, to);
  const order = game.orders[0];
  const due = Date.parse(order.due_at);
  const quarter = T0 + Math.round((due - T0) / 4);
  game = redirectOrder(game, map, constants, HOUSE, order.id, CAPITAL, { nowMs: quarter });
  const back = Date.parse(game.orders[0].due_at);
  assert.ok(back - quarter <= (due - T0) / 4 + 2, 'the way back is the part already walked');
  game = processDueOrders(game, map, constants, back);
  assert.equal(game.orders[0].result.kind, 'RETURNED_HOME');
  assert.equal(game.state.territories[CAPITAL].warriors[HOUSE], 5);
});

test('an army on the road can be sent to another goal, and can stop part of the way', () => {
  let game = borderGame(4, 1);
  const targets = freeTargets(game);
  assert.ok(targets.length >= 2, 'two free goals near the capital');
  game = marchTo(game, targets[0]);
  const order = game.orders[0];
  const due = Date.parse(order.due_at);
  const mid = Math.round((T0 + due) / 2);
  game = redirectOrder(game, map, constants, HOUSE, order.id, targets[1], { nowMs: mid });
  assert.equal(game.orders[0].action.to, targets[1]);
  assert.ok(orderPlace(game.orders[0], mid), 'the army is still found on the road');
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  assert.equal(game.orders[0].status, 'RESOLVED');
  assert.equal(game.state.territories[targets[1]].owner, HOUSE);

  let other = marchTo(borderGame(4, 1), targets[0]);
  setHaltPoint(other.orders[0], 0.5, T0);
  other = processDueOrders(other, map, constants, Date.parse(other.orders[0].due_at));
  assert.equal(other.orders[0].status, 'PENDING');
  assert.ok(other.orders[0].halted, 'camped half way');
});
