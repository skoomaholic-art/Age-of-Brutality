import crypto from 'node:crypto';

const HANDLE_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const SESSION_DAYS = 90;

export const PROFILE_AVATARS = Object.freeze([
  'sigil-01','sigil-02','sigil-03','sigil-04',
  'sigil-05','sigil-06','sigil-07','sigil-08',
  'sigil-09','sigil-10','sigil-11','sigil-12'
]);

export const PROFILE_MMR = Object.freeze({
  initial: 1000,
  winDelta: 25,
  lossDelta: 25
});

export function normalizeAvatarId(value) {
  const avatarId = String(value || 'sigil-01');
  if (!PROFILE_AVATARS.includes(avatarId)) throw new Error('invalid avatar');
  return avatarId;
}

export function normalizeProfileStats(stats = {}) {
  const achievements = Array.isArray(stats.achievements)
    ? [...new Set(stats.achievements.map(String))].slice(0, 500)
    : [];

  return {
    games_played: Math.max(0, Number(stats.games_played || 0)),
    wins: Math.max(0, Number(stats.wins || 0)),
    losses: Math.max(0, Number(stats.losses || 0)),
    mmr: Math.max(0, Number.isFinite(Number(stats.mmr)) ? Number(stats.mmr) : PROFILE_MMR.initial),
    play_seconds: Math.max(0, Number(stats.play_seconds || 0)),
    achievements
  };
}

export function applyRankedResult(stats, { won }) {
  const next = normalizeProfileStats(stats);
  next.games_played += 1;
  if (won) {
    next.wins += 1;
    next.mmr += PROFILE_MMR.winDelta;
  } else {
    next.losses += 1;
    next.mmr = Math.max(0, next.mmr - PROFILE_MMR.lossDelta);
  }
  return next;
}

export function normalizeProfileHandle(value) {
  const handle = String(value || '').trim().normalize('NFKC').toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    throw new Error('login must be 3..24 letters, numbers, dot, dash or underscore');
  }
  return handle;
}

export function validateProfilePassword(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    throw new Error(`password must be ${PASSWORD_MIN}..${PASSWORD_MAX} characters`);
  }
  return value;
}

export function createPasswordRecord(password, {
  salt = crypto.randomBytes(16).toString('hex')
} = {}) {
  const value = validateProfilePassword(password);
  const hash = crypto.scryptSync(value, salt, 64).toString('hex');
  return {
    password_salt: salt,
    password_hash: hash,
    password_scheme: 'scrypt-v1'
  };
}

export function verifyPassword(password, record) {
  const value = validateProfilePassword(password);
  const salt = String(record?.password_salt || '');
  const expectedHex = String(record?.password_hash || '');
  if (!salt || !expectedHex) return false;

  const actual = crypto.scryptSync(value, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createProfileRecord({
  profileId = crypto.randomUUID(),
  handle,
  displayName,
  password,
  nowMs = Date.now()
}) {
  const normalizedHandle = normalizeProfileHandle(handle);
  const name = String(displayName || handle || '').trim();
  if (!name || name.length > 40) {
    throw new Error('display name must be 1..40 characters');
  }

  return {
    id: profileId,
    handle: normalizedHandle,
    display_name: name,
    avatar_id: 'sigil-01',
    stats: normalizeProfileStats(),
    activity: {
      last_game_heartbeat_at: null
    },
    ...createPasswordRecord(password),
    created_at: new Date(nowMs).toISOString(),
    updated_at: new Date(nowMs).toISOString()
  };
}

export function createProfileSessionCredentials({
  profileId,
  sessionId = crypto.randomUUID(),
  secret = crypto.randomBytes(32).toString('base64url'),
  nowMs = Date.now(),
  lifetimeDays = SESSION_DAYS
} = {}) {
  if (!profileId) throw new Error('profile id required');
  const token = `${profileId}.${sessionId}.${secret}`;
  return {
    profile_id: profileId,
    session_id: sessionId,
    token,
    token_hash: hashProfileToken(token),
    created_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + lifetimeDays * 24 * 60 * 60 * 1000).toISOString()
  };
}

export function hashProfileToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function parseProfileToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some(part => !part)) return null;
  return {
    profile_id: parts[0],
    session_id: parts[1]
  };
}

export function safeHashEqual(expectedHex, actualHex) {
  const expected = Buffer.from(String(expectedHex || ''), 'hex');
  const actual = Buffer.from(String(actualHex || ''), 'hex');
  return expected.length === actual.length &&
    expected.length > 0 &&
    crypto.timingSafeEqual(expected, actual);
}

export function publicProfile(profile) {
  if (!profile) return null;
  const {
    password_hash,
    password_salt,
    password_scheme,
    activity,
    ...safe
  } = profile;
  return {
    ...safe,
    avatar_id: normalizeAvatarId(profile.avatar_id || 'sigil-01'),
    stats: normalizeProfileStats(profile.stats)
  };
}
