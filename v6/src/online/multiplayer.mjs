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
  accessMode = ACCESS_MODE.PLAYER_BOUND
} = {}) {
  return {
    status: GAME_STATUS.LOBBY,
    access_mode: accessMode,
    ruleset_version: constants.version,
    invite_code: inviteCode,
    created_at: new Date(nowMs).toISOString(),
    started_at: null,
    finished_at: null,
    archived_at: null,
    house_claims: {},
    player_count: 0,
    spectator_count: 0,
    max_players: constants.houses.length,
    start_requirement: 'ALL_SIX_HOUSES_FOR_V6_REFERENCE'
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
      start_requirement: 'ALL_SIX_HOUSES_FOR_V6_REFERENCE'
    };
  }
  if (!next.lifecycle.house_claims) next.lifecycle.house_claims = {};
  return next;
}

export function createPlayerRecord({
  playerId,
  tokenHash,
  displayName,
  role = PLAYER_ROLE.PLAYER,
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

export function validateStart(game, constants) {
  if (game.lifecycle?.status !== GAME_STATUS.LOBBY) throw new Error('game is not in lobby');
  const claims = game.lifecycle?.house_claims || {};
  const missing = constants.houses.filter(house => !claims[house]);
  if (missing.length) {
    throw new Error(
      `current V6 reference rules require all six Houses before start; missing: ${missing.join(', ')}`
    );
  }
  return true;
}
