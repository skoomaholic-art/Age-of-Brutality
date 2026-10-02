import crypto from 'node:crypto';

const HANDLE_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const SESSION_DAYS = 90;

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
    ...safe
  } = profile;
  return safe;
}
