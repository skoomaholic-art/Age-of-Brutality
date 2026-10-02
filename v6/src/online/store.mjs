import { createInitialState } from '../core/state.mjs';
import {
  ACCESS_MODE,
  createLobbyMetadata,
  normalizeGameMetadata
} from './multiplayer.mjs';

export function createOnlineGame(map, constants, {
  id = 'prototype-1',
  nowMs = Date.now(),
  accessMode = ACCESS_MODE.ADMIN_SANDBOX,
  inviteCode = null,
  lifecycleOptions = {},
  characterCatalog = null
} = {}) {
  const now = new Date(nowMs).toISOString();
  const state = createInitialState(map, constants, characterCatalog);
  const sessionId = `S${nowMs}`;
  state.journal.push({ kind: 'SESSION_START', session_id: sessionId, at: now });

  const base = {
    id,
    session_id: sessionId,
    mode: 'PERSISTENT_PROTOTYPE',
    ruleset_version: constants.version,
    created_at: now,
    updated_at: now,
    next_order_id: 1,
    state,
    orders: []
  };

  if (accessMode === ACCESS_MODE.PLAYER_BOUND) {
    base.lifecycle = createLobbyMetadata(constants, {
      inviteCode: inviteCode === null ? null : inviteCode,
      nowMs,
      accessMode,
      ...lifecycleOptions
    });
  }

  return normalizeGameMetadata(base, constants, {
    nowMs,
    defaultAccessMode: accessMode
  });
}
