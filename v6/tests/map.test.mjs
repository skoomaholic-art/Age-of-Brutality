import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, validateMap, edgeKey } from '../src/core/map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));

test('provenance-locked map validates', () => {
  assert.deepEqual(validateMap(map), []);
  assert.equal(map.territories.length, 52);
  assert.equal(map.land_edges.length, 96);
  assert.equal(map.sea_edges.length, 20);
  assert.equal(map.ports.length, 16);
});

test('capitals are restored to Step 9 ids', () => {
  assert.deepEqual(map.capitals, {
    'Варкайр':'W01','Сайрвен':'W08','Ортайн':'W15',
    'Эркай':'E01','Тасвар':'E08','Айрель':'E15'
  });
});

test('mainland ports are the six old central-sea cities, not capitals/villages', () => {
  const mainland = map.ports.filter(x => /^[WE]/.test(x));
  assert.deepEqual(mainland, ['W05','W12','W19','E05','E12','E19']);
  for (const id of mainland) assert.equal(map.territories.find(t=>t.id===id).type, 'Город');
  for (const id of Object.values(map.capitals)) assert.equal(map.ports.includes(id), false);
});

test('every sea route has port endpoints and island halves are land-connected', () => {
  const ports = new Set(map.ports);
  for (const [a,b] of map.sea_edges) assert.ok(ports.has(a) && ports.has(b), `${a}-${b}`);
  const land = new Set(map.land_edges.map(([a,b]) => edgeKey(a,b)));
  for (const halves of Object.values(map.islands)) assert.ok(land.has(edgeKey(...halves)));
});
