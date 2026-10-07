import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { validateState } from '../src/core/state.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { normalizeOnlineEconomy, processEconomy } from '../src/online/economy.mjs';
import { processRounds, rankAiCommands, takeAiAction } from '../src/online/ai.mjs';
import { houseRoundStatus, passRound, startRounds } from '../src/online/rounds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const T0 = 1_000_000;

// A started solo game. With no `human`, all six Houses are played by the AI.
function soloGame(id, human = null) {
  let game = createOnlineGame(map, constants, {
    id,
    nowMs: T0,
    accessMode: 'PLAYER_BOUND',
    inviteCode: null,
    lifecycleOptions: { gameMode: 'SOLO' },
    characterCatalog
  });
  game = normalizeOnlineEconomy(game, T0);
  game.lifecycle.status = 'RUNNING';
  if (human) game.lifecycle.house_claims = { [human]: 'player-1' };
  return startRounds(game, map, constants, { nowMs: T0 });
}

function tick(game, nowMs) {
  let next = processDueOrders(game, map, constants, nowMs);
  next = processEconomy(next, map, constants, nowMs);
  return processRounds(next, map, constants, { nowMs });
}

test('in a solo game the five unclaimed Houses are AI and the player is not', () => {
  const game = soloGame('ai-solo', 'Эркай');
  assert.equal(game.rounds.ai_houses.length, 5);
  assert.equal(game.rounds.ai_houses.includes('Эркай'), false);
  assert.equal(game.rounds.deadline_at, null, 'a solo round waits for the player');
});

test('the AI opens by expanding or recruiting and decides the same way every time', () => {
  const game = soloGame('ai-open');
  const first = takeAiAction(game, map, constants, 'Варкайр', { nowMs: T0 + 1 });
  const again = takeAiAction(game, map, constants, 'Варкайр', { nowMs: T0 + 1 });

  assert.ok(['CAPTURE_NEUTRAL', 'RECRUIT'].includes(first.decision.kind), first.decision.kind);
  assert.deepEqual(first.decision.command, again.decision.command);
  assert.equal(houseRoundStatus(first.game, 'Варкайр').used, 1);
});

test('the AI never strips its capital below a garrison', () => {
  const game = soloGame('ai-garrison');
  for (const house of constants.houses) {
    const capital = map.capitals[house];
    for (const candidate of rankAiCommands(game, map, constants, house)) {
      if (candidate.command.type !== 'MARCH' || candidate.command.from !== capital) continue;
      assert.ok(candidate.command.warriors <= 2, `${house} would send ${candidate.command.warriors} of 4`);
    }
  }
});

test('an AI House with nothing worth doing ends its round instead of stalling', () => {
  const game = soloGame('ai-pass');
  const house = 'Варкайр';
  // No gold and a single warrior: no recruit, no fort, no march that keeps a garrison.
  game.state.houses[house].gold = 0;
  game.state.territories[map.capitals[house]].warriors[house] = 1;
  for (const character of Object.values(game.state.characters || {})) {
    if (character.house === house) character.location = null;
  }

  const acted = takeAiAction(game, map, constants, house, { nowMs: T0 + 1 });
  assert.equal(acted.decision.kind, 'PASS');
  assert.equal(houseRoundStatus(acted.game, house).done, true);
});

test('all-AI games always reach the automatic finish with a legal state at every step', () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    let game = soloGame(`ai-full-${seed}`);
    let now = T0;
    let ticks = 0;

    while (game.lifecycle.status === 'RUNNING') {
      ticks += 1;
      assert.ok(ticks < 3_000, `game ${seed} did not finish`);
      now += 1_000;
      game = tick(game, now);
      assert.deepEqual(validateState(game.state, map, constants), []);
      for (const house of constants.houses) {
        assert.ok(houseRoundStatus(game, house).used <= constants.actions_per_round);
      }
    }

    assert.equal(game.rounds.number, constants.rounds);
    assert.equal(game.lifecycle.finish_reason, 'ROUND_LIMIT');
    assert.ok(game.rounds.winners.length >= 1);
    assert.ok(
      Object.values(game.state.territories).filter(item => item.owner).length > 6,
      'the AI expanded beyond the six capitals'
    );
  }
});

test('the AI waits for the human player before a solo round can close', () => {
  const human = 'Эркай';
  let game = soloGame('ai-waits', human);
  let now = T0;
  for (let i = 0; i < 200; i += 1) {
    now += 1_000;
    game = tick(game, now);
  }
  assert.equal(game.rounds.number, 1, 'round 1 stays open for the player');
  assert.ok(game.rounds.ai_houses.every(house => houseRoundStatus(game, house).done));

  game = passRound(game, human, now + 1);
  game = tick(game, now + 2);
  assert.equal(game.rounds.number, 2);
});
