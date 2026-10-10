import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { buildVictoryStatus } from '../src/core/victory.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { journalEntryToAudit } from '../src/online/audit.mjs';
import { GAME_STATUS, PLAYER_ROLE, planLeave } from '../src/online/multiplayer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const NOW = Date.parse('2026-10-07T09:00:00Z');

const host = { id: 'p1', role: PLAYER_ROLE.ADMIN, house: 'Варкайр', display_name: 'Алекс', joined_at: '2026-10-07T08:00:00Z' };
const second = { id: 'p2', role: PLAYER_ROLE.PLAYER, house: 'Сайрвен', display_name: 'Мира', joined_at: '2026-10-07T08:01:00Z' };
const third = { id: 'p3', role: PLAYER_ROLE.PLAYER, house: 'Ортайн', display_name: 'Тим', joined_at: '2026-10-07T08:02:00Z' };

function lifecycle(status, players) {
  return {
    status,
    game_mode: 'MULTIPLAYER',
    player_count: players.length,
    spectator_count: 0,
    house_claims: Object.fromEntries(players.map(player => [player.house, player.id]))
  };
}

test('leaving a running game with other players turns the House into an abandoned realm', () => {
  const plan = planLeave(lifecycle(GAME_STATUS.RUNNING, [host, second, third]), second, [host, third], NOW);

  assert.equal(plan.abandonedHouse, 'Сайрвен');
  assert.equal(plan.archived, false);
  assert.equal(plan.lifecycle.status, GAME_STATUS.RUNNING);
  assert.equal(plan.lifecycle.house_claims['Сайрвен'], undefined, 'nobody controls the realm any more');
  assert.equal(plan.lifecycle.abandoned_houses['Сайрвен'].display_name, 'Мира');
  assert.equal(plan.lifecycle.player_count, 2);
  assert.equal(plan.promote, null);
});

test('when the host leaves, the longest-standing remaining player becomes host', () => {
  const plan = planLeave(lifecycle(GAME_STATUS.RUNNING, [host, second, third]), host, [third, second], NOW);
  assert.equal(plan.promote, 'p2');
  assert.equal(plan.abandonedHouse, 'Варкайр');
});

test('the last player out, or a solo player, closes the game instead of abandoning a realm', () => {
  const plan = planLeave(lifecycle(GAME_STATUS.RUNNING, [host]), host, [], NOW);
  assert.equal(plan.archived, true);
  assert.equal(plan.lifecycle.status, GAME_STATUS.ARCHIVED);
  assert.equal(plan.abandonedHouse, null);
});

test('leaving a room that has not started just frees the House', () => {
  const plan = planLeave(lifecycle(GAME_STATUS.LOBBY, [host, second]), second, [host], NOW);
  assert.equal(plan.abandonedHouse, null);
  assert.equal(plan.lifecycle.abandoned_houses, undefined);
  assert.equal(plan.lifecycle.house_claims['Сайрвен'], undefined);
  assert.equal(plan.lifecycle.status, GAME_STATUS.LOBBY);
});

test('a spectator leaves without touching any House', () => {
  const watcher = { id: 'w1', role: PLAYER_ROLE.SPECTATOR, house: null };
  const before = lifecycle(GAME_STATUS.RUNNING, [host, second]);
  before.spectator_count = 1;
  const plan = planLeave(before, watcher, [host, second], NOW);
  assert.equal(plan.lifecycle.spectator_count, 0);
  assert.equal(plan.lifecycle.player_count, 2);
  assert.equal(plan.abandonedHouse, null);
  assert.equal(plan.archived, false);
});

test('a closed game cannot be left again', () => {
  assert.throws(
    () => planLeave(lifecycle(GAME_STATUS.ARCHIVED, [host]), host, [], NOW),
    /game is closed/
  );
});

test('an abandoned realm stays in the standings but cannot win', () => {
  const game = createOnlineGame(map, constants, { id: 'leave-victory', nowMs: NOW });
  game.state.houses['Сайрвен'].victory_points = 5;
  game.state.houses['Ортайн'].victory_points = 2;
  game.lifecycle = { status: 'FINISHED', abandoned_houses: { 'Сайрвен': { at: 'x' } } };

  const victory = buildVictoryStatus(game, map, constants);
  assert.equal(victory.standings[0].house, 'Сайрвен');
  assert.equal(victory.standings[0].abandoned, true);
  assert.deepEqual(victory.winners, ['Ортайн']);
});

test('the chronicle tells the other players about the abandoned realm', () => {
  const game = createOnlineGame(map, constants, { id: 'leave-audit', nowMs: NOW });
  const item = journalEntryToAudit(
    { kind: 'HOUSE_ABANDONED', house: 'Сайрвен', player_name: 'Мира', at: 'x' },
    map,
    game
  );
  assert.match(item.message, /Дом Сайрвен постигла смута/);
  assert.match(item.message, /Мира/);
  assert.match(item.message, /разбойники и варвары/);
});

test('an abandoned House is played on by the House AI', async () => {
  const { runAiHouses } = await import('../src/online/ai.mjs');
  const { createOnlineGame } = await import('../src/online/store.mjs');
  const { startRounds } = await import('../src/online/rounds.mjs');
  const { normalizeOnlineEconomy } = await import('../src/online/economy.mjs');
  const { normalizeAudit } = await import('../src/online/audit.mjs');
  const { loadJson } = await import('../src/core/map.mjs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const map = loadJson(path.join(root, 'src/data/map.v6.json'));
  const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
  const T0 = 1_700_000_000_000;

  const left = constants.houses[0];
  let game = createOnlineGame(map, constants, { id: 'left-behind', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  game.lifecycle.status = 'RUNNING';
  // Every House is taken by a player, so none of them is an AI House to begin with.
  game.lifecycle.house_claims = Object.fromEntries(constants.houses.map((house, i) => [house, `P${i}`]));
  game = startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs: 600_000 });
  assert.deepEqual(game.rounds.ai_houses, []);

  // The player walks away: the House is abandoned, and the AI picks it up.
  game.lifecycle.abandoned_houses = { [left]: { display_name: 'Мира', at: new Date(T0).toISOString() } };
  game.rounds.ai_next_at = {};
  const after = runAiHouses(game, map, constants, { nowMs: T0 + 60_000 });
  assert.notEqual(after, game, 'the abandoned House took its turn');
  assert.ok(after.rounds.ai_next_at[left], 'and is now on the AI clock');
});
