// Standing to arms, and the lie of the land in a fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { baseDefense } from '../src/core/combat.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit } from '../src/online/audit.mjs';
import { HOLD, holdGuard, holdLine, isHolding, standDown } from '../src/online/stance.mjs';
import { terrainGuard } from '../src/online/terrain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const HOUSE = constants.houses[0];
const T0 = 1_700_000_000_000;

function freshGame() {
  const game = createOnlineGame(map, constants, { id: 'stance', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null });
  return normalizeAudit(normalizeOnlineEconomy(game, T0));
}

test('a host told to hold the line digs in, and stands down when told again', () => {
  const game = freshGame();
  const id = map.capitals[HOUSE];
  game.state.territories[id].warriors[HOUSE] = 4;

  const other = constants.houses[1];
  assert.throws(() => holdLine(game, map, other, id, { nowMs: T0 }), /в своей земле/);

  const held = holdLine(game, map, HOUSE, id, { nowMs: T0 });
  assert.ok(isHolding(held.state, id, HOUSE));
  assert.equal(holdGuard(held.state, id, HOUSE), HOLD.guard);
  assert.ok(held.state.journal.some(e => e.kind === 'HOLDING_LINE'));

  const down = holdLine(held, map, HOUSE, id, { nowMs: T0 + 1 });
  assert.equal(isHolding(down.state, id, HOUSE), false);
  assert.ok(down.state.journal.some(e => e.kind === 'STOOD_DOWN'));
});

test('ditches add to the defence of a land, on top of its walls and its ground', () => {
  const game = freshGame();
  const id = map.capitals[HOUSE];
  const plain = baseDefense(map, game.state, constants, id);
  game.state.holding = { [id]: { [HOUSE]: true } };
  // The stance is not part of the land's own defence: it is counted per House.
  assert.equal(baseDefense(map, game.state, constants, id), plain);
  assert.equal(holdGuard(game.state, id, HOUSE), HOLD.guard);
  standDown(game.state, id, HOUSE);
  assert.equal(holdGuard(game.state, id, HOUSE), 0);
});

test('mountains and marshes are held harder than open ground', () => {
  const rough = { ...map, terrain: { X: 'горы', Y: 'болота', Z: 'равнина' } };
  assert.equal(terrainGuard(rough, 'X'), 2);
  assert.equal(terrainGuard(rough, 'Y'), 1);
  assert.equal(terrainGuard(rough, 'Z'), 0);

  // And it tells in the defence of the land itself.
  const game = freshGame();
  const id = map.capitals[HOUSE];
  const flat = baseDefense(map, game.state, constants, id);
  const hilly = baseDefense({ ...map, terrain: { [id]: 'горы' } }, game.state, constants, id);
  assert.equal(hilly, flat + 2);
});
