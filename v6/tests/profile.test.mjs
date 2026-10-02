import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPasswordRecord,
  createProfileRecord,
  createProfileSessionCredentials,
  hashProfileToken,
  normalizeProfileHandle,
  parseProfileToken,
  publicProfile,
  safeHashEqual,
  verifyPassword
} from '../src/online/profile.mjs';

test('profile handle normalizes and validates unicode safely', () => {
  assert.equal(normalizeProfileHandle('  Skoomaholic  '), 'skoomaholic');
  assert.equal(normalizeProfileHandle('АЛЕКС_91'), 'алекс_91');
  assert.throws(() => normalizeProfileHandle('ab'), /login must be/);
  assert.throws(() => normalizeProfileHandle('bad/name'), /login must be/);
});

test('password is stored as scrypt hash and verifies', () => {
  const record = createPasswordRecord('correct horse battery staple', {
    salt: '00112233445566778899aabbccddeeff'
  });
  assert.equal(record.password_scheme, 'scrypt-v1');
  assert.notEqual(record.password_hash, 'correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', record), true);
  assert.equal(verifyPassword('wrong password', record), false);
});

test('profile public representation does not expose password material', () => {
  const profile = createProfileRecord({
    profileId: 'profile-1',
    handle: 'Skoomaholic',
    displayName: 'Alexander',
    password: 'password123',
    nowMs: 1000
  });
  const safe = publicProfile(profile);
  assert.equal(safe.id, 'profile-1');
  assert.equal(safe.handle, 'skoomaholic');
  assert.equal(safe.display_name, 'Alexander');
  assert.equal('password_hash' in safe, false);
  assert.equal('password_salt' in safe, false);
});

test('profile session token can be parsed and verified by hash', () => {
  const session = createProfileSessionCredentials({
    profileId: 'profile-1',
    sessionId: 'session-1',
    secret: 'secret-value',
    nowMs: 1000,
    lifetimeDays: 1
  });
  assert.equal(session.token, 'profile-1.session-1.secret-value');
  assert.deepEqual(parseProfileToken(session.token), {
    profile_id: 'profile-1',
    session_id: 'session-1'
  });
  assert.equal(
    safeHashEqual(session.token_hash, hashProfileToken(session.token)),
    true
  );
  assert.equal(
    safeHashEqual(session.token_hash, hashProfileToken('profile-1.session-1.wrong')),
    false
  );
});
