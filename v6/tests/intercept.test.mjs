// Catching a host on the road: an ambush laid from a land beside its way.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit } from '../src/online/audit.mjs';
import { startRounds } from '../src/online/rounds.mjs';
import { listQueueableMarches, queueTimedOrder, processDueOrders } from '../src/online/orders.mjs';
import { listInterceptions, orderIntercept, processAmbushes } from '../src/online/intercept.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const T0 = 1_700_000_000_000;

function freshGame() {
  let game = createOnlineGame(map, constants, { id: 'ambush', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  game = normalizeAudit(normalizeOnlineEconomy(game, T0));
  game.lifecycle.status = 'RUNNING';
  return startRounds(game, map, constants, { nowMs: T0, mode: 'days', dayMs: 600_000 });
}

// A House marching out, and a neighbour of the road with men to spare.
function marchingGame() {
  const game = freshGame();
  const them = constants.houses[0];
  const march = listQueueableMarches(game, map, constants, them)
    .filter(action => action.warriors >= 2)
    .sort((a, b) => b.warriors - a.warriors)[0];
  assert.ok(march, 'the House has somewhere to march');
  game.state.territories[march.from].warriors[them] = 8;
  const queued = queueTimedOrder(game, map, constants, { ...march, warriors: 4 }, { nowMs: T0 });
  return { game: queued.game, order: queued.game.orders[queued.game.orders.length - 1], them, march };
}

test('a House sees the columns it could catch, and may not empty a land to do it', () => {
  const { game, them, order } = marchingGame();
  const us = constants.houses.find(house => house !== them);
  // We hold the land the column is walking into, with a garrison of our own.
  const road = order.action.to;
  game.state.territories[road].owner = us;
  game.state.territories[road].warriors = { [us]: 5 };

  const offers = listInterceptions(game, map, us, { nowMs: T0 + 100 });
  const mine = offers.find(item => item.order_id === order.id && item.from === road);
  assert.ok(mine, 'the column can be caught from the land it is walking into');
  assert.equal(mine.max, 4, 'one man always stays to hold the land');
  assert.throws(() => orderIntercept(game, map, constants, us, { orderId: order.id, from: road, warriors: 5, nowMs: T0 + 100 }), /не больше/);
  assert.throws(() => orderIntercept(game, map, constants, us, { orderId: order.id, from: order.action.from, warriors: 1, nowMs: T0 + 100 }), /не перехватить/);
});

test('an ambush is fought on the road: both sides bleed and a beaten column turns home', () => {
  const { game, them, order } = marchingGame();
  const us = constants.houses.find(house => house !== them);
  const road = order.action.to;
  game.state.territories[road].owner = us;
  game.state.territories[road].warriors = { [us]: 12 };

  const laid = orderIntercept(game, map, constants, us, { orderId: order.id, from: road, warriors: 10, nowMs: T0 + 100 });
  const live = laid.orders.find(item => item.id === order.id);
  assert.equal(live.ambush.length, 1);
  assert.ok(laid.state.journal.some(e => e.kind === 'AMBUSH_LAID'));

  // Nothing happens before the hour of the meeting.
  assert.equal(processAmbushes(structuredClone(laid), map, constants, T0 + 200), 0);

  const meeting = Date.parse(live.ambush[0].at);
  const fought = structuredClone(laid);
  assert.equal(processAmbushes(fought, map, constants, meeting), 1);
  const fight = fought.state.journal.find(e => e.kind === 'AMBUSH');
  assert.ok(fight, 'the fight is written down');
  assert.equal(fight.ours, 10);
  assert.ok(fight.their_lost > 0, 'the column lost men');
  assert.equal(fight.won, true, 'ten against four carry the road');

  const after = fought.orders.find(item => item.id === order.id);
  assert.ok(after.return_home || after.status === 'FAILED', 'the column does not walk on');
  // The dead of the column are struck off the land it set out from.
  const left = Number(fought.state.territories[order.action.from].warriors[them] || 0);
  assert.equal(left, 8 - fight.their_lost);
});

test('an ambush that fails lets the column walk on, thinner', () => {
  const { game, them, order } = marchingGame();
  const us = constants.houses.find(house => house !== them);
  const road = order.action.to;
  game.state.territories[road].owner = us;
  game.state.territories[road].warriors = { [us]: 2 };

  const laid = orderIntercept(game, map, constants, us, { orderId: order.id, from: road, warriors: 1, nowMs: T0 + 100 });
  const live = laid.orders.find(item => item.id === order.id);
  const fought = structuredClone(laid);
  processAmbushes(fought, map, constants, Date.parse(live.ambush[0].at));
  const fight = fought.state.journal.find(e => e.kind === 'AMBUSH');
  assert.equal(fight.won, false, 'one man does not stop four');
  const after = fought.orders.find(item => item.id === order.id);
  assert.equal(after.status, 'PENDING');
  assert.ok(!after.return_home, 'it walks on');
});

test('the tick settles ambushes before anybody arrives', () => {
  const { game, order } = marchingGame();
  const us = constants.houses.find(house => house !== order.action.house);
  const road = order.action.to;
  game.state.territories[road].owner = us;
  game.state.territories[road].warriors = { [us]: 12 };
  const laid = orderIntercept(game, map, constants, us, { orderId: order.id, from: road, warriors: 10, nowMs: T0 + 100 });
  const meeting = Date.parse(laid.orders.find(item => item.id === order.id).ambush[0].at);
  const ticked = processDueOrders(laid, map, constants, meeting);
  assert.ok(ticked.state.journal.some(e => e.kind === 'AMBUSH'));
});
