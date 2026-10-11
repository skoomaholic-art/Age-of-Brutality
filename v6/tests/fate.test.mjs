import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit, syncAuditFromJournal } from '../src/online/audit.mjs';
import { startRounds } from '../src/online/rounds.mjs';
import { markCommanderFatePending, resolveCommanderFate } from '../src/core/characters.mjs';
import { validateState } from '../src/core/state.mjs';
import {
  AI_RANSOM,
  captiveAction,
  captivesView,
  fateDice,
  processCharacters,
  recoveryMs,
  settleFate
} from '../src/online/fate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const T0 = 1_000_000;
const DAY = 600_000;
const HOUSE = 'Варкайр';
const RIVAL = 'Сайрвен';

function freshGame(claims = constants.houses) {
  let game = createOnlineGame(map, constants, {
    id: 'fate-test', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null, characterCatalog
  });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  game.lifecycle.status = 'RUNNING';
  game.lifecycle.house_claims = Object.fromEntries(claims.map(h => [h, `p-${h}`]));
  return startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs: DAY });
}

const commanderOf = (game, house) =>
  Object.values(game.state.characters).find(c => c.house === house && c.mode === 'ARMY');

// Runs the Fate of HOUSE's commander after a defeat by `margin`.
function defeat(game, margin, { destroyed = false } = {}) {
  const commander = commanderOf(game, HOUSE);
  const next = structuredClone(game);
  next.state = markCommanderFatePending(next.state, commander.id, {
    battle_territory: map.capitals[HOUSE],
    opponent_house: RIVAL,
    side: 'DEFENDER',
    army_destroyed: destroyed,
    fallback_territory: destroyed ? null : map.capitals[HOUSE],
    created_at: new Date(T0).toISOString()
  });
  const dice = fateDice({ attackerStrength: 5 + margin, defenderStrength: 5 }, commander);
  const fate = resolveCommanderFate(next.state, map, constants, commander.id, dice, { nowMs: T0 });
  next.state = settleFate(fate.state, map, commander.id, { nowMs: T0, recovery: recoveryMs(next) });
  return { game: next, outcome: fate.result.outcome, id: commander.id };
}

test('a narrow defeat weakens, a heavy one captures, only a rout kills', () => {
  const game = freshGame();
  const survival = Number(commanderOf(game, HOUSE).stats.survival || 0);
  const outcomes = [];
  for (let margin = 0; margin <= 12; margin += 1) outcomes.push(defeat(game, margin).outcome);
  const firstCaptured = outcomes.indexOf('CAPTURED');
  const firstDead = outcomes.indexOf('DEAD');
  assert.ok(firstCaptured >= 3 + survival, outcomes.join(','));
  assert.ok(firstDead > firstCaptured, outcomes.join(','));
  assert.ok(outcomes.slice(0, firstCaptured).every(o => o === 'SAVED' || o === 'WEAKENED'));

  // Whoever is neither dead nor taken is weakened and recovers in half a day.
  const beaten = defeat(game, 0);
  const commander = beaten.game.state.characters[beaten.id];
  assert.equal(commander.health, 'WEAKENED');
  assert.equal(Date.parse(commander.weakened_until), T0 + DAY / 2);
  let later = processCharacters(beaten.game, map, constants, { nowMs: T0 + DAY / 2 - 1 });
  assert.equal(later.state.characters[beaten.id].health, 'WEAKENED');
  later = processCharacters(beaten.game, map, constants, { nowMs: T0 + DAY / 2 });
  assert.equal(later.state.characters[beaten.id].health, 'HEALTHY');

  // Beaten again while weakened, he fares worse.
  const again = defeat(beaten.game, firstCaptured - 1);
  assert.equal(again.outcome, 'CAPTURED');
});

test('a commander whose army is gone returns to court', () => {
  const beaten = defeat(freshGame(), 0, { destroyed: true });
  const commander = beaten.game.state.characters[beaten.id];
  assert.equal(commander.status, 'ACTIVE');
  assert.equal(commander.mode, 'COURT');
  assert.equal(commander.location.kind, 'COURT');
  assert.deepEqual(validateState(beaten.game.state, map, constants), []);
});

test('the captor decides: ransom, dungeon, release or the block', () => {
  const taken = defeat(freshGame(), 5);
  assert.equal(taken.outcome, 'CAPTURED');
  let game = taken.game;
  const id = taken.id;
  assert.equal(captivesView(game, map, RIVAL).held.length, 1);
  assert.equal(captivesView(game, map, RIVAL).held[0].prison_available, null);

  assert.throws(() => captiveAction(game, map, constants, { house: HOUSE, characterId: id, action: 'RELEASE' }), /не в твоих руках/);
  assert.throws(() => captiveAction(game, map, constants, { house: RIVAL, characterId: id, action: 'IMPRISON' }), /нужна крепость/);

  // Ransom demanded, refused, then the dungeon once there is a fort.
  game = captiveAction(game, map, constants, { house: RIVAL, characterId: id, action: 'RANSOM', amount: 4 }, { nowMs: T0 });
  assert.equal(game.state.characters[id].captivity.ransom_amount, 4);
  game = captiveAction(game, map, constants, { house: HOUSE, characterId: id, action: 'REFUSE_RANSOM' }, { nowMs: T0 });
  assert.equal(game.state.characters[id].captivity.decision_pending, true);
  game.state.territories[map.capitals[RIVAL]].fort = true;
  game = captiveAction(game, map, constants, { house: RIVAL, characterId: id, action: 'IMPRISON' }, { nowMs: T0 });
  assert.equal(game.state.characters[id].captivity.prison, map.capitals[RIVAL]);

  // Ransom paid: gold changes hands and he is home, weakened.
  let paid = captiveAction(game, map, constants, { house: RIVAL, characterId: id, action: 'RANSOM', amount: 3 }, { nowMs: T0 });
  const before = [paid.state.houses[HOUSE].gold, paid.state.houses[RIVAL].gold];
  paid = captiveAction(paid, map, constants, { house: HOUSE, characterId: id, action: 'PAY_RANSOM' }, { nowMs: T0 });
  assert.deepEqual([paid.state.houses[HOUSE].gold, paid.state.houses[RIVAL].gold], [before[0] - 3, before[1] + 3]);
  assert.equal(paid.state.characters[id].mode, 'COURT');
  assert.equal(paid.state.characters[id].health, 'WEAKENED');
  assert.deepEqual(validateState(paid.state, map, constants), []);

  // The dungeon falls to his own House: he walks free.
  const stormed = structuredClone(game);
  stormed.state.territories[map.capitals[RIVAL]].owner = HOUSE;
  const freed = processCharacters(stormed, map, constants, { nowMs: T0 });
  assert.equal(freed.state.characters[id].mode, 'COURT');

  // The block.
  const dead = captiveAction(game, map, constants, { house: RIVAL, characterId: id, action: 'EXECUTE' }, { nowMs: T0 });
  assert.equal(dead.state.characters[id].alive, false);
  const log = syncAuditFromJournal(dead, map, { nowMs: T0, emit: () => {} }).audit_log.map(item => item.type);
  for (const type of ['COMMANDER_FATE', 'RANSOM_DEMANDED', 'RANSOM_REFUSED', 'CAPTIVE_IMPRISONED', 'CAPTIVE_EXECUTED']) {
    assert.ok(log.includes(type), type);
  }
});

test('Houses nobody plays decide for themselves', () => {
  // The captor is an AI House, the owner a player: a ransom is demanded.
  let taken = defeat(freshGame([HOUSE]), 5);
  let game = processCharacters(taken.game, map, constants, { nowMs: T0 });
  assert.equal(game.state.characters[taken.id].captivity.ransom_amount, AI_RANSOM);
  // Refused and no fort: the AI lets him go.
  game = captiveAction(game, map, constants, { house: HOUSE, characterId: taken.id, action: 'REFUSE_RANSOM' }, { nowMs: T0 });
  game = processCharacters(game, map, constants, { nowMs: T0 });
  assert.equal(game.state.characters[taken.id].mode, 'COURT');

  // The owner is an AI House: it pays when it can.
  taken = defeat(freshGame([RIVAL]), 5);
  game = captiveAction(taken.game, map, constants, { house: RIVAL, characterId: taken.id, action: 'RANSOM', amount: 2 }, { nowMs: T0 });
  game = processCharacters(game, map, constants, { nowMs: T0 });
  assert.equal(game.state.characters[taken.id].mode, 'COURT');
});
