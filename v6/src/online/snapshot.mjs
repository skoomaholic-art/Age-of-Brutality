import { validateState } from '../core/state.mjs';
import { normalizeOnlineEconomy } from './economy.mjs';
import { normalizeAudit } from './audit.mjs';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export function createSnapshotEnvelope(game, nowMs = Date.now()) {
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    saved_at: new Date(nowMs).toISOString(),
    game: structuredClone(game)
  };
}

function basicGameShape(game) {
  return Boolean(
    game &&
    typeof game === 'object' &&
    game.id === 'prototype-1' &&
    game.mode === 'PERSISTENT_PROTOTYPE' &&
    game.state &&
    typeof game.state === 'object' &&
    game.state.houses &&
    game.state.territories &&
    Array.isArray(game.orders)
  );
}

export function restoreGameFromSnapshot(payload, map, constants, {
  nowMs = Date.now()
} = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('snapshot payload must be an object');
  }
  if (Number(payload.schema_version) !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('unsupported snapshot schema version');
  }
  if (!basicGameShape(payload.game)) {
    throw new Error('invalid snapshot game shape');
  }

  let next = structuredClone(payload.game);
  next = normalizeOnlineEconomy(next, nowMs);
  next = normalizeAudit(next);

  const errors = validateState(next.state, map, constants);
  if (errors.length) {
    throw new Error(`snapshot state invalid: ${errors.join('; ')}`);
  }

  if (!Array.isArray(next.state.journal)) next.state.journal = [];
  next.state.journal.push({
    kind: 'SNAPSHOT_RESTORED',
    at: new Date(nowMs).toISOString(),
    snapshot_saved_at: payload.saved_at || null
  });
  next.updated_at = new Date(nowMs).toISOString();
  next.last_restored_at = new Date(nowMs).toISOString();
  next.last_snapshot_saved_at = payload.saved_at || null;
  return next;
}
