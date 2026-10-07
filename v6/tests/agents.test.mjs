import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit } from '../src/online/audit.mjs';
import { startRounds } from '../src/online/rounds.mjs';
import { visiblePositions } from '../src/online/fog.mjs';
import { bandNow, buildWayfarers, wayfarerLegMs } from '../src/online/wayfarers.mjs';
import { attachSpy, hireSpy, processAgents, SPY_COST } from '../src/online/agents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const T0 = 1_000_000_000;
const HOUSE = 'Варкайр';

test('a spy joins wayfarers resting in our land, arrives with them and opens the land', () => {
  let game = createOnlineGame(map, constants, { id: 'spy-test', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  game.lifecycle.status = 'RUNNING';
  game = startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs: 600_000 });
  const bands = buildWayfarers(game, map);
  assert.ok(bands.length >= 3);
  const legMs = wayfarerLegMs(game);

  assert.throws(() => attachSpy(game, map, { house: HOUSE, band: 0, target: bands[0].path[1] }, { nowMs: T0 }), /должна стоять|свободного/);
  const gold = game.state.houses[HOUSE].gold;
  game = hireSpy(game, constants, HOUSE, { nowMs: T0 });
  assert.equal(game.state.houses[HOUSE].gold, gold - SPY_COST);

  // Find a moment when band 0 rests, and make that land ours.
  const band = bands[0];
  let now = T0;
  while (!bandNow(band, legMs, now).resting) now += 1000;
  const here = bandNow(band, legMs, now).from;
  game.state.territories[here].owner = HOUSE;
  const target = band.path.find(id => id !== here);
  const sent = attachSpy(game, map, { house: HOUSE, band: band.id, target }, { nowMs: now });
  const arrive = Date.parse(sent.agent.arrive_at);
  assert.ok(arrive > now);
  assert.equal(bandNow(band, legMs, arrive + 1).from, target, 'the band is there when he arrives');

  let later = processAgents(sent.game, map, { nowMs: arrive - 1 });
  assert.equal(later, sent.game);
  later = processAgents(sent.game, map, { nowMs: arrive });
  assert.equal(later.agents[HOUSE][0].status, 'WATCH');
  assert.ok(visiblePositions(later.state, map, HOUSE).has(target));
  const done = processAgents(later, map, { nowMs: Date.parse(later.agents[HOUSE][0].until) });
  assert.equal(done.agents[HOUSE][0].status, 'IDLE');
  assert.equal(done.agents[HOUSE][0].missions, 1);
  assert.equal(done.state.spy_sight?.[HOUSE], undefined);
});
