// Ranks of warriors, the levy and the drill.
//
// A warrior is not just a head: villages send peasants, towns send militia,
// the capital sends men-at-arms, and the drill yard makes veterans and the
// household guard out of them. In battle the ranks add up as strength (no
// dice: numbers decide), and losses fall on the weakest first.
//
// The rules elsewhere still count heads (`warriors`). The ranks ride beside
// them in `state.ranks[position][house] = [n0, n1, n2, n3, n4]` and are kept
// in step after every change; marches carry their own ranks in
// `order.action.ranks`.

export const RANKS = Object.freeze([
  { key: 'seliane', name: 'Селяне', one: 'селянин', few: 'селянина', many: 'селян', power: 1 },
  { key: 'opolchenie', name: 'Ополченцы', one: 'ополченец', few: 'ополченца', many: 'ополченцев', power: 2 },
  { key: 'ratniki', name: 'Ратники', one: 'ратник', few: 'ратника', many: 'ратников', power: 3 },
  { key: 'latniki', name: 'Латники', one: 'латник', few: 'латника', many: 'латников', power: 4 },
  { key: 'druzhina', name: 'Дружинники', one: 'дружинник', few: 'дружинника', many: 'дружинников', power: 5 }
]);
const N = RANKS.length;

// The levy: who each kind of land sends, how many a day, at what price a head.
export const LEVY = Object.freeze({
  'Деревня': { rank: 0, perDay: 2, gold: 1 },
  'Город': { rank: 1, perDay: 2, gold: 2 },
  'Столица': { rank: 2, perDay: 1, gold: 3 }
});
export const LEVY_DAYS_STOCK = 3;

// The drill: a rank higher for gold and time; the yard opens the top ranks.
export const DRILL = Object.freeze({
  maxWithoutYard: 2,        // up to ratniki
  maxWithYard: 4,           // up to druzhina
  places: 6,                // warriors at drill at once
  placesWithYard: 12,
  dayShare: 1 / 3,          // a drill lasts a third of a game day
  goldPerStep: [1, 2, 3, 4] // to rank 1, 2, 3, 4
});
export const YARD = Object.freeze({ gold: 8, dayShare: 1 / 2 });

export const emptyComp = () => Array(N).fill(0);
export const compSum = comp => (comp || []).reduce((a, b) => a + Number(b || 0), 0);
export const compStrength = comp => (comp || []).reduce((a, n, i) => a + Number(n || 0) * RANKS[i].power, 0);

function clean(comp) {
  const out = emptyComp();
  for (let i = 0; i < N; i += 1) out[i] = Math.max(0, Math.floor(Number(comp?.[i] || 0)));
  return out;
}

// Takes `k` heads off a composition, weakest first; returns what was taken.
export function takeWeakest(comp, k) {
  const taken = emptyComp();
  let left = Math.max(0, k);
  for (let i = 0; i < N && left > 0; i += 1) {
    const n = Math.min(comp[i], left);
    comp[i] -= n; taken[i] += n; left -= n;
  }
  return taken;
}

export function takeStrongest(comp, k) {
  const taken = emptyComp();
  let left = Math.max(0, k);
  for (let i = N - 1; i >= 0 && left > 0; i -= 1) {
    const n = Math.min(comp[i], left);
    comp[i] -= n; taken[i] += n; left -= n;
  }
  return taken;
}

export function addComp(a, b) {
  for (let i = 0; i < N; i += 1) a[i] += Number(b?.[i] || 0);
  return a;
}

// Removes `b` from `a` where it can; returns what could not be removed.
function subComp(a, b) {
  const rest = emptyComp();
  for (let i = 0; i < N; i += 1) {
    const n = Math.min(a[i], Number(b?.[i] || 0));
    a[i] -= n;
    rest[i] = Number(b?.[i] || 0) - n;
  }
  return rest;
}

// "3 ратника, 2 селянина"
export function describeComp(comp) {
  const word = (rank, n) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return rank.one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return rank.few;
    return rank.many;
  };
  const parts = [];
  for (let i = N - 1; i >= 0; i -= 1) if (comp?.[i] > 0) parts.push(`${comp[i]} ${word(RANKS[i], comp[i])}`);
  return parts.join(', ');
}

// ---------- where warriors stand ----------

const guestKey = id => `g:${id}`;

function headsAt(state, key, house) {
  if (key.startsWith('g:')) return Number(state.guests?.[key.slice(2)]?.[house] || 0);
  return Number(state.territories?.[key]?.warriors?.[house] ?? state.sea_nodes?.[key]?.warriors?.[house] ?? 0);
}

// Heads the ranks do not know yet (old games, hired by the old way) count as
// villagers, so every older battle is decided as it was.
function defaultRank() {
  return 0;
}

function allPositions(state) {
  const out = [];
  for (const [id, t] of Object.entries(state.territories || {})) {
    for (const [house, n] of Object.entries(t.warriors || {})) if (Number(n) > 0) out.push([id, house]);
  }
  for (const [id, node] of Object.entries(state.sea_nodes || {})) {
    for (const [house, n] of Object.entries(node.warriors || {})) if (Number(n) > 0) out.push([id, house]);
  }
  for (const [id, byHouse] of Object.entries(state.guests || {})) {
    for (const [house, n] of Object.entries(byHouse || {})) if (Number(n) > 0) out.push([guestKey(id), house]);
  }
  return out;
}

export function compAt(state, map, key, house) {
  const stored = clean(state.ranks?.[key]?.[house]);
  const heads = headsAt(state, key, house);
  const sum = compSum(stored);
  if (sum > heads) takeWeakest(stored, sum - heads);
  else if (sum < heads) stored[defaultRank(map, key)] += heads - sum;
  return stored;
}

function setComp(state, key, house, comp) {
  state.ranks ||= {};
  if (compSum(comp) <= 0) {
    if (state.ranks[key]) {
      delete state.ranks[key][house];
      if (!Object.keys(state.ranks[key]).length) delete state.ranks[key];
    }
    return;
  }
  state.ranks[key] ||= {};
  state.ranks[key][house] = clean(comp);
}

// Brings the ranks in step with the heads everywhere. Mutates `state`;
// returns true when anything changed.
export function reconcileRanks(state, map) {
  const before = JSON.stringify(state.ranks || {});
  const next = {};
  for (const [key, house] of allPositions(state)) {
    next[key] ||= {};
    next[key][house] = compAt(state, map, key, house);
  }
  state.ranks = next;
  return JSON.stringify(next) !== before;
}

// ---------- marches ----------

// What a new march takes from its origin: the strongest free warriors, or a
// composition asked for, as long as the origin has them free.
export function ranksForMarch(game, map, action) {
  const key = game.state.guests?.[action.from]?.[action.house] && !game.state.territories?.[action.from]?.warriors?.[action.house]
    ? guestKey(action.from) : action.from;
  const free = compAt(game.state, map, key, action.house);
  for (const order of game.orders || []) {
    if (order.status === 'PENDING' && order.action.house === action.house && order.action.from === action.from && order.action.ranks) {
      subComp(free, order.action.ranks);
    }
  }
  const asked = action.ranks ? clean(action.ranks) : null;
  if (asked && compSum(asked) === Number(action.warriors)) {
    const probe = [...free];
    if (compSum(subComp(probe, asked)) === 0) return asked;
  }
  const comp = takeStrongest(free, Number(action.warriors));
  // Warriors the ranks have not met yet stand at the bottom.
  comp[0] += Math.max(0, Number(action.warriors) - compSum(comp));
  return comp;
}

function orderComp(order) {
  const comp = clean(order.action.ranks);
  const heads = Number(order.action.warriors || 0);
  const sum = compSum(comp);
  if (sum > heads) takeWeakest(comp, sum - heads);
  else if (sum < heads) comp[0] += heads - sum;
  return comp;
}

// After a march has been settled: its ranks leave the origin and arrive with
// the survivors. A won battle teaches: every third survivor rises a rank
// (up to latniki; the household guard is made only on the drill yard).
export function settleMarchRanks(before, after, map, order, journal) {
  const house = order.action.house;
  const comp = orderComp(order);
  const fromKeys = [order.action.from, guestKey(order.action.from)];
  const toKeys = [order.action.to, guestKey(order.action.to)];
  after.ranks = structuredClone(before.ranks || {});
  for (const key of fromKeys) {
    const left = headsAt(before, key, house) - headsAt(after, key, house);
    if (left <= 0) continue;
    const stored = compAt(before, map, key, house);
    const leaving = [...comp];
    takeWeakest(leaving, compSum(leaving) - Math.min(left, compSum(leaving)));
    const rest = subComp(stored, leaving);
    takeWeakest(stored, compSum(rest));
    setComp(after, key, house, stored);
  }
  for (const key of toKeys) {
    const came = headsAt(after, key, house) - headsAt(before, key, house);
    if (came <= 0) continue;
    const arriving = [...comp];
    takeWeakest(arriving, compSum(arriving) - Math.min(came, compSum(arriving)));
    const stored = compAt(before, map, key, house);
    addComp(stored, arriving);
    if (journal?.some(entry => entry.kind === 'BATTLE' && entry.winner === house)) promote(stored, Math.floor(compSum(arriving) / 3), 3);
    setComp(after, key, house, stored);
  }
  // A defender who held his walls learns too.
  for (const entry of journal || []) {
    if (entry.kind !== 'BATTLE' || !entry.defender || entry.winner !== entry.defender) continue;
    const key = order.action.to;
    const heads = headsAt(after, key, entry.defender);
    if (heads <= 0) continue;
    const stored = compAt(before, map, key, entry.defender);
    takeWeakest(stored, Math.max(0, compSum(stored) - heads));
    promote(stored, Math.floor(heads / 3), 3);
    setComp(after, key, entry.defender, stored);
  }
  reconcileRanks(after, map);
}

// Raises `count` of the weakest a rank, none above `cap`.
export function promote(comp, count, cap = N - 1) {
  let left = count;
  for (let i = 0; i < cap && left > 0; i += 1) {
    const n = Math.min(comp[i], left);
    comp[i] -= n; comp[i + 1] += n; left -= n;
  }
  return count - left;
}

// Losses in a meeting on the road fall on the weakest of the marching army,
// and leave the books of its origin too.
export function loseOnRoad(state, map, order, losses) {
  if (losses <= 0) return;
  const comp = orderComp(order);
  const lost = takeWeakest(comp, losses);
  order.action.ranks = comp;
  const key = state.territories?.[order.action.from] || state.sea_nodes?.[order.action.from] ? order.action.from : guestKey(order.action.from);
  const stored = clean(state.ranks?.[key]?.[order.action.house]);
  subComp(stored, lost);
  setComp(state, key, order.action.house, stored);
}

export function strengthOf(comp, heads) {
  const c = clean(comp);
  const sum = compSum(c);
  if (sum < heads) c[0] += heads - sum;
  else if (sum > heads) takeWeakest(c, sum - heads);
  return compStrength(c);
}

// ---------- the levy ----------

function dayMs(game) {
  return Number(game.rounds?.round_duration_ms) > 0 ? Number(game.rounds.round_duration_ms) : 24 * 3600_000;
}

// How many men a land can send now: it gathers `perDay` a game day, up to three days' worth.
export function levyStock(game, map, territoryId, nowMs) {
  const type = map.territories.find(t => t.id === territoryId)?.type;
  const rule = LEVY[type];
  if (!rule) return 0;
  const cap = rule.perDay * LEVY_DAYS_STOCK;
  const mark = game.levy?.[territoryId];
  if (!mark) return rule.perDay;
  const grown = Number(mark.stock || 0) + (rule.perDay * Math.max(0, nowMs - Date.parse(mark.at))) / dayMs(game);
  return Math.min(cap, grown);
}

export function levyView(game, map, house, nowMs) {
  const kinds = [0, 1, 2].map(rank => ({ rank, name: RANKS[rank].name, gold: 0, available: 0, sources: 0 }));
  for (const t of map.territories) {
    const rule = LEVY[t.type];
    if (!rule || game.state.territories[t.id]?.owner !== house) continue;
    const kind = kinds[rule.rank];
    kind.gold = rule.gold;
    kind.available += Math.floor(levyStock(game, map, t.id, nowMs));
    kind.sources += 1;
  }
  return kinds;
}

// Draws `count` men of a rank from the lands that have the most to give.
// Returns [{ territory, count }] and books the stock taken.
export function drawLevy(game, map, house, rank, count, nowMs) {
  const sources = map.territories
    .filter(t => LEVY[t.type]?.rank === rank && game.state.territories[t.id]?.owner === house)
    .map(t => ({ id: t.id, stock: levyStock(game, map, t.id, nowMs) }))
    .sort((a, b) => b.stock - a.stock || (a.id < b.id ? -1 : 1));
  const out = [];
  let left = count;
  for (const source of sources) {
    if (left <= 0) break;
    const n = Math.min(left, Math.floor(source.stock));
    if (n <= 0) continue;
    game.levy ||= {};
    game.levy[source.id] = { stock: source.stock - n, at: new Date(nowMs).toISOString() };
    out.push({ territory: source.id, count: n });
    left -= n;
  }
  return out;
}

// ---------- the drill and the yard ----------

export function yardOf(game, house) {
  return game.yards?.[house] || null;
}

export function yardReady(game, house, nowMs) {
  const yard = yardOf(game, house);
  return Boolean(yard && Date.parse(yard.ready_at) <= nowMs);
}

export function drillingCount(game, house) {
  return (game.drills?.[house] || []).reduce((sum, drill) => sum + compSum(drill.counts), 0);
}

// The capital garrison free for the drill: not on the march, not at the drill already.
export function drillableComp(game, map, house) {
  const capital = map.capitals?.[house];
  if (!capital || game.state.territories[capital]?.owner !== house) return emptyComp();
  const free = compAt(game.state, map, capital, house);
  for (const order of game.orders || []) {
    if (order.status === 'PENDING' && order.action.house === house && order.action.from === capital) subComp(free, orderComp(order));
  }
  for (const drill of game.drills?.[house] || []) subComp(free, drill.counts);
  return free;
}

export function drillTime(game) {
  return Math.round(dayMs(game) * DRILL.dayShare);
}

export function yardTime(game) {
  return Math.round(dayMs(game) * YARD.dayShare);
}

export function nextRanksDueAt(game) {
  const times = [];
  for (const list of Object.values(game.drills || {})) for (const drill of list) times.push(drill.due_at);
  for (const yard of Object.values(game.yards || {})) if (!yard.announced) times.push(yard.ready_at);
  return times.sort()[0] || null;
}

// How many heads a damage takes: the weakest fall first, and each absorbs his power.
export function headsLost(comp, heads, damage) {
  const c = clean(comp);
  const sum = compSum(c);
  if (sum < heads) c[0] += heads - sum;
  else if (sum > heads) takeWeakest(c, sum - heads);
  let left = damage, lost = 0;
  for (let i = 0; i < N && left > 0; i += 1) {
    while (c[i] > 0 && left > 0) { c[i] -= 1; lost += 1; left -= RANKS[i].power; }
  }
  return lost;
}
