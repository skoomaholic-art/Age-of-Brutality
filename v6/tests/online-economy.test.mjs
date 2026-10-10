import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import {
  ONLINE_ECONOMY_TIMING,
  normalizeOnlineEconomy,
  processEconomy,
  queueFortJob,
  queueRecruitJob
} from '../src/online/economy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const c = loadJson(path.join(root, 'src/data/constants.v6.json'));
const timing = { incomeIntervalMs: 100, recruitBuildMs: 10, fortBuildMs: 20 };

test('online income pulse accrues while game is persistent', () => {
  let game = createOnlineGame(map, c, { nowMs: 1000 });
  game = normalizeOnlineEconomy(game, 1000, timing);
  game = processEconomy(game, map, c, 1101, timing);
  assert.equal(game.state.houses['Варкайр'].gold, 12);
  assert.equal(game.state.houses['Варкайр'].influence, 4);
});

test('timed recruitment reserves gold and completes later', () => {
  let game = createOnlineGame(map, c, { nowMs: 2000 });
  game = normalizeOnlineEconomy(game, 2000, timing);
  game = queueRecruitJob(game, c, {
    house: 'Варкайр',
    territory: 'W01',
    warriors: 2
  }, { nowMs: 2000, timing }).game;

  assert.equal(game.state.houses['Варкайр'].gold, 6);
  assert.equal(game.state.territories.W01.warriors['Варкайр'], 4);

  game = processEconomy(game, map, c, 2021, timing);
  assert.equal(game.jobs[0].status, 'RESOLVED');
  assert.equal(game.state.territories.W01.warriors['Варкайр'], 6);
});

test('a fort begun in a land that falls is finished for the captor, unpaid', () => {
  let game = createOnlineGame(map, c, { nowMs: 3000 });
  game = normalizeOnlineEconomy(game, 3000, timing);
  game.state.territories.W03.owner = 'Варкайр';
  game = queueFortJob(game, map, c, {
    house: 'Варкайр',
    territory: 'W03'
  }, { nowMs: 3000, timing }).game;

  assert.equal(game.state.houses['Варкайр'].gold, 5);
  game.state.territories.W03.owner = 'Сайрвен';
  game = processEconomy(game, map, c, 3021, timing);

  assert.equal(game.jobs[0].status, 'RESOLVED');
  assert.equal(game.jobs[0].seized_by, 'Сайрвен');
  assert.equal(game.state.houses['Варкайр'].gold, 5, 'no refund');
  assert.equal(game.state.territories.W03.fort, true);
  assert.deepEqual(game.state.houses['Сайрвен'].forts, ['W03']);
});


test('accelerated test build timers are 4 and 5 seconds', () => {
  assert.equal(ONLINE_ECONOMY_TIMING.recruitBuildMs, 4000);
  assert.equal(ONLINE_ECONOMY_TIMING.fortBuildMs, 5000);
});

test('income missed over days of idling is paid in one step, not replayed pulse by pulse', () => {
  const started = Date.parse('2026-10-02T15:00:00Z');
  const interval = 120_000;
  let game = normalizeOnlineEconomy(
    createOnlineGame(map, c, { nowMs: started }),
    started,
    { incomeIntervalMs: interval, recruitBuildMs: 4_000, fortBuildMs: 5_000 }
  );
  const house = c.houses[0];
  const goldBefore = game.state.houses[house].gold;
  const perPulse = 4; // one home capital

  // Five idle days: 3600 pulses. The first one is due one interval after the start.
  const now = started + 3600 * interval;
  const clock = Date.now();
  game = processEconomy(game, map, c, now);
  const elapsed = Date.now() - clock;

  const pulses = game.state.journal.filter(entry => entry.kind === 'ONLINE_INCOME_PULSE');
  assert.equal(pulses.length, 1);
  assert.equal(pulses[0].pulses, 3600);
  assert.equal(pulses[0].gains[house].gold, perPulse * 3600);
  assert.equal(game.state.houses[house].gold, goldBefore + perPulse * 3600);
  assert.equal(Date.parse(game.next_income_at), now + interval);
  assert.ok(elapsed < 1_000, `catch-up took ${elapsed} ms`);

  // Nothing more is due until the next interval.
  const again = processEconomy(game, map, c, now + 1);
  assert.equal(again.state.houses[house].gold, game.state.houses[house].gold);
});

test('a levy paid for in a land that falls is raised for the captor', async () => {
  const { cancelJob, CANCEL_DELAY_MS } = await import('../src/online/economy.mjs');
  const house = c.houses[0];
  const rival = c.houses[1];
  const capital = map.capitals[house];
  const now = Date.parse('2026-01-01T00:00:00Z');
  let game = normalizeOnlineEconomy(createOnlineGame(map, c, { id: 'seize', nowMs: now}), now);
  const goldBefore = game.state.houses[house].gold;
  let queued = queueRecruitJob(game, c, { house, territory: capital, warriors: 2 }, { nowMs: now });
  game = queued.game;
  assert.equal(game.state.houses[house].gold, goldBefore - 2);

  // The land falls before the levy is ready.
  game.state.territories[capital].owner = rival;
  game.state.territories[capital].warriors = { [rival]: 1 };
  assert.throws(() => cancelJob(game, { house, jobId: queued.job.id }, { nowMs: now + 1 }), /захвачена/);
  game = processEconomy(game, map, c, Date.parse(queued.job.due_at));
  assert.equal(game.state.territories[capital].warriors[rival], 3, 'the captor gets the warriors');
  assert.equal(game.state.houses[house].gold, goldBefore - 2, 'and the payer gets nothing back');
  assert.ok(game.state.journal.some(e => e.kind === 'JOB_SEIZED' && e.captor === rival && e.house === house));

  // Cancelling in time: ten seconds later the gold is back.
  let fresh = normalizeOnlineEconomy(createOnlineGame(map, c, { id: 'cancel', nowMs: now}), now);
  queued = queueRecruitJob(fresh, c, { house, territory: capital, warriors: 1 }, { nowMs: now, timing: { ...ONLINE_ECONOMY_TIMING, recruitBuildMs: 60_000 } });
  const cancelled = cancelJob(queued.game, { house, jobId: queued.job.id }, { nowMs: now + 1000 });
  fresh = processEconomy(cancelled.game, map, c, now + 1000 + CANCEL_DELAY_MS - 1);
  assert.equal(fresh.jobs[0].status, 'PENDING', 'not before the countdown ends');
  fresh = processEconomy(fresh, map, c, now + 1000 + CANCEL_DELAY_MS);
  assert.equal(fresh.jobs[0].status, 'CANCELLED');
  assert.equal(fresh.state.houses[house].gold, goldBefore);
});
