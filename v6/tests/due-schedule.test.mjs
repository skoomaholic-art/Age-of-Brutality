import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNextDueAt } from '../src/online/scheduling.mjs';

test('next due picks earliest pending timer', () => {
  const game = {
    lifecycle: { status: 'RUNNING' },
    next_income_at: '2026-10-02T10:00:00.000Z',
    orders: [
      { status:'PENDING', due_at:'2026-10-02T09:58:00.000Z' },
      { status:'RESOLVED', due_at:'2026-10-02T09:00:00.000Z' }
    ],
    jobs: [
      { status:'PENDING', due_at:'2026-10-02T09:59:00.000Z' }
    ]
  };

  assert.equal(calculateNextDueAt(game), '2026-10-02T09:58:00.000Z');
});

test('finished games have no next due timer', () => {
  assert.equal(calculateNextDueAt({
    lifecycle:{status:'FINISHED'},
    next_income_at:'2026-10-02T10:00:00.000Z',
    orders:[{status:'PENDING',due_at:'2026-10-02T09:58:00.000Z'}],
    jobs:[]
  }), null);
});

test('running game falls back to next income', () => {
  assert.equal(calculateNextDueAt({
    lifecycle:{status:'RUNNING'},
    next_income_at:'2026-10-02T10:00:00.000Z',
    orders:[],
    jobs:[]
  }), '2026-10-02T10:00:00.000Z');
});
