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

function marchBoth(game, mine, theirs) {
  let next = executeCommand(game, map, constants,
    { type: 'MARCH', house: HOUSE, from: CAPITAL, to: NEXT, warriors: mine }, { nowMs: T0 }).game;
  next = executeCommand(next, map, constants,
    { type: 'MARCH', house: RIVAL, from: NEXT, to: CAPITAL, warriors: theirs }, { nowMs: T0 }).game;
  return next;
}

test('neutral armies that meet head-on go to war and fight on the road', () => {
  let game = marchBoth(borderGame(4, 2), 4, 2);
  const met = nextEncounter(game);
  assert.ok(met, 'the two marches meet');
  const due = Date.parse(game.orders[0].due_at);
  assert.ok(met.at > T0 && met.at < due, 'they meet before either arrives');
  assert.equal(Date.parse(calculateNextDueAt(game)) <= Math.ceil(met.at), true, 'the meeting is scheduled');

  assert.equal(processEncounters(game, map, constants, met.at - 1), game, 'nothing before the meeting');
  game = processEncounters(game, map, constants, Math.ceil(met.at));

  assert.equal(relationOf(game, HOUSE, RIVAL), RELATION.WAR);
  const kinds = game.state.journal.map(e => e.kind);
  assert.ok(kinds.includes('WAR_DECLARED'));
  const battle = game.state.journal.find(e => e.kind === 'FIELD_BATTLE');
  assert.equal(battle.winner, HOUSE);
  assert.equal(battle.war_declared, true);

  const [mine, theirs] = game.orders;
  assert.equal(theirs.status, 'RESOLVED');
  assert.equal(theirs.result.kind, 'FIELD_BATTLE_DEFEAT');
  assert.equal(mine.status, 'PENDING');
  assert.equal(mine.action.warriors, battle.sides[0].survivors);
  assert.equal(game.state.territories[CAPITAL].warriors[HOUSE], 5 - battle.sides[0].losses);
  assert.equal(game.state.territories[NEXT].warriors[RIVAL] || 0, 3 - battle.sides[1].losses);

  // The victor still arrives and the usual rules settle the land.
  game = processDueOrders(game, map, constants, due);
  assert.equal(game.orders[0].status, 'RESOLVED');
  const synced = syncAuditFromJournal(game, map);
  assert.ok(synced.audit_log.some(item => item.type === 'FIELD_BATTLE' && /Встречный бой/.test(item.message)));
});

test('an even meeting sends both armies home', () => {
  let game = marchBoth(borderGame(3, 3), 3, 3);
  const met = nextEncounter(game);
  game = processEncounters(game, map, constants, Math.ceil(met.at));
  const battle = game.state.journal.find(e => e.kind === 'FIELD_BATTLE');
  assert.equal(battle.winner, null);
  assert.deepEqual(game.orders.map(o => o.status), ['RESOLVED', 'RESOLVED']);
});

test('allies pass each other without a fight', () => {
  let game = borderGame(4, 2);
  game = offerAlliance(game, constants, HOUSE, RIVAL, { nowMs: T0 });
  assert.deepEqual(diplomacyView(game, RIVAL).offers_in, [HOUSE]);
  assert.deepEqual(diplomacyView(game, THIRD).offers_in, []);
  game = acceptAlliance(game, constants, RIVAL, HOUSE, { nowMs: T0 });
  assert.equal(relationOf(game, HOUSE, RIVAL), RELATION.ALLIANCE);

  // Marching onto each other's land is still an attack, so use the meeting check alone.
  game = marchBoth(game, 4, 2);
  assert.equal(nextEncounter(game), null);
  assert.throws(() => offerAlliance(game, constants, THIRD, HOUSE, { nowMs: T0 }), /ещё не встретился/);
  game.contacts[THIRD] = [HOUSE];
  assert.throws(() => offerAlliance(game, constants, THIRD, HOUSE, { nowMs: T0 }), /уже есть союзник/);
});

test('attacking a land is war, and attacking an ally is treachery', () => {
  let game = borderGame(4, 2);
  game = acceptAlliance(offerAlliance(game, constants, HOUSE, RIVAL, { nowMs: T0 }), constants, RIVAL, HOUSE, { nowMs: T0 });
  game = executeCommand(game, map, constants,
    { type: 'MARCH', house: HOUSE, from: CAPITAL, to: NEXT, warriors: 4 }, { nowMs: T0 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  assert.equal(relationOf(game, HOUSE, RIVAL), RELATION.WAR);
  const war = game.state.journal.find(e => e.kind === 'WAR_DECLARED');
  assert.equal(war.betrayal, true);
});

test('a House led by the AI takes a free alliance and refuses a second', () => {
  let game = borderGame(1, 1);
  game = offerAlliance(game, constants, HOUSE, RIVAL, { nowMs: T0 });
  game = answerAiOffers(game, [RIVAL], { nowMs: T0 });
  assert.equal(relationOf(game, HOUSE, RIVAL), RELATION.ALLIANCE);
});

test('right of passage opens the host\'s roads, and war closes them', async () => {
  const { requestPassage, answerPassage, hasPassage, declareWar } = await import('../src/online/diplomacy.mjs');
  const { listQueueableMarches } = await import('../src/online/orders.mjs');
  let game = borderGame(4, 2);
  const beyond = [...adjacency.get(NEXT)].find(id => id !== CAPITAL && !adjacency.get(CAPITAL).has(id));
  const reaches = g => listQueueableMarches(g, map, constants, HOUSE).some(a => a.from === CAPITAL && a.to === beyond);
  assert.equal(reaches(game), false, 'no road through a foreign land');

  game = requestPassage(game, constants, HOUSE, RIVAL, { nowMs: T0 });
  assert.deepEqual(diplomacyView(game, RIVAL).passage_asked_in, [HOUSE]);
  game = answerPassage(game, constants, RIVAL, HOUSE, true, { nowMs: T0 });
  assert.equal(hasPassage(game.state, RIVAL, HOUSE), true);
  assert.equal(hasPassage(game.state, HOUSE, RIVAL), false, 'the right is one-way');
  assert.equal(reaches(game), true, 'the guest marches through');
  assert.equal(nextEncounter(marchBoth(game, 4, 2)), null, 'guest and host do not fight on the road');

  game = declareWar(game, constants, RIVAL, HOUSE, { nowMs: T0 });
  assert.equal(hasPassage(game.state, RIVAL, HOUSE), false);
  assert.equal(reaches(game), false);

  // A House led by the AI opens its roads when asked in peace.
  let asked = requestPassage(borderGame(1, 1), constants, HOUSE, RIVAL, { nowMs: T0 });
  asked = answerAiOffers(asked, [RIVAL], { nowMs: T0 });
  assert.equal(hasPassage(asked.state, RIVAL, HOUSE), true);
});

test('with right of passage warriors enter the host\'s land as guests', async () => {
  const { requestPassage, answerPassage } = await import('../src/online/diplomacy.mjs');
  const { listQueueableMarches } = await import('../src/online/orders.mjs');
  const { expelGuests } = await import('../src/online/guests.mjs');
  const { validateState } = await import('../src/core/state.mjs');
  let game = borderGame(4, 2);
  game = answerPassage(requestPassage(game, constants, HOUSE, RIVAL, { nowMs: T0 }), constants, RIVAL, HOUSE, true, { nowMs: T0 });

  game = executeCommand(game, map, constants, { type: 'MARCH', house: HOUSE, from: CAPITAL, to: NEXT, warriors: 3 }, { nowMs: T0 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders[0].due_at));
  assert.equal(game.orders[0].status, 'RESOLVED', game.orders[0].failure_reason || '');
  assert.equal(game.orders[0].result.kind, 'GUEST_MARCH');
  assert.equal(game.state.territories[NEXT].owner, RIVAL, 'the land stays the host\'s');
  assert.equal(game.state.territories[NEXT].warriors[RIVAL], 3, 'nobody fought');
  assert.equal(game.state.guests[NEXT][HOUSE], 3);
  assert.equal(relationOf(game, HOUSE, RIVAL), RELATION.NEUTRAL);
  assert.deepEqual(validateState(game.state, map, constants), []);

  // From the camp they march on: to a neutral land beyond, and take it.
  const beyond = [...adjacency.get(NEXT)].find(id => id !== CAPITAL && game.state.territories[id].owner === null);
  const onward = listQueueableMarches(game, map, constants, HOUSE).filter(a => a.from === NEXT && a.to === beyond);
  assert.ok(onward.length > 0, 'the camp is a starting point');
  let moved = executeCommand(game, map, constants, { type: 'MARCH', house: HOUSE, from: NEXT, to: beyond, warriors: 3 }, { nowMs: T0 + 1 }).game;
  moved = processDueOrders(moved, map, constants, Date.parse(moved.orders[1].due_at));
  assert.equal(moved.orders[1].status, 'RESOLVED', moved.orders[1].failure_reason || '');
  assert.equal(moved.state.territories[beyond].owner, HOUSE, 'the neutral land is taken from the camp');
  assert.equal(moved.state.journal.some(e => e.from === '__guest_origin__'), false);
  assert.deepEqual(validateState(moved.state, map, constants), []);

  // The host closes his roads: the guests are led home.
  const closed = expelGuests(answerPassage(game, constants, RIVAL, HOUSE, false, { nowMs: T0 }), map, constants, T0);
  assert.equal(closed.state.guests?.[NEXT], undefined);
  assert.equal(closed.state.territories[CAPITAL].warriors[HOUSE], 5);
  assert.ok(closed.state.journal.some(e => e.kind === 'GUESTS_EXPELLED'));
});
