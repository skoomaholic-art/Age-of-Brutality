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
  assert.equal(map.ports.length, 18);
});

test('capitals are restored to Step 9 ids', () => {
  assert.deepEqual(map.capitals, {
    'Варкайр':'W01','Сайрвен':'W08','Ортайн':'W15',
    'Эркай':'E01','Тасвар':'E08','Айрель':'E15'
  });
});

test('approved west-center sea routes use the corrected mainland endpoints', () => {
  const edges = new Set(map.sea_edges.map(([a,b]) => edgeKey(a,b)));

  for (const [a,b] of [
    ['S04-A','W18'],
    ['S04-A','W14'],
    ['S03-A','W18'],
    ['S03-A','W14'],
    ['S03-A','W07'],
    ['S03-A','S01-B'],
    ['S03-A','S04-B']
  ]) {
    assert.ok(edges.has(edgeKey(a,b)), `missing corrected sea route ${a}-${b}`);
  }

  const land = new Set(map.land_edges.map(([a,b]) => edgeKey(a,b)));
  assert.ok(
    land.has(edgeKey('S03-A','S03-B')),
    'missing Короны A-Короны B land connection'
  );

  for (const [a,b] of [
    ['S04-A','W12'],
    ['S04-A','W19'],
    ['S03-A','W05'],
    ['S03-A','W12'],
    ['S03-A','W19']
  ]) {
    assert.equal(edges.has(edgeKey(a,b)), false, `stale route remains ${a}-${b}`);
  }

  for (const id of ['W18','W14','W07']) assert.equal(map.ports.includes(id), true);
});

test('every sea route has port endpoints and island halves are land-connected', () => {
  const ports = new Set(map.ports);
  for (const [a,b] of map.sea_edges) assert.ok(ports.has(a) && ports.has(b), `${a}-${b}`);
  const land = new Set(map.land_edges.map(([a,b]) => edgeKey(a,b)));
  for (const halves of Object.values(map.islands)) assert.ok(land.has(edgeKey(...halves)));
});
