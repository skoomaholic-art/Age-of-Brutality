// Folk who walk the roads on business of their own: jesters, pilgrims,
// peasants, deserters. Each band is a traveller in earnest — its round takes
// in every village and town of the world, one after another, by the shortest
// road between them, and when it has seen them all it begins again.
//
// A band's round follows from the game alone, so the server and every player
// agree on where it is at any moment. A band that has taken a spy aboard walks
// a round of its own instead; that one is written down in the game, because it
// cannot be guessed from the seed.

const KINDS = 4;
const cache = new Map();

export function wayfarerLegMs(game) {
  const day = Number(game?.rounds?.round_duration_ms || 600000);
  // A host walks a road in a sixth of a game day. A band of wayfarers carries
  // no baggage and keeps no order, so it goes a quarter faster than that — and
  // no faster: folk on the roads should not flicker past the armies.
  return Math.max(12000, Math.round(day / 7.5));
}

function roadsOf(map) {
  const near = {};
  for (const [a, b] of map.land_edges || []) { (near[a] ||= []).push(b); (near[b] ||= []).push(a); }
  for (const list of Object.values(near)) list.sort();
  return near;
}

function settlementsOf(map) {
  return map.territories
    .filter(t => t.type === 'Деревня' || t.type === 'Город' || t.type === 'Столица')
    .map(t => t.id);
}

// The shortest road from `start` to `goal`, as the lands passed through.
function roadTo(near, start, goal) {
  if (start === goal) return [];
  const came = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift();
    for (const next of near[at] || []) {
      if (came.has(next)) continue;
      came.set(next, at);
      if (next === goal) {
        const out = [];
        for (let id = goal; id && id !== start; id = came.get(id)) out.unshift(id);
        return out;
      }
      queue.push(next);
    }
  }
  return null;
}

// A round that takes in every settlement it can reach: always on to the
// nearest one not yet seen, which wanders the map the way a pedlar would.
export function wanderRound(map, start, random, { first = null } = {}) {
  const near = roadsOf(map);
  const stops = settlementsOf(map).filter(id => id !== start && roadTo(near, start, id));
  const path = [];
  let at = start;
  const left = new Set(stops);
  if (first && left.has(first)) {
    const leg = roadTo(near, at, first);
    if (leg) { path.push(...leg); at = first; left.delete(first); }
  }
  while (left.size) {
    let best = null;
    let bestLeg = null;
    for (const id of left) {
      const leg = roadTo(near, at, id);
      if (!leg) { left.delete(id); continue; }
      // Nearest first, with a toss of the coin between equals: no two bands walk alike.
      if (!bestLeg || leg.length < bestLeg.length || (leg.length === bestLeg.length && random() < 0.4)) {
        best = id; bestLeg = leg;
      }
    }
    if (!best) break;
    path.push(...bestLeg);
    at = best;
    left.delete(best);
  }
  const home = roadTo(near, at, start);
  if (home) path.push(...home);
  return path.length ? path : [start];
}

export function buildWayfarers(game, map) {
  const key = `${game.id}:${map.territories.length}`;
  const base = cache.has(key) ? cache.get(key) : makeBands(game, map, key);
  const own = game.state?.band_rounds;
  if (!own) return base;
  // A band carrying a spy walks the round written down for it.
  return base.map(band => {
    const round = own[band.id];
    return round ? { ...band, path: round.path, offset: round.offset, rest: round.rest ?? band.rest } : band;
  });
}

function makeBands(game, map, key) {
  const near = roadsOf(map);
  const towns = settlementsOf(map).filter(id => near[id]);
  let seed = 7;
  for (const ch of String(game.id || '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const count = Math.max(3, Math.round(map.territories.length / 6), Object.keys(map.capitals || {}).length);
  const capitals = Object.values(map.capitals || {}).filter(id => near[id]);
  const bands = [];
  for (let k = 0; k < count && towns.length; k += 1) {
    const home = k < capitals.length ? capitals[k] : towns[Math.floor(random() * towns.length)];
    // Each band sets out for a different settlement first, so they spread out.
    const first = towns[Math.floor(random() * towns.length)];
    const path = wanderRound(map, home, random, { first });
    if (path.length < 2) continue;
    bands.push({
      id: k,
      kind: k % KINDS,
      line: Math.floor(random() * 3),
      path,
      offset: random(),
      // A band rests a short while in each land it passes; it is on the road most of the time.
      rest: 0.2 + random() * 0.15
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

// A round for a band that has taken a spy: on from where it stands, a couple of
// stops of its own business, then the settlement nearest the mark, and only
// then the mark itself — a band that walks straight at its goal is no band of
// pedlars. Afterwards it wanders on as before.
export function spyRound(map, band, at, target, random) {
  const near = roadsOf(map);
  const settlements = new Set(settlementsOf(map));
  const path = [];
  let from = at;
  // Two errands first, chosen among the settlements that are not the mark.
  const aside = settlementsOf(map).filter(id => id !== target && id !== at && roadTo(near, at, id));
  aside.sort((a, b) => (roadTo(near, at, a)?.length || 99) - (roadTo(near, at, b)?.length || 99));
  for (const stop of aside.slice(0, 3).sort(() => random() - 0.5).slice(0, 2)) {
    const leg = roadTo(near, from, stop);
    if (!leg) continue;
    path.push(...leg);
    from = stop;
  }
  // The last roof before the mark: a neighbour of it, if any is a settlement.
  const doorstep = (near[target] || [])
    .filter(id => settlements.has(id) && id !== from)
    .sort((a, b) => (roadTo(near, from, a)?.length || 99) - (roadTo(near, from, b)?.length || 99))[0];
  if (doorstep) {
    const leg = roadTo(near, from, doorstep);
    if (leg) { path.push(...leg); from = doorstep; }
  }
  const last = roadTo(near, from, target);
  if (last) { path.push(...last); from = target; }
  // And on with its own round from there.
  const onwards = wanderRound(map, from, random);
  return [...path, ...onwards.slice(0, Math.max(2, onwards.length))];
}
