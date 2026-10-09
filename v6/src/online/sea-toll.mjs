// Nobody fights at sea, but the sea takes its toll. Every dawn a fleet still
// out on the open water counts one more day there; from the second dawn on it
// loses a fifth of its men (at least one, never the last) to sickness, hunger and storms.
// Moving from one sea point to the next does not reset the count: only
// landing does.

export const SEA_TOLL = Object.freeze({ freeDawns: 1, share: 0.2 });

export function seaTollLoss(men, days) {
  // The sea thins a fleet but never takes its last man.
  if (days <= SEA_TOLL.freeDawns || men <= 1) return 0;
  return Math.min(men - 1, Math.max(1, Math.floor(men * SEA_TOLL.share)));
}

// Mutates `state`. Returns the list of losses.
export function applySeaToll(state, nowMs = Date.now()) {
  const losses = [];
  for (const [id, node] of Object.entries(state.sea_nodes || {})) {
    for (const [house, count] of Object.entries(node.warriors || {})) {
      const men = Number(count || 0);
      if (men <= 0) continue;
      node.days_at_sea ||= {};
      const days = Number(node.days_at_sea[house] || 0) + 1;
      node.days_at_sea[house] = days;
      const lost = seaTollLoss(men, days);
      if (!lost) continue;
      const left = men - lost;
      node.warriors[house] = left;
      losses.push({ house, node: id, lost, left });
      state.journal.push({
        kind: 'SEA_TOLL', house, houses: [house], position: id, lost, left, days,
        at: new Date(nowMs).toISOString()
      });
    }
    const afloat = Object.keys(node.warriors || {}).filter(h => Number(node.warriors[h] || 0) > 0);
    node.owner = afloat.length === 1 ? afloat[0] : null;
  }
  return losses;
}
