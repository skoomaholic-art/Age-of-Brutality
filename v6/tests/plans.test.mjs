// The plan a host carries into a fight: press the attack, or spare the men.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, planLosses, planOf, planStrength } from '../src/online/plans.mjs';

test('a plan is read off the order, and an unknown one is an even fight', () => {
  assert.equal(planOf({ plan: 'CHARGE' }), 'CHARGE');
  assert.equal(planOf({ plan: 'careful' }), 'CAREFUL');
  assert.equal(planOf({ plan: 'что-то' }), 'EVEN');
  assert.equal(planOf({}), 'EVEN');
  assert.equal(planOf(null), 'EVEN');
});

test('pressing the attack hits harder and bleeds more; caution does the reverse', () => {
  assert.equal(planStrength({ plan: 'CHARGE' }), PLANS.CHARGE.strength);
  assert.ok(planStrength({ plan: 'CHARGE' }) > planStrength({}));
  assert.ok(planStrength({ plan: 'CAREFUL' }) < planStrength({}));

  assert.equal(planLosses({}, 10), 10, 'an even fight is counted as it falls');
  assert.ok(planLosses({ plan: 'CHARGE' }, 10) > 10);
  assert.ok(planLosses({ plan: 'CAREFUL' }, 10) < 10);
  // Nobody is brought back to life by a cautious plan, and none are invented by a bold one.
  assert.equal(planLosses({ plan: 'CAREFUL' }, 0), 0);
  assert.equal(planLosses({ plan: 'CHARGE' }, 0), 0);
  assert.equal(planLosses({ plan: 'CAREFUL' }, 1), 0);
});
