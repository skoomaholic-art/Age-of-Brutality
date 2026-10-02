import { Firestore } from '@google-cloud/firestore';
import crypto from 'node:crypto';
import { createOnlineGame } from './store.mjs';
import { repairForeignWarriors } from '../core/state.mjs';
import {
  GAME_STATUS,
  PLAYER_ROLE,
  canAdminister,
  playerIdFromToken,
  hashAccessToken,
  safeTokenHashEqual,
  validateStart
} from './multiplayer.mjs';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortByIso(items, field = 'created_at') {
  return items.sort((a, b) => String(a?.[field] || '').localeCompare(String(b?.[field] || '')));
}

function compactGameDoc(game) {
  const next = structuredClone(game);
  delete next.orders;
  delete next.jobs;
  delete next.audit_log;
  if (next.state) next.state.journal = [];
  next.audit_journal_cursor = 0;
  return plain(next);
}

function compactCheckpoint(snapshot) {
  const payload = structuredClone(snapshot);
  if (payload?.game) {
    payload.game.audit_log = [];
    if (payload.game.state) payload.game.state.journal = [];
    payload.game.orders = (payload.game.orders || []).filter(item => item.status === 'PENDING');
    payload.game.jobs = (payload.game.jobs || []).filter(item => item.status === 'PENDING');
  }
  return plain(payload);
}

function chunk(items, size = 350) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class FirestoreGameStore {
  constructor({
    projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    databaseId = process.env.AOB_FIRESTORE_DATABASE || '(default)',
    gameId = 'prototype-1'
  } = {}) {
    this.projectId = projectId;
    this.databaseId = databaseId;
    this.gameId = gameId;

    const options = projectId ? { projectId } : {};
    if (databaseId && databaseId !== '(default)') options.databaseId = databaseId;

    this.db = new Firestore(options);
    this.loadedExistingAtStartup = null;
    this.orderCache = new Map();
    this.jobCache = new Map();
    this.eventMaxSeq = 0;
  }

  gameRef() {
    return this.db.collection('games').doc(this.gameId);
  }

  sessionRef(sessionId) {
    return this.gameRef().collection('sessions').doc(sessionId);
  }

  playersRef() {
    return this.gameRef().collection('players');
  }

  playerRef(playerId) {
    return this.playersRef().doc(String(playerId));
  }

  async getPlayer(playerId) {
    if (!playerId) return null;
    const doc = await this.playerRef(playerId).get();
    return doc.exists ? doc.data() : null;
  }

  async listPlayers() {
    const snap = await this.playersRef().orderBy('joined_at', 'asc').get();
    return snap.docs.map(doc => doc.data());
  }

  async authenticateToken(token) {
    const playerId = playerIdFromToken(token);
    if (!playerId) return null;
    const player = await this.getPlayer(playerId);
    if (!player) return null;
    const actual = hashAccessToken(token);
    if (!safeTokenHashEqual(player.token_hash, actual)) return null;
    return player;
  }

  async addPlayer(player) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(player.id);

    await this.db.runTransaction(async tx => {
      const [gameDoc, existingPlayer] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (existingPlayer.exists) throw new Error('player already joined');

      const game = gameDoc.data();
      const lifecycle = structuredClone(game.lifecycle || {});
      if (lifecycle.status !== GAME_STATUS.LOBBY) throw new Error('game is not joinable');

      if (player.role === PLAYER_ROLE.SPECTATOR) {
        lifecycle.spectator_count = Number(lifecycle.spectator_count || 0) + 1;
      } else {
        const current = Number(lifecycle.player_count || 0);
        const max = Number(lifecycle.max_players || 6);
        if (current >= max) throw new Error('game is full');
        lifecycle.player_count = current + 1;
      }

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.set(playerRef, plain(player), { merge: false });
      tx.update(gameRef, { lifecycle, state_revision: nextRevision });
    });

    return player;
  }

  async claimHouse(playerId, house, constants) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');
      if (!constants.houses.includes(house)) throw new Error('unknown house');

      const game = gameDoc.data();
      const player = playerDoc.data();
      const lifecycle = structuredClone(game.lifecycle || {});

      if (lifecycle.status !== GAME_STATUS.LOBBY) throw new Error('house selection is closed');
      if (player.role === PLAYER_ROLE.SPECTATOR) throw new Error('spectator cannot claim a house');

      const claims = structuredClone(lifecycle.house_claims || {});
      const occupiedBy = claims[house];
      if (occupiedBy && occupiedBy !== playerId) throw new Error('house already claimed');

      if (player.house && player.house !== house) {
        throw new Error('player already controls another house');
      }

      claims[house] = playerId;
      lifecycle.house_claims = claims;
      player.house = house;

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, { lifecycle, state_revision: nextRevision });
      tx.update(playerRef, { house });

      return { house, player_id: playerId };
    });
  }

  async startGame(playerId, constants, nowMs = Date.now()) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');

      const game = gameDoc.data();
      const player = playerDoc.data();
      if (!canAdminister(player)) throw new Error('admin role required');

      validateStart(game, constants);

      const lifecycle = structuredClone(game.lifecycle);
      lifecycle.status = GAME_STATUS.RUNNING;
      lifecycle.started_at = new Date(nowMs).toISOString();
      lifecycle.invite_code = null;

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, {
        lifecycle,
        updated_at: lifecycle.started_at,
        state_revision: nextRevision
      });
      return lifecycle;
    });
  }

  async finishGame(playerId, {
    nowMs = Date.now(),
    reason = null
  } = {}) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');

      const game = gameDoc.data();
      const player = playerDoc.data();
      if (!canAdminister(player)) throw new Error('admin role required');

      const lifecycle = structuredClone(game.lifecycle || {});
      if (lifecycle.status !== GAME_STATUS.RUNNING) {
        throw new Error('only a running game can be finished');
      }

      lifecycle.status = GAME_STATUS.FINISHED;
      lifecycle.finished_at = new Date(nowMs).toISOString();
      lifecycle.finish_reason = reason ? String(reason).slice(0, 200) : null;

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, {
        lifecycle,
        updated_at: lifecycle.finished_at,
        state_revision: nextRevision
      });

      return lifecycle;
    });
  }

  async archiveGame(playerId, nowMs = Date.now()) {
    const gameRef = this.gameRef();
    const playerRef = this.playerRef(playerId);

    return this.db.runTransaction(async tx => {
      const [gameDoc, playerDoc] = await Promise.all([
        tx.get(gameRef),
        tx.get(playerRef)
      ]);

      if (!gameDoc.exists) throw new Error('game not found');
      if (!playerDoc.exists) throw new Error('player not found');

      const game = gameDoc.data();
      const player = playerDoc.data();
      if (!canAdminister(player)) throw new Error('admin role required');

      const lifecycle = structuredClone(game.lifecycle || {});
      if (lifecycle.status !== GAME_STATUS.FINISHED) {
        throw new Error('only a finished game can be archived');
      }

      lifecycle.status = GAME_STATUS.ARCHIVED;
      lifecycle.archived_at = new Date(nowMs).toISOString();

      const nextRevision = Number(game.state_revision || 0) + 1;
      tx.update(gameRef, {
        lifecycle,
        updated_at: lifecycle.archived_at,
        state_revision: nextRevision
      });

      return lifecycle;
    });
  }

  async findGameIdByInviteCode(inviteCode) {
    const code = String(inviteCode || '').trim().toUpperCase();
    if (!code) return null;

    const snap = await this.db.collection('games')
      .where('lifecycle.invite_code', '==', code)
      .limit(2)
      .get();

    if (snap.empty) return null;
    const live = snap.docs.find(doc => doc.data()?.lifecycle?.status === GAME_STATUS.LOBBY);
    return live?.id || null;
  }


  commandReceiptRef(commandId) {
    const digest = crypto.createHash('sha256').update(String(commandId)).digest('hex');
    return this.gameRef().collection('command_receipts').doc(digest);
  }

  async getCommandReceipt(commandId) {
    if (!commandId) return null;
    const doc = await this.commandReceiptRef(commandId).get();
    return doc.exists ? doc.data() : null;
  }

  async load() {
    const doc = await this.gameRef().get();
    if (!doc.exists) return null;

    const game = doc.data();
    game.state_revision = Number(game.state_revision || 0);
    const sessionId = game.session_id;
    if (!sessionId) throw new Error('Firestore game is missing session_id');

    const session = this.sessionRef(sessionId);
    const [ordersSnap, jobsSnap, eventsSnap] = await Promise.all([
      session.collection('orders').get(),
      session.collection('jobs').get(),
      session.collection('events').orderBy('seq', 'desc').limit(2000).get()
    ]);

    const orders = sortByIso(ordersSnap.docs.map(d => d.data()));
    const jobs = sortByIso(jobsSnap.docs.map(d => d.data()));
    const auditLog = eventsSnap.docs.map(d => d.data()).reverse();

    if (!game.state) throw new Error('Firestore game is missing state');

    const repaired = repairForeignWarriors(game.state);
    game.state = repaired.state;
    game.state.journal = [];
    if (repaired.repairs.length) {
      game.state.journal.push({
        kind: 'STATE_REPAIR',
        reason: 'REMOVED_FOREIGN_WARRIORS',
        repairs: repaired.repairs
      });
    }

    game.orders = orders;
    game.jobs = jobs;
    game.audit_log = auditLog;
    game.audit_journal_cursor = 0;

    const maxSeq = auditLog.reduce((max, item) => Math.max(max, Number(item.seq || 0)), 0);
    game.audit_seq = Math.max(Number(game.audit_seq || 1), maxSeq + 1);

    this.orderCache = new Map(orders.map(item => [item.id, JSON.stringify(item)]));
    this.jobCache = new Map(jobs.map(item => [item.id, JSON.stringify(item)]));
    this.eventMaxSeq = maxSeq;

    return game;
  }

  changedCollectionItems(items, cache, idField = 'id') {
    const changed = [];
    for (const item of items) {
      const id = item?.[idField];
      if (!id) continue;
      const normalized = plain(item);
      const serialized = JSON.stringify(normalized);
      if (cache.get(id) === serialized) continue;
      changed.push([String(id), normalized, serialized]);
    }
    return changed;
  }

  freshEvents(auditLog = []) {
    return auditLog
      .filter(item => Number(item.seq || 0) > this.eventMaxSeq)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  }

  async save(game, {
    commandId = null,
    commandResponse = null,
    commandStatus = 200
  } = {}) {
    const sessionId = game.session_id;
    if (!sessionId) throw new Error('cannot persist game without session_id');

    const gameRef = this.gameRef();
    const session = this.sessionRef(sessionId);
    const expectedRevision = Number(game.state_revision || 0);
    const changedOrders = this.changedCollectionItems(game.orders || [], this.orderCache);
    const changedJobs = this.changedCollectionItems(game.jobs || [], this.jobCache);
    const freshEvents = this.freshEvents(game.audit_log || []);
    const receiptRef = commandId ? this.commandReceiptRef(commandId) : null;

    const writeCount =
      2 + changedOrders.length + changedJobs.length + freshEvents.length + (receiptRef ? 1 : 0);
    if (writeCount > 450) {
      throw new Error(`atomic Firestore write set too large: ${writeCount}`);
    }

    const result = await this.db.runTransaction(async tx => {
      const gameDoc = await tx.get(gameRef);
      let receiptDoc = null;
      if (receiptRef) receiptDoc = await tx.get(receiptRef);

      if (receiptDoc?.exists) {
        return { duplicate: true, receipt: receiptDoc.data() };
      }

      const currentRevision = gameDoc.exists
        ? Number(gameDoc.data()?.state_revision || 0)
        : 0;

      if (currentRevision !== expectedRevision) {
        const error = new Error(
          `stale game state: expected revision ${expectedRevision}, current ${currentRevision}`
        );
        error.code = 'STALE_GAME_STATE';
        throw error;
      }

      const nextRevision = expectedRevision + 1;
      game.state_revision = nextRevision;
      const current = compactGameDoc(game);

      tx.set(gameRef, {
        ...current,
        state_revision: nextRevision,
        storage_backend: 'firestore',
        firestore_database: this.databaseId
      }, { merge: false });

      tx.set(session, {
        session_id: sessionId,
        game_id: game.id,
        created_at: game.created_at,
        updated_at: game.updated_at,
        session_metrics: plain(game.session_metrics || {}),
        audit_seq: Number(game.audit_seq || 1),
        state_revision: nextRevision
      }, { merge: true });

      for (const [id, normalized] of changedOrders) {
        tx.set(session.collection('orders').doc(id), normalized, { merge: false });
      }
      for (const [id, normalized] of changedJobs) {
        tx.set(session.collection('jobs').doc(id), normalized, { merge: false });
      }
      for (const item of freshEvents) {
        const seq = Number(item.seq || 0);
        const id = String(seq).padStart(10, '0');
        tx.set(session.collection('events').doc(id), plain(item), { merge: false });
      }

      if (receiptRef) {
        tx.set(receiptRef, {
          command_id_hash: receiptRef.id,
          created_at: new Date().toISOString(),
          state_revision: nextRevision,
          status_code: Number(commandStatus || 200),
          response: plain(commandResponse || {})
        }, { merge: false });
      }

      return {
        duplicate: false,
        state_revision: nextRevision
      };
    });

    if (result.duplicate) return result;

    for (const [id, , serialized] of changedOrders) this.orderCache.set(id, serialized);
    for (const [id, , serialized] of changedJobs) this.jobCache.set(id, serialized);
    if (freshEvents.length) {
      this.eventMaxSeq = Math.max(
        this.eventMaxSeq,
        ...freshEvents.map(item => Number(item.seq || 0))
      );
    }

    return result;
  }

  async loadOrCreate(map, constants) {
    const existing = await this.load();
    if (existing) {
      this.loadedExistingAtStartup = true;
      return existing;
    }
    const created = createOnlineGame(map, constants, { id: this.gameId });
    await this.save(created);
    this.loadedExistingAtStartup = false;
    return created;
  }

  async reset(map, constants) {
    const created = createOnlineGame(map, constants, { id: this.gameId });
    this.orderCache = new Map();
    this.jobCache = new Map();
    this.eventMaxSeq = 0;
    await this.save(created);
    return created;
  }

  async saveCheckpoint(snapshot) {
    const payload = compactCheckpoint(snapshot);
    const savedAt = payload.saved_at || new Date().toISOString();
    const sessionId = payload.game?.session_id || 'unknown-session';
    const id = `${sessionId}_${savedAt.replace(/[:.]/g, '-')}`;

    await this.gameRef().collection('snapshots').doc(id).set({
      snapshot_id: id,
      session_id: sessionId,
      saved_at: savedAt,
      schema_version: Number(payload.schema_version || 1),
      payload
    });

    return { snapshot_id: id, saved_at: savedAt };
  }

  async latestCheckpoint() {
    const snap = await this.gameRef()
      .collection('snapshots')
      .orderBy('saved_at', 'desc')
      .limit(1)
      .get();

    if (snap.empty) return null;
    return snap.docs[0].data()?.payload || null;
  }

  status() {
    return {
      backend: 'firestore',
      project_id: this.projectId || null,
      database_id: this.databaseId,
      game_id: this.gameId,
      loaded_existing_at_startup: this.loadedExistingAtStartup
    };
  }
}
