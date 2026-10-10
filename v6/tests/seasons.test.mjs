// The turning year: two days of summer, two of winter, and round again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLD, SUMMER, WINTER, seasonOfDay, seasonNow, seasonTurnsOn } from '../src/online/seasons.mjs';
import { roadSlow, wearAt, PLAIN } from '../src/online/terrain.mjs';

const summerMap = { season: 'лето', terrain: {} };
const winterMap = { season: 'зима', terrain: {} };

test('the year turns every second day, and a world born in winter begins in winter', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(d => seasonOfDay(summerMap, d)),
    [SUMMER, SUMMER, WINTER, WINTER, SUMMER, SUMMER, WINTER, WINTER]);
  assert.deepEqual([1, 2, 3, 4].map(d => seasonOfDay(winterMap, d)),
    [WINTER, WINTER, SUMMER, SUMMER]);
  assert.equal(seasonNow({ rounds: { number: 3 } }, summerMap), WINTER);
  assert.equal(seasonTurnsOn({ rounds: { number: 1 } }, summerMap), 3);
  assert.equal(seasonTurnsOn({ rounds: { number: 4 } }, summerMap), 5);
});

test('winter is heavier on the road and takes its own from a host abroad', () => {
  const map = { season: 'лето', terrain: { A: 'горы', B: PLAIN } };
  assert.ok(roadSlow(map, 'A', 'B', WINTER) > roadSlow(map, 'A', 'B', SUMMER));
  assert.equal(roadSlow(map, 'A', 'B', WINTER), roadSlow(map, 'A', 'B') * COLD.slow);

  // Open ground costs nothing in summer and bites in winter.
  const state = { territories: { B: { warriors: {} } } };
  assert.equal(wearAt(map, state, 'B', 'Дом', SUMMER), null);
  const cold = wearAt(map, state, 'B', 'Дом', WINTER);
  assert.equal(cold.rate, COLD.wear);
  assert.equal(cold.why, COLD.why);

  // Rough ground is worse still in winter than in summer.
  const mountainsSummer = wearAt(map, state, 'A', 'Дом', SUMMER);
  const mountainsWinter = wearAt(map, state, 'A', 'Дом', WINTER);
  assert.ok(mountainsWinter.rate > mountainsSummer.rate);
  assert.equal(mountainsWinter.why, mountainsSummer.why, 'the reason is still the mountains');
});
