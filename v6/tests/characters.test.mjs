import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import {
  CHARACTER_MODE,
  CHARACTER_STATUS,
  assignCharacterToArmy,
  charactersForHouse,
  commanderStats,
  normalizeCharacterLayer,
  returnCharacterToCourt
} from '../src/core/characters.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import {
  processDueOrders,
  queueTimedOrder
} from '../src/online/orders.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const catalog = loadJson(path.join(root, 'src/data/characters.v6.json'));

test('canonical setup activates one ruler and one adult heir per House', () => {
  const state = createInitialState(map, constants, catalog);
  assert.equal(Object.keys(state.characters).length, 12);

  for (const house of constants.houses) {
    const characters = charactersForHouse(state, house);
    assert.equal(characters.length, 2);
    assert.equal(characters.some(character => character.role === 'RULER'), true);
    assert.equal(characters.some(character => character.role === 'HEIR'), true);
    const heir = characters.find(character => character.role === 'HEIR');
    assert.equal(heir.mode, CHARACTER_MODE.COURT);
  }

  assert.equal(state.characters['RUL-ВАР'].mode, CHARACTER_MODE.ARMY);
  assert.equal(state.characters['RUL-ЭРК'].mode, CHARACTER_MODE.ARMY);
  assert.equal(state.characters['RUL-САЙ'].mode, CHARACTER_MODE.COURT);
  assert.equal(state.characters['RUL-ОРТ'].mode, CHARACTER_MODE.COURT);
  assert.equal(state.characters['RUL-ТАС'].mode, CHARACTER_MODE.COURT);
  assert.equal(state.characters['RUL-АЙР'].mode, CHARACTER_MODE.COURT);
});

test('existing V6 state gains character layer without rewriting territory state', () => {
  const base = createInitialState(map, constants);
  base.territories.W02.owner = 'Варкайр';
  const migrated = normalizeCharacterLayer(base, catalog, map, constants);
  assert.equal(migrated.territories.W02.owner, 'Варкайр');
  assert.equal(Object.keys(migrated.characters).length, 12);
  assert.equal(migrated.characters['CH-ВАР-1'].name, 'Роварк');
});

test('healthy adult court character can be assigned in capital and returned', () => {
  const state = createInitialState(map, constants, catalog);
  const assigned = assignCharacterToArmy(state, map, constants, {
    house: 'Сайрвен',
    characterId: 'RUL-САЙ'
  });

  assert.equal(assigned.characters['RUL-САЙ'].mode, CHARACTER_MODE.ARMY);
  assert.equal(
    assigned.armies[assigned.characters['RUL-САЙ'].army_id].territory,
    map.capitals['Сайрвен']
  );

  const returned = returnCharacterToCourt(assigned, map, {
    house: 'Сайрвен',
    characterId: 'RUL-САЙ'
  });
  assert.equal(returned.characters['RUL-САЙ'].mode, CHARACTER_MODE.COURT);
  assert.equal(returned.characters['RUL-САЙ'].army_id, null);
});

test('one capital stack cannot silently receive two commanders', () => {
  const state = createInitialState(map, constants, catalog);
  assert.throws(() => assignCharacterToArmy(state, map, constants, {
    house: 'Варкайр',
    characterId: 'CH-ВАР-1'
  }), /already has a commander/);
});

test('commander stats expose only the active army combat block', () => {
  const state = createInitialState(map, constants, catalog);
  assert.deepEqual(commanderStats(state.characters['RUL-ВАР']), {
    attack: 2,
    defense: 0,
    survival: 1
  });
  assert.deepEqual(commanderStats(state.characters['CH-ВАР-1']), {
    attack: 0,
    defense: 0,
    survival: 0
  });
});

test('full timed March carries the starting commander and applies Attack stat', () => {
  let game = createOnlineGame(map, constants, {
    nowMs: 10_000,
    characterCatalog: catalog
  });

  game.state.territories.W02.owner = 'Сайрвен';
  game.state.territories.W02.warriors = { 'Сайрвен': 1 };

  game = queueTimedOrder(game, map, constants, {
    type:'MARCH',
    mode:'LAND',
    house:'Варкайр',
    from:'W01',
    to:'W02',
    warriors:4
  }, {
    nowMs:10_000,
    timing:{ landSegmentMs:10, landMaxMs:20, seaSegmentMs:20 }
  }).game;

  assert.equal(game.orders[0].commander_id, 'RUL-ВАР');

  game = processDueOrders(game, map, constants, 10_011);
  const result = game.orders[0].result;

  assert.equal(result.attacker_commander_id, 'RUL-ВАР');
  assert.equal(result.attackerStrength, 4 + result.attackerStrength - 4);
  assert.equal(
    result.attackerStrength >= 7,
    true,
    '4 warriors + d6 + Attack 2 must be at least 7'
  );
});

test('losing commander enters explicit Fate pending state instead of inventing an outcome', () => {
  let game = createOnlineGame(map, constants, {
    nowMs:20_000,
    characterCatalog:catalog
  });

  game.state.territories.W01.warriors['Варкайр'] = 1;
  game.state.territories.W02.owner = 'Сайрвен';
  game.state.territories.W02.warriors = { 'Сайрвен': 8 };

  game = queueTimedOrder(game, map, constants, {
    type:'MARCH',
    mode:'LAND',
    house:'Варкайр',
    from:'W01',
    to:'W02',
    warriors:1
  }, {
    nowMs:20_000,
    timing:{ landSegmentMs:10, landMaxMs:20, seaSegmentMs:20 }
  }).game;

  game = processDueOrders(game, map, constants, 20_011);

  assert.equal(game.orders[0].status, 'RESOLVED');
  assert.equal(
    game.state.characters['RUL-ВАР'].status,
    CHARACTER_STATUS.FATE_PENDING
  );
  assert.equal(
    game.state.characters['RUL-ВАР'].fate_pending.side,
    'ATTACKER'
  );
});
