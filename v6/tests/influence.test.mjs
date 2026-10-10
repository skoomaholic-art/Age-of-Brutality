// Влияние: чем меряется век, и за что его дают.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { INFLUENCE, addInfluence, influenceLeaders } from '../src/online/influence.mjs';
import { seedWild, wildBattle, menToTakeWild } from '../src/online/wild.mjs';
import { resolveBattle } from '../src/core/combat.mjs';
import { buildVictoryStatus } from '../src/core/victory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const HOUSE = constants.houses[0];
const RIVAL = constants.houses[1];

test('a free land taken from the wild guard is worth влияние once', () => {
  const game = createOnlineGame(map, constants, { id: 'infl', nowMs: 1 });
  seedWild(game, map);
  const capital = map.capitals[HOUSE];
  const land = map.land_edges.find(([a, b]) => a === capital || b === capital).find(id => id !== capital);
  game.state.wild_guards[land] = 2;
  game.state.territories[capital].warriors[HOUSE] = 12;

  const men = menToTakeWild(2) + 2;
  const out = wildBattle(game.state, map, constants, { house: HOUSE, from: capital, to: land, warriors: men },
    { ranks: [men, 0, 0, 0, 0, 0], stars: 0, glory: 1, nowMs: 1000 });
  assert.equal(out.result.success, true);
  assert.equal(out.state.houses[HOUSE].influence, Number(game.state.houses[HOUSE].influence || 0) + INFLUENCE.wildLand);
  assert.ok(out.state.journal.some(e => e.kind === 'INFLUENCE' && e.why === 'WILD_LAND'));

  // Taken back and taken again: the chroniclers pay for it only the first time.
  const again = structuredClone(out.state);
  again.territories[land].owner = null;
  again.wild_guards[land] = 2;
  again.territories[capital].warriors[HOUSE] = 12;
  const twice = wildBattle(again, map, constants, { house: HOUSE, from: capital, to: land, warriors: men },
    { ranks: [men, 0, 0, 0, 0, 0], stars: 0, glory: 1, nowMs: 2000 });
  assert.equal(twice.state.houses[HOUSE].influence, out.state.houses[HOUSE].influence);
});

test('a land taken from another House is worth more, and the sech itself is worth something', () => {
  const game = createOnlineGame(map, constants, { id: 'infl2', nowMs: 1 });
  seedWild(game, map);
  const capital = map.capitals[HOUSE];
  const land = map.land_edges.find(([a, b]) => a === capital || b === capital).find(id => id !== capital);
  game.state.territories[land].owner = RIVAL;
  game.state.territories[land].warriors = { [RIVAL]: 1 };
  game.state.territories[capital].warriors[HOUSE] = 12;
  const before = Number(game.state.houses[HOUSE].influence || 0);

  const out = resolveBattle(game.state, map, constants,
    { type: 'MARCH', mode: 'LAND', house: HOUSE, from: capital, to: land, warriors: 10 }, { attackerDie: 6, defenderDie: 1 });
  assert.equal(out.result.captured, true);
  assert.equal(out.state.houses[HOUSE].influence, before + INFLUENCE.battle + INFLUENCE.rivalLand);
  const lines = out.state.journal.filter(e => e.kind === 'INFLUENCE');
  assert.deepEqual(lines.map(e => e.why).sort(), ['BATTLE', 'RIVAL_LAND']);
});

test('the age is won by влияние, not by anything else', () => {
  const game = createOnlineGame(map, constants, { id: 'infl3', nowMs: 1 });
  game.state.houses[HOUSE].influence = 3;
  game.state.houses[HOUSE].victory_points = 99;
  game.state.houses[RIVAL].influence = 7;
  game.state.houses[RIVAL].victory_points = 0;
  const victory = buildVictoryStatus(game, map, constants);
  assert.equal(victory.standings[0].house, RIVAL);
  assert.deepEqual(victory.current_leaders, [RIVAL]);
  assert.deepEqual(influenceLeaders(game.state, constants.houses), [RIVAL]);

  // Level at the top: both are leading.
  addInfluence(game.state, HOUSE, 4, 'BATTLE');
  assert.deepEqual(influenceLeaders(game.state, constants.houses).sort(), [HOUSE, RIVAL].sort());
});
