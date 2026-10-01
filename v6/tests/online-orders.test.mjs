import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import {
  listQueueableMarches,
  processDueOrders,
  queueTimedOrder,
  reservedWarriors
} from '../src/online/orders.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const timing = { landSegmentMs: 10, seaSegmentMs: 15 };

test('persistent prototype queues and resolves a timed friendly March', () => {
  let game = createOnlineGame(map, constants, { nowMs: 1_000 });
  game.state.territories.W02.owner = 'Варкайр';

  const action = {
    type: 'MARCH',
    mode: 'LAND',
    house: 'Варкайр',
    from: 'W01',
    to: 'W02',
    warriors: 1
  };

  const queued = queueTimedOrder(game, map, constants, action, {
    nowMs: 1_000,
    timing
  });
  game = queued.game;

  assert.equal(game.orders[0].status, 'PENDING');
  assert.equal(reservedWarriors(game, 'Варкайр', 'W01'), 1);

  game = processDueOrders(game, map, constants, 1_011);

  assert.equal(game.orders[0].status, 'RESOLVED');
  assert.equal(game.state.territories.W01.warriors['Варкайр'], 3);
  assert.equal(game.state.territories.W02.warriors['Варкайр'], 1);
});

test('pending orders reserve warriors and prevent double spending', () => {
  let game = createOnlineGame(map, constants, { nowMs: 2_000 });
  game.state.territories.W02.owner = 'Варкайр';

  const first = {
    type: 'MARCH',
    mode: 'LAND',
    house: 'Варкайр',
    from: 'W01',
    to: 'W02',
    warriors: 3
  };

  game = queueTimedOrder(game, map, constants, first, {
    nowMs: 2_000,
    timing
  }).game;

  const queueable = listQueueableMarches(game, map, constants, 'Варкайр');
  assert.equal(
    queueable.some(action => action.from === 'W01' && action.warriors > 1),
    false
  );

  assert.throws(() => {
    queueTimedOrder(game, map, constants, {
      ...first,
      warriors: 2
    }, {
      nowMs: 2_001,
      timing
    });
  }, /LEGAL_ACTIONS/);
});

test('a stale timed order fails atomically if its origin changes owner before arrival', () => {
  let game = createOnlineGame(map, constants, { nowMs: 3_000 });
  game.state.territories.W02.owner = 'Варкайр';

  const action = {
    type: 'MARCH',
    mode: 'LAND',
    house: 'Варкайр',
    from: 'W01',
    to: 'W02',
    warriors: 1
  };

  game = queueTimedOrder(game, map, constants, action, {
    nowMs: 3_000,
    timing
  }).game;

  game.state.territories.W01.owner = 'Сайрвен';
  const before = structuredClone(game.state.territories.W02);

  game = processDueOrders(game, map, constants, 3_011);

  assert.equal(game.orders[0].status, 'FAILED');
  assert.deepEqual(game.state.territories.W02, before);
});
