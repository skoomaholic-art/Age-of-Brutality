// Folk who walk the roads on business of their own: jesters, pilgrims,
// peasants, deserters. Their rounds follow from the game alone, so the server
// and every player agree on where each band is at any moment.

const KINDS = 4;
const cache = new Map();

export function wayfarerLegMs(game) {
  const day = Number(game?.rounds?.round_duration_ms || 600000);
  return Math.max(45000, day / 7);
}

export function buildWayfarers(game, map) {
  const key = `${game.id}:${map.territories.length}`;
  if (cache.has(key)) return cache.get(key);
  const near = {};
  for (const [a, b] of map.land_edges || []) { (near[a] ||= []).push(b); (near[b] ||= []).push(a); }
  const towns = map.territories
    .filter(t => near[t.id] && t.type !== 'Дикая земля' && t.type !== 'Половина острова')
    .map(t => t.id);
  let seed = 7;
  for (const ch of String(game.id || '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const count = Math.max(3, Math.round(map.territories.length / 5), Object.keys(map.capitals || {}).length + 2);
  const bands = [];
  for (let k = 0; k < count && towns.length; k += 1) {
    // There and back again: a walk of a few lands from one settlement.
    // Every capital is home to one band, so each House has wayfarers calling on it.
    const capitals = Object.values(map.capitals || {}).filter(id => near[id]);
    const path = [k < capitals.length ? capitals[k] : towns[Math.floor(random() * towns.length)]];
    const steps = 3 + Math.floor(random() * 4);
    for (let i = 0; i < steps; i += 1) {
      const options = near[path[path.length - 1]].filter(id => id !== path[path.length - 2]);
      if (!options.length) break;
      path.push(options[Math.floor(random() * options.length)]);
    }
    if (path.length < 2) continue;
    bands.push({
      id: k,
      kind: k % KINDS,
      line: Math.floor(random() * 3),
      path: [...path, ...path.slice(1, -1).reverse()],
      offset: random(),
      rest: 0.45 + random() * 0.2
    });
  }
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, bands);
  return bands;
}

// Where a band is: resting at `from`, or on the road from `from` to `to`.
export function bandNow(band, legMs, nowMs) {
  const t = nowMs / legMs + band.offset * band.path.length;
  const leg = Math.floor(t) % band.path.length;
  const along = Math.max(0, (t - Math.floor(t) - band.rest) / (1 - band.rest));
  return { from: band.path[leg], to: band.path[(leg + 1) % band.path.length], along, resting: along === 0 };
}

// When the band next walks into `target`, or null if its round never goes there.
export function nextArrival(band, legMs, nowMs, target) {
  const n = band.path.length;
  const shift = band.offset * n;
  const t = nowMs / legMs + shift;
  for (let step = Math.floor(t) + 1; step <= Math.floor(t) + n; step += 1) {
    if (band.path[step % n] === target) return Math.ceil((step - shift) * legMs);
  }
  return null;
}
