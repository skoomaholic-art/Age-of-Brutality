import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createInitialState } from '../src/core/state.mjs';
import { findLegalLandPaths, validateMarch } from '../src/core/movement.mjs';
import { enumerateMarches, assertLegalAction } from '../src/core/legal-actions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const c = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('land March cannot cross a neutral intermediate territory', () => {
  const s=createInitialState(map,c);
  assert.deepEqual(findLegalLandPaths(s,map,'Варкайр','W01','W05',2), []);
  assert.equal(validateMarch(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W02',warriors:1}).length,0);
  assert.ok(validateMarch(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W05',warriors:1}).length>0);
});

test('two-step land March becomes legal after intermediate territory is controlled', () => {
  const s=createInitialState(map,c);
  s.territories.W02.owner='Варкайр';
  assert.deepEqual(findLegalLandPaths(s,map,'Варкайр','W01','W05',2), [['W01','W02','W05']]);
  assert.equal(validateMarch(s,map,c,{type:'MARCH',mode:'LAND',house:'Варкайр',from:'W01',to:'W05',warriors:2}).length,0);
});

test('sea March starts only from a controlled approved coast port', () => {
  const s=createInitialState(map,c);
  assert.ok(validateMarch(s,map,c,{type:'MARCH',mode:'SEA',house:'Варкайр',from:'W01',to:'S01-A',warriors:1}).length>0);

  s.territories.W07.owner='Варкайр';
  s.territories.W07.warriors['Варкайр']=2;
  assert.equal(
    validateMarch(s,map,c,{
      type:'MARCH',mode:'SEA',house:'Варкайр',
      from:'W07',to:'S01-A',warriors:2
    }).length,
    0
  );

  s.territories.W05.owner='Варкайр';
  s.territories.W05.warriors['Варкайр']=2;
  assert.ok(
    validateMarch(s,map,c,{
      type:'MARCH',mode:'SEA',house:'Варкайр',
      from:'W05',to:'S01-A',warriors:2
    }).length>0,
    'Скархольм/W05 is no longer a sea port'
  );

  assert.ok(validateMarch(s,map,c,{type:'MARCH',mode:'SEA',house:'Эркай',from:'E01',to:'S02-B',warriors:1}).length>0);
});

test('LEGAL_ACTIONS never emits teleporting sea marches', () => {
  const s=createInitialState(map,c);
  const legal=enumerateMarches(s,map,c,'Варкайр');
  assert.equal(legal.some(a=>a.mode==='SEA'), false, 'capital W01 is not a port');
  for (const action of legal) assert.doesNotThrow(()=>assertLegalAction(action,legal));
  assert.throws(()=>assertLegalAction({type:'MARCH',mode:'SEA',house:'Варкайр',from:'W01',to:'S01-A',warriors:1},legal));
});
