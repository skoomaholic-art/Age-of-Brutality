import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { buildVictoryStatus } from '../src/core/victory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('conquering every territory does not create an early canonical winner', () => {
  const state = createInitialState(map, constants);
  for (const territory of Object.values(state.territories)) {
    territory.owner = 'Сайрвен';
    territory.warriors = {};
  }
  state.territories.W08.warriors['Сайрвен'] = 4;
  state.houses['Сайрвен'].victory_points = 3;

  const status = buildVictoryStatus({
    state,
    lifecycle:{status:'RUNNING'}
  }, map, constants);

  assert.equal(status.status, 'RUNNING');
  assert.deepEqual(status.winners, []);
  assert.equal(status.current_leaders[0], 'Сайрвен');
  assert.equal(status.exiled_houses.length, 5);
});

test('finished game uses VP then influence territories and gold as tie breakers', () => {
  const state = createInitialState(map, constants);
  state.phase = 'FINISHED';
  state.houses['Сайрвен'].victory_points = 10;
  state.houses['Варкайр'].victory_points = 10;
  state.houses['Сайрвен'].influence = 5;
  state.houses['Варкайр'].influence = 4;

  const status = buildVictoryStatus({
    state,
    lifecycle:{status:'FINISHED'}
  }, map, constants);

  assert.deepEqual(status.winners, ['Сайрвен']);
});

test('fully tied final standings allow joint victory', () => {
  const state = createInitialState(map, constants);
  state.phase = 'FINISHED';

  for (const house of constants.houses) {
    state.houses[house].victory_points = 0;
    state.houses[house].influence = 3;
    state.houses[house].gold = 8;
  }

  const status = buildVictoryStatus({
    state,
    lifecycle:{status:'FINISHED'}
  }, map, constants);

  assert.equal(status.winners.length, 6);
});
