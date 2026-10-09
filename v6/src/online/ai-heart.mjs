// The House AI in a game of the Heart. It thinks in strength, not heads, and
// it has one aim: the Heart. It picks a goal (the true Heart once known, else
// the nearest Heart not yet exposed as a decoy, else the deepest free land it
// can reach), musters its spare men in the own land nearest the goal, and
// strikes the next land on the road when the muster is strong enough. When
// the Horde comes for its capital it musters there instead. Losing a war, it
// asks for peace.
import { buildAdjacency } from '../core/map.mjs';
import { compAt, headsLost, starsAt, strengthOf, takeStrongest } from './ranks.mjs';
import { HEART, menToTakeWild } from './heart.mjs';
import { garrisonToHold, revoltRisk } from './order.mjs';
import { inTruce, relationOf, RELATION } from './diplomacy.mjs';
import { baseDefense } from '../core/combat.mjs';

function roads(map) {
  return buildAdjacency(map.land_edges);
}

// Road distances from `start` over land, ignoring who owns what.
function distances(map, adjacency, start) {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift();
    for (const next of adjacency.get(at) || []) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(at) + 1);
      queue.push(next);
    }
  }
  return dist;
}

export function ownLands(state, house) {
  return Object.keys(state.territories).filter(id => state.territories[id].owner === house);
}

// The strongest `n` men of a host and their strength on the attack.
function attackStrength(state, map, from, house, n) {
  const comp = compAt(state, map, from, house);
  const picked = takeStrongest([...comp], n);
  return { comp: picked, strength: strengthOf(picked, n, { stars: starsAt(state, from, house) }) + HEART.fortune };
}

// Can `n` men from `from` take `to`? Mirrors heart.wildBattle and the melee counts.
export function canTake(state, map, constants, house, from, to, n) {
  if (n <= 0) return false;
  const land = state.territories[to];
  const { comp, strength } = attackStrength(state, map, from, house, n);
  if (!land.owner) {
    const guards = Number(state.wild_guards?.[to] || 0);
    if (!guards) return true;
    const losses = headsLost(comp, n, Math.ceil(guards / 2));
    return strength > guards && n - losses > 0;
  }
  const defenders = Number(land.warriors?.[land.owner] || 0);
  if (!defenders) return true;
  const defStrength = strengthOf(compAt(state, map, to, land.owner), defenders, { defending: true, stars: starsAt(state, to, land.owner) }) + HEART.fortune;
  const walls = baseDefense(map, state, constants, to);
  const losses = headsLost(comp, n, Math.max(0, Math.ceil(defStrength / 2)));
  return strength > defStrength + walls && n - losses > 0;
}

// The fewest men from `from` that take `to`, or null.
export function menToTake(state, map, constants, house, from, to, available) {
  for (let n = 1; n <= available; n += 1) if (canTake(state, map, constants, house, from, to, n)) return n;
  return null;
}

// Men a land must keep: one (two in the capital), more where the people would rise.
export function garrisonToKeep(state, map, house, id) {
  const meta = map.territories.find(t => t.id === id);
  // The true Heart, once ours, is never stripped: whoever holds it wins.
  if (state.heart?.territory === id && state.territories[id]?.owner === house) return Number(state.territories[id].warriors?.[house] || 0);
  let keep = meta?.type === 'Столица' ? 2 : 1;
  if (state.order) {
    const people = Number(state.population?.[id] || 0);
    const order = Number(state.order[id] ?? 70);
    if (revoltRisk(order, people, 0) !== 'NONE') keep = Math.max(keep, garrisonToHold(people));
  }
  return keep;
}

// What the House is after right now.
export function chooseGoal(game, map, house) {
  const state = game.state;
  const heart = state.heart;
  const capital = map.capitals?.[house];
  // The Horde is coming: hold the capital.
  if ((state.hordes || []).some(h => h.against === house && h.men > 0) && state.territories[capital]?.owner === house) {
    return { kind: 'DEFEND', target: capital };
  }
  const adjacency = roads(map);
  const own = ownLands(state, house);
  const fromCapital = distances(map, adjacency, capital || own[0]);
  const near = id => fromCapital.get(id) ?? 99;
  const known = heart?.known?.[house] || {};
  const trueKnown = heart?.territory || Object.keys(known).find(id => known[id] === 'TRUE') || null;
  // The Heart is ours: every spare man goes to hold it.
  if (trueKnown && state.territories[trueKnown]?.owner === house) return { kind: 'HOLD', target: trueKnown };
  if (trueKnown) return { kind: 'HEART', target: trueKnown };
  const open = (heart?.candidates || []).filter(id => !(heart.revealed || []).includes(id) && known[id] !== 'FALSE' && state.territories[id]?.owner !== house);
  if (open.length) return { kind: 'HEART', target: open.sort((a, b) => near(a) - near(b) || (a < b ? -1 : 1))[0] };
  // No Hearts yet: the deepest free land within reach, to earn glory and ground. Never a decoy: it wakes the Horde.
  const candidates = new Set(heart?.candidates || []);
  const free = Object.keys(state.wild_guards || {}).filter(id => !state.territories[id]?.owner && !candidates.has(id) && near(id) < 99);
  if (!free.length) return null;
  const rings = heart?.rings || {};
  free.sort((a, b) => (rings[b] || 1) - (rings[a] || 1) || near(a) - near(b) || (a < b ? -1 : 1));
  // Not too deep too soon: the deepest land no more than two roads from our own.
  const ownSet = new Set(own);
  const reachable = free.filter(id => [...(adjacency.get(id) || [])].some(n => ownSet.has(n)));
  return { kind: 'EXPAND', target: reachable[0] || free[0] };
}

// The plan: muster at the own land nearest the goal, strike the next land on the road.
export function heartPlan(game, map, constants, house) {
  const state = game.state;
  const goal = chooseGoal(game, map, house);
  if (!goal) return null;
  const adjacency = roads(map);
  const own = ownLands(state, house);
  if (!own.length) return null;
  const toGoal = distances(map, adjacency, goal.target);
  if (goal.kind === 'DEFEND' || goal.kind === 'HOLD') return { goal, stage: goal.target, target: null };
  const stage = [...own].sort((a, b) => (toGoal.get(a) ?? 99) - (toGoal.get(b) ?? 99) || (a < b ? -1 : 1))[0];
  if ((toGoal.get(stage) ?? 99) >= 99) return null;
  // The next step: a neighbour of the stage one road nearer the goal, not our own.
  const step = [...(adjacency.get(stage) || [])]
    .filter(n => state.territories[n]?.owner !== house && (toGoal.get(n) ?? 99) < (toGoal.get(stage) ?? 99))
    .sort((a, b) => (toGoal.get(a) ?? 99) - (toGoal.get(b) ?? 99) || (a < b ? -1 : 1))[0];
  return { goal, stage, target: step || null };
}

// Peace: when the House is the weaker in a war and has not asked today.
export function wantsPeace(game, map, house) {
  const state = game.state;
  const mine = ownLands(state, house).reduce((s, id) => s + strengthOf(compAt(state, map, id, house), Number(state.territories[id].warriors?.[house] || 0)), 0);
  const day = Number(game.rounds?.number || 0);
  const asked = game.rounds?.ai_peace_asked || {};
  for (const other of Object.keys(state.houses || {})) {
    if (other === house || relationOf(game, house, other) !== RELATION.WAR) continue;
    if (game.lifecycle?.abandoned_houses?.[other]) continue;
    if (asked[`${house}>${other}`] === day) continue;
    if (inTruce(game, house, other)) continue;
    const theirs = ownLands(state, other).reduce((s, id) => s + strengthOf(compAt(state, map, id, other), Number(state.territories[id].warriors?.[other] || 0)), 0);
    if (mine < theirs * 0.9) return other;
  }
  return null;
}
