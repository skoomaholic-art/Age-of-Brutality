// A short game played against a real server, over real HTTP.
//
// The tests check the rules; this checks the thing the player actually talks
// to: that the server starts, makes a world, hands out a state, lets a host
// march and answers every pane the game opens. A crash in code the tests never
// run — a misspelt name in the snapshot, a route wired to nothing — shows up
// here and nowhere else.
//
//   node tools/smoke.mjs
//
// Exits 0 when the whole round-trip worked, 1 with the reason when it did not.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['--import', './tools/dev/register-fake-firestore.mjs', 'src/online/server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), AOB_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverSaid = '';
server.stdout.on('data', chunk => { serverSaid += chunk; });
server.stderr.on('data', chunk => { serverSaid += chunk; });

const done = (code, why) => {
  if (why) console.error(why);
  if (code && serverSaid.trim()) console.error('--- server said ---\n' + serverSaid.trim().split('\n').slice(-25).join('\n'));
  server.kill('SIGKILL');
  process.exit(code);
};

process.on('unhandledRejection', error => done(1, 'ПАДЕНИЕ: ' + (error?.message || error)));

async function call(method, where, body, token) {
  const res = await fetch(BASE + where, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      // Every command wants a key of its own, as a courier's letter has a seal.
      ...(method === 'POST' ? { 'idempotency-key': 'smoke-' + Math.random().toString(36).slice(2) } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`${method} ${where} → ${res.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForServer() {
  for (let tries = 0; tries < 80; tries += 1) {
    try {
      await fetch(BASE + '/api/build');
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('сервер не поднялся за 20 секунд');
}

const steps = [];
const step = (name, run) => steps.push({ name, run });

let token = null;
let gameId = null;
let house = null;

step('сервер отвечает', async () => {
  await waitForServer();
  await call('GET', '/api/build');
});

step('новая игра в одиночку', async () => {
  house = 'Варкайр';
  const made = await call('POST', '/api/games/solo', {
    house,
    display_name: 'Смоук',
    houses_count: 4,
    map: 'random',
    shape: 'mainland'
  });
  gameId = made.game_id;
  token = made.access_token;
  if (!gameId || !token) throw new Error('сервер не дал ни игры, ни ключа: ' + JSON.stringify(made).slice(0, 200));
});

step('состояние мира выдаётся', async () => {
  const state = await call('GET', `/api/games/${gameId}/state`, null, token);
  if (!state?.game?.state?.territories) throw new Error('в ответе нет земель');
  if (!state.rounds) throw new Error('в ответе нет счёта дней');
  // The things added last are exactly the ones a crash hides.
  for (const field of ['season', 'terrain_kinds', 'order_rules']) {
    if (state.game[field] === undefined) throw new Error(`в состоянии нет поля ${field}`);
  }
});

step('все панели отвечают', async () => {
  for (const where of ['/lobby', '/bootstrap', `/economy?house=${encodeURIComponent(house)}`,
    `/characters?house=${encodeURIComponent(house)}`, `/legal?house=${encodeURIComponent(house)}`,
    '/map-art/provinces.json']) {
    await call('GET', `/api/games/${gameId}${where}`, null, token);
  }
});

step('рать выходит в поход', async () => {
  const state = await call('GET', `/api/games/${gameId}/state`, null, token);
  void state;
  const legal = await call('GET', `/api/games/${gameId}/legal?house=${encodeURIComponent(house)}`, null, token);
  const list = Array.isArray(legal) ? legal : (legal.actions || legal.legal_actions || []);
  const march = list.find(action => action.type === 'MARCH');
  if (!march) throw new Error('войску некуда идти в самом начале игры');
  await call('POST', `/api/games/${gameId}/orders`, {
    house, from: march.from, to: march.to, warriors: march.warriors, mode: march.mode || 'LAND', plan: 'CHARGE'
  }, token);
  const after = await call('GET', `/api/games/${gameId}/state`, null, token);
  if (!(after.game.orders || []).some(order => order.action?.house === house)) throw new Error('приказ не записался');
});

step('устремление Дома называется', async () => {
  await call('POST', `/api/games/${gameId}/aspiration`, { house, key: 'SWORD' }, token);
  const state = await call('GET', `/api/games/${gameId}/state`, null, token);
  if (state.game.aspiration?.chosen !== 'SWORD') throw new Error('путь Дома не записался');
});

const start = Date.now();
for (const item of steps) {
  try {
    await item.run();
    console.log('OK  ' + item.name);
  } catch (error) {
    done(1, 'ПАДЕНИЕ на шаге «' + item.name + '»: ' + (error?.message || error));
  }
}
console.log(`Всё прошло за ${((Date.now() - start) / 1000).toFixed(1)} с`);
done(0);
