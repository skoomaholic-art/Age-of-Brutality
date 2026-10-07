import crypto from 'node:crypto';

export const GAME_STATUS = Object.freeze({
  LOBBY: 'LOBBY',
  RUNNING: 'RUNNING',
  FINISHED: 'FINISHED',
  ARCHIVED: 'ARCHIVED'
});

export const ACCESS_MODE = Object.freeze({
  ADMIN_SANDBOX: 'ADMIN_SANDBOX',
  PLAYER_BOUND: 'PLAYER_BOUND'
});

export const PLAYER_ROLE = Object.freeze({
  ADMIN: 'ADMIN',
  PLAYER: 'PLAYER',
  SPECTATOR: 'SPECTATOR'
});

export const GAME_MODE = Object.freeze({
  SOLO: 'SOLO',
  MULTIPLAYER: 'MULTIPLAYER'
});

export const GAME_VISIBILITY = Object.freeze({
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC'
});

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createInviteCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += INVITE_ALPHABET[crypto.randomInt(0, INVITE_ALPHABET.length)];
  }
  return out;
}

export function createPlayerCredentials({
  playerId = crypto.randomUUID(),
  secret = crypto.randomBytes(24).toString('base64url')
} = {}) {
  return {
    player_id: playerId,
    token: `${playerId}.${secret}`,
    token_hash: hashAccessToken(`${playerId}.${secret}`)
  };
}

export function hashAccessToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function playerIdFromToken(token) {
  const value = String(token || '');
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  return value.slice(0, dot);
}

export function safeTokenHashEqual(expected, actual) {
  const a = Buffer.from(String(expected || ''), 'hex');
  const b = Buffer.from(String(actual || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export function createLobbyMetadata(constants, {
  inviteCode = createInviteCode(),
  nowMs = Date.now(),
  accessMode = ACCESS_MODE.PLAYER_BOUND,
  gameMode = GAME_MODE.MULTIPLAYER,
  visibility = GAME_VISIBILITY.PRIVATE,
  roomName = null
} = {}) {
  const solo = gameMode === GAME_MODE.SOLO;
  return {
    status: GAME_STATUS.LOBBY,
    access_mode: accessMode,
    game_mode: gameMode,
    visibility,
    room_name: String(roomName || (solo ? 'Соло' : 'Новая комната')).trim().slice(0, 60),
    ruleset_version: constants.version,
    invite_code: inviteCode,
    created_at: new Date(nowMs).toISOString(),
    started_at: null,
    finished_at: null,
    archived_at: null,
    house_claims: {},
    player_count: 0,
    spectator_count: 0,
    max_players: solo ? 1 : constants.houses.length,
    start_requirement: solo ? 'ONE_HOUSE_FOR_SOLO' : 'TWO_HOUSES_AI_FILLS_THE_REST'
  };
}

export function normalizeGameMetadata(game, constants, {
  nowMs = Date.now(),
  defaultAccessMode = ACCESS_MODE.ADMIN_SANDBOX
} = {}) {
  const next = structuredClone(game);
  if (!next.ruleset_version) next.ruleset_version = constants.version;
  if (!next.lifecycle) {
    next.lifecycle = {
      status: defaultAccessMode === ACCESS_MODE.ADMIN_SANDBOX
        ? GAME_STATUS.RUNNING
        : GAME_STATUS.LOBBY,
      access_mode: defaultAccessMode,
      game_mode: GAME_MODE.MULTIPLAYER,
      visibility: GAME_VISIBILITY.PRIVATE,
      room_name: 'Prototype',
      ruleset_version: next.ruleset_version,
      invite_code: null,
      created_at: next.created_at || new Date(nowMs).toISOString(),
      started_at: defaultAccessMode === ACCESS_MODE.ADMIN_SANDBOX
        ? (next.created_at || new Date(nowMs).toISOString())
        : null,
      finished_at: null,
      archived_at: null,
      house_claims: {},
      player_count: 0,
      spectator_count: 0,
      max_players: constants.houses.length,
      start_requirement: 'TWO_HOUSES_AI_FILLS_THE_REST'
    };
  }
  if (!next.lifecycle.house_claims) next.lifecycle.house_claims = {};
  if (!next.lifecycle.game_mode) next.lifecycle.game_mode = GAME_MODE.MULTIPLAYER;
  if (!next.lifecycle.visibility) next.lifecycle.visibility = GAME_VISIBILITY.PRIVATE;
  if (!next.lifecycle.room_name) {
    next.lifecycle.room_name = next.lifecycle.game_mode === GAME_MODE.SOLO ? 'Соло' : 'Комната';
  }
  return next;
}

export function createPlayerRecord({
  playerId,
  tokenHash,
  displayName,
  role = PLAYER_ROLE.PLAYER,
  profileId = null,
  nowMs = Date.now()
}) {
  if (!playerId || !tokenHash) throw new Error('player credentials required');
  const name = String(displayName || '').trim();
  if (!name || name.length > 40) throw new Error('display name must be 1..40 characters');
  if (!Object.values(PLAYER_ROLE).includes(role)) throw new Error('invalid player role');

  return {
    id: playerId,
    display_name: name,
    role,
    house: null,
    profile_id: profileId || null,
    token_hash: tokenHash,
    joined_at: new Date(nowMs).toISOString(),
    last_seen_at: new Date(nowMs).toISOString()
  };
}

export function publicPlayer(player) {
  if (!player) return null;
  const { token_hash, ...safe } = player;
  return safe;
}

export function publicLifecycle(lifecycle) {
  if (!lifecycle) return null;
  return {
    ...lifecycle,
    invite_code: lifecycle.status === GAME_STATUS.LOBBY ? lifecycle.invite_code : null
  };
}

export function assertGameRunning(game) {
  const status = game.lifecycle?.status;
  if (status !== GAME_STATUS.RUNNING) throw new Error(`game is not running: ${status || 'UNKNOWN'}`);
}

export function assertHouseAccess(game, player, house, constants) {
  if (!constants.houses.includes(house)) throw new Error('unknown house');

  if (game.lifecycle?.access_mode === ACCESS_MODE.ADMIN_SANDBOX) {
    return true;
  }

  if (!player) throw new Error('authentication required');
  if (player.role === PLAYER_ROLE.SPECTATOR) throw new Error('spectators cannot control a house');
  if (player.house !== house) throw new Error('player cannot control this house');

  const claimedBy = game.lifecycle?.house_claims?.[house];
  if (claimedBy !== player.id) throw new Error('house ownership mismatch');
  return true;
}

export function canAdminister(player) {
  return player?.role === PLAYER_ROLE.ADMIN;
}

export const MIN_MULTIPLAYER_HOUSES = 2;

export function validateStart(game, constants) {
  if (game.lifecycle?.status !== GAME_STATUS.LOBBY) throw new Error('game is not in lobby');
  const claims = game.lifecycle?.house_claims || {};

  if (game.lifecycle?.game_mode === GAME_MODE.SOLO) {
    const claimed = constants.houses.filter(house => Boolean(claims[house]));
    if (claimed.length !== 1) {
      throw new Error('solo game requires exactly one claimed House');
    }
    return true;
  }

  // Houses nobody took are played by the House AI, so two players are enough.
  const claimed = constants.houses.filter(house => Boolean(claims[house]));
  if (claimed.length < MIN_MULTIPLAYER_HOUSES) {
    throw new Error(
      `a multiplayer game needs at least ${MIN_MULTIPLAYER_HOUSES} Houses with players; claimed: ${claimed.length}`
    );
  }
  return true;
}
