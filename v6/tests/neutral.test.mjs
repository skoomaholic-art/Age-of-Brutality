import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { resolveNeutralCapture, neutralResistance } from '../src/core/neutral.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map=loadJson(path.join(root,'src/data/map.v6.json'));
const c=loadJson(path.join(root,'src/data/constants.v6.json'));

test('neutral resistance comes from territory type and central halves are 1',()=>{
  assert.equal(neutralResistance(map,c,'W02'),0);
  assert.equal(neutralResistance(map,c,'W03'),1);
  assert.equal(neutralResistance(map,c,'W05'),2);
  assert.equal(neutralResistance(map,c,'S03-A'),1);
});

test('failed neutral capture loses at most one warrior and returns control unchanged',()=>{
  const s=createInitialState(map,c);
  const a={type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W02',warriors:3};
  const {state:n,result}=resolveNeutralCapture(s,map,c,a,[1,1]);
  assert.equal(result.success,false);
  assert.equal(result.loss,1);
  assert.equal(n.territories.W02.owner,null);
  assert.equal(n.territories.W01.warriors['Варкайр'],3);
});

test('successful neutral capture moves group, takes control and grants VP-W1 once',()=>{
  let s=createInitialState(map,c);
  let out=resolveNeutralCapture(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W03',warriors:3},[3,3]);
  s=out.state;
  assert.equal(out.result.success,true);
  assert.equal(s.territories.W03.owner,'Варкайр');
  assert.equal(s.territories.W03.warriors['Варкайр'],3);
  assert.equal(s.houses['Варкайр'].victory_points,1);
  assert.equal(s.houses['Варкайр'].achievements['VP-W1'],true);

  s.territories.W04.owner='Варкайр';
  s.territories.W04.warriors['Варкайр']=2;
  out=resolveNeutralCapture(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W04',to:'W07',warriors:1},[6,6]);
  assert.equal(out.result.success,true);
  assert.equal(out.result.victory_points_awarded,0);
  assert.equal(out.state.houses['Варкайр'].victory_points,1);
});
