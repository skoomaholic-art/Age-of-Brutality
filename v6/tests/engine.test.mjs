import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { currentHouse } from '../src/core/turns.mjs';
import { executeMarchAction, listLegalMarchActions, prepareCurrentAction } from '../src/core/engine.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map=loadJson(path.join(root,'src/data/map.v6.json'));
const c=loadJson(path.join(root,'src/data/constants.v6.json'));

test('illegal action is rejected atomically and does not consume slot or mutate caller state',()=>{
  const s=createInitialState(map,c);
  const before=structuredClone(s);
  assert.throws(()=>executeMarchAction(s,map,c,{type:'MARCH',mode:'SEA',house:'Варкайр',from:'W01',to:'S01-A',warriors:1}),/not emitted by LEGAL_ACTIONS/);
  assert.deepEqual(s,before);
  assert.equal(s.houses['Варкайр'].actions_used,0);
  assert.equal(currentHouse(s,c),'Варкайр');
});

test('legal neutral March resolves then consumes exactly one action and advances to next House',()=>{
  const s=createInitialState(map,c);
  const action={type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W02',warriors:2};
  const {state:n,result}=executeMarchAction(s,map,c,action,{neutralDice:[6,6]});
  assert.equal(result.success,true);
  assert.equal(n.houses['Варкайр'].actions_used,1);
  assert.equal(currentHouse(n,c),'Сайрвен');
  assert.equal(n.territories.W02.owner,'Варкайр');
});

test('resolution error is atomic: no action slot is spent and original state stays unchanged',()=>{
  const s=createInitialState(map,c);
  const before=structuredClone(s);
  const action={type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W02',warriors:2};
  assert.throws(()=>executeMarchAction(s,map,c,action,{neutralDice:[9,9]}),/two d6/);
  assert.deepEqual(s,before);
  assert.equal(s.houses['Варкайр'].actions_used,0);
});

test('start of a House own action clears only that House retreat streaks',()=>{
  const s=createInitialState(map,c);
  s.territories.W09.retreat_streak['Варкайр']=2;
  s.territories.W09.retreat_streak['Сайрвен']=1;
  const prepared=prepareCurrentAction(s,map,c);
  assert.equal(prepared.territories.W09.retreat_streak['Варкайр'],undefined);
  assert.equal(prepared.territories.W09.retreat_streak['Сайрвен'],1);
  assert.equal(s.territories.W09.retreat_streak['Варкайр'],2,'caller state remains immutable');
});

test('LEGAL_ACTIONS is generated for current House only',()=>{
  const s=createInitialState(map,c);
  const legal=listLegalMarchActions(s,map,c);
  assert.ok(legal.length>0);
  assert.ok(legal.every(a=>a.house==='Варкайр'));
});

test('engine routes an empty enemy territory to occupation rather than battle',()=>{
  const s=createInitialState(map,c);
  s.territories.W02.owner='Варкайр';
  s.territories.W02.warriors={'Варкайр':2};
  s.territories.W05.owner='Сайрвен';
  s.territories.W05.warriors={};
  const action={type:'MARCH',mode:'LAND',house:'Варкайр',from:'W02',to:'W05',warriors:2};
  const {state:n,result}=executeMarchAction(s,map,c,action);
  assert.equal(result.kind,'EMPTY_ENEMY_OCCUPATION');
  assert.equal(result.battle_occurred,false);
  assert.equal(n.territories.W05.owner,'Варкайр');
  assert.equal(n.houses['Варкайр'].actions_used,1);
});
