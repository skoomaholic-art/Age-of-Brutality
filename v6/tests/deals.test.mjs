import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit, syncAuditFromJournal } from '../src/online/audit.mjs';
import { startRounds } from '../src/online/rounds.mjs';
import { recordExploration } from '../src/online/fog.mjs';
import { calculateNextDueAt } from '../src/online/scheduling.mjs';
import { nextEncounter, processEncounters } from '../src/online/encounters.mjs';
import {
  proposeDeal, acceptDeal, declineDeal, answerAiDeals, aiVerdict, dealsView, hasPassage,
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


test('a deal in two halves: gold for a land, sealed by the other House', () => {
  let game = borderGame(2, 2);
  game.state.houses[HOUSE].gold = 20;
  game = proposeDeal(game, constants, map, HOUSE, RIVAL, { give: [{ type: 'GOLD', amount: 12 }], take: [{ type: 'LAND', territory: NEXT }] }, { nowMs: T0 });
  assert.equal(dealsView(game, map, RIVAL).deals_in.length, 1);
  assert.equal(dealsView(game, map, THIRD).deals_in.length, 0);
  const rivalGold = game.state.houses[RIVAL].gold;
  game = acceptDeal(game, constants, map, RIVAL, HOUSE, { nowMs: T0 });
  assert.equal(game.state.territories[NEXT].owner, HOUSE);
  assert.equal(game.state.territories[NEXT].warriors[RIVAL] || 0, 0, 'the old garrison leaves');
  assert.equal(game.state.houses[HOUSE].gold, 8);
  assert.equal(game.state.houses[RIVAL].gold, rivalGold + 12);
  assert.ok(game.state.journal.some(e => e.kind === 'DEAL_MADE'));
});

test('a marriage in a deal makes the alliance, and only one marriage fits a letter', () => {
  let game = borderGame(1, 1);
  assert.throws(() => proposeDeal(game, constants, map, HOUSE, RIVAL, { give: [{ type: 'MARRIAGE' }], take: [{ type: 'MARRIAGE' }] }, { nowMs: T0 }), /только одна свадьба/);
  game = proposeDeal(game, constants, map, HOUSE, RIVAL, { give: [{ type: 'MARRIAGE' }], take: [] }, { nowMs: T0 });
  game = answerAiDeals(game, map, constants, [RIVAL], { nowMs: T0 });
  assert.equal(relationOf(game, HOUSE, RIVAL), RELATION.ALLIANCE);
});

test('the AI weighs a letter and refuses a bad bargain', () => {
  let game = borderGame(1, 1);
  game.state.houses[HOUSE].gold = 50;
  game = proposeDeal(game, constants, map, HOUSE, RIVAL, { give: [{ type: 'GOLD', amount: 1 }], take: [{ type: 'LAND', territory: NEXT }] }, { nowMs: T0 });
  assert.equal(aiVerdict(game, map, HOUSE, RIVAL).accept, false);
  game = answerAiDeals(game, map, constants, [RIVAL], { nowMs: T0 });
  assert.equal(game.state.territories[NEXT].owner, RIVAL);
  assert.ok(game.state.journal.some(e => e.kind === 'DEAL_REJECTED'));
  game = proposeDeal(game, constants, map, HOUSE, RIVAL, { give: [{ type: 'GOLD', amount: 3 }], take: [{ type: 'PASSAGE' }] }, { nowMs: T0 });
  game = answerAiDeals(game, map, constants, [RIVAL], { nowMs: T0 });
  assert.equal(hasPassage(game.state, RIVAL, HOUSE), true);
});

test('a capital is never part of a deal, and a declined letter is gone', () => {
  let game = borderGame(1, 1);
  assert.throws(() => proposeDeal(game, constants, map, HOUSE, RIVAL, { give: [{ type: 'LAND', territory: CAPITAL }] }, { nowMs: T0 }), /столицу/);
  game = proposeDeal(game, constants, map, HOUSE, RIVAL, { give: [{ type: 'PASSAGE' }] }, { nowMs: T0 });
  game = declineDeal(game, RIVAL, HOUSE, { nowMs: T0 });
  assert.equal(dealsView(game, map, RIVAL).deals_in.length, 0);
});
