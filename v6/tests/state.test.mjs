import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import {
  createInitialState,
  repairForeignWarriors,
  totalHouseWarriors,
  validateState
} from '../src/core/state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const c = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('initial setup gives each House only its capital with four warriors', () => {
  const s = createInitialState(map,c);
  for (const h of c.houses) {
    const cap = map.capitals[h];
    assert.equal(s.territories[cap].owner, h);
    assert.equal(s.territories[cap].warriors[h], 4);
    assert.equal(totalHouseWarriors(s,h), 4);
    assert.equal(s.houses[h].gold, 8);
    assert.equal(s.houses[h].influence, 3);
    assert.equal(s.houses[h].intrigue_hand.length, 0);
  }
  const owned = Object.values(s.territories).filter(t=>t.owner !== null);
  assert.equal(owned.length, 6);
  assert.deepEqual(validateState(s,map,c), []);
});


test('foreign warriors on an owned territory are invalid and repairable', () => {
  const s = createInitialState(map,c);
  s.territories.W15.owner = 'Варкайр';
  s.territories.W15.warriors = { Ортайн: 4 };

  const errors = validateState(s,map,c);
  assert.ok(errors.some(error => /foreign warriors/.test(error)));

  const repaired = repairForeignWarriors(s);
  assert.deepEqual(repaired.state.territories.W15.warriors, {});
  assert.equal(repaired.repairs.length, 1);
  assert.equal(repaired.repairs[0].territory, 'W15');
  assert.equal(repaired.repairs[0].removed_house, 'Ортайн');
  assert.equal(repaired.repairs[0].removed_warriors, 4);
});
