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
  validateOnlineSeaMarch
} from '../src/online/sea-navigation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('sea network moves through explicit waypoints to the next port', () => {
  const route = findSeaLaneRoute(map, 'W07', 'S01-A');
  assert.deepEqual(route, {
    to:'S01-A',
    path:['W07','M-WN','S01-A'],
    segments:2
  });
});

test('sea route cannot pass through an intermediate territory', () => {
  assert.equal(findSeaLaneRoute(map, 'W07', 'S01-B'), null);
  assert.ok(findSeaLaneRoute(map, 'W07', 'S01-A'));
});

test('two halves of one island remain a land move, never a sea move', () => {
  assert.equal(findSeaLaneRoute(map, 'S03-A', 'S03-B'), null);
  assert.equal(findSeaLaneRoute(map, 'S04-A', 'S04-B'), null);
});

test('branched waypoint exposes several local sea destinations', () => {
  const destinations = new Set(
    listSeaLaneDestinations(map, 'W07').map(item => item.to)
  );
  assert.equal(destinations.has('S01-A'), true);
  assert.equal(destinations.has('S03-A'), true);
  assert.equal(destinations.has('W14'), true);
  assert.equal(destinations.has('S01-B'), false);
});

test('online sea validation uses lane graph instead of legacy direct edge only', () => {
  const state = createInitialState(map, constants);
  state.territories.W07.owner = 'Варкайр';
  state.territories.W07.warriors = {'Варкайр':2};

  const action = {
    type:'MARCH',
    mode:'SEA',
    house:'Варкайр',
    from:'W07',
    to:'S01-A',
    warriors:1,
    path:['W07','M-WN','S01-A'],
    sea_segments:2
  };

  assert.deepEqual(
    validateOnlineSeaMarch(state, map, constants, action),
    []
  );

  const actions = enumerateOnlineSeaMarches(
    state,
    map,
    constants,
    'Варкайр'
  );
  assert.equal(
    actions.some(item =>
      item.from === 'W07' &&
      item.to === 'S01-A' &&
      item.warriors === 1 &&
      item.path.join('>') === 'W07>M-WN>S01-A'
    ),
    true
  );
});

test('declared sea path must match the graph route', () => {
  const state = createInitialState(map, constants);
  state.territories.W07.owner = 'Варкайр';
  state.territories.W07.warriors = {'Варкайр':1};

  const errors = validateOnlineSeaMarch(state, map, constants, {
    type:'MARCH',
    mode:'SEA',
    house:'Варкайр',
    from:'W07',
    to:'S01-A',
    warriors:1,
    path:['W07','M-WN','S03-A','S01-A']
  });

  assert.equal(
    errors.some(error => /declared sea path is not legal/.test(error)),
    true
  );
});
