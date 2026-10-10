import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, buildAdjacency } from '../src/core/map.mjs';
import { generateMap } from '../src/online/mapgen.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { executeCommand } from '../src/online/commands.mjs';
import { processDueOrders } from '../src/online/orders.mjs';
import { startRounds, advanceRound } from '../src/online/rounds.mjs';
import { seedHeart, heartLayout, heartDawn, menToTakeWild, chooseHearts, spyLearns, heartOnCapture, processHordes, HEART, SCOURGE } from '../src/online/heart.mjs';
import { applyFog } from '../src/online/fog.mjs';
import { validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants0 = loadJson(path.join(root, 'src/data/constants.v6.json'));
const characterCatalog = loadJson(path.join(root, 'src/data/characters.v6.json'));
const houses = constants0.houses.slice(0, 4);
const constants = { ...constants0, houses, house_warrior_cap: 9999, territory_warrior_cap: 9999 };
const map = generateMap(base, constants, { houses, seed: 21, shape: 'wheel', seaMesh: true, homePorts: false });
const adjacency = buildAdjacency(map.land_edges);
const H = houses[0];
const capital = map.capitals[H];

function heartGame() {
  const game = createOnlineGame(map, constants, { id: 'heart', nowMs: 1, characterCatalog });
  game.rounds = { round_duration_ms: 800_000 };
  return seedHeart(game, map);
}

// Hearts appear as on their dawn.
// A host of the scourge, set on the board by hand for the tests that follow it.
function startHorde(game, from, house) {
  heartDawn(game, map, constants, 100, SCOURGE.day);
  const mine = game.state.hordes.find(h => h.against === house);
  mine.at = from;
  mine.path = [from];
  mine.started = false;
  mine.men = HEART.hordeMen;
  for (const other of game.state.hordes) if (other !== mine) other.men = 0;
  game.state.hordes = game.state.hordes.filter(h => h.men > 0);
  return mine;
}

function withHearts() {
  const game = heartGame();
  heartDawn(game, map, constants, 10, HEART.appearDay);
  return game;
}

test('rings grow from the capitals outwards, and so does the wild guard; no Heart is known at the start', () => {
  const { rings } = heartLayout(map);
  assert.equal(rings[capital], 0);
  const game = heartGame();
  assert.deepEqual(game.state.heart.candidates, []);
  const guards = game.state.wild_guards;
  const byRing = {};
  for (const t of map.territories) {
    if (rings[t.id] === 0 || t.type === 'Город') continue;
    (byRing[rings[t.id]] ||= new Set()).add(guards[t.id]);
  }
  const seen = Object.keys(byRing).map(Number).sort();
  for (let i = 1; i < seen.length; i += 1) assert.ok(Math.min(...byRing[seen[i]]) > Math.max(...byRing[seen[i - 1]]));
  assert.deepEqual(validateState(game.state, map, constants), []);
});

test('the Hearts appear on their day: one true among decoys, far from the House that spread most', () => {
  const game = heartGame();
  // House H has spread over many lands.
  for (const id of [...adjacency.get(capital)]) game.state.territories[id].owner = H;
  heartDawn(game, map, constants, 5, HEART.appearDay - 1);
  assert.deepEqual(game.state.heart.candidates, [], 'not before its day');
  heartDawn(game, map, constants, 10, HEART.appearDay);
  const { candidates, truth } = game.state.heart;
  assert.equal(candidates.length, 4, 'four Houses: one true Heart and three decoys');
  assert.ok(candidates.includes(truth));
  for (const id of candidates) {
    assert.equal(game.state.wild_guards[id], HEART.heartGuards);
    assert.equal(game.state.territories[id].fort, true);
    assert.equal(game.state.territories[id].owner, null);
  }
  assert.ok(game.state.journal.some(e => e.kind === 'HEARTS_APPEARED'));
  // The spread-out House is no nearer to them than the others.
  const own = Object.keys(game.state.territories).filter(id => game.state.territories[id].owner === H);
  assert.ok(candidates.every(id => !own.includes(id)));
});

test('which Heart is true stays secret, save for a spy next to it and the daily rumour', () => {
  const game = withHearts();
  const { candidates, truth } = game.state.heart;
  const decoys = candidates.filter(id => id !== truth);
  const view = structuredClone({ ...game, visibility: null });
  applyFog(view, map, H);
  assert.equal(view.state.heart.truth, undefined, 'the client is not told');
  spyLearns(game.state, map, H, truth, 20);
  assert.equal(game.state.heart.known[H][truth], 'TRUE');
  heartDawn(game, map, constants, 30, HEART.appearDay + 1);
  assert.equal(game.state.heart.revealed.length, 1);
  assert.ok(decoys.includes(game.state.heart.revealed[0]));
});

test('taking a decoy costs the purse and the land\'s trust, and wakes nothing', () => {
  const game = withHearts();
  const { candidates, truth } = game.state.heart;
  const decoy = candidates.find(id => id !== truth);
  game.state.territories[decoy].owner = H;
  game.state.territories[decoy].warriors = { [H]: 2 };
  delete game.state.wild_guards[decoy];
  game.state.houses[H].gold = 9;
  game.state.order = { ...(game.state.order || {}), [decoy]: 70 };
  heartOnCapture(game, map, decoy, H, 100);
  assert.equal((game.state.hordes || []).length, 0, 'no Horde comes of it');
  assert.equal(game.state.houses[H].gold, 4, 'half the purse went on nothing');
  assert.ok(game.state.order[decoy] <= 15, 'the land trusts him least of all');
  assert.ok(game.state.journal.some(e => e.kind === 'FALSE_HEART'));
  assert.deepEqual(validateState(game.state, map, constants), []);
});

test('taking the true Heart shows it to all, and it pays more each dawn', () => {
  const game = withHearts();
  const { truth } = game.state.heart;
  game.state.territories[truth].owner = H;
  game.state.territories[truth].warriors = { [H]: 3 };
  delete game.state.wild_guards[truth];
  heartOnCapture(game, map, truth, H, 100);
  assert.equal(game.state.heart.territory, truth);
  assert.equal(game.state.heart.revealed.length, game.state.heart.candidates.length - 1);
  const start = Number(game.state.houses[H].victory_points || 0);
  heartDawn(game, map, constants, 200, 5);
  heartDawn(game, map, constants, 300, 6);
  assert.equal(game.state.houses[H].victory_points, start + 3 + 4);
});

test('a free land is fought for; enough men take it and earn its glory once', () => {
  let game = heartGame();
  const near = [...adjacency.get(capital)].find(id => map.territories.find(t => t.id === id).type === 'Деревня');
  game.state.wild_guards[near] = 5;
  game.state.territories[capital].warriors[H] = 12;
  game = executeCommand(game, map, constants, { type: 'MARCH', house: H, from: capital, to: near, warriors: 2 }, { nowMs: 10 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders.at(-1).due_at));
  assert.equal(game.state.journal.filter(e => e.kind === 'WILD_BATTLE').at(-1).success, false);
  const need = menToTakeWild(game.state.wild_guards[near]);
  const vp = Number(game.state.houses[H].victory_points || 0);
  game = executeCommand(game, map, constants, { type: 'MARCH', house: H, from: capital, to: near, warriors: need }, { nowMs: 100_000 }).game;
  game = processDueOrders(game, map, constants, Date.parse(game.orders.at(-1).due_at));
  assert.equal(game.state.territories[near].owner, H);
  assert.equal(game.state.houses[H].victory_points, vp + game.state.heart.rings[near]);
});

test('the age ends at the dawn someone reaches the glory target', () => {
  let game = heartGame();
  game.lifecycle.status = 'RUNNING';
  game.lifecycle.house_claims = Object.fromEntries(houses.map(h => [h, `p-${h}`]));
  game = startRounds(game, map, constants, { nowMs: 1, mode: 'days', dayMs: 600_000 });
  assert.equal(game.rounds.max, HEART.days);
  game.state.houses[H].victory_points = HEART.target;
  game = advanceRound(game, map, constants, { nowMs: 700_000 });
  assert.equal(game.lifecycle.status, 'FINISHED');
  assert.equal(game.lifecycle.finish_reason, 'HEART');
  assert.deepEqual(game.rounds.winners, [H]);
});

test('chooseHearts never puts two Hearts side by side', () => {
  const game = heartGame();
  const picked = chooseHearts(game, map);
  for (const a of picked) for (const b of picked) if (a !== b) assert.ok(!adjacency.get(a).has(b));
});

test('on the scourge\'s dawn a host comes for every House at once, and the first to break it is seen by all', () => {
  let game = withHearts();
  for (const house of houses) {
    const seat = map.capitals[house];
    game.state.territories[seat].owner = house;
    game.state.territories[seat].warriors = { [house]: 4 };
  }
  heartDawn(game, map, constants, 20, SCOURGE.day - 1);
  assert.ok(game.state.journal.some(e => e.kind === 'SCOURGE_COMING'));
  assert.equal((game.state.hordes || []).length, 0, 'not yet');
  heartDawn(game, map, constants, 30, SCOURGE.day);
  const targets = game.state.hordes.map(h => h.against).sort();
  assert.deepEqual(targets, [...houses].sort(), 'one host for every House');
  assert.ok(game.state.hordes.every(h => h.scourge && h.men >= SCOURGE.floor));
  assert.ok(game.state.journal.some(e => e.kind === 'SCOURGE_LANDED'));
  // It comes only once in a century.
  const before = game.state.hordes.length;
  heartDawn(game, map, constants, 40, SCOURGE.day + 1);
  assert.equal(game.state.hordes.length, before);

  // One House cuts its own down: the realm is told, and the first gets glory.
  const mine = game.state.hordes.find(h => h.against === H);
  const vp = Number(game.state.houses[H].victory_points || 0);
  mine.men = 1;
  mine.next_at = new Date(50).toISOString();
  game = processHordes(game, map, constants, 10_000_000);
  const broke = game.state.journal.find(e => e.kind === 'SCOURGE_BROKEN' && e.house === H);
  assert.ok(broke, 'the chronicle says who stood');
  assert.equal(broke.first, true);
  assert.equal(game.state.houses[H].victory_points, vp + HEART.heartGlory);
});

test('a river with no bridge holds the Horde up at the ford', () => {
  let game = withHearts();
  const { candidates, truth } = game.state.heart;
  const decoy = candidates.find(id => id !== truth);
  game.state.territories[decoy].owner = H;
  game.state.territories[decoy].warriors = { [H]: 1 };
  delete game.state.wild_guards[decoy];
  startHorde(game, decoy, H);
  // Every road out of the decoy crosses a river with no bridge.
  game.state.river_crossings = {};
  for (const [a, b] of map.land_edges.filter(e => e.includes(decoy))) game.state.river_crossings[[a, b].sort().join('|')] = { a, b, x: 0, y: 0 };
  game.state.bridges = {};
  const step = Math.round(800_000 * HEART.hordeStepShare);
  game = processHordes(game, map, constants, 100);
  const at = game.state.hordes[0]?.at;
  game = processHordes(game, map, constants, 100 + step);
  assert.equal(game.state.hordes[0]?.at, at, 'waiting at the river');
  assert.ok(game.state.journal.some(e => e.kind === 'HORDE_FORDING'));
});

test('chooseHearts always finds as many Hearts as the table needs, even when the middle is taken', () => {
  const game = heartGame();
  // Every land in the no-man's land is owned already.
  for (const t of map.territories) if (!(t.house_sector in map.capitals) && t.type !== 'Столица') { game.state.territories[t.id].owner = H; game.state.territories[t.id].warriors = { [H]: 1 }; delete game.state.wild_guards[t.id]; }
  const picked = chooseHearts(game, map);
  assert.equal(picked.length, Math.min(HEART.maxDecoys, houses.length - 1) + 1);
  for (const id of picked) assert.equal(game.state.territories[id].owner, null);
});

test('the Horde sacks a capital it reaches but does not keep it: the House stands, poorer and without its guard', () => {
  let game = withHearts();
  const { candidates, truth } = game.state.heart;
  const decoy = candidates.find(id => id !== truth);
  game.state.territories[decoy].owner = H;
  game.state.territories[decoy].warriors = { [H]: 1 };
  delete game.state.wild_guards[decoy];
  startHorde(game, decoy, H);
  const horde = game.state.hordes[0];
  for (const id of horde.path.slice(1, -1)) { game.state.territories[id].owner = null; game.state.wild_guards[id] = 1; }
  game.state.territories[capital].warriors = { [H]: 2 };
  game.state.houses[H].gold = 9;
  game = processHordes(game, map, constants, 10_000_000);
  assert.equal(game.state.territories[capital].owner, H, 'the capital is still ours');
  assert.equal(game.state.territories[capital].warriors[H], undefined, 'the guard fell');
  assert.equal(game.state.houses[H].gold, 4, 'half the purse burnt');
  assert.ok(game.state.journal.some(e => e.kind === 'HORDE_SACKED'));
  assert.equal(game.state.hordes.length, 0);
  assert.deepEqual(validateState(game.state, map, constants), []);
});
