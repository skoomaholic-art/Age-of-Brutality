import { createInitialState } from '../core/state.mjs';

export function createOnlineGame(map, constants, {
  id = 'prototype-1',
  nowMs = Date.now()
} = {}) {
  const now = new Date(nowMs).toISOString();
  const state = createInitialState(map, constants);
  const sessionId = `S${nowMs}`;
  state.journal.push({ kind: 'SESSION_START', session_id: sessionId, at: now });

  return {
    id,
    session_id: sessionId,
    mode: 'PERSISTENT_PROTOTYPE',
    created_at: now,
    updated_at: now,
    next_order_id: 1,
    state,
    orders: []
  };
}
