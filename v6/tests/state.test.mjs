import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState, totalHouseWarriors, validateState } from '../src/core/state.mjs';

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
