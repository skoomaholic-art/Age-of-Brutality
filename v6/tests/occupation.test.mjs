import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { resolveEmptyEnemyOccupation } from '../src/core/occupation.mjs';
import { resolvePendingCapitalHold } from '../src/core/scoring.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map=loadJson(path.join(root,'src/data/map.v6.json'));
const c=loadJson(path.join(root,'src/data/constants.v6.json'));

test('empty enemy territory is occupied without a dice battle or VP-W2',()=>{
  const s=createInitialState(map,c);
  s.territories.W02.owner='Варкайр';
  s.territories.W02.warriors={'Варкайр':2};
  s.territories.W05.owner='Сайрвен';
  s.territories.W05.warriors={};
  const {state:n,result}=resolveEmptyEnemyOccupation(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W02',to:'W05',warriors:2});
  assert.equal(result.battle_occurred,false);
  assert.equal(n.territories.W05.owner,'Варкайр');
  assert.equal(n.territories.W05.warriors['Варкайр'],2);
  assert.equal(n.houses['Варкайр'].achievements['VP-W2'],undefined);
});

test('empty foreign capital awards W3A and creates one hold window',()=>{
  const s=createInitialState(map,c);
  s.territories.W09.owner='Варкайр';
  s.territories.W09.warriors={'Варкайр':3};
  s.territories.W08.owner='Сайрвен';
  s.territories.W08.warriors={};
  const {state:n,result}=resolveEmptyEnemyOccupation(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W09',to:'W08',warriors:3});
  assert.equal(result.capital_capture_vp,1);
  assert.equal(n.houses['Варкайр'].victory_points,1);
  assert.deepEqual(n.houses['Варкайр'].pending_capital_hold,{territoryId:'W08',formerOwner:'Сайрвен'});
});

test('W3B is awarded at beginning of next own action only if capital is still controlled',()=>{
  const s=createInitialState(map,c);
  s.houses['Варкайр'].achievements['VP-W3A']=true;
  s.houses['Варкайр'].victory_points=1;
  s.houses['Варкайр'].pending_capital_hold={territoryId:'W08',formerOwner:'Сайрвен'};
  s.territories.W08.owner='Варкайр';
  let out=resolvePendingCapitalHold(s,map,c,'Варкайр');
  assert.equal(out.result.victory_points_awarded,1);
  assert.equal(out.state.houses['Варкайр'].victory_points,2);
  assert.equal(out.state.houses['Варкайр'].pending_capital_hold,undefined);

  const lost=createInitialState(map,c);
  lost.houses['Варкайр'].achievements['VP-W3A']=true;
  lost.houses['Варкайр'].victory_points=1;
  lost.houses['Варкайр'].pending_capital_hold={territoryId:'W08',formerOwner:'Сайрвен'};
  out=resolvePendingCapitalHold(lost,map,c,'Варкайр');
  assert.equal(out.result.stillControls,false);
  assert.equal(out.result.victory_points_awarded,0);
  assert.equal(out.state.houses['Варкайр'].victory_points,1);
  assert.equal(out.state.houses['Варкайр'].pending_capital_hold,undefined);
});
