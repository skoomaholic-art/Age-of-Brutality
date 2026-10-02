import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import {
  enumerateOnlineSeaMarches,
  findSeaLaneRoute,
  listSeaLaneDestinations,
  normalizeOnlineSeaState,
  onlineWarriorsAt,
  resolveSeaWaypointMove,
  validateOnlineSeaMarch
} from '../src/online/sea-navigation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));

function seaState() {
  return normalizeOnlineSeaState(
    createInitialState(map, constants),
    map
  );
}

test('coast port moves to adjacent sea waypoint, not directly to island', () => {
  assert.deepEqual(findSeaLaneRoute(map, 'W07', 'M-WN'), {
    to:'M-WN',
    path:['W07','M-WN'],
    segments:1,
    destination_kind:'SEA_WAYPOINT'
  });
  assert.equal(findSeaLaneRoute(map, 'W07', 'S01-A'), null);
});

test('sea waypoint branches to neighbouring coast and island positions', () => {
  const destinations = new Set(
    listSeaLaneDestinations(map, 'M-WN').map(item => item.to)
  );
  assert.deepEqual(
    destinations,
    new Set(['W07','W14','S01-A','S03-A'])
  );
});

test('island halves remain land neighbours and are not direct sea neighbours', () => {
  assert.equal(findSeaLaneRoute(map, 'S03-A', 'S03-B'), null);
  assert.equal(findSeaLaneRoute(map, 'S04-A', 'S04-B'), null);
});

test('online sea validation allows entering an empty waypoint', () => {
  const state = seaState();
  state.territories.W07.owner = 'Варкайр';
  state.territories.W07.warriors = {'Варкайр':2};

  const action = {
    type:'MARCH',
    mode:'SEA',
    house:'Варкайр',
    from:'W07',
    to:'M-WN',
    warriors:1,
    path:['W07','M-WN'],
    sea_segments:1
  };

  assert.deepEqual(
    validateOnlineSeaMarch(state, map, constants, action),
    []
  );
});

test('army can stop on waypoint and use it as next origin', () => {
  let state = seaState();
  state.territories.W07.owner = 'Варкайр';
  state.territories.W07.warriors = {'Варкайр':2};

  state = resolveSeaWaypointMove(state, map, constants, {
    type:'MARCH',
    mode:'SEA',
    house:'Варкайр',
    from:'W07',
    to:'M-WN',
    warriors:1,
    path:['W07','M-WN'],
    sea_segments:1
  });

  assert.equal(state.territories.W07.warriors['Варкайр'], 1);
  assert.equal(state.sea_nodes['M-WN'].owner, 'Варкайр');
  assert.equal(onlineWarriorsAt(state, 'M-WN', 'Варкайр'), 1);

  const actions = enumerateOnlineSeaMarches(
    state,
    map,
    constants,
    'Варкайр'
  );

  assert.equal(
    actions.some(item =>
      item.from === 'M-WN' &&
      item.to === 'S01-A' &&
      item.warriors === 1 &&
      item.path.join('>') === 'M-WN>S01-A'
    ),
    true
  );
});

test('enemy occupied sea waypoint is blocked until sea combat exists', () => {
  const state = seaState();
  state.territories.W07.owner = 'Варкайр';
  state.territories.W07.warriors = {'Варкайр':1};
  state.sea_nodes['M-WN'] = {
    owner:'Сайрвен',
    warriors:{'Сайрвен':1}
  };

  const errors = validateOnlineSeaMarch(state, map, constants, {
    type:'MARCH',
    mode:'SEA',
    house:'Варкайр',
    from:'W07',
    to:'M-WN',
    warriors:1,
    path:['W07','M-WN']
  });

  assert.equal(
    errors.some(error => /sea combat is not implemented/.test(error)),
    true
  );
});

test('declared sea path must be exactly the selected adjacent segment', () => {
  const state = seaState();
  state.territories.W07.owner = 'Варкайр';
  state.territories.W07.warriors = {'Варкайр':1};

  const errors = validateOnlineSeaMarch(state, map, constants, {
    type:'MARCH',
    mode:'SEA',
    house:'Варкайр',
    from:'W07',
    to:'M-WN',
    warriors:1,
    path:['W07','M-WN','S01-A']
  });

  assert.equal(
    errors.some(error => /declared sea path is not legal/.test(error)),
    true
  );
});
