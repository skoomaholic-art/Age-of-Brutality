import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import {
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

test('timed fort refunds if territory changes owner before completion', () => {
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

  assert.equal(game.jobs[0].status, 'FAILED');
  assert.equal(game.state.houses['Варкайр'].gold, 8);
  assert.equal(game.state.territories.W03.fort, false);
});
