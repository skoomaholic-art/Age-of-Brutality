// The crown passes: an heir takes the throne, and an empty one costs the House.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { normalizeOnlineEconomy } from '../src/online/economy.mjs';
import { normalizeAudit } from '../src/online/audit.mjs';
import { houseCourtTotals } from '../src/online/court.mjs';
import { heirOf, isInterregnum, processSuccession, rulerOf } from '../src/online/succession.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const catalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const HOUSE = constants.houses[0];
const T0 = 1_700_000_000_000;

function freshGame() {
  const game = createOnlineGame(map, constants, { id: 'crown', nowMs: T0, accessMode: 'PLAYER_BOUND', inviteCode: null, characterCatalog: catalog });
  const ready = normalizeAudit(normalizeOnlineEconomy(game, T0));
  ready.rounds = { houses: [...constants.houses], number: 1, round_duration_ms: 600_000 };
  return ready;
}

test('a dead ruler is succeeded by his heir, and a new heir comes to court', () => {
  const game = freshGame();
  const ruler = rulerOf(game.state, HOUSE);
  const heir = heirOf(game.state, HOUSE);
  assert.ok(ruler && heir && ruler.id !== heir.id);

  // Nothing to settle while he lives.
  assert.equal(processSuccession(game, map, catalog, { nowMs: T0 }), false);

  ruler.alive = false;
  ruler.mode = 'DEAD';
  assert.equal(processSuccession(game, map, catalog, { nowMs: T0 + 1 }), true);

  const crowned = rulerOf(game.state, HOUSE);
  assert.equal(crowned.id, heir.id, 'the heir wears the crown');
  const raised = heirOf(game.state, HOUSE);
  assert.ok(raised && raised.id !== heir.id, 'and a new heir stands at court');
  assert.equal(raised.house, HOUSE);
  assert.equal(isInterregnum(game.state, HOUSE), false);
  const word = game.state.journal.find(e => e.kind === 'SUCCESSION');
  assert.equal(word.character_name, heir.name);
  assert.equal(word.heir_name, raised.name);
});

test('with the heir in chains the throne stands empty and the House pays for it', () => {
  const game = freshGame();
  const ruler = rulerOf(game.state, HOUSE);
  const heir = heirOf(game.state, HOUSE);
  ruler.alive = false;
  ruler.mode = 'DEAD';
  heir.mode = 'CAPTIVE';

  assert.equal(processSuccession(game, map, catalog, { nowMs: T0 }), true);
  assert.equal(rulerOf(game.state, HOUSE), null);
  assert.ok(isInterregnum(game.state, HOUSE));
  assert.ok(game.state.journal.some(e => e.kind === 'THRONE_EMPTY' && e.why === 'HEIR_HELD'));
  assert.equal(houseCourtTotals(game.state, HOUSE, map.capitals).influence < 0, true);

  // He is ransomed back: the crown is his at the next settling.
  heir.mode = 'COURT';
  assert.equal(processSuccession(game, map, catalog, { nowMs: T0 + 2 }), true);
  assert.equal(rulerOf(game.state, HOUSE).id, heir.id);
  assert.equal(isInterregnum(game.state, HOUSE), false);
});

test('with nobody left of the line the throne stays empty', () => {
  const game = freshGame();
  for (const character of Object.values(game.state.characters)) {
    if (character.house !== HOUSE) continue;
    character.alive = false;
    character.mode = 'DEAD';
  }
  // Every child of the House is already spent: none can be raised.
  const spent = (catalog.characters || []).filter(card => card.house_pool === HOUSE && card.type === 'Законный ребёнок');
  for (const card of spent) game.state.characters[card.id] ||= { id: card.id, house: HOUSE, role: 'CHILD', alive: false, mode: 'DEAD' };

  assert.equal(processSuccession(game, map, catalog, { nowMs: T0 }), true);
  assert.ok(game.state.journal.some(e => e.kind === 'THRONE_EMPTY' && e.why === 'NO_HEIR'));
  assert.equal(processSuccession(game, map, catalog, { nowMs: T0 + 1 }), false, 'the wound is noted once');
});
