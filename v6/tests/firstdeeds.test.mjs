// The first deeds: plain things a new House is told to do, paid for once.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit } from '../src/online/audit.mjs';
import { DEEDS, checkDeeds, deedsView } from '../src/online/firstdeeds.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const T0 = 1_700_000_000_000;
const HOUSE = constants.houses[0];

function freshGame() {
  let game = createOnlineGame(map, constants, { id: 'deeds', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  return normalizeAudit(normalizeOnlineEconomy(game, T0));
}

test('a new House is given four deeds, and none of them is done at the start', () => {
  const game = freshGame();
  const view = deedsView(game, map, HOUSE);
  assert.equal(view.length, DEEDS.length);
  assert.ok(view.every(item => !item.done), 'nothing has been done yet');
  assert.equal(checkDeeds(game, map, constants, { nowMs: T0 }), false, 'and nothing is paid for');
});

test('taking a land pays for that deed once and no more', () => {
  const game = freshGame();
  const gold = Number(game.state.houses[HOUSE].gold || 0);
  const land = map.territories.find(t => t.house_sector === HOUSE && t.id !== map.capitals[HOUSE]);
  game.state.territories[land.id].owner = HOUSE;

  assert.equal(checkDeeds(game, map, constants, { nowMs: T0 }), true);
  const deed = DEEDS.find(item => item.key === 'LAND');
  assert.equal(game.state.houses[HOUSE].gold, gold + deed.gold);
  assert.ok(game.state.journal.some(e => e.kind === 'DEED_DONE' && e.deed === 'LAND' && e.house === HOUSE));
  assert.ok(deedsView(game, map, HOUSE).find(item => item.key === 'LAND').done);

  // A second look pays nothing.
  assert.equal(checkDeeds(game, map, constants, { nowMs: T0 + 1000 }), false);
  assert.equal(game.state.houses[HOUSE].gold, gold + deed.gold);
});

test('a fort pays in glory, and the last deed is marked as the last', () => {
  const game = freshGame();
  const capital = map.capitals[HOUSE];
  game.state.territories[capital].fort = { level: 1 };
  game.state.journal.push({ kind: 'UNITS_HIRED', house: HOUSE, at: new Date(T0).toISOString() });
  game.state.journal.push({ kind: 'DEAL_MADE', houses: [HOUSE, constants.houses[1]], at: new Date(T0).toISOString() });
  game.state.territories[map.territories.find(t => t.house_sector === HOUSE && t.id !== capital).id].owner = HOUSE;

  const glory = Number(game.state.houses[HOUSE].victory_points || 0);
  assert.equal(checkDeeds(game, map, constants, { nowMs: T0 }), true);
  const fort = DEEDS.find(item => item.key === 'FORT');
  const envoy = DEEDS.find(item => item.key === 'ENVOY');
  assert.equal(game.state.houses[HOUSE].victory_points, glory + fort.glory + envoy.glory);
  const done = game.state.journal.filter(e => e.kind === 'DEED_DONE' && e.house === HOUSE);
  assert.equal(done.length, DEEDS.length, 'all four were paid for');
  assert.equal(done[done.length - 1].last, true, 'and the last one says so');
  assert.ok(deedsView(game, map, HOUSE).every(item => item.done));
});
