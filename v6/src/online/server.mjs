import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateMarches } from '../core/legal-actions.mjs';
import { loadJson } from '../core/map.mjs';
import { JsonGameStore } from './store.mjs';
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

const here = path.dirname(fileURLToPath(import.meta.url));
const v6Root = path.resolve(here, '../..');
const map = loadJson(path.join(v6Root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(v6Root, 'src/data/constants.v6.json'));
const stateFile = process.env.AOB_ONLINE_STATE_FILE || path.join(v6Root, 'runtime/online-game.json');
const store = new JsonGameStore(stateFile);
let game = normalizeOnlineEconomy(store.loadOrCreate(map, constants));
store.save(game);

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
    if (body.length > 1_000_000) throw new Error('request body too large');
  }
  if (!body) return {};
  return JSON.parse(body);
}

function tick() {
  const nowMs = Date.now();
  let processed = processDueOrders(game, map, constants, nowMs);
  processed = processEconomy(processed, map, constants, nowMs);
  if (processed.updated_at !== game.updated_at) {
    game = processed;
    store.save(game);
  }
}

function publicState() {
  return {
    game,
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    tick();

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, publicState());
    }

    if (req.method === 'GET' && url.pathname === '/api/legal') {
      const house = url.searchParams.get('house');
      if (!constants.houses.includes(house)) {
        return json(res, 400, { error: 'unknown house' });
      }
      const legal = listQueueableMarches(game, map, constants, house);
      return json(res, 200, { house, actions: legal });
    }

    if (req.method === 'GET' && url.pathname === '/api/economy') {
      const house = url.searchParams.get('house');
      if (!constants.houses.includes(house)) {
        return json(res, 400, { error: 'unknown house' });
      }
      return json(res, 200, economyView(game, map, constants, house));
    }

    if (req.method === 'POST' && url.pathname === '/api/recruit') {
      const body = await readBody(req);
      const queued = queueRecruitJob(game, constants, {
        house: body.house,
        territory: body.territory,
        warriors: Number(body.warriors)
      });
      game = queued.game;
      store.save(game);
      return json(res, 201, { job: queued.job, game });
    }

    if (req.method === 'POST' && url.pathname === '/api/fort') {
      const body = await readBody(req);
      const queued = queueFortJob(game, map, constants, {
        house: body.house,
        territory: body.territory
      });
      game = queued.game;
      store.save(game);
      return json(res, 201, { job: queued.job, game });
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(req);
      const action = {
        type: 'MARCH',
        mode: body.mode || 'LAND',
        house: body.house,
        from: body.from,
        to: body.to,
        warriors: Number(body.warriors)
      };

      const queued = queueTimedOrder(game, map, constants, action);
      game = queued.game;
      store.save(game);
      return json(res, 201, { order: queued.order, game });
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      game = normalizeOnlineEconomy(store.reset(map, constants));
      store.save(game);
      return json(res, 200, publicState());
    }

    if (req.method === 'GET' && url.pathname === '/api/debug/all-legal') {
      const byHouse = Object.fromEntries(
        constants.houses.map(house => [house, enumerateMarches(game.state, map, constants, house)])
      );
      return json(res, 200, byHouse);
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(v6Root, 'online/index.html'), 'utf8');
      return text(res, 200, html, 'text/html; charset=utf-8');
    }

    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

setInterval(() => {
  try {
    tick();
  } catch (error) {
    console.error('background tick failed', error);
  }
}, 1_000).unref();

const port = Number(process.env.PORT || 8787);
server.listen(port, '0.0.0.0', () => {
  console.log(`Age of Brutality persistent prototype: http://localhost:${port}`);
  console.log(`State file: ${stateFile}`);
});
