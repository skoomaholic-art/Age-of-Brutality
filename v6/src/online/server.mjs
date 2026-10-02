import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { enumerateMarches } from '../core/legal-actions.mjs';
import { loadJson } from '../core/map.mjs';
import { validateState } from '../core/state.mjs';
import { FirestoreGameStore } from './firestore-store.mjs';
import { createOnlineGame } from './store.mjs';
import {
  ONLINE_TIMING,
  listQueueableMarches,
  processDueOrders
} from './orders.mjs';
import {
  ONLINE_ECONOMY_TIMING,
  economyView,
  normalizeOnlineEconomy,
  processEconomy
} from './economy.mjs';
import {
  commandHouse,
  executeCommand,
  normalizeCommand
} from './commands.mjs';
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
import {
  ACCESS_MODE,
  GAME_STATUS,
  PLAYER_ROLE,
  assertGameRunning,
  assertHouseAccess,
  canAdminister,
  createInviteCode,
  createPlayerCredentials,
  createPlayerRecord,
  normalizeGameMetadata,
  publicLifecycle,
  publicPlayer
} from './multiplayer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v6Root = path.resolve(here, '../..');
const map = loadJson(path.join(v6Root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(v6Root, 'src/data/constants.v6.json'));

const defaultGameId = process.env.AOB_GAME_ID || 'prototype-1';
const databaseId = process.env.AOB_FIRESTORE_DATABASE || '(default)';
const contexts = new Map();
const contextLoads = new Map();

function createStore(gameId) {
  return new FirestoreGameStore({
    gameId,
    databaseId
  });
}

async function finalizeGame(ctx, next, nowMs = Date.now(), saveOptions = {}) {
  const audited = syncAuditFromJournal(next, map, {
    nowMs,
    emit: emitCloudAudit
  });

  const validationErrors = validateState(audited.state, map, constants);
  if (validationErrors.length) {
    throw new Error(`invalid game state: ${validationErrors.join('; ')}`);
  }

  const persisted = await ctx.store.save(audited, saveOptions);
  if (persisted?.duplicate) {
    await refreshContext(ctx);
    return {
      game: ctx.game,
      duplicate: true,
      receipt: persisted.receipt
    };
  }

  ctx.game = audited;
  return {
    game: audited,
    duplicate: false,
    state_revision: audited.state_revision
  };
}

async function loadContext(gameId, {
  createIfMissing = false,
  defaultAccessMode = ACCESS_MODE.PLAYER_BOUND
} = {}) {
  if (contexts.has(gameId)) return contexts.get(gameId);
  if (contextLoads.has(gameId)) return contextLoads.get(gameId);

  const pending = (async () => {
    const store = createStore(gameId);
    let game = await store.load();

    if (!game && createIfMissing) {
      game = createOnlineGame(map, constants, {
        id: gameId,
        accessMode: defaultAccessMode
      });
      await store.save(game);
      store.loadedExistingAtStartup = false;
    }

    if (!game) throw new Error('game not found');

    game = normalizeGameMetadata(game, constants, {
      defaultAccessMode
    });
    game = normalizeAudit(normalizeOnlineEconomy(game));

    const ctx = {
      gameId,
      store,
      game,
      chain: Promise.resolve()
    };
    contexts.set(gameId, ctx);
    await finalizeGame(ctx, game);
    return ctx;
  })();

  contextLoads.set(gameId, pending);
  try {
    return await pending;
  } finally {
    contextLoads.delete(gameId);
  }
}

const defaultContext = await loadContext(defaultGameId, {
  createIfMissing: true,
  defaultAccessMode: ACCESS_MODE.ADMIN_SANDBOX
});

function serial(ctx, fn) {
  const run = ctx.chain.then(fn, fn);
  ctx.chain = run.catch(() => {});
  return run;
}

async function refreshContext(ctx) {
  let reloaded = await ctx.store.load();
  if (!reloaded) throw new Error('game not found');
  reloaded = normalizeGameMetadata(reloaded, constants, {
    defaultAccessMode: ctx.game?.lifecycle?.access_mode || ACCESS_MODE.PLAYER_BOUND
  });
  reloaded = normalizeAudit(normalizeOnlineEconomy(reloaded));
  ctx.game = reloaded;
  return reloaded;
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

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function commandKey(req, ctx, kind) {
  let key = String(req.headers['idempotency-key'] || '').trim();

  if (!key && ctx.game.lifecycle?.access_mode === ACCESS_MODE.PLAYER_BOUND) {
    throw new Error('Idempotency-Key header required');
  }

  if (!key) key = `sandbox:${kind}:${crypto.randomUUID()}`;
  if (key.length < 8 || key.length > 200) {
    throw new Error('Idempotency-Key must be 8..200 characters');
  }
  return key;
}

async function priorCommandResponse(ctx, key) {
  const receipt = await ctx.store.getCommandReceipt(key);
  if (!receipt) return null;
  return {
    status: Number(receipt.status_code || 200),
    response: receipt.response || {}
  };
}

async function runGameCommand(ctx, req, {
  kind,
  status = 201,
  mutate
}) {
  const key = commandKey(req, ctx, kind);

  const prior = await priorCommandResponse(ctx, key);
  if (prior) return prior;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) await refreshContext(ctx);
      await tickUnlocked(ctx);

      const result = await mutate(ctx.game);
      const response = result.response || {};
      const persisted = await finalizeGame(
        ctx,
        result.game,
        Date.now(),
        {
          commandId: key,
          commandResponse: response,
          commandStatus: status
        }
      );

      if (persisted.duplicate) {
        return {
          status: Number(persisted.receipt?.status_code || status),
          response: persisted.receipt?.response || response
        };
      }

      return { status, response };
    } catch (error) {
      if (error?.code === 'STALE_GAME_STATE' && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error('command could not be committed after retries');
}

async function requirePlayer(ctx, req) {
  if (ctx.game.lifecycle?.access_mode === ACCESS_MODE.ADMIN_SANDBOX) return null;
  const token = bearerToken(req);
  if (!token) throw new Error('authentication required');
  const player = await ctx.store.authenticateToken(token);
  if (!player) throw new Error('invalid player token');
  return player;
}

async function requireAdmin(ctx, req) {
  if (ctx.game.lifecycle?.access_mode === ACCESS_MODE.ADMIN_SANDBOX) return null;
  const player = await requirePlayer(ctx, req);
  if (!canAdminister(player)) throw new Error('admin role required');
  return player;
}

async function requireHouse(ctx, req, house, { running = true } = {}) {
  if (running) assertGameRunning(ctx.game);
  const player = await requirePlayer(ctx, req);
  assertHouseAccess(ctx.game, player, house, constants);
  return player;
}

async function tickUnlocked(ctx) {
  if (ctx.game.lifecycle?.status !== GAME_STATUS.RUNNING) return;

  const nowMs = Date.now();
  let processed = processDueOrders(ctx.game, map, constants, nowMs);
  processed = processEconomy(processed, map, constants, nowMs);
  if (
    processed.updated_at !== ctx.game.updated_at ||
    processed.state.journal.length !== ctx.game.state.journal.length
  ) {
    await finalizeGame(ctx, processed, nowMs);
  }
}

async function publicState(ctx, player = null) {
  const clientGame = structuredClone(ctx.game);
  clientGame.lifecycle = publicLifecycle(clientGame.lifecycle);

  let lobby = null;
  if (ctx.game.lifecycle?.access_mode === ACCESS_MODE.PLAYER_BOUND) {
    const players = await ctx.store.listPlayers();
    lobby = {
      players: players.map(publicPlayer),
      current_player: publicPlayer(player)
    };
  }

  return {
    game: clientGame,
    lobby,
    storage: ctx.store.status(),
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
  restored.state_revision = Number(current.state_revision || 0);
  restored.audit_log = structuredClone(current.audit_log || []);
  restored.audit_seq = Math.max(
    Number(restored.audit_seq || 1),
    Number(current.audit_seq || 1)
  );
  restored.session_metrics = structuredClone(current.session_metrics || restored.session_metrics || {});
  restored.audit_journal_cursor = 0;
  return restored;
}

function gamePath(pathname) {
  const match = pathname.match(/^\/api\/games\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  return {
    gameId: decodeURIComponent(match[1]),
    subpath: match[2] || '/'
  };
}

function newGameId() {
  return `game-${crypto.randomUUID()}`;
}

function errorStatus(error) {
  const message = String(error?.message || error || '');
  if (/authentication required|invalid player token/i.test(message)) return 401;
  if (/admin role required|cannot control|spectator|ownership mismatch/i.test(message)) return 403;
  if (/game not found|player not found|no snapshot found/i.test(message)) return 404;
  if (/already|claimed|full|closed|not joinable|not in lobby|require all six|missing:|only a running game|only a finished game|unique invite/i.test(message)) return 409;
  if (/Idempotency-Key|unknown|invalid|must be|request body|not running/i.test(message)) return 400;
  if (/stale game state|could not be committed/i.test(message)) return 409;
  return 500;
}

async function uniqueInviteCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createInviteCode();
    const existing = await defaultContext.store.findGameIdByInviteCode(code);
    if (!existing) return code;
  }
  throw new Error('could not allocate unique invite code');
}

async function createMultiplayerGame(body) {
  const gameId = newGameId();
  const inviteCode = await uniqueInviteCode();
  const credentials = createPlayerCredentials();
  const host = createPlayerRecord({
    playerId: credentials.player_id,
    tokenHash: credentials.token_hash,
    displayName: body.display_name || 'Host',
    role: PLAYER_ROLE.ADMIN
  });

  const store = createStore(gameId);
  let game = createOnlineGame(map, constants, {
    id: gameId,
    accessMode: ACCESS_MODE.PLAYER_BOUND,
    inviteCode
  });
  game = normalizeAudit(normalizeOnlineEconomy(game));

  const ctx = {
    gameId,
    store,
    game,
    chain: Promise.resolve()
  };
  contexts.set(gameId, ctx);

  await finalizeGame(ctx, game);
  await store.addPlayer(host);
  await refreshContext(ctx);

  if (body.house) {
    await store.claimHouse(host.id, body.house, constants);
    await refreshContext(ctx);
  }

  return {
    game_id: gameId,
    invite_code: inviteCode,
    player: publicPlayer(await store.getPlayer(host.id)),
    access_token: credentials.token,
    lifecycle: publicLifecycle(ctx.game.lifecycle)
  };
}

async function joinMultiplayerGame(body) {
  const inviteCode = String(body.invite_code || '').trim().toUpperCase();
  const gameId = await defaultContext.store.findGameIdByInviteCode(inviteCode);
  if (!gameId) throw new Error('game not found');

  const ctx = await loadContext(gameId);
  if (ctx.game.lifecycle?.status !== GAME_STATUS.LOBBY) throw new Error('game is not joinable');

  const role = body.spectator ? PLAYER_ROLE.SPECTATOR : PLAYER_ROLE.PLAYER;
  const credentials = createPlayerCredentials();
  const player = createPlayerRecord({
    playerId: credentials.player_id,
    tokenHash: credentials.token_hash,
    displayName: body.display_name || 'Player',
    role
  });

  await ctx.store.addPlayer(player);
  await refreshContext(ctx);

  return {
    game_id: gameId,
    player: publicPlayer(player),
    access_token: credentials.token,
    lifecycle: publicLifecycle(ctx.game.lifecycle)
  };
}

async function handleGameApi(req, res, url, ctx, subpath) {
  if (req.method === 'GET' && subpath === '/lobby') {
    const player = await requirePlayer(ctx, req);
    const players = await ctx.store.listPlayers();
    return json(res, 200, {
      game_id: ctx.game.id,
      lifecycle: publicLifecycle(ctx.game.lifecycle),
      players: players.map(publicPlayer),
      current_player: publicPlayer(player)
    });
  }

  if (req.method === 'POST' && subpath === '/claim-house') {
    const body = await readBody(req);
    const player = await requirePlayer(ctx, req);
    const claimed = await serial(ctx, async () => {
      const result = await ctx.store.claimHouse(player.id, body.house, constants);
      await refreshContext(ctx);
      return result;
    });
    return json(res, 200, {
      ...claimed,
      lifecycle: publicLifecycle(ctx.game.lifecycle)
    });
  }

  if (req.method === 'POST' && subpath === '/release-house') {
    const player = await requirePlayer(ctx, req);
    if (player.role === PLAYER_ROLE.SPECTATOR) {
      throw new Error('spectator cannot release a house');
    }

    const payload = await serial(ctx, async () => {
      const result = await ctx.store.releaseHouse(player.id);
      await refreshContext(ctx);
      if (result.released) {
        ctx.game.state.journal.push({
          kind: 'HOUSE_RELEASED',
          at: new Date().toISOString(),
          player_id: player.id,
          house: result.released
        });
        await finalizeGame(ctx, ctx.game);
      }
      return {
        ...result,
        lifecycle: publicLifecycle(ctx.game.lifecycle)
      };
    });
    return json(res, 200, payload);
  }

  if (req.method === 'POST' && subpath === '/start') {
    const player = await requireAdmin(ctx, req);
    const payload = await serial(ctx, async () => {
      const nowMs = Date.now();
      const lifecycle = await ctx.store.startGame(player.id, constants, nowMs);
      await refreshContext(ctx);
      ctx.game.lifecycle = lifecycle;
      ctx.game.next_income_at = new Date(nowMs + ONLINE_ECONOMY_TIMING.incomeIntervalMs).toISOString();
      ctx.game.updated_at = new Date(nowMs).toISOString();
      ctx.game.state.journal.push({
        kind: 'GAME_STARTED',
        at: ctx.game.updated_at,
        game_id: ctx.game.id,
        ruleset_version: ctx.game.ruleset_version
      });
      await finalizeGame(ctx, ctx.game, nowMs);
      return {
        game_id: ctx.game.id,
        lifecycle: publicLifecycle(ctx.game.lifecycle)
      };
    });
    return json(res, 200, payload);
  }

  if (req.method === 'POST' && subpath === '/finish') {
    const player = await requireAdmin(ctx, req);
    const body = await readBody(req);

    const payload = await serial(ctx, async () => {
      const nowMs = Date.now();
      const lifecycle = await ctx.store.finishGame(player.id, {
        nowMs,
        reason: body.reason || null
      });
      await refreshContext(ctx);
      ctx.game.lifecycle = lifecycle;
      ctx.game.updated_at = new Date(nowMs).toISOString();
      ctx.game.state.journal.push({
        kind: 'GAME_FINISHED',
        at: ctx.game.updated_at,
        game_id: ctx.game.id,
        reason: lifecycle.finish_reason || null
      });
      await finalizeGame(ctx, ctx.game, nowMs);

      return {
        game_id: ctx.game.id,
        lifecycle: publicLifecycle(ctx.game.lifecycle)
      };
    });

    return json(res, 200, payload);
  }

  if (req.method === 'POST' && subpath === '/archive') {
    const player = await requireAdmin(ctx, req);

    const payload = await serial(ctx, async () => {
      const nowMs = Date.now();
      const lifecycle = await ctx.store.archiveGame(player.id, nowMs);
      await refreshContext(ctx);
      ctx.game.lifecycle = lifecycle;
      ctx.game.updated_at = new Date(nowMs).toISOString();
      ctx.game.state.journal.push({
        kind: 'GAME_ARCHIVED',
        at: ctx.game.updated_at,
        game_id: ctx.game.id
      });
      await finalizeGame(ctx, ctx.game, nowMs);

      return {
        game_id: ctx.game.id,
        lifecycle: publicLifecycle(ctx.game.lifecycle)
      };
    });

    return json(res, 200, payload);
  }

  if (req.method === 'GET' && subpath === '/storage') {
    await requirePlayer(ctx, req);
    return json(res, 200, ctx.store.status());
  }

  if (req.method === 'GET' && subpath === '/state') {
    const player = await requirePlayer(ctx, req);
    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return publicState(ctx, player);
    });
    return json(res, 200, payload);
  }

  if (req.method === 'GET' && subpath === '/snapshot') {
    await requireAdmin(ctx, req);
    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return createSnapshotEnvelope(ctx.game);
    });
    return json(res, 200, payload);
  }

  if (req.method === 'POST' && subpath === '/snapshot') {
    await requireAdmin(ctx, req);
    const saved = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      const envelope = createSnapshotEnvelope(ctx.game);
      return ctx.store.saveCheckpoint(envelope);
    });
    return json(res, 201, { saved: true, ...saved });
  }

  if (req.method === 'GET' && subpath === '/snapshot/latest') {
    await requireAdmin(ctx, req);
    const snapshot = await ctx.store.latestCheckpoint();
    if (!snapshot) throw new Error('no snapshot found');
    return json(res, 200, snapshot);
  }

  if (req.method === 'POST' && subpath === '/snapshot/restore-latest') {
    await requireAdmin(ctx, req);
    const result = await serial(ctx, async () => {
      const snapshot = await ctx.store.latestCheckpoint();
      if (!snapshot) throw new Error('no snapshot found');

      let restored = restoreGameFromSnapshot(snapshot, map, constants);
      restored = preserveAuditHistory(restored, ctx.game);
      await finalizeGame(ctx, restored);

      return {
        restored: true,
        game_id: ctx.game.id,
        session_id: ctx.game.session_id,
        restored_at: ctx.game.last_restored_at,
        snapshot_saved_at: ctx.game.last_snapshot_saved_at
      };
    });
    return json(res, 200, result);
  }

  if (req.method === 'POST' && subpath === '/snapshot/restore') {
    await requireAdmin(ctx, req);
    const body = await readBody(req);
    const result = await serial(ctx, async () => {
      let restored = restoreGameFromSnapshot(body, map, constants);
      restored = preserveAuditHistory(restored, ctx.game);
      await finalizeGame(ctx, restored);
      return {
        restored: true,
        game_id: ctx.game.id,
        session_id: ctx.game.session_id,
        restored_at: ctx.game.last_restored_at,
        snapshot_saved_at: ctx.game.last_snapshot_saved_at
      };
    });
    return json(res, 200, result);
  }

  if (req.method === 'GET' && subpath === '/legal') {
    const house = url.searchParams.get('house');
    await requireHouse(ctx, req, house);
    const legal = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return listQueueableMarches(ctx.game, map, constants, house);
    });
    return json(res, 200, { house, actions: legal });
  }

  if (req.method === 'GET' && subpath === '/economy') {
    const house = url.searchParams.get('house');
    await requireHouse(ctx, req, house);
    const data = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return economyView(ctx.game, map, constants, house);
    });
    return json(res, 200, data);
  }

  if (req.method === 'POST' && subpath === '/commands') {
    const body = await readBody(req);
    const command = normalizeCommand(body.command || body);
    await requireHouse(ctx, req, commandHouse(command));

    const result = await serial(ctx, () => runGameCommand(ctx, req, {
      kind: command.type,
      status: 201,
      mutate: async game => executeCommand(game, map, constants, command)
    }));

    return json(res, result.status, result.response);
  }

  if (req.method === 'POST' && subpath === '/recruit') {
    const body = await readBody(req);
    const command = normalizeCommand({
      type: 'RECRUIT',
      house: body.house,
      territory: body.territory,
      warriors: body.warriors
    });
    await requireHouse(ctx, req, command.house);

    const result = await serial(ctx, () => runGameCommand(ctx, req, {
      kind: command.type,
      status: 201,
      mutate: async game => executeCommand(game, map, constants, command)
    }));
    return json(res, result.status, result.response);
  }

  if (req.method === 'POST' && subpath === '/fort') {
    const body = await readBody(req);
    const command = normalizeCommand({
      type: 'BUILD_FORT',
      house: body.house,
      territory: body.territory
    });
    await requireHouse(ctx, req, command.house);

    const result = await serial(ctx, () => runGameCommand(ctx, req, {
      kind: command.type,
      status: 201,
      mutate: async game => executeCommand(game, map, constants, command)
    }));
    return json(res, result.status, result.response);
  }

  if (req.method === 'POST' && subpath === '/orders') {
    const body = await readBody(req);
    const command = normalizeCommand({
      type: 'MARCH',
      mode: body.mode || 'LAND',
      house: body.house,
      from: body.from,
      to: body.to,
      warriors: body.warriors
    });
    await requireHouse(ctx, req, command.house);

    const result = await serial(ctx, () => runGameCommand(ctx, req, {
      kind: command.type,
      status: 201,
      mutate: async game => executeCommand(game, map, constants, command)
    }));
    return json(res, result.status, result.response);
  }

  if (req.method === 'POST' && subpath === '/reset') {
    await requireAdmin(ctx, req);
    const payload = await serial(ctx, async () => {
      const accessMode = ctx.game.lifecycle?.access_mode || ACCESS_MODE.PLAYER_BOUND;
      if (accessMode !== ACCESS_MODE.ADMIN_SANDBOX) {
        throw new Error('reset is disabled for multiplayer games');
      }
      ctx.game = normalizeAudit(normalizeOnlineEconomy(await ctx.store.reset(map, constants)));
      await finalizeGame(ctx, ctx.game);
      return publicState(ctx);
    });
    return json(res, 200, payload);
  }

  if (req.method === 'GET' && subpath === '/audit') {
    await requirePlayer(ctx, req);
    const requested = Number(url.searchParams.get('limit') || 200);
    const limit = Math.max(1, Math.min(2000, Number.isFinite(requested) ? requested : 200));
    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return {
        game_id: ctx.game.id,
        session_id: ctx.game.session_id,
        session: sessionSummary(ctx.game),
        count: Math.min(limit, ctx.game.audit_log.length),
        entries: ctx.game.audit_log.slice(-limit)
      };
    });
    return json(res, 200, payload);
  }

  if (req.method === 'GET' && subpath === '/debug/all-legal') {
    await requireAdmin(ctx, req);
    const byHouse = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return Object.fromEntries(
        constants.houses.map(house => [house, enumerateMarches(ctx.game.state, map, constants, house)])
      );
    });
    return json(res, 200, byHouse);
  }

  return json(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(v6Root, 'online/index.html'), 'utf8');
      return text(res, 200, html, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && (url.pathname === '/lobby' || url.pathname === '/lobby.html')) {
      const html = fs.readFileSync(path.join(v6Root, 'online/lobby.html'), 'utf8');
      return text(res, 200, html, 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && url.pathname === '/api/games') {
      const body = await readBody(req);
      return json(res, 201, await createMultiplayerGame(body));
    }

    if (req.method === 'POST' && url.pathname === '/api/games/join') {
      const body = await readBody(req);
      return json(res, 201, await joinMultiplayerGame(body));
    }

    const scoped = gamePath(url.pathname);
    if (scoped && scoped.gameId !== 'join') {
      const ctx = await loadContext(scoped.gameId);
      return handleGameApi(req, res, url, ctx, scoped.subpath);
    }

    if (url.pathname.startsWith('/api/')) {
      const subpath = url.pathname.slice('/api'.length);
      return handleGameApi(req, res, url, defaultContext, subpath);
    }

    return json(res, 404, { error: 'not found' });
  } catch (error) {
    console.error('request failed', error);
    return json(res, errorStatus(error), {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

setInterval(() => {
  for (const ctx of contexts.values()) {
    serial(ctx, () => tickUnlocked(ctx)).catch(error => {
      console.error(`background tick failed for ${ctx.gameId}`, error);
    });
  }
}, 1_000).unref();

const port = Number(process.env.PORT || 8787);
server.listen(port, '0.0.0.0', () => {
  console.log(`Age of Brutality persistent prototype: http://localhost:${port}`);
  console.log(`Storage backend: Firestore ${defaultContext.store.status().database_id}`);
  console.log(`Default sandbox game: ${defaultGameId}`);
});
