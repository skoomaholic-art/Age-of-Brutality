import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import {
  CHARACTER_HEALTH,
  CHARACTER_MODE,
  CHARACTER_STATUS,
  assignCharacterToArmy,
  characterArmyAssignmentEligibility,
  charactersForHouse,
  commanderStats,
  markCommanderFatePending,
  normalizeCharacterLayer,
  resolveCommanderFate,
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

test('a troop stack that already has a commander is not offered again', () => {
  const state = createInitialState(map, constants, catalog);
  const eligibility = characterArmyAssignmentEligibility(
    state,
    map,
    constants,
    {
      house:'Варкайр',
      characterId:'CH-ВАР-1'
    }
  );

  assert.equal(eligibility.allowed, false);
  assert.equal(eligibility.code, 'NO_AVAILABLE_ARMY');
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
    warriors:4,
    commander_id:'RUL-ВАР'
  }, {
    nowMs:10_000,
    timing:{ landSegmentMs:10, landMaxMs:20, seaSegmentMs:20 }
  }).game;

  assert.equal(game.orders[0].commander_id, 'RUL-ВАР');

  game = processDueOrders(game, map, constants, 10_011);
  const result = game.orders[0].result;

  assert.equal(result.attacker_commander_id, 'RUL-ВАР');
  assert.equal(
    result.attackerStrength >= 7 && result.attackerStrength <= 12,
    true,
    '4 warriors + d6 + Attack 2 must be within 7..12'
  );
});

test('losing commander resolves Fate deterministically after battle', () => {
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
    warriors:1,
    commander_id:'RUL-ВАР'
  }, {
    nowMs:20_000,
    timing:{ landSegmentMs:10, landMaxMs:20, seaSegmentMs:20 }
  }).game;

  game = processDueOrders(game, map, constants, 20_011);

  assert.equal(game.orders[0].status, 'RESOLVED');
  assert.ok(game.orders[0].result.attacker_commander_fate);
  assert.notEqual(
    game.state.characters['RUL-ВАР'].status,
    CHARACTER_STATUS.FATE_PENDING
  );
});


test('full March cannot leave a commander behind with zero warriors', () => {
  const game = createOnlineGame(map, constants, {
    nowMs:30_000,
    characterCatalog:catalog
  });
  game.state.territories.W02.owner = 'Варкайр';

  assert.throws(() => queueTimedOrder(game, map, constants, {
    type:'MARCH',
    mode:'LAND',
    house:'Варкайр',
    from:'W01',
    to:'W02',
    warriors:4,
    commander_id:null
  }, {
    nowMs:30_000,
    timing:{ landSegmentMs:10, landMaxMs:20, seaSegmentMs:20 }
  }), /leave a commander without an army/);
});

test('partial March may leave commander with remaining army', () => {
  let game = createOnlineGame(map, constants, {
    nowMs:40_000,
    characterCatalog:catalog
  });
  game.state.territories.W02.owner = 'Варкайр';

  game = queueTimedOrder(game, map, constants, {
    type:'MARCH',
    mode:'LAND',
    house:'Варкайр',
    from:'W01',
    to:'W02',
    warriors:2,
    commander_id:null
  }, {
    nowMs:40_000,
    timing:{ landSegmentMs:10, landMaxMs:20, seaSegmentMs:20 }
  }).game;

  assert.equal(game.orders[0].commander_id, null);
  assert.equal(
    game.state.armies['ARM-RUL-ВАР'].territory,
    'W01'
  );
});


function pendingFateState({
  armyDestroyed = false,
  fallback = 'W01'
} = {}) {
  let state = createInitialState(map, constants, catalog);
  state = markCommanderFatePending(state, 'RUL-ВАР', {
    battle_territory:'W02',
    opponent_house:'Сайрвен',
    side:'ATTACKER',
    army_destroyed:armyDestroyed,
    fallback_territory:fallback,
    created_at:'2026-10-02T10:00:00.000Z'
  });
  return state;
}

test('Fate 10+ saves commander and keeps surviving army active', () => {
  const state = pendingFateState();
  const {state:next,result} = resolveCommanderFate(
    state,map,constants,'RUL-ВАР',[6,6],{nowMs:1000}
  );
  assert.equal(result.outcome,'SAVED');
  assert.equal(next.characters['RUL-ВАР'].status,CHARACTER_STATUS.ACTIVE);
  assert.equal(next.characters['RUL-ВАР'].mode,CHARACTER_MODE.ARMY);
  assert.equal(next.armies['ARM-RUL-ВАР'].territory,'W01');
});

test('Fate 7-9 weakens commander', () => {
  const state = pendingFateState();
  const {state:next,result} = resolveCommanderFate(
    state,map,constants,'RUL-ВАР',[3,3],{nowMs:1000}
  );
  assert.equal(result.outcome,'WEAKENED');
  assert.equal(next.characters['RUL-ВАР'].health,CHARACTER_HEALTH.WEAKENED);
  assert.equal(next.characters['RUL-ВАР'].status,CHARACTER_STATUS.ACTIVE);
});

test('Fate 5-6 captures commander and records captor context', () => {
  const state = pendingFateState();
  const {state:next,result} = resolveCommanderFate(
    state,map,constants,'RUL-ВАР',[2,2],{nowMs:1000}
  );
  assert.equal(result.outcome,'CAPTURED');
  assert.equal(next.characters['RUL-ВАР'].mode,CHARACTER_MODE.CAPTIVE);
  assert.equal(next.characters['RUL-ВАР'].alive,true);
  assert.equal(next.characters['RUL-ВАР'].captivity.held_by,'Сайрвен');
  assert.equal(next.characters['RUL-ВАР'].army_id,null);
});

test('Fate 4 or less kills commander', () => {
  const state = pendingFateState();
  const {state:next,result} = resolveCommanderFate(
    state,map,constants,'RUL-ВАР',[1,1],{nowMs:1000}
  );
  assert.equal(result.outcome,'DEAD');
  assert.equal(next.characters['RUL-ВАР'].alive,false);
  assert.equal(next.characters['RUL-ВАР'].mode,CHARACTER_MODE.DEAD);
  assert.equal(next.characters['RUL-ВАР'].army_id,null);
});

test('saved or weakened commander with destroyed army waits for a location rule', () => {
  const state = pendingFateState({
    armyDestroyed:true,
    fallback:null
  });
  const {state:next,result} = resolveCommanderFate(
    state,map,constants,'RUL-ВАР',[6,6],{nowMs:1000}
  );
  assert.equal(result.outcome,'SAVED');
  assert.equal(result.location_pending,true);
  assert.equal(
    next.characters['RUL-ВАР'].status,
    CHARACTER_STATUS.FATE_LOCATION_PENDING
  );
  assert.equal(next.characters['RUL-ВАР'].army_id,null);
});


test('commander can be assigned to an existing army outside a lost capital', () => {
  const state = createInitialState(map, constants, catalog);
  state.territories.W08.owner = 'Варкайр';
  state.territories.W08.warriors = {};
  state.territories.W09.owner = 'Сайрвен';
  state.territories.W09.warriors = {'Сайрвен':2};

  const eligibility = characterArmyAssignmentEligibility(
    state,
    map,
    constants,
    {
      house:'Сайрвен',
      characterId:'RUL-САЙ'
    }
  );

  assert.equal(eligibility.allowed, true);
  assert.equal(
    eligibility.targets.some(target => target.id === 'W09'),
    true
  );

  const assigned = assignCharacterToArmy(
    state,
    map,
    constants,
    {
      house:'Сайрвен',
      characterId:'RUL-САЙ',
      position:'W09'
    }
  );

  assert.equal(
    assigned.armies[assigned.characters['RUL-САЙ'].army_id].territory,
    'W09'
  );
});

test('assignment eligibility returns selectable army targets', () => {
  const state = createInitialState(map, constants, catalog);
  state.territories.W09.owner = 'Сайрвен';
  state.territories.W09.warriors = {'Сайрвен':2};

  const eligibility = characterArmyAssignmentEligibility(
    state,
    map,
    constants,
    {
      house:'Сайрвен',
      characterId:'RUL-САЙ'
    }
  );

  assert.equal(eligibility.allowed, true);
  assert.deepEqual(
    eligibility.targets.map(target => target.id),
    ['W08','W09']
  );
});
