import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { startRide, processRiders } from '../src/online/riders.mjs';
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


test('a lord rides out to his army and takes command only when he gets there', () => {
  let game = borderGame(4, 1);
  const [to] = freeTargets(game);
  game = marchTo(game, to, 2);
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  const courtier = Object.values(game.state.characters).find(c => c.house === HOUSE && c.mode === 'COURT' && c.age === 'ADULT' && c.alive);
  assert.ok(courtier, 'someone at court');
  const t1 = Date.parse(game.orders[0].due_at) + 10;
  game = startRide(game, map, constants, { house: HOUSE, characterId: courtier.id, position: to }, { nowMs: t1 });
  assert.equal(game.state.characters[courtier.id].mode, 'COURT', 'not yet in command');
  const due = Date.parse(game.riders[0].due_at);
  assert.ok(due > t1, 'the ride takes time');
  game = processRiders(game, map, constants, due);
  assert.equal(game.state.characters[courtier.id].mode, 'ARMY');
  assert.equal(game.riders.length, 0);
});

test('a lord riding through a land taken by an enemy at war is caught', async () => {
  const { declareWar } = await import('../src/online/diplomacy.mjs');
  let game = borderGame(4, 1);
  const [to] = freeTargets(game);
  game = marchTo(game, to, 2);
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  const courtier = Object.values(game.state.characters).find(c => c.house === HOUSE && c.mode === 'COURT' && c.age === 'ADULT' && c.alive);
  const t1 = Date.parse(game.orders[0].due_at) + 10;
  game = startRide(game, map, constants, { house: HOUSE, characterId: courtier.id, position: to }, { nowMs: t1 });
  game = declareWar(game, constants, HOUSE, RIVAL, { nowMs: t1 });
  game.state.territories[to].owner = RIVAL;
  game.state.territories[to].warriors = { [RIVAL]: 1 };
  game = processRiders(game, map, constants, Date.parse(game.riders[0].due_at));
  assert.equal(game.state.characters[courtier.id].mode, 'CAPTIVE');
  assert.equal(game.state.characters[courtier.id].captivity.held_by, RIVAL);
});
