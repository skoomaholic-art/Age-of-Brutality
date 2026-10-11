// Spies: hired, told where to go, taken along by the next band of wayfarers.
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
import { hireSpy, orderSpy, processAgents, setWatch, watchOver, SPY_COST, WATCH } from '../src/online/agents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const T0 = 1_000_000_000;
const HOUSE = 'Варкайр';

function started(id = 'spy-test') {
  let game = createOnlineGame(map, constants, { id, nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  game.lifecycle.status = 'RUNNING';
  return startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs: 600_000 });
}

test('every band walks a round that takes in every settlement of the map', () => {
  const game = started('round-test');
  const bands = buildWayfarers(game, map);
  assert.ok(bands.length >= 3);
  const settlements = map.territories
    .filter(t => ['Деревня', 'Город', 'Столица'].includes(t.type))
    .map(t => t.id);
  const near = {};
  for (const [a, b] of map.land_edges || []) { (near[a] ||= []).push(b); (near[b] ||= []).push(a); }
  const reachable = start => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) for (const next of near[queue.shift()] || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    return seen;
  };
  for (const band of bands) {
    const seen = new Set(band.path);
    const canReach = reachable(band.path[0]);
    // Islands across the water are nobody's round: only the mainland counts.
    const missed = settlements.filter(id => canReach.has(id) && !seen.has(id));
    assert.deepEqual(missed, [], `band ${band.id} misses ${missed.join(', ')}`);
    // Every step of the round is one road, never a leap across the map.
    for (let i = 0; i < band.path.length; i += 1) {
      const a = band.path[i];
      const b = band.path[(i + 1) % band.path.length];
      if (a === b) continue;
      const road = (map.land_edges || []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      assert.ok(road, `band ${band.id} walks from ${a} to ${b} with no road`);
    }
  }
});

test('a spy waits for company, rides to his mark and opens the land', () => {
  let game = started();
  const legMs = wayfarerLegMs(game);
  const gold = game.state.houses[HOUSE].gold;
  game = hireSpy(game, constants, HOUSE, { nowMs: T0 });
  assert.equal(game.state.houses[HOUSE].gold, gold - SPY_COST);

  // A land of ours where a band will stop, and a mark far from it.
  const band = buildWayfarers(game, map)[0];
  let now = T0;
  while (!bandNow(band, legMs, now).resting) now += 1000;
  const here = bandNow(band, legMs, now).from;
  game.state.territories[here].owner = HOUSE;
  const target = band.path.find(id => id !== here && game.state.territories[id]);

  assert.throws(() => orderSpy(game, map, { house: HOUSE, agentId: 'S1', from: target, target: here }), /в твоей земле/);
  const sent = orderSpy(game, map, { house: HOUSE, agentId: 'S1', from: here, target }, { nowMs: now });
  assert.equal(sent.agent.status, 'WAITING');
  assert.ok(sent.game.state.journal.some(e => e.kind === 'SPY_WAITING'));

  // The band is standing right here, so it takes him at the next tick.
  const aboard = processAgents(sent.game, map, { nowMs: now });
  const agent = aboard.agents[HOUSE][0];
  assert.equal(agent.status, 'TRAVEL', 'the band took him along');
  assert.ok(aboard.state.band_rounds[band.id], 'the band walks a round of its own now');
  assert.ok(aboard.state.journal.some(e => e.kind === 'SPY_JOINED'));

  const arrive = Date.parse(agent.arrive_at);
  assert.ok(arrive > now);
  const diverted = buildWayfarers(aboard, map).find(item => item.id === band.id);
  assert.equal(bandNow(diverted, legMs, arrive + 1).from, target, 'the band is there when he arrives');
  // The mark is not the first stop: the band has its own business on the way.
  assert.ok(diverted.path.indexOf(target) > 0, 'it does not walk straight at the mark');

  let later = processAgents(aboard, map, { nowMs: arrive - 1 });
  assert.equal(later.agents[HOUSE][0].status, 'TRAVEL');
  later = processAgents(aboard, map, { nowMs: arrive });
  assert.equal(later.agents[HOUSE][0].status, 'WATCH');
  assert.ok(visiblePositions(later.state, map, HOUSE).has(target));
  const done = processAgents(later, map, { nowMs: Date.parse(later.agents[HOUSE][0].until) });
  assert.equal(done.agents[HOUSE][0].status, 'IDLE');
  assert.equal(done.agents[HOUSE][0].missions, 1);
  assert.equal(done.state.spy_sight?.[HOUSE], undefined);
});


test('a watch at the gate takes the spy who comes to look', () => {
  let game = started('watch-test');
  const legMs = wayfarerLegMs(game);
  game = hireSpy(game, constants, HOUSE, { nowMs: T0 });

  const band = buildWayfarers(game, map)[0];
  let now = T0;
  while (!bandNow(band, legMs, now).resting) now += 1000;
  const here = bandNow(band, legMs, now).from;
  game.state.territories[here].owner = HOUSE;
  const target = band.path.find(id => id !== here && game.state.territories[id]);

  // The House that owns the mark sets gate-keepers over it.
  const THEM = 'Сайрвен';
  game.state.territories[target].owner = THEM;
  game.state.houses[THEM].gold = 10;
  game = setWatch(game, map, THEM, target, { nowMs: now });
  assert.ok(watchOver(game.state, target, now));
  assert.equal(game.state.houses[THEM].gold, 10 - WATCH.gold);
  assert.throws(() => setWatch(game, map, THEM, target, { nowMs: now }), /уже стоит/);

  const sent = orderSpy(game, map, { house: HOUSE, agentId: 'S1', from: here, target }, { nowMs: now });
  const aboard = processAgents(sent.game, map, { nowMs: now });
  const arrive = Date.parse(aboard.agents[HOUSE][0].arrive_at);
  const caught = processAgents(aboard, map, { nowMs: arrive });
  assert.deepEqual(caught.agents[HOUSE], [], 'the spy is gone');
  assert.ok(caught.state.journal.some(e => e.kind === 'SPY_CAUGHT' && e.against === HOUSE));
  assert.equal(caught.state.spy_sight?.[HOUSE]?.[target], undefined, 'he sent no word home');
});
