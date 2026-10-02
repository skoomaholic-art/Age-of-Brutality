import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { enumerateMarches } from '../core/legal-actions.mjs';
import { loadJson } from '../core/map.mjs';
import { validateState } from '../core/state.mjs';
import { resolvePendingCapitalHold } from '../core/scoring.mjs';
import { buildVictoryStatus } from '../core/victory.mjs';
import {
  assignCharacterToArmy,
  charactersForHouse,
  normalizeCharacterLayer,
  returnCharacterToCourt
} from '../core/characters.mjs';
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
import { buildGameStats } from './stats.mjs';
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
  PROFILE_AVATARS,
  PROFILE_MMR,
  createProfileRecord,
  createProfileSessionCredentials,
  normalizeProfileHandle,
  publicProfile,
  publicSocialProfile,
  verifyPassword
} from './profile.mjs';
import {
  ACCESS_MODE,
  GAME_STATUS,
  GAME_MODE,
  GAME_VISIBILITY,
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
const characterCatalog = loadJson(path.join(v6Root, 'src/data/characters.v6.json'));

const defaultGameId = process.env.AOB_GAME_ID || 'prototype-1';
const databaseId = process.env.AOB_FIRESTORE_DATABASE || '(default)';
const contexts = new Map();
const contextLoads = new Map();

function createStore(gameId) {
  return new FirestoreGameStore({
    gameId,
    databaseId,
    characterCatalog
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
        accessMode: defaultAccessMode,
        characterCatalog
      });
      await store.save(game);
      store.loadedExistingAtStartup = false;
    }

    if (!game) throw new Error('game not found');

    game = normalizeGameMetadata(game, constants, {
      defaultAccessMode
    });
    game = normalizeAudit(normalizeOnlineEconomy(game));
    game.state = normalizeCharacterLayer(game.state, characterCatalog, map, constants);

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
  reloaded.state = normalizeCharacterLayer(
    reloaded.state,
    characterCatalog,
    map,
    constants
  );
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
  house = null,
  mutate
}) {
  const key = commandKey(req, ctx, kind);

  const prior = await priorCommandResponse(ctx, key);
  if (prior) return prior;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) await refreshContext(ctx);
      await tickUnlocked(ctx);

      let commandGame = ctx.game;
      let capitalHold = null;
      if (house) {
        const resolvedHold = resolvePendingCapitalHold(
          commandGame.state,
          map,
          constants,
          house
        );
        if (resolvedHold.result) {
          commandGame = structuredClone(commandGame);
          commandGame.state = resolvedHold.state;
          commandGame.updated_at = new Date().toISOString();
          capitalHold = resolvedHold.result;
        }
      }

      const result = await mutate(commandGame);
      if (capitalHold) {
        result.response = {
          ...(result.response || {}),
          capital_hold: capitalHold
        };
      }
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

async function optionalProfile(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return defaultContext.store.authenticateProfileSession(token);
}

async function requireProfile(req) {
  const profile = await optionalProfile(req);
  if (!profile) throw new Error('invalid profile session');
  return profile;
}

async function requirePlayer(ctx, req) {
  if (ctx.game.lifecycle?.access_mode === ACCESS_MODE.ADMIN_SANDBOX) return null;
  const token = bearerToken(req);
  if (!token) throw new Error('authentication required');

  const legacyPlayer = await ctx.store.authenticateToken(token);
  if (legacyPlayer) return legacyPlayer;

  const profile = await defaultContext.store.authenticateProfileSession(token);
  if (!profile) throw new Error('invalid player token');

  const player = await ctx.store.findPlayerByProfileId(profile.id);
  if (!player) throw new Error('profile is not a member of this game');
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

function redactGameForPlayer(game, player) {
  const clientGame = structuredClone(game);
  clientGame.lifecycle = publicLifecycle(clientGame.lifecycle);

  clientGame.orders = player?.role === PLAYER_ROLE.SPECTATOR
    ? (clientGame.orders || []).filter(item => item.status !== 'PENDING').slice(-30)
    : [
        ...(clientGame.orders || []).filter(item => item.status === 'PENDING'),
        ...(clientGame.orders || []).filter(item => item.status !== 'PENDING').slice(-30)
      ];
  clientGame.jobs = [];
  clientGame.audit_log = (clientGame.audit_log || []).slice(-40);
  if (clientGame.state) clientGame.state.journal = [];

  if (clientGame.lifecycle?.access_mode === ACCESS_MODE.PLAYER_BOUND) {
    const ownHouse = player?.house || null;

    for (const [house, houseState] of Object.entries(clientGame.state?.houses || {})) {
      const hand = Array.isArray(houseState.intrigue_hand) ? houseState.intrigue_hand : [];
      houseState.intrigue_hand_count = hand.length;
      if (house !== ownHouse) houseState.intrigue_hand = [];
    }

    clientGame.audit_log = clientGame.audit_log.filter(item => {
      if (item.visibility !== 'PRIVATE') return true;
      return item.details?.house === ownHouse;
    });
  }

  return clientGame;
}

async function publicState(ctx, player = null) {
  let lobby = null;
  if (ctx.game.lifecycle?.access_mode === ACCESS_MODE.PLAYER_BOUND) {
    const players = await ctx.store.listPlayers();
    lobby = {
      players: players.map(publicPlayer),
      current_player: publicPlayer(player)
    };
  }

  return {
    game: redactGameForPlayer(ctx.game, player),
    lobby,
    victory: buildVictoryStatus(ctx.game, map, constants)
  };
}

function publicBootstrap(ctx) {
  return {
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
    ruleset_version: constants.version,
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
  if (/authentication required|invalid player token|invalid profile session/i.test(message)) return 401;
  if (/admin role required|cannot control|spectator|ownership mismatch|friend request blocked|messages are blocked|game invites are blocked|messages are allowed only between friends|game invites are allowed only between friends|sender is not a member|spectating this private game requires friendship/i.test(message)) return 403;
  if (/game not found|player not found|profile not found|friend request not found|game invite not found|no snapshot found/i.test(message)) return 404;
  if (/already|claimed|full|closed|not joinable|not in lobby|require all six|missing:|only a running game|only a finished game|unique invite|not a public room|not multiplayer|profile login already exists|linked to another profile|players are already friends|friend request already sent|friend is already in this game|game is not accepting invitations|game invite already sent|player is not in game|game is not watchable/i.test(message)) return 409;
  if (/Idempotency-Key|unknown|invalid|must be|request body|not running|solo game requires|login must be|password must be|display name must be|invalid avatar|unknown winner house|message must be|conversation requires|profile id required|invite id required|cannot add this profile|cannot block this profile|invalid watch target|character does not belong|only adult|dead character|weakened character|character is not|army must be|capital army already|two army characters/i.test(message)) return 400;
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

function safeRoomName(value, fallback) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return (name || fallback).slice(0, 60);
}

function publicPresenceForViewer(presence, { canSeePrivateGame = false } = {}) {
  const next = structuredClone(presence || {
    status: 'OFFLINE',
    online: false,
    in_game: false,
    game: null
  });

  if (
    next.game &&
    next.game.visibility === GAME_VISIBILITY.PRIVATE &&
    !canSeePrivateGame
  ) {
    next.game = {
      game_id: null,
      room_name: null,
      visibility: next.game.visibility,
      game_mode: next.game.game_mode,
      status: next.game.status
    };
  }

  return next;
}

async function createMultiplayerGame(body, profile = null) {
  const gameId = newGameId();
  const inviteCode = await uniqueInviteCode();
  const visibility = body.visibility === GAME_VISIBILITY.PUBLIC
    ? GAME_VISIBILITY.PUBLIC
    : GAME_VISIBILITY.PRIVATE;
  const roomName = safeRoomName(
    body.room_name,
    visibility === GAME_VISIBILITY.PUBLIC ? 'Открытая комната' : 'Приватная комната'
  );

  const credentials = createPlayerCredentials();
  const host = createPlayerRecord({
    playerId: credentials.player_id,
    tokenHash: credentials.token_hash,
    displayName: profile?.display_name || body.display_name || 'Host',
    role: PLAYER_ROLE.ADMIN,
    profileId: profile?.id || null
  });

  const store = createStore(gameId);
  let game = createOnlineGame(map, constants, {
    id: gameId,
    accessMode: ACCESS_MODE.PLAYER_BOUND,
    inviteCode,
    lifecycleOptions: {
      gameMode: GAME_MODE.MULTIPLAYER,
      visibility,
      roomName
    },
    characterCatalog
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
  if (profile) await store.linkPlayerToProfile(host.id, profile.id);
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

async function createSoloGame(body, profile = null) {
  const house = String(body.house || '').trim();
  if (!constants.houses.includes(house)) throw new Error('solo game requires a valid house');

  const gameId = newGameId();
  const credentials = createPlayerCredentials();
  const player = createPlayerRecord({
    playerId: credentials.player_id,
    tokenHash: credentials.token_hash,
    displayName: profile?.display_name || body.display_name || 'Player',
    role: PLAYER_ROLE.ADMIN,
    profileId: profile?.id || null
  });

  const store = createStore(gameId);
  let game = createOnlineGame(map, constants, {
    id: gameId,
    accessMode: ACCESS_MODE.PLAYER_BOUND,
    inviteCode: null,
    lifecycleOptions: {
      gameMode: GAME_MODE.SOLO,
      visibility: GAME_VISIBILITY.PRIVATE,
      roomName: safeRoomName(body.room_name, `Соло · ${house}`)
    },
    characterCatalog
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
  await store.addPlayer(player);
  if (profile) await store.linkPlayerToProfile(player.id, profile.id);
  await refreshContext(ctx);
  await store.claimHouse(player.id, house, constants);
  await refreshContext(ctx);

  const nowMs = Date.now();
  const lifecycle = await store.startGame(player.id, constants, nowMs);
  await refreshContext(ctx);
  ctx.game.lifecycle = lifecycle;
  ctx.game.next_income_at = new Date(nowMs + ONLINE_ECONOMY_TIMING.incomeIntervalMs).toISOString();
  ctx.game.updated_at = new Date(nowMs).toISOString();
  ctx.game.state.journal.push({
    kind: 'GAME_STARTED',
    at: ctx.game.updated_at,
    game_id: ctx.game.id,
    ruleset_version: ctx.game.ruleset_version,
    game_mode: GAME_MODE.SOLO
  });
  await finalizeGame(ctx, ctx.game, nowMs);

  return {
    game_id: gameId,
    player: publicPlayer(await store.getPlayer(player.id)),
    access_token: credentials.token,
    lifecycle: publicLifecycle(ctx.game.lifecycle)
  };
}

async function joinGameById(gameId, body, { publicOnly = false, profile = null } = {}) {
  const ctx = await loadContext(gameId);
  const lifecycle = ctx.game.lifecycle || {};

  if (lifecycle.status !== GAME_STATUS.LOBBY) throw new Error('game is not joinable');
  if (lifecycle.game_mode !== GAME_MODE.MULTIPLAYER) throw new Error('game is not multiplayer');
  if (publicOnly && lifecycle.visibility !== GAME_VISIBILITY.PUBLIC) {
    throw new Error('game is not a public room');
  }

  if (profile) {
    const existing = await ctx.store.findPlayerByProfileId(profile.id);
    if (existing) {
      return {
        game_id: gameId,
        player: publicPlayer(existing),
        access_token: null,
        lifecycle: publicLifecycle(ctx.game.lifecycle),
        existing_membership: true
      };
    }
  }

  const role = body.spectator ? PLAYER_ROLE.SPECTATOR : PLAYER_ROLE.PLAYER;
  const credentials = createPlayerCredentials();
  const player = createPlayerRecord({
    playerId: credentials.player_id,
    tokenHash: credentials.token_hash,
    displayName: profile?.display_name || body.display_name || 'Player',
    role,
    profileId: profile?.id || null
  });

  await ctx.store.addPlayer(player);
  if (profile) await ctx.store.linkPlayerToProfile(player.id, profile.id);
  await refreshContext(ctx);

  return {
    game_id: gameId,
    player: publicPlayer(player),
    access_token: credentials.token,
    lifecycle: publicLifecycle(ctx.game.lifecycle)
  };
}

async function joinMultiplayerGame(body, profile = null) {
  const inviteCode = String(body.invite_code || '').trim().toUpperCase();
  const gameId = await defaultContext.store.findGameIdByInviteCode(inviteCode);
  if (!gameId) throw new Error('game not found');
  return joinGameById(gameId, body, { profile });
}

async function joinPublicGame(gameId, body, profile = null) {
  return joinGameById(gameId, body, { publicOnly: true, profile });
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
    const winnerHouse = body.winner_house ? String(body.winner_house) : null;

    if (winnerHouse && !constants.houses.includes(winnerHouse)) {
      throw new Error('unknown winner house');
    }

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
        reason: lifecycle.finish_reason || null,
        winner_house: winnerHouse
      });
      await finalizeGame(ctx, ctx.game, nowMs);

      const rankedResults = [];
      if (
        winnerHouse &&
        ctx.game.lifecycle?.game_mode === GAME_MODE.MULTIPLAYER
      ) {
        const players = await ctx.store.listPlayers();
        for (const participant of players) {
          if (!participant.profile_id || !participant.house) continue;
          const result = await ctx.store.recordProfileRankedResult(
            participant.profile_id,
            ctx.game.id,
            { won: participant.house === winnerHouse },
            nowMs
          );
          rankedResults.push({
            profile_id: participant.profile_id,
            house: participant.house,
            result: participant.house === winnerHouse ? 'WIN' : 'LOSS',
            duplicate: Boolean(result.duplicate)
          });
        }
      }

      return {
        game_id: ctx.game.id,
        lifecycle: publicLifecycle(ctx.game.lifecycle),
        winner_house: winnerHouse,
        ranked_results_recorded: rankedResults
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

  if (req.method === 'POST' && subpath === '/profile-heartbeat') {
    const player = await requirePlayer(ctx, req);
    const profile = await optionalProfile(req);

    if (!profile || !player?.profile_id || player.profile_id !== profile.id) {
      return json(res, 200, { tracked: false });
    }

    if (player.role === PLAYER_ROLE.SPECTATOR) {
      const presence = await defaultContext.store.heartbeatProfilePresence(profile.id);
      return json(res, 200, {
        tracked: true,
        spectator: true,
        ...presence
      });
    }

    const activity = await defaultContext.store.heartbeatProfileActivity(
      profile.id,
      { gameId: ctx.game.id }
    );
    return json(res, 200, {
      tracked: true,
      spectator: false,
      ...activity
    });
  }

  if (req.method === 'GET' && subpath === '/storage') {
    await requirePlayer(ctx, req);
    return json(res, 200, ctx.store.status());
  }

  if (req.method === 'GET' && subpath === '/bootstrap') {
    const player = await requirePlayer(ctx, req);
    return json(res, 200, {
      ...publicBootstrap(ctx),
      current_player: publicPlayer(player)
    });
  }

  if (req.method === 'GET' && subpath === '/state') {
    const player = await requirePlayer(ctx, req);
    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return publicState(ctx, player);
    });
    return json(res, 200, payload);
  }

  if (req.method === 'POST' && subpath === '/save-exit') {
    await requirePlayer(ctx, req);
    const saved = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      const envelope = createSnapshotEnvelope(ctx.game);
      return ctx.store.saveCheckpoint(envelope);
    });
    return json(res, 201, {
      saved: true,
      game_id: ctx.game.id,
      session_id: ctx.game.session_id,
      ...saved
    });
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

  if (req.method === 'GET' && subpath === '/characters') {
    const house = String(url.searchParams.get('house') || '').trim();
    await requireHouse(ctx, req, house, { running: false });
    const characters = charactersForHouse(ctx.game.state, house);
    const armies = Object.values(ctx.game.state.armies || {})
      .filter(army => army.house === house);

    return json(res, 200, {
      house,
      characters,
      armies
    });
  }

  if (req.method === 'POST' && subpath === '/characters/assign-army') {
    const body = await readBody(req);
    const house = String(body.house || '').trim();
    await requireHouse(ctx, req, house);

    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      ctx.game.state = assignCharacterToArmy(
        ctx.game.state,
        map,
        constants,
        {
          house,
          characterId: String(body.character_id || '').trim()
        }
      );
      ctx.game.updated_at = new Date().toISOString();
      await finalizeGame(ctx, ctx.game);
      return {
        house,
        characters: charactersForHouse(ctx.game.state, house),
        armies: Object.values(ctx.game.state.armies || {})
          .filter(army => army.house === house)
      };
    });

    return json(res, 200, payload);
  }

  if (req.method === 'POST' && subpath === '/characters/return-court') {
    const body = await readBody(req);
    const house = String(body.house || '').trim();
    await requireHouse(ctx, req, house);

    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      ctx.game.state = returnCharacterToCourt(
        ctx.game.state,
        map,
        {
          house,
          characterId: String(body.character_id || '').trim()
        }
      );
      ctx.game.updated_at = new Date().toISOString();
      await finalizeGame(ctx, ctx.game);
      return {
        house,
        characters: charactersForHouse(ctx.game.state, house),
        armies: Object.values(ctx.game.state.armies || {})
          .filter(army => army.house === house)
      };
    });

    return json(res, 200, payload);
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
      house: command.house,
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
      house: command.house,
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
      house: command.house,
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
      warriors: body.warriors,
      commander_id: body.commander_id || null
    });
    await requireHouse(ctx, req, command.house);

    const result = await serial(ctx, () => runGameCommand(ctx, req, {
      kind: command.type,
      status: 201,
      house: command.house,
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
      return {
        ...publicBootstrap(ctx),
        ...(await publicState(ctx))
      };
    });
    return json(res, 200, payload);
  }

  if (req.method === 'GET' && subpath === '/stats') {
    await requirePlayer(ctx, req);
    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);
      return buildGameStats(ctx.game, map, constants);
    });
    return json(res, 200, payload);
  }

  if (req.method === 'GET' && subpath === '/audit') {
    const player = await requirePlayer(ctx, req);
    const requested = Number(url.searchParams.get('limit') || 200);
    const limit = Math.max(1, Math.min(2000, Number.isFinite(requested) ? requested : 200));
    const payload = await serial(ctx, async () => {
      await tickUnlocked(ctx);

      const visibleEntries = (ctx.game.audit_log || []).filter(item => {
        if (ctx.game.lifecycle?.access_mode !== ACCESS_MODE.PLAYER_BOUND) return true;
        if (item.visibility !== 'PRIVATE') return true;
        if (!player || player.role === PLAYER_ROLE.SPECTATOR) return false;
        return item.details?.house === player.house;
      });

      return {
        game_id: ctx.game.id,
        session_id: ctx.game.session_id,
        session: sessionSummary(ctx.game),
        count: Math.min(limit, visibleEntries.length),
        entries: visibleEntries.slice(-limit)
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

async function tickDueGames({
  nowMs = Date.now(),
  limit = 100
} = {}) {
  const ids = await defaultContext.store.listDueGameIds(nowMs, limit);
  const results = [];

  for (const gameId of ids) {
    try {
      const ctx = await loadContext(gameId);
      await serial(ctx, () => tickUnlocked(ctx));
      results.push({
        game_id: gameId,
        status: 'OK',
        next_due_at: ctx.game.next_due_at || null
      });
    } catch (error) {
      results.push({
        game_id: gameId,
        status: 'ERROR',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    checked_at: new Date(nowMs).toISOString(),
    due_games: ids.length,
    results
  };
}

function internalTickAuthorized(req) {
  const configured = String(process.env.AOB_INTERNAL_TICK_TOKEN || '');
  if (!configured) return false;
  const supplied = String(req.headers['x-aob-internal-token'] || '');
  if (!supplied || supplied.length !== configured.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
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

    if (req.method === 'POST' && url.pathname === '/api/internal/tick-due') {
      if (!process.env.AOB_INTERNAL_TICK_TOKEN) {
        return json(res, 404, { error: 'internal resolver is not configured' });
      }
      if (!internalTickAuthorized(req)) {
        return json(res, 403, { error: 'forbidden' });
      }

      const body = await readBody(req);
      const result = await tickDueGames({
        nowMs: Date.now(),
        limit: Number(body.limit || 100)
      });
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/profiles/register') {
      const body = await readBody(req);
      const profile = createProfileRecord({
        handle: body.handle,
        displayName: body.display_name,
        password: body.password
      });
      const session = createProfileSessionCredentials({ profileId: profile.id });
      await defaultContext.store.createProfile(profile, session);
      return json(res, 201, {
        profile: publicProfile(profile),
        profile_token: session.token,
        expires_at: session.expires_at
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/profiles/login') {
      const body = await readBody(req);
      const handle = normalizeProfileHandle(body.handle);
      const profile = await defaultContext.store.getProfileByHandle(handle);
      if (!profile || !verifyPassword(body.password, profile)) {
        return json(res, 401, { error: 'invalid login or password' });
      }
      const session = createProfileSessionCredentials({ profileId: profile.id });
      await defaultContext.store.addProfileSession(profile.id, session);
      return json(res, 200, {
        profile: publicProfile(profile),
        profile_token: session.token,
        expires_at: session.expires_at
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/profile') {
      const profile = await requireProfile(req);
      return json(res, 200, { profile: publicProfile(profile) });
    }

    if (req.method === 'GET' && url.pathname === '/api/profile/meta') {
      return json(res, 200, {
        avatars: PROFILE_AVATARS,
        mmr: PROFILE_MMR
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/profile/avatar') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const updated = await defaultContext.store.updateProfileAvatar(
        profile.id,
        body.avatar_id
      );
      return json(res, 200, { profile: publicProfile(updated) });
    }

    if (req.method === 'POST' && url.pathname === '/api/profile/logout') {
      const profile = await requireProfile(req);
      const token = bearerToken(req);
      await defaultContext.store.revokeProfileSession(token);
      return json(res, 200, { logged_out: true, profile_id: profile.id });
    }

    if (req.method === 'GET' && url.pathname === '/api/profile/games') {
      const profile = await requireProfile(req);
      const memberships = await defaultContext.store.listProfileGames(profile.id);
      const games = memberships.map(item => ({
        game_id: item.game_id,
        lifecycle: publicLifecycle(item.game?.lifecycle),
        player: publicPlayer(item.player),
        linked_at: item.linked_at
      }));
      return json(res, 200, { profile: publicProfile(profile), games });
    }

    if (req.method === 'POST' && url.pathname === '/api/profile/link-game') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const gameId = String(body.game_id || '').trim();
      const gameToken = String(body.game_token || '').trim();
      if (!gameId || !gameToken) throw new Error('game id and game token required');

      const ctx = await loadContext(gameId);
      const player = await ctx.store.authenticateToken(gameToken);
      if (!player) throw new Error('invalid player token');
      await ctx.store.linkPlayerToProfile(player.id, profile.id);

      return json(res, 200, {
        linked: true,
        game_id: gameId,
        player: publicPlayer(await ctx.store.getPlayer(player.id))
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/social/search') {
      const profile = await requireProfile(req);
      const handle = normalizeProfileHandle(url.searchParams.get('handle'));
      const found = await defaultContext.store.getProfileByHandle(handle);
      if (!found || found.id === profile.id) {
        return json(res, 404, { error: 'player not found' });
      }
      if (await defaultContext.store.isBlockedBetween(profile.id, found.id)) {
        return json(res, 404, { error: 'player not found' });
      }
      const areFriends = await defaultContext.store.areProfilesFriends(profile.id, found.id);
      const presence = publicPresenceForViewer(
        await defaultContext.store.profilePresence(found),
        { canSeePrivateGame: areFriends }
      );
      return json(res, 200, {
        player: {
          ...publicSocialProfile(found),
          presence
        },
        are_friends: areFriends
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/profile/presence') {
      const profile = await requireProfile(req);
      const presence = await defaultContext.store.heartbeatProfilePresence(profile.id);
      return json(res, 200, { online: true, ...presence });
    }

    if (req.method === 'GET' && url.pathname === '/api/social/profile') {
      const viewer = await requireProfile(req);
      const targetId = String(url.searchParams.get('profile_id') || '').trim();
      if (!targetId) throw new Error('profile id required');

      const target = await defaultContext.store.getProfile(targetId);
      if (!target) throw new Error('profile not found');
      if (await defaultContext.store.isBlockedBetween(viewer.id, target.id)) {
        throw new Error('profile not found');
      }

      const [presence, areFriends] = await Promise.all([
        defaultContext.store.profilePresence(target),
        defaultContext.store.areProfilesFriends(viewer.id, target.id)
      ]);

      return json(res, 200, {
        profile: publicProfile(target),
        presence: publicPresenceForViewer(presence, {
          canSeePrivateGame: areFriends
        }),
        are_friends: areFriends
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/social/watch') {
      const viewer = await requireProfile(req);
      const body = await readBody(req);
      const targetId = String(body.profile_id || '').trim();
      if (!targetId || targetId === viewer.id) throw new Error('invalid watch target');

      const target = await defaultContext.store.getProfile(targetId);
      if (!target) throw new Error('profile not found');
      if (await defaultContext.store.isBlockedBetween(viewer.id, target.id)) {
        throw new Error('profile not found');
      }

      const presence = await defaultContext.store.profilePresence(target);
      if (!presence.in_game || !presence.game?.game_id) {
        throw new Error('player is not in game');
      }

      const gameId = presence.game.game_id;
      const ctx = await loadContext(gameId);
      if (ctx.game.lifecycle?.status !== GAME_STATUS.RUNNING) {
        throw new Error('game is not watchable');
      }

      const areFriends = await defaultContext.store.areProfilesFriends(viewer.id, target.id);
      if (
        ctx.game.lifecycle?.visibility !== GAME_VISIBILITY.PUBLIC &&
        !areFriends
      ) {
        throw new Error('spectating this private game requires friendship');
      }

      const existing = await ctx.store.findPlayerByProfileId(viewer.id);
      if (existing) {
        return json(res, 200, {
          game_id: gameId,
          player: publicPlayer(existing),
          access_token: null,
          lifecycle: publicLifecycle(ctx.game.lifecycle),
          existing_membership: true
        });
      }

      const credentials = createPlayerCredentials();
      const spectator = createPlayerRecord({
        playerId: credentials.player_id,
        tokenHash: credentials.token_hash,
        displayName: viewer.display_name,
        role: PLAYER_ROLE.SPECTATOR,
        profileId: viewer.id
      });
      await ctx.store.addSpectator(spectator);
      await refreshContext(ctx);

      return json(res, 201, {
        game_id: gameId,
        player: publicPlayer(await ctx.store.getPlayer(spectator.id)),
        access_token: credentials.token,
        lifecycle: publicLifecycle(ctx.game.lifecycle)
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/social') {
      const profile = await requireProfile(req);
      const social = await defaultContext.store.listSocialState(profile.id);
      return json(res, 200, { social });
    }

    if (req.method === 'POST' && url.pathname === '/api/social/friends/request') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      let target = null;

      if (body.profile_id) {
        target = await defaultContext.store.getProfile(body.profile_id);
      } else if (body.handle) {
        target = await defaultContext.store.getProfileByHandle(body.handle);
      }

      if (!target) throw new Error('profile not found');
      const result = await defaultContext.store.sendFriendRequest(profile.id, target.id);
      return json(res, 201, {
        ...result,
        player: publicSocialProfile(target)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/social/friends/respond') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const fromProfileId = String(body.profile_id || '').trim();
      if (!fromProfileId) throw new Error('profile id required');

      const result = await defaultContext.store.respondFriendRequest(
        profile.id,
        fromProfileId,
        { accept: Boolean(body.accept) }
      );
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/social/friends/remove') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const friendProfileId = String(body.profile_id || '').trim();
      if (!friendProfileId) throw new Error('profile id required');
      await defaultContext.store.removeFriend(profile.id, friendProfileId);
      return json(res, 200, { removed: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/social/block') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const targetId = String(body.profile_id || '').trim();
      if (!targetId) throw new Error('profile id required');
      await defaultContext.store.blockProfile(profile.id, targetId);
      return json(res, 200, { blocked: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/social/unblock') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const targetId = String(body.profile_id || '').trim();
      if (!targetId) throw new Error('profile id required');
      await defaultContext.store.unblockProfile(profile.id, targetId);
      return json(res, 200, { unblocked: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/social/messages') {
      const profile = await requireProfile(req);
      const otherProfileId = String(url.searchParams.get('profile_id') || '').trim();
      if (!otherProfileId) throw new Error('profile id required');
      const messages = await defaultContext.store.listDirectMessages(
        profile.id,
        otherProfileId,
        Number(url.searchParams.get('limit') || 100)
      );
      return json(res, 200, messages);
    }

    if (req.method === 'POST' && url.pathname === '/api/social/messages') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const otherProfileId = String(body.profile_id || '').trim();
      if (!otherProfileId) throw new Error('profile id required');
      const message = await defaultContext.store.sendDirectMessage(
        profile.id,
        otherProfileId,
        body.text
      );
      return json(res, 201, { message });
    }

    if (req.method === 'POST' && url.pathname === '/api/social/game-invites') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const otherProfileId = String(body.profile_id || '').trim();
      const gameId = String(body.game_id || '').trim();
      if (!otherProfileId || !gameId) throw new Error('profile id and game id required');

      const invite = await defaultContext.store.createGameInvite(
        profile.id,
        otherProfileId,
        gameId
      );
      return json(res, 201, { invite });
    }

    if (req.method === 'POST' && url.pathname === '/api/social/game-invites/respond') {
      const profile = await requireProfile(req);
      const body = await readBody(req);
      const inviteId = String(body.invite_id || '').trim();
      if (!inviteId) throw new Error('invite id required');

      const invite = await defaultContext.store.getGameInvite(profile.id, inviteId);
      if (!invite || invite.status !== 'PENDING') throw new Error('game invite not found');
      if (invite.expires_at && Date.parse(invite.expires_at) <= Date.now()) {
        throw new Error('game invite expired');
      }

      if (!body.accept) {
        await defaultContext.store.resolveGameInvite(profile.id, inviteId, 'DECLINED');
        return json(res, 200, { accepted: false });
      }

      const joined = await joinGameById(
        invite.game_id,
        { display_name: profile.display_name },
        { profile }
      );
      await defaultContext.store.resolveGameInvite(profile.id, inviteId, 'ACCEPTED');

      return json(res, 200, {
        accepted: true,
        ...joined
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/rooms/open') {
      const rooms = await defaultContext.store.listOpenPublicGames(50);
      return json(res, 200, { rooms });
    }

    if (req.method === 'POST' && url.pathname === '/api/games/solo') {
      const body = await readBody(req);
      const profile = await optionalProfile(req);
      return json(res, 201, await createSoloGame(body, profile));
    }

    if (req.method === 'POST' && url.pathname === '/api/games') {
      const body = await readBody(req);
      const profile = await optionalProfile(req);
      return json(res, 201, await createMultiplayerGame(body, profile));
    }

    if (req.method === 'POST' && url.pathname === '/api/games/join') {
      const body = await readBody(req);
      const profile = await optionalProfile(req);
      return json(res, 201, await joinMultiplayerGame(body, profile));
    }

    const publicJoin = url.pathname.match(/^\/api\/games\/([^/]+)\/join-public$/);
    if (req.method === 'POST' && publicJoin) {
      const body = await readBody(req);
      return json(
        res,
        201,
        await joinPublicGame(
          decodeURIComponent(publicJoin[1]),
          body,
          await optionalProfile(req)
        )
      );
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
