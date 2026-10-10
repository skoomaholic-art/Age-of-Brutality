// What one House remembers of another.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPINION, nudgeOpinion, opinionDawn, opinionOf, opinionWord, rememberDeed } from '../src/online/opinion.mjs';

function world() {
  return { diplomacy: {}, state: { houses: { A: {}, B: {}, C: {} } } };
}

test('a deed is remembered by the House it was done to, and never past hatred', () => {
  const game = world();
  assert.equal(opinionOf(game, 'A', 'B'), 0);
  rememberDeed(game, { doer: 'A', about: 'B', deed: 'ATTACKED' });
  assert.equal(opinionOf(game, 'B', 'A'), OPINION.deeds.ATTACKED);
  assert.equal(opinionOf(game, 'A', 'B'), 0, 'the one who struck remembers nothing of it');

  for (let i = 0; i < 20; i += 1) rememberDeed(game, { doer: 'A', about: 'B', deed: 'ATTACKED' });
  assert.equal(opinionOf(game, 'B', 'A'), OPINION.floor, 'hatred has a bottom');
  assert.equal(opinionWord(opinionOf(game, 'B', 'A')), 'ненависть');
});

test('a marriage is felt on both sides; an oath broken is seen by the whole world', () => {
  const game = world();
  rememberDeed(game, { doer: 'A', about: 'B', deed: 'MARRIAGE' });
  assert.equal(opinionOf(game, 'A', 'B'), OPINION.deeds.MARRIAGE);
  assert.equal(opinionOf(game, 'B', 'A'), OPINION.deeds.MARRIAGE);

  rememberDeed(game, { doer: 'A', about: 'B', deed: 'OATH_BROKEN', houses: ['A', 'B', 'C'] });
  assert.equal(opinionOf(game, 'C', 'A'), Math.round(OPINION.deeds.OATH_BROKEN / 3), 'C saw it too');
  assert.equal(opinionOf(game, 'C', 'B'), 0, 'and holds nothing against the wronged House');
});

test('gold given in a bargain is weighed by the amount', () => {
  const game = world();
  rememberDeed(game, { doer: 'A', about: 'B', deed: 'GIFT', amount: 5 });
  assert.equal(opinionOf(game, 'B', 'A'), OPINION.deeds.GIFT * 5);
});

test('every dawn dulls an old grudge until nothing is left of it', () => {
  const game = world();
  nudgeOpinion(game, 'B', 'A', -OPINION.fade - 1);
  opinionDawn(game);
  assert.equal(opinionOf(game, 'B', 'A'), -1);
  opinionDawn(game);
  assert.equal(opinionOf(game, 'B', 'A'), 0);
  assert.equal(game.diplomacy.opinion['B>A'], undefined, 'nothing is kept once it is forgotten');
});

test('quiet years of themselves turn indifference into good will, but only so far', () => {
  const game = world();
  game.rounds = { number: 1 };
  // A blow today: nothing warms while it still stings.
  rememberDeed(game, { doer: 'A', about: 'B', deed: 'ATTACKED' });
  opinionDawn(game);
  assert.ok(opinionOf(game, 'B', 'A') < 0);

  // Days pass with nothing done, and the grudge wears out and turns the corner.
  for (let day = 2; day < 40; day += 1) {
    game.rounds.number = day;
    opinionDawn(game);
  }
  assert.equal(opinionOf(game, 'B', 'A'), OPINION.warmth, 'neighbours warm up to a point and no further');
  assert.equal(opinionWord(OPINION.warmth), 'приязнь');

  // And a fresh blow undoes it at once.
  rememberDeed(game, { doer: 'A', about: 'B', deed: 'ATTACKED' });
  assert.ok(opinionOf(game, 'B', 'A') < 0);
});

test('a House that comes up to our border where there was nobody is a worry', async () => {
  const { watchBorders, OPINION } = await import('../src/online/opinion.mjs');
  const map = { land_edges: [['L1', 'L2'], ['L2', 'L3'], ['L3', 'L4']] };
  const game = {
    diplomacy: {},
    state: {
      houses: { A: {}, B: {} },
      journal: [],
      territories: { L1: { owner: 'A' }, L2: { owner: null }, L3: { owner: null }, L4: { owner: 'B' } }
    }
  };

  // Far apart: nothing to say.
  assert.equal(watchBorders(game, map), false);
  assert.equal(opinionOf(game, 'A', 'B'), 0);

  // B takes the land next to ours: now it is over the fence.
  game.state.territories.L2.owner = 'B';
  assert.equal(watchBorders(game, map), true);
  assert.equal(opinionOf(game, 'A', 'B'), OPINION.deeds.NEIGHBOUR);
  assert.ok(game.state.journal.some(e => e.kind === 'NEW_NEIGHBOUR' && e.house === 'A' && e.other === 'B'));

  // Standing there is not a fresh offence at every dawn.
  const before = opinionOf(game, 'A', 'B');
  assert.equal(watchBorders(game, map), false);
  assert.equal(opinionOf(game, 'A', 'B'), before);
});
