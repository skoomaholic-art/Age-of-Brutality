// Standing to arms. A host told to hold the line digs in where it stands:
// ditches, stakes and watches by night. It fights the harder for it, but it is
// no longer a host on the march — it gives up the ground the moment it leaves,
// and it is told to stand down as soon as it marches anywhere.
//
// state.holding[territory][house] = true

export const HOLD = Object.freeze({ guard: 2 });

export function isHolding(state, id, house) {
  return Boolean(state?.holding?.[id]?.[house]);
}

export function holdGuard(state, id, house) {
  return isHolding(state, id, house) ? HOLD.guard : 0;
}

export function standDown(state, id, house) {
  if (!state?.holding?.[id]) return;
  delete state.holding[id][house];
  if (!Object.keys(state.holding[id]).length) delete state.holding[id];
}

// Everything a House had dug in anywhere it no longer holds.
export function clearHoldAt(state, id) {
  if (state?.holding?.[id]) delete state.holding[id];
}

export function holdLine(game, map, house, territory, { nowMs = Date.now() } = {}) {
  const land = game.state.territories?.[territory];
  if (!land) throw new Error('такой земли нет');
  if (land.owner !== house) throw new Error('окапываться можно в своей земле');
  if (Number(land.warriors?.[house] || 0) < 1) throw new Error('здесь некому держать оборону');
  const next = structuredClone(game);
  const already = isHolding(next.state, territory, house);
  next.state.holding ||= {};
  if (already) {
    standDown(next.state, territory, house);
  } else {
    next.state.holding[territory] ||= {};
    next.state.holding[territory][house] = true;
  }
  next.state.journal.push({
    kind: already ? 'STOOD_DOWN' : 'HOLDING_LINE', house, houses: [house], territory,
    at: new Date(nowMs).toISOString()
  });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}
