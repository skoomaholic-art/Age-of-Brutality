import test from 'node:test';
import assert from 'node:assert/strict';
import { courtEffects, houseCourtTotals, applyCourtDawn } from '../src/online/court.mjs';

const lord = (extra) => ({ id: 'c', house: 'H', alive: true, status: 'ACTIVE', mode: 'COURT', location: { kind: 'COURT' }, role: 'HEIR', stats: { attack: 0, defense: 0, stewardship: 2, diplomacy: 1, intrigue: 1 }, ...extra });

test('a steward at court fills the treasury; away with an army he costs his keep', () => {
  const state = { characters: { c: lord() }, houses: { H: { gold: 0, influence: 0 } }, armies: {} };
  assert.deepEqual(houseCourtTotals(state, 'H'), { gold: 2, influence: 0, deals: 1, spy: 1 });
  state.characters.c.mode = 'ARMY'; state.characters.c.army_id = 'a';
  state.armies.a = { territory: 'X', moving_order_id: null };
  assert.equal(houseCourtTotals(state, 'H', { H: 'CAP' }).gold, -1);
  state.armies.a.territory = 'CAP';
  assert.equal(houseCourtTotals(state, 'H', { H: 'CAP' }).gold, 0, 'at home nothing to pay');
});

test('the ruler on the throne gives influence, the empty throne costs it', () => {
  const state = { characters: { c: lord({ role: 'RULER', stats: {} }) }, houses: { H: { gold: 5, influence: 3 } }, armies: {} };
  applyCourtDawn(state, ['H']);
  assert.equal(state.houses.H.influence, 4);
  state.characters.c.mode = 'ARMY'; state.characters.c.army_id = 'a'; state.armies.a = { territory: 'X' };
  applyCourtDawn(state, ['H'], { H: 'CAP' });
  assert.equal(state.houses.H.influence, 3);
  assert.ok(courtEffects(state.characters.c).army.some(e => /государь/.test(e.text)));
});
