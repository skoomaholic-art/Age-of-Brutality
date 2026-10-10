import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import {
  calculateHouseIncome,
  applyRecruit,
  applyFort
} from '../src/core/economy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const c = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('canonical income distinguishes home territory from occupation', () => {
  const s = createInitialState(map, c);
  assert.deepEqual(calculateHouseIncome(s, map, c, 'Варкайр'), { gold: 4, influence: 1 });

  // A town at home pays three, one taken from another House pays one.
  s.territories.W05.owner = 'Варкайр';
  s.territories.W12.owner = 'Варкайр';
  assert.deepEqual(calculateHouseIncome(s, map, c, 'Варкайр'), { gold: 8, influence: 1 });
});

test('full island bonus is granted only when both halves are controlled', () => {
  const s = createInitialState(map, c);
  // Every land pays its owner something, a half-island included.
  s.territories['S03-A'].owner = 'Варкайр';
  assert.deepEqual(calculateHouseIncome(s, map, c, 'Варкайр'), { gold: 5, influence: 1 });
  s.territories['S03-B'].owner = 'Варкайр';
  assert.deepEqual(calculateHouseIncome(s, map, c, 'Варкайр'), { gold: 7, influence: 2 });
});

test('recruit costs one gold per warrior and respects caps', () => {
  let s = createInitialState(map, c);
  s = applyRecruit(s, c, 'Варкайр', 'W01', 3);
  assert.equal(s.houses['Варкайр'].gold, 5);
  assert.equal(s.territories.W01.warriors['Варкайр'], 7);

  assert.throws(() => applyRecruit(s, c, 'Варкайр', 'W01', 2), /territory warrior cap/);
});

test('fort costs three gold and cannot be built in a capital', () => {
  let s = createInitialState(map, c);
  s.territories.W03.owner = 'Варкайр';
  s = applyFort(s, map, c, 'Варкайр', 'W03');
  assert.equal(s.houses['Варкайр'].gold, 5);
  assert.equal(s.territories.W03.fort, true);
  assert.deepEqual(s.houses['Варкайр'].forts, ['W03']);

  assert.throws(() => applyFort(s, map, c, 'Варкайр', 'W01'), /capital/);
});
