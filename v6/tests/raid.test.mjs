// Вольные люди не сидят на месте: набег на тех, кто не поставил дозор.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { seedWild, wildDawn, guardCap, RAID } from '../src/online/wild.mjs';
import { seedPopulation } from '../src/online/units.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const HOUSE = constants.houses[0];

function freshGame() {
  const game = createOnlineGame(map, constants, { id: 'raid', nowMs: 1 });
  seedWild(game, map);
  seedPopulation(game, map);
  return game;
}

// A free land beside one of ours, and the land it would come for.
function border(game) {
  for (const [a, b] of map.land_edges) {
    for (const [free, mine] of [[a, b], [b, a]]) {
      if (game.state.territories[free].owner) continue;
      if (game.state.territories[mine].owner !== HOUSE) continue;
      return { free, mine };
    }
  }
  return null;
}

test('the guard grows back towards its cap and never beyond it', () => {
  const game = freshGame();
  const { free } = border(game);
  const cap = guardCap(game.state.wild.rings[free] || 1, map.territories.find(t => t.id === free).type);
  game.state.wild_guards[free] = 0;
  for (let day = 2; day < 12; day += 1) {
    wildDawn(game, map, constants, 1000 * day, day);
    assert.ok(game.state.wild_guards[free] <= cap, `day ${day}: ${game.state.wild_guards[free]} of ${cap}`);
  }
  assert.ok(game.state.wild_guards[free] >= cap - 1, 'and it is back to strength, bar what the border took');
});

test('free folk at full strength burn an unwatched land, and are turned back by a watch', () => {
  const game = freshGame();
  const spot = border(game);
  assert.ok(spot, 'a free land lies beside ours');
  const type = map.territories.find(t => t.id === spot.free).type;
  const cap = guardCap(game.state.wild.rings[spot.free] || 1, type);
  // Nobody else is to be raided: only this border stays open.
  for (const id of Object.keys(game.state.wild_guards)) game.state.wild_guards[id] = id === spot.free ? cap : 0;
  game.state.territories[spot.mine].warriors = {};
  game.state.population[spot.mine] = 10;
  const gold = Number(game.state.houses[HOUSE].gold || 0);

  wildDawn(game, map, constants, 5000, 2);
  const raid = game.state.journal.find(e => e.kind === 'RAID' && e.territory === spot.mine);
  assert.ok(raid, 'they came');
  assert.equal(game.state.houses[HOUSE].gold, gold - RAID.gold);
  assert.equal(game.state.population[spot.mine], 10 - RAID.people);

  // A watch of half their number turns them back, and costs them men.
  game.state.territories[spot.mine].warriors = { [HOUSE]: Math.ceil(cap * RAID.hold) };
  game.state.wild_guards[spot.free] = cap;
  const before = Number(game.state.houses[HOUSE].gold || 0);
  wildDawn(game, map, constants, 6000, 3);
  assert.ok(game.state.journal.some(e => e.kind === 'RAID_BROKEN' && e.territory === spot.mine));
  assert.equal(game.state.houses[HOUSE].gold, before, 'nothing was taken');
  assert.equal(game.state.wild_guards[spot.free], cap - RAID.guardLost);
});

test('on the first day nobody rides out', () => {
  const game = freshGame();
  const spot = border(game);
  const type = map.territories.find(t => t.id === spot.free).type;
  game.state.wild_guards[spot.free] = guardCap(game.state.wild.rings[spot.free] || 1, type);
  game.state.territories[spot.mine].warriors = {};
  wildDawn(game, map, constants, 4000, 1);
  assert.equal(game.state.journal.some(e => e.kind === 'RAID'), false);
});
