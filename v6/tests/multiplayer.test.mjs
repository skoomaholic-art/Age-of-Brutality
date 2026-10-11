import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_MODE,
  GAME_STATUS,
  GAME_MODE,
  GAME_VISIBILITY,
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
  assert.equal(lifecycle.game_mode, GAME_MODE.MULTIPLAYER);
  assert.equal(lifecycle.visibility, GAME_VISIBILITY.PRIVATE);
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

test('a multiplayer game starts with two players; the House AI takes the rest', () => {
  const game = {
    lifecycle: {
      status: GAME_STATUS.LOBBY,
      house_claims: { A:'1' }
    }
  };
  assert.throws(() => validateStart(game, constants), /needs at least 2 Houses/);
  game.lifecycle.house_claims.B = '2';
  assert.equal(validateStart(game, constants), true);
  Object.assign(game.lifecycle.house_claims, { C:'3',D:'4',E:'5',F:'6' });
  assert.equal(validateStart(game, constants), true);
});

test('invite codes omit ambiguous characters', () => {
  for (let i = 0; i < 30; i += 1) {
    const code = createInviteCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  }
});


test('public multiplayer lobby keeps public visibility and room name', () => {
  const lifecycle = createLobbyMetadata(constants, {
    inviteCode: 'PUB234',
    nowMs: 1000,
    gameMode: GAME_MODE.MULTIPLAYER,
    visibility: GAME_VISIBILITY.PUBLIC,
    roomName: 'Комната 1'
  });
  assert.equal(lifecycle.game_mode, GAME_MODE.MULTIPLAYER);
  assert.equal(lifecycle.visibility, GAME_VISIBILITY.PUBLIC);
  assert.equal(lifecycle.room_name, 'Комната 1');
  assert.equal(lifecycle.max_players, 6);
  assert.equal(lifecycle.start_requirement, 'TWO_HOUSES_AI_FILLS_THE_REST');
});

test('solo lobby needs exactly one claimed house', () => {
  const game = {
    lifecycle: createLobbyMetadata(constants, {
      inviteCode: null,
      nowMs: 1000,
      gameMode: GAME_MODE.SOLO,
      visibility: GAME_VISIBILITY.PRIVATE,
      roomName: 'Соло'
    })
  };

  assert.equal(game.lifecycle.max_players, 1);
  assert.equal(game.lifecycle.invite_code, null);
  assert.equal(game.lifecycle.start_requirement, 'ONE_HOUSE_FOR_SOLO');
  assert.throws(() => validateStart(game, constants), /exactly one claimed House/);

  game.lifecycle.house_claims.A = 'p1';
  assert.equal(validateStart(game, constants), true);

  game.lifecycle.house_claims.B = 'p2';
  assert.throws(() => validateStart(game, constants), /exactly one claimed House/);
});
