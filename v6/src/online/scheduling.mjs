export function calculateNextDueAt(game) {
  if (game.lifecycle?.status !== 'RUNNING') return null;

  const candidates = [];
  if (game.next_income_at) candidates.push(game.next_income_at);

  for (const order of game.orders || []) {
    if (order.status === 'PENDING' && order.due_at) candidates.push(order.due_at);
  }

  for (const job of game.jobs || []) {
    if (job.status === 'PENDING' && job.due_at) candidates.push(job.due_at);
  }

  const valid = candidates
    .map(value => String(value))
    .filter(value => Number.isFinite(Date.parse(value)))
    .sort();

  return valid[0] || null;
}
