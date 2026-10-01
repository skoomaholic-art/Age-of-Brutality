import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { legalVoluntaryRetreats, resolveVoluntaryRetreat, voluntaryRetreatLoss, clearRetreatStreakForHouse } from '../src/core/retreat.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map=loadJson(path.join(root,'src/data/map.v6.json'));
const c=loadJson(path.join(root,'src/data/constants.v6.json'));

function battleSetup() {
  const s=createInitialState(map,c);
  s.territories.W02.owner='Варкайр';
  s.territories.W02.warriors={'Варкайр':4};
  s.territories.W05.owner='Сайрвен';
  s.territories.W05.warriors={'Сайрвен':4};
  s.territories.W09.owner='Сайрвен';
  s.territories.W09.warriors={'Сайрвен':1};
  return s;
}

test('voluntary retreat costs 1, then 2, and a third consecutive retreat is forbidden',()=>{
  assert.equal(voluntaryRetreatLoss(0),1);
  assert.equal(voluntaryRetreatLoss(1),2);
  assert.throws(()=>voluntaryRetreatLoss(2),/third consecutive/);
});

test('voluntary retreat requires at least one survivor and adjacent own legal destination',()=>{
  const s=battleSetup();
  assert.deepEqual(legalVoluntaryRetreats(s,map,c,'Сайрвен','W05'),['W09']);
  s.territories.W05.warriors['Сайрвен']=1;
  assert.deepEqual(legalVoluntaryRetreats(s,map,c,'Сайрвен','W05'),[]);
});

test('first retreat loses one, transfers streak marker and attacker occupies without VP-W2',()=>{
  const s=battleSetup();
  const action={type:'MARCH',mode:'LAND',house:'Варкайр',from:'W02',to:'W05',warriors:3};
  const {state:n,result}=resolveVoluntaryRetreat(s,map,c,action,'W09');
  assert.equal(result.retreat_loss,1);
  assert.equal(result.defenders_after,3);
  assert.equal(result.battle_occurred,false);
  assert.equal(n.territories.W05.owner,'Варкайр');
  assert.equal(n.territories.W05.warriors['Варкайр'],3);
  assert.equal(n.territories.W09.warriors['Сайрвен'],4);
  assert.equal(n.territories.W09.retreat_streak['Сайрвен'],1);
  assert.equal(n.houses['Варкайр'].achievements['VP-W2'],undefined);
});

test('second consecutive retreat loses two and third is blocked until own action reset',()=>{
  const s=battleSetup();
  s.territories.W05.retreat_streak['Сайрвен']=1;
  const action={type:'MARCH',mode:'LAND',house:'Варкайр',from:'W02',to:'W05',warriors:3};
  const {state:n,result}=resolveVoluntaryRetreat(s,map,c,action,'W09');
  assert.equal(result.retreat_loss,2);
  assert.equal(n.territories.W09.retreat_streak['Сайрвен'],2);
  assert.equal(legalVoluntaryRetreats(n,map,c,'Сайрвен','W09').length,0);
  const reset=clearRetreatStreakForHouse(n,'Сайрвен');
  assert.equal(reset.territories.W09.retreat_streak['Сайрвен'],undefined);
});
