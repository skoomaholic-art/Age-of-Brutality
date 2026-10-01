import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { baseDefense, resolveBattle } from '../src/core/combat.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map=loadJson(path.join(root,'src/data/map.v6.json'));
const c=loadJson(path.join(root,'src/data/constants.v6.json'));

function enemyAt(s,id,house,count){
  s.territories[id].owner=house;
  s.territories[id].warriors={[house]:count};
}

test('base defense uses the highest terrain/fort value, never sums them',()=>{
  const s=createInitialState(map,c);
  assert.equal(baseDefense(map,s,c,'W01'),5);
  s.territories.W03.fort=true;
  assert.equal(baseDefense(map,s,c,'W03'),3);
  s.territories.W05.fort=true;
  assert.equal(baseDefense(map,s,c,'W05'),3);
});

test('attacker wins only on strictly greater strength and simultaneous losses are applied',()=>{
  const s=createInitialState(map,c);
  enemyAt(s,'W02','Сайрвен',3);
  const {state:n,result}=resolveBattle(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W02',warriors:4},{attackerDie:6,defenderDie:1});
  assert.equal(result.attackerWins,true);
  assert.equal(result.attackerStrength,10);
  assert.equal(result.defenderStrength,4);
  assert.equal(result.attackerLosses,2);
  assert.equal(result.defenderLosses,3);
  assert.equal(n.territories.W02.owner,'Варкайр');
  assert.equal(n.territories.W02.warriors['Варкайр'],2);
  assert.equal(n.houses['Варкайр'].achievements['VP-W2'],true);
});

test('tie is defender victory even when simultaneous damage destroys both groups',()=>{
  const s=createInitialState(map,c);
  s.territories.W01.warriors['Варкайр']=2;
  enemyAt(s,'W02','Сайрвен',2);
  const {state:n,result}=resolveBattle(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W02',warriors:2},{attackerDie:1,defenderDie:1});
  assert.equal(result.attackerStrength,result.defenderStrength);
  assert.equal(result.attackerWins,false);
  assert.equal(result.attackerSurvivors,0);
  assert.equal(result.defenderSurvivors,0);
  assert.equal(n.territories.W02.owner,'Сайрвен');
  assert.equal(n.houses['Сайрвен'].achievements['VP-W2'],true);
});

test('surviving defenders retreat only to adjacent own territory; otherwise they are removed',()=>{
  const s=createInitialState(map,c);
  s.territories.W01.warriors['Варкайр']=4;
  enemyAt(s,'W05','Сайрвен',4);
  s.territories.W02.owner='Варкайр';
  s.territories.W02.warriors={};
  s.territories.W09.owner='Сайрвен';
  s.territories.W09.warriors={'Сайрвен':1};
  const action={type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W05',warriors:4,path:['W01','W02','W05']};
  const {state:n,result}=resolveBattle(s,map,c,action,{attackerDie:6,defenderDie:1,defenderRetreatTo:'W09'});
  assert.equal(result.attackerWins,true);
  assert.equal(result.defenderSurvivors,1);
  assert.equal(result.defenderRetreatTo,'W09');
  assert.equal(n.territories.W09.warriors['Сайрвен'],2);
  assert.equal(n.territories.W05.owner,'Варкайр');
});

test('first foreign capital capture grants VP-W3A in addition to first battle victory',()=>{
  const s=createInitialState(map,c);
  s.territories.W09.owner='Варкайр';
  s.territories.W09.warriors={'Варкайр':6};
  enemyAt(s,'W08','Сайрвен',1);
  const {state:n,result}=resolveBattle(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W09',to:'W08',warriors:6},{attackerDie:6,defenderDie:1});
  assert.equal(result.captured,true);
  assert.equal(result.capital_capture_vp,1);
  assert.equal(n.houses['Варкайр'].victory_points,2);
  assert.equal(n.houses['Варкайр'].achievements['VP-W2'],true);
  assert.equal(n.houses['Варкайр'].achievements['VP-W3A'],true);
});
