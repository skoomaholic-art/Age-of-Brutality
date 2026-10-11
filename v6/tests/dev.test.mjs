import test from 'node:test';
import assert from 'node:assert/strict';
import { DEV_HANDLE, devAllowed, isDevOwner } from '../src/online/dev.mjs';
import { publicPlayer } from '../src/online/multiplayer.mjs';

const solo = { lifecycle: { game_mode: 'SOLO' } };
const table = { lifecycle: { game_mode: 'MULTIPLAYER' } };

test('developer mode belongs to one account and to nobody else', () => {
  assert.ok(isDevOwner({ handle: DEV_HANDLE }));
  assert.ok(isDevOwner({ handle: DEV_HANDLE.toUpperCase() }), 'the case of the handle does not matter');
  assert.ok(isDevOwner({ handle: ` ${DEV_HANDLE} ` }), 'nor the spaces around it');
  for (const other of [{ handle: 'skoom' }, { handle: '' }, {}, null, undefined, { handle: DEV_HANDLE + '1' }]) {
    assert.equal(isDevOwner(other), false, `${JSON.stringify(other)} must not own developer mode`);
  }
});

test('even the author has it only in his own solo game', () => {
  assert.equal(devAllowed(solo, { handle: DEV_HANDLE }), true);
  assert.equal(devAllowed(table, { handle: DEV_HANDLE }), false, 'never at a table with other people');
  assert.equal(devAllowed(solo, { handle: 'gost' }), false);
  assert.equal(devAllowed(solo, null), false);
  assert.equal(devAllowed(null, { handle: DEV_HANDLE }), false);
});

test('the right never leaves the server with a player record', () => {
  const sent = publicPlayer({ id: 'p1', house: 'Варкайр', token_hash: 'secret', dev_owner: true, profile_handle: DEV_HANDLE });
  assert.equal(sent.dev_owner, undefined);
  assert.equal(sent.profile_handle, undefined);
  assert.equal(sent.token_hash, undefined);
  assert.equal(sent.house, 'Варкайр');
});
