import fs from 'node:fs';
import path from 'node:path';
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

export class JsonGameStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    if (!fs.existsSync(this.filePath)) return null;
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  save(game) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(game, null, 2));
    fs.renameSync(tmp, this.filePath);
    return game;
  }

  loadOrCreate(map, constants) {
    const existing = this.load();
    if (existing) return existing;
    return this.save(createOnlineGame(map, constants));
  }

  reset(map, constants) {
    return this.save(createOnlineGame(map, constants));
  }
}
