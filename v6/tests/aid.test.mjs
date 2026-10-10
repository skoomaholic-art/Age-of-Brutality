// Standing by an ally, and hurrying a work along for gold.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy, hurryJob, queueFortJob } from '../src/online/economy.mjs';
import { normalizeAudit } from '../src/online/audit.mjs';
import { AID, declareWar, joinAllyWar, sendAid, warsOfAlly } from '../src/online/diplomacy.mjs';
import { opinionOf } from '../src/online/opinion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const [A, B, C] = constants.houses;
const T0 = 1_700_000_000_000;

function freshGame() {
  const game = createOnlineGame(map, constants, { id: 'aid', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  const ready = normalizeAudit(normalizeOnlineEconomy(game, T0));
  ready.rounds = { houses: [...constants.houses], number: 1, round_duration_ms: 600_000 };
  ready.diplomacy = { relations: {}, offers: {}, deals: {} };
  return ready;
}

function ally(game, a, b) {
  game.diplomacy.relations[[a, b].sort().join('::')] = 'ALLIANCE';
}

test('gold goes to an ally outright, and only to an ally', () => {
  const game = freshGame();
  game.state.houses[A].gold = 30;
  assert.throws(() => sendAid(game, A, B, 5, { nowMs: T0 }), /только союзнику/);

  ally(game, A, B);
  assert.throws(() => sendAid(game, A, B, AID.most + 1, { nowMs: T0 }), /не больше/);
  const sent = sendAid(game, A, B, 5, { nowMs: T0 });
  assert.equal(sent.state.houses[A].gold, 25);
  assert.equal(sent.state.houses[B].gold, Number(game.state.houses[B].gold || 0) + 5);
  assert.ok(sent.state.journal.some(e => e.kind === 'AID_SENT' && e.gold === 5));
  assert.ok(opinionOf(sent, B, A) > 0, 'he remembers the gift');

  sent.state.houses[A].gold = 2;
  assert.throws(() => sendAid(sent, A, B, 10, { nowMs: T0 }), /в казне столько нет/);
});

test('a House may take up its ally’s war, and is remembered for it', () => {
  let game = freshGame();
  ally(game, A, B);
  assert.deepEqual(warsOfAlly(game, A, B), [], 'he is at war with nobody yet');
  assert.throws(() => joinAllyWar(game, A, B, C, { nowMs: T0 }), /с этим Домом не воюет/);

  game = declareWar(game, constants, B, C, { nowMs: T0 });
  assert.deepEqual(warsOfAlly(game, A, B), [C]);

  const joined = joinAllyWar(game, A, B, C, { nowMs: T0 + 1 });
  assert.equal(joined.diplomacy.relations[[A, C].sort().join('::')], 'WAR');
  assert.ok(joined.state.journal.some(e => e.kind === 'WAR_JOINED' && e.ally === B && e.foe === C));
  assert.ok(opinionOf(joined, B, A) > 0, 'the ally remembers who stood with him');
  // And once at war with him, there is nothing left to join.
  assert.deepEqual(warsOfAlly(joined, A, B), []);
});

test('a work is hurried for gold, and what is left of the waiting is halved', () => {
  const game = freshGame();
  const land = map.territories.find(t => t.type !== 'Столица' && t.house_sector === A);
  game.state.territories[land.id].owner = A;
  game.state.houses[A].gold = 40;

  const { game: queued, job } = queueFortJob(game, map, constants, { house: A, territory: land.id }, { nowMs: T0 });
  const left = Date.parse(job.due_at) - T0;

  const gold = queued.state.houses[A].gold;
  const hurried = hurryJob(queued, { house: A, jobId: job.id }, { nowMs: T0 });
  const after = hurried.jobs.find(item => item.id === job.id);
  assert.ok(hurried.state.houses[A].gold < gold, 'the masters are paid');
  assert.equal(Date.parse(after.due_at) - T0, Math.round(left / 2));
  assert.ok(hurried.state.journal.some(e => e.kind === 'JOB_HURRIED'));

  assert.throws(() => hurryJob(hurried, { house: B, jobId: job.id }, { nowMs: T0 }), /у твоего Дома нет/);
});
