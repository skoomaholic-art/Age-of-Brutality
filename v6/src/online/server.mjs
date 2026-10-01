import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateMarches } from '../core/legal-actions.mjs';
import { loadJson } from '../core/map.mjs';
import { FirestoreGameStore } from './firestore-store.mjs';
import {
  ONLINE_TIMING,
  listQueueableMarches,
  processDueOrders,
  queueTimedOrder
} from './orders.mjs';
import {
  ONLINE_ECONOMY_TIMING,
  economyView,
  normalizeOnlineEconomy,
  processEconomy,
  queueFortJob,
  queueRecruitJob
} from './economy.mjs';
import {
  emitCloudAudit,
  normalizeAudit,
  sessionSummary,
  syncAuditFromJournal
} from './audit.mjs';
import {
  createSnapshotEnvelope,
  restoreGameFromSnapshot
} from './snapshot.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v6Root = path.resolve(here, '../..');
const map = loadJson(path.join(v6Root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(v6Root, 'src/data/constants.v6.json'));

const store = new FirestoreGameStore({
  gameId: process.env.AOB_GAME_ID || 'prototype-1',
  databaseId: process.env.AOB_FIRESTORE_DATABASE || '(default)'
});

async function finalizeGame(next, nowMs = Date.now()) {
  const audited = syncAuditFromJournal(next, map, {
    nowMs,
    emit: emitCloudAudit
  });
  await store.save(audited);
  return audited;
}

let game = normalizeAudit(normalizeOnlineEconomy(await store.loadOrCreate(map, constants)));
game = await finalizeGame(game);

let operationChain = Promise.resolve();

function serial(fn) {
  const run = operationChain.then(fn, fn);
  operationChain = run.catch(() => {});
  return run;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 5_000_000) throw new Error('request body too large');
  }
  if (!body) return {};
  return JSON.parse(body);
}

async function tickUnlocked() {
  const nowMs = Date.now();
  let processed = processDueOrders(game, map, constants, nowMs);
  processed = processEconomy(processed, map, constants, nowMs);
  if (
    processed.updated_at !== game.updated_at ||
    processed.state.journal.length !== game.state.journal.length
  ) {
    game = await finalizeGame(processed, nowMs);
  }
}

function publicState() {
  return {
    game,
    storage: store.status(),
    map: {
      territories: map.territories,
      coordinates: map.coordinates,
      land_edges: map.land_edges,
      sea_edges: map.sea_edges,
      ports: map.ports,
      capitals: map.capitals
    },
    houses: constants.houses,
    timing: {
      ...ONLINE_TIMING,
      ...ONLINE_ECONOMY_TIMING
    }
  };
}

function preserveAuditHistory(restored, current) {
  restored.audit_log = structuredClone(current.audit_log || []);
  restored.audit_seq = Math.max(
    Number(restored.audit_seq || 1),
    Number(current.audit_seq || 1)
  );
  restored.session_metrics = structuredClone(current.session_metrics || restored.session_metrics || {});
  restored.audit_journal_cursor = 0;
  return restored;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(v6Root, 'online/index.html'), 'utf8');
      return text(res, 200, html, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/storage') {
      return json(res, 200, store.status());
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const payload = await serial(async () => {
        await tickUnlocked();
        return publicState();
      });
      return json(res, 200, payload);
    }

    if (req.method === 'GET' && url.pathname === '/api/snapshot') {
      const payload = await serial(async () => {
        await tickUnlocked();
        return createSnapshotEnvelope(game);
      });
      return json(res, 200, payload);
    }

    if (req.method === 'POST' && url.pathname === '/api/snapshot') {
      const saved = await serial(async () => {
        await tickUnlocked();
        const envelope = createSnapshotEnvelope(game);
        return store.saveCheckpoint(envelope);
      });
      return json(res, 201, { saved: true, ...saved });
    }

    if (req.method === 'GET' && url.pathname === '/api/snapshot/latest') {
      const snapshot = await store.latestCheckpoint();
      if (!snapshot) return json(res, 404, { error: 'no snapshot found' });
      return json(res, 200, snapshot);
    }

    if (req.method === 'POST' && url.pathname === '/api/snapshot/restore-latest') {
      const result = await serial(async () => {
        const snapshot = await store.latestCheckpoint();
        if (!snapshot) throw new Error('no snapshot found');

        let restored = restoreGameFromSnapshot(snapshot, map, constants);
        restored = preserveAuditHistory(restored, game);
        game = await finalizeGame(restored);

        return {
          restored: true,
          game_id: game.id,
          session_id: game.session_id,
          restored_at: game.last_restored_at,
          snapshot_saved_at: game.last_snapshot_saved_at
        };
      });
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/snapshot/restore') {
      const body = await readBody(req);
      const result = await serial(async () => {
        game = restoreGameFromSnapshot(body, map, constants);
        game = await finalizeGame(game);
        return {
          restored: true,
          game_id: game.id,
          session_id: game.session_id,
          restored_at: game.last_restored_at,
          snapshot_saved_at: game.last_snapshot_saved_at
        };
      });
      return json(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/legal') {
      const house = url.searchParams.get('house');
      if (!constants.houses.includes(house)) {
        return json(res, 400, { error: 'unknown house' });
      }
      const legal = await serial(async () => {
        await tickUnlocked();
        return listQueueableMarches(game, map, constants, house);
      });
      return json(res, 200, { house, actions: legal });
    }

    if (req.method === 'GET' && url.pathname === '/api/economy') {
      const house = url.searchParams.get('house');
      if (!constants.houses.includes(house)) {
        return json(res, 400, { error: 'unknown house' });
      }
      const data = await serial(async () => {
        await tickUnlocked();
        return economyView(game, map, constants, house);
      });
      return json(res, 200, data);
    }

    if (req.method === 'POST' && url.pathname === '/api/recruit') {
      const body = await readBody(req);
      const payload = await serial(async () => {
        await tickUnlocked();
        const queued = queueRecruitJob(game, constants, {
          house: body.house,
          territory: body.territory,
          warriors: Number(body.warriors)
        });
        game = await finalizeGame(queued.game);
        return { job: queued.job, game };
      });
      return json(res, 201, payload);
    }

    if (req.method === 'POST' && url.pathname === '/api/fort') {
      const body = await readBody(req);
      const payload = await serial(async () => {
        await tickUnlocked();
        const queued = queueFortJob(game, map, constants, {
          house: body.house,
          territory: body.territory
        });
        game = await finalizeGame(queued.game);
        return { job: queued.job, game };
      });
      return json(res, 201, payload);
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(req);
      const payload = await serial(async () => {
        await tickUnlocked();
        const action = {
          type: 'MARCH',
          mode: body.mode || 'LAND',
          house: body.house,
          from: body.from,
          to: body.to,
          warriors: Number(body.warriors)
        };

        const queued = queueTimedOrder(game, map, constants, action);
        game = await finalizeGame(queued.game);
        return { order: queued.order, game };
      });
      return json(res, 201, payload);
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const payload = await serial(async () => {
        game = normalizeAudit(normalizeOnlineEconomy(await store.reset(map, constants)));
        game = await finalizeGame(game);
        return publicState();
      });
      return json(res, 200, payload);
    }

    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const requested = Number(url.searchParams.get('limit') || 200);
      const limit = Math.max(1, Math.min(2000, Number.isFinite(requested) ? requested : 200));
      const payload = await serial(async () => {
        await tickUnlocked();
        return {
          game_id: game.id,
          session_id: game.session_id,
          session: sessionSummary(game),
          count: Math.min(limit, game.audit_log.length),
          entries: game.audit_log.slice(-limit)
        };
      });
      return json(res, 200, payload);
    }

    if (req.method === 'GET' && url.pathname === '/api/debug/all-legal') {
      const byHouse = await serial(async () => {
        await tickUnlocked();
        return Object.fromEntries(
          constants.houses.map(house => [house, enumerateMarches(game.state, map, constants, house)])
        );
      });
      return json(res, 200, byHouse);
    }

    return json(res, 404, { error: 'not found' });
  } catch (error) {
    console.error('request failed', error);
    return json(res, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

setInterval(() => {
  serial(tickUnlocked).catch(error => {
    console.error('background tick failed', error);
  });
}, 1_000).unref();

const port = Number(process.env.PORT || 8787);
server.listen(port, '0.0.0.0', () => {
  console.log(`Age of Brutality persistent prototype: http://localhost:${port}`);
  console.log(`Storage backend: Firestore ${store.status().database_id}`);
});
