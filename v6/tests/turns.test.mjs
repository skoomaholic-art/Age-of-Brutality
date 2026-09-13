import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { currentHouse, spendActionAndAdvance, beginNextRound } from '../src/core/turns.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const c = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('round has exactly three action cycles for six Houses', () => {
  let s=createInitialState(map,c);
  const acted=[];
  for(let i=0;i<18;i++){
    acted.push(currentHouse(s,c));
    s=spendActionAndAdvance(s,c,{kind:'TEST'});
  }
  assert.equal(s.phase,'DYNASTY');
  for(const h of c.houses) assert.equal(s.houses[h].actions_used,3);
  assert.deepEqual(acted.slice(0,6),c.houses);
});

test('first player rotates one House each new round', () => {
  let s=createInitialState(map,c);
  for(let i=0;i<18;i++) s=spendActionAndAdvance(s,c);
  s=beginNextRound(s,c);
  assert.equal(s.round,2);
  assert.equal(currentHouse(s,c),'Сайрвен');
});
