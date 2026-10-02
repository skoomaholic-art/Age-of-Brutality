import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import {
  createSnapshotEnvelope,
  restoreGameFromSnapshot
} from '../src/online/snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('snapshot roundtrip preserves game state and session', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1_000 });
  game.state.houses['Варкайр'].gold = 17;
  game.state.houses['Варкайр'].victory_points = 2;
  game.state.territories.W02.owner = 'Варкайр';
  game.state.territories.W02.warriors['Варкайр'] = 2;

  const snapshot = createSnapshotEnvelope(game, 2_000);
  const restored = restoreGameFromSnapshot(snapshot, map, constants, { nowMs: 3_000 });

  assert.equal(restored.session_id, game.session_id);
  assert.equal(restored.state.houses['Варкайр'].gold, 17);
  assert.equal(restored.state.houses['Варкайр'].victory_points, 2);
  assert.equal(restored.state.territories.W02.owner, 'Варкайр');
  assert.equal(restored.state.territories.W02.warriors['Варкайр'], 2);
  assert.equal(restored.last_snapshot_saved_at, snapshot.saved_at);
  assert.equal(restored.state.journal.at(-1).kind, 'SNAPSHOT_RESTORED');
});

test('invalid snapshot is rejected', () => {
  assert.throws(() => restoreGameFromSnapshot({
    schema_version: 1,
    saved_at: new Date().toISOString(),
    game: { id: 'wrong' }
  }, map, constants), /invalid snapshot game shape/);
});
