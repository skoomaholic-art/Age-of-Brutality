import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { raiseLevy, startDrill, buildYard, processRanks, ranksView } from '../src/online/levy.mjs';
import { compAt, reconcileRanks, strengthOf, RANKS } from '../src/online/ranks.mjs';
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


const villageOf = game => map.territories.find(t => t.type === 'Деревня' && [...adjacency.get(CAPITAL)].includes(t.id))?.id;

test('the levy: villagers walk to the capital and arrive as villagers', () => {
  let game = borderGame(1, 1);
  const village = villageOf(game);
  game.state.territories[village].owner = HOUSE;
  game.state.houses[HOUSE].gold = 20;
  const view = ranksView(game, map, HOUSE, T0);
  assert.equal(view.levy[0].available, 2, 'a village gives two a day at first');
  game = raiseLevy(game, map, constants, HOUSE, [2, 0, 1], { nowMs: T0 });
  assert.equal(game.state.houses[HOUSE].gold, 20 - 2 * 1 - 1 * 3);
  const march = game.orders.find(o => o.action.from === village);
  assert.ok(march, 'the villagers set off');
  assert.deepEqual(march.action.ranks, [2, 0, 0, 0, 0, 0]);
  assert.equal(compAt(game.state, map, CAPITAL, HOUSE)[2], 1, 'a man-at-arms of the capital is there at once');
  game = processDueOrders(game, map, constants, Date.parse(march.due_at));
  const comp = compAt(game.state, map, CAPITAL, HOUSE);
  assert.equal(comp[0], 2 + 2, 'the old garrison and the new villagers');
  assert.throws(() => raiseLevy(game, map, constants, HOUSE, [5, 0, 0], { nowMs: T0 + 1 }), /не больше/);
});

test('the drill raises a rank, and the yard opens the higher ones', () => {
  let game = borderGame(5, 1);
  game.state.houses[HOUSE].gold = 40;
  game = startDrill(game, map, HOUSE, [3, 0, 0, 0], { nowMs: T0 });
  assert.throws(() => startDrill(game, map, HOUSE, [0, 0, 1, 0], { nowMs: T0 }), /учебном дворе|свободно/);
  const due = Date.parse(game.drills[HOUSE][0].due_at);
  game = processRanks(game, map, due);
  assert.deepEqual(compAt(game.state, map, CAPITAL, HOUSE).slice(0, 2), [3, 3]);
  assert.ok(game.state.journal.some(e => e.kind === 'DRILL_DONE'));
  game = buildYard(game, map, HOUSE, { nowMs: due });
  game = processRanks(game, map, Date.parse(game.yards[HOUSE].ready_at));
  game = startDrill(game, map, HOUSE, [0, 3, 0, 0], { nowMs: Date.parse(game.yards[HOUSE].ready_at) });
  game = processRanks(game, map, Date.parse(game.drills[HOUSE][0].due_at));
  game = startDrill(game, map, HOUSE, [0, 0, 3, 0], { nowMs: Date.parse(game.yards[HOUSE].ready_at) + 1e9 });
  game = processRanks(game, map, Date.parse(game.drills[HOUSE][0].due_at));
  assert.equal(compAt(game.state, map, CAPITAL, HOUSE)[3], 3, 'three latniki');
});

test('ranks add up as strength: few veterans beat many villagers', () => {
  let game = borderGame(3, 5);
  reconcileRanks(game.state, map);
  game.state.ranks[CAPITAL][HOUSE] = [1, 0, 0, 0, 3, 0];
  assert.equal(strengthOf(game.state.ranks[CAPITAL][HOUSE], 4), 13, 'a peasant and three mounted sergeants');
  game = executeCommand(game, map, constants, { type: 'MARCH', house: HOUSE, from: CAPITAL, to: NEXT, warriors: 3 }, { nowMs: T0 }).game;
  assert.deepEqual(game.orders[0].action.ranks, [0, 0, 0, 0, 3, 0], 'the march takes the strongest');
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  assert.equal(game.state.territories[NEXT].owner, HOUSE, 'three sergeants take a land held by six peasants');
  const comp = compAt(game.state, map, NEXT, HOUSE);
  assert.ok(comp[4] > 0, 'the survivors keep their kind');
});

test('archers hold walls better, and every star of experience adds a tenth', () => {
  assert.equal(strengthOf([0, 0, 4, 0, 0, 0], 4), 8);
  assert.equal(strengthOf([0, 0, 4, 0, 0, 0], 4, { defending: true }), 12);
  assert.equal(strengthOf([10, 0, 0, 0, 0, 0], 10, { stars: 3 }), 13);
});
