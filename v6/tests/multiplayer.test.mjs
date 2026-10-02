import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_MODE,
  GAME_STATUS,
  PLAYER_ROLE,
  assertHouseAccess,
  createInviteCode,
  createLobbyMetadata,
  createPlayerCredentials,
  createPlayerRecord,
  hashAccessToken,
  normalizeGameMetadata,
  playerIdFromToken,
  safeTokenHashEqual,
  validateStart
} from '../src/online/multiplayer.mjs';

const constants = {
  version: 'V6.TEST',
  houses: ['A', 'B', 'C', 'D', 'E', 'F']
};

test('player token stores only verifiable hash', () => {
  const credentials = createPlayerCredentials({ playerId: 'p1', secret: 'secret' });
  assert.equal(credentials.token, 'p1.secret');
  assert.equal(playerIdFromToken(credentials.token), 'p1');
  assert.equal(
    safeTokenHashEqual(credentials.token_hash, hashAccessToken(credentials.token)),
    true
  );
  assert.equal(
    safeTokenHashEqual(credentials.token_hash, hashAccessToken('p1.wrong')),
    false
  );
});

test('new lobby is player-bound and versioned', () => {
  const lifecycle = createLobbyMetadata(constants, {
    inviteCode: 'ABC123',
    nowMs: 1000
  });
  assert.equal(lifecycle.status, GAME_STATUS.LOBBY);
  assert.equal(lifecycle.access_mode, ACCESS_MODE.PLAYER_BOUND);
  assert.equal(lifecycle.ruleset_version, 'V6.TEST');
  assert.equal(lifecycle.invite_code, 'ABC123');
  assert.equal(lifecycle.max_players, 6);
});

test('legacy game normalizes to running admin sandbox', () => {
  const game = normalizeGameMetadata({
    id: 'prototype-1',
    created_at: '1970-01-01T00:00:01.000Z'
  }, constants, { nowMs: 1000 });
  assert.equal(game.lifecycle.status, GAME_STATUS.RUNNING);
  assert.equal(game.lifecycle.access_mode, ACCESS_MODE.ADMIN_SANDBOX);
});

test('player can control only claimed house', () => {
  const player = createPlayerRecord({
    playerId: 'p1',
    tokenHash: 'a'.repeat(64),
    displayName: 'Player',
    role: PLAYER_ROLE.PLAYER,
    nowMs: 1000
  });
  player.house = 'B';

  const game = {
    lifecycle: {
      status: GAME_STATUS.RUNNING,
      access_mode: ACCESS_MODE.PLAYER_BOUND,
      house_claims: { B: 'p1' }
    }
  };

  assert.equal(assertHouseAccess(game, player, 'B', constants), true);
  assert.throws(() => assertHouseAccess(game, player, 'A', constants), /cannot control/);
});

test('spectator cannot control a house', () => {
  const player = {
    id: 's1',
    role: PLAYER_ROLE.SPECTATOR,
    house: null
  };
  const game = {
    lifecycle: {
      access_mode: ACCESS_MODE.PLAYER_BOUND,
      house_claims: {}
    }
  };
  assert.throws(() => assertHouseAccess(game, player, 'A', constants), /spectators/);
});

test('current V6 reference start requires all six houses', () => {
  const game = {
    lifecycle: {
      status: GAME_STATUS.LOBBY,
      house_claims: { A:'1',B:'2',C:'3',D:'4',E:'5' }
    }
  };
  assert.throws(() => validateStart(game, constants), /missing: F/);
  game.lifecycle.house_claims.F = '6';
  assert.equal(validateStart(game, constants), true);
});

test('invite codes omit ambiguous characters', () => {
  for (let i = 0; i < 30; i += 1) {
    const code = createInviteCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  }
});
