import { Firestore } from '@google-cloud/firestore';
import { createOnlineGame } from './store.mjs';

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
    this.loadedExisting = false;
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

  async load() {
    const doc = await this.gameRef().get();
    if (!doc.exists) return null;

    const game = doc.data();
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
    game.state.journal = [];
    game.orders = orders;
    game.jobs = jobs;
    game.audit_log = auditLog;
    game.audit_journal_cursor = 0;

    const maxSeq = auditLog.reduce((max, item) => Math.max(max, Number(item.seq || 0)), 0);
    game.audit_seq = Math.max(Number(game.audit_seq || 1), maxSeq + 1);

    this.loadedExisting = true;
    this.orderCache = new Map(orders.map(item => [item.id, JSON.stringify(item)]));
    this.jobCache = new Map(jobs.map(item => [item.id, JSON.stringify(item)]));
    this.eventMaxSeq = maxSeq;

    return game;
  }

  async writeChangedCollection(ref, items, cache, idField = 'id') {
    const changed = [];
    for (const item of items) {
      const id = item?.[idField];
      if (!id) continue;
      const normalized = plain(item);
      const serialized = JSON.stringify(normalized);
      if (cache.get(id) === serialized) continue;
      changed.push([id, normalized, serialized]);
    }

    for (const group of chunk(changed)) {
      const batch = this.db.batch();
      for (const [id, normalized] of group) {
        batch.set(ref.doc(String(id)), normalized, { merge: true });
      }
      await batch.commit();
    }

    for (const [id, , serialized] of changed) cache.set(id, serialized);
  }

  async appendNewEvents(session, auditLog = []) {
    const fresh = auditLog
      .filter(item => Number(item.seq || 0) > this.eventMaxSeq)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));

    for (const group of chunk(fresh)) {
      const batch = this.db.batch();
      for (const item of group) {
        const seq = Number(item.seq || 0);
        const id = String(seq).padStart(10, '0');
        batch.set(session.collection('events').doc(id), plain(item), { merge: false });
      }
      await batch.commit();
    }

    if (fresh.length) {
      this.eventMaxSeq = Math.max(this.eventMaxSeq, ...fresh.map(item => Number(item.seq || 0)));
    }
  }

  async save(game) {
    const sessionId = game.session_id;
    if (!sessionId) throw new Error('cannot persist game without session_id');

    const gameRef = this.gameRef();
    const session = this.sessionRef(sessionId);
    const current = compactGameDoc(game);

    await Promise.all([
      gameRef.set({
        ...current,
        storage_backend: 'firestore',
        firestore_database: this.databaseId
      }, { merge: true }),
      session.set({
        session_id: sessionId,
        game_id: game.id,
        created_at: game.created_at,
        updated_at: game.updated_at,
        session_metrics: plain(game.session_metrics || {}),
        audit_seq: Number(game.audit_seq || 1)
      }, { merge: true })
    ]);

    await Promise.all([
      this.writeChangedCollection(session.collection('orders'), game.orders || [], this.orderCache),
      this.writeChangedCollection(session.collection('jobs'), game.jobs || [], this.jobCache),
      this.appendNewEvents(session, game.audit_log || [])
    ]);

    this.loadedExisting = true;
    return game;
  }

  async loadOrCreate(map, constants) {
    const existing = await this.load();
    if (existing) return existing;
    const created = createOnlineGame(map, constants);
    await this.save(created);
    this.loadedExisting = false;
    return created;
  }

  async reset(map, constants) {
    const created = createOnlineGame(map, constants);
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
      loaded_existing_game: this.loadedExisting
    };
  }
}
