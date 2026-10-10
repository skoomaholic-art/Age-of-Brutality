// Catching a host on the road.
//
// A column on the march is not safe until it arrives. A House that holds a
// land beside the road may send part of its garrison out to meet it: the two
// hosts fight in the open, where there are no walls to stand behind and no
// land to be won — only men lost on both sides. A column that is beaten turns
// back home; one that wins walks on, thinner than it set out.
//
// The ambush is written on the order it is laid for:
//   order.ambush = [{ house, from, warriors, at, comp, stars }]
// and it is settled by the clock at `at`, before the column ever arrives.

import { compAt, headsLost, moveRanks, starsAt, strengthOf, takeWeakest } from './ranks.mjs';
import { commanderAt, commanderStats } from '../core/characters.mjs';
import { areAllies, declareWarInPlace, inTruce } from './diplomacy.mjs';
import { rulerLeadBonus } from './court.mjs';
import { orderPlace, travelSegments } from './orders.mjs';
import { visiblePositions, alliesOf } from './fog.mjs';

// A land keeps a watch of its own: a House may not empty it onto the road.
export const AMBUSH = Object.freeze({ keep: 1, die: 3 });

function roadsOf(map) {
  const near = {};
  for (const [a, b] of map.land_edges || []) { (near[a] ||= []).push(b); (near[b] ||= []).push(a); }
  return near;
}

// Where the column still has to pass, and when it is there.
export function roadAhead(order, nowMs) {
  const segments = travelSegments(order);
  if (!segments.length) return [];
  const place = orderPlace(order, nowMs);
  if (!place) return [];
  const total = segments.reduce((sum, s) => sum + Number(s.duration_ms || 0), 0) || 1;
  const factor = Number(order.duration_ms || total) / total;
  const start = Date.parse(order.created_at);
  let when = start;
  const out = [];
  for (let i = 0; i < segments.length; i += 1) {
    const length = Math.max(1, Number(segments[i].duration_ms || 0) * factor);
    when += length;
    if (i < place.index) continue;
    const to = segments[i].to ?? segments[i].id ?? null;
    if (to) out.push({ at: Math.round(when), land: to, index: i });
  }
  return out;
}

// Enemy columns this House can see, and the lands of its own it can strike
// from: a land of ours next to a stretch of road the column has yet to walk.
export function listInterceptions(game, map, house, { nowMs = Date.now() } = {}) {
  const state = game.state;
  const seen = visiblePositions(state, map, house, alliesOf(game, house));
  const near = roadsOf(map);
  const out = [];
  for (const order of game.orders || []) {
    if (order.status !== 'PENDING' || order.halted) continue;
    const them = order.action?.house;
    if (!them || them === house) continue;
    if (areAllies(game, house, them) || inTruce(game, house, them)) continue;
    if ((order.ambush || []).some(item => item.house === house)) continue;
    const ahead = roadAhead(order, nowMs).filter(step => step.at > nowMs + 1000);
    if (!ahead.length) continue;
    // The column must be in sight: a House does not ambush a rumour.
    if (!ahead.some(step => seen.has(step.land)) && !seen.has(order.action.from)) continue;
    for (const step of ahead) {
      for (const beside of [step.land, ...(near[step.land] || [])]) {
        const land = state.territories?.[beside];
        if (!land || land.owner !== house) continue;
        const men = Number(land.warriors?.[house] || 0);
        if (men <= AMBUSH.keep) continue;
        out.push({
          order_id: order.id,
          from: beside,
          land: step.land,
          at: step.at,
          max: men - AMBUSH.keep,
          house: them,
          warriors: Number(order.action.warriors || 0),
          to: order.action.to
        });
      }
    }
  }
  // One offer per land and column: the earliest meeting on the road.
  const best = new Map();
  for (const item of out) {
    const key = `${item.order_id}:${item.from}`;
    if (!best.has(key) || item.at < best.get(key).at) best.set(key, item);
  }
  return [...best.values()].sort((a, b) => a.at - b.at || a.from.localeCompare(b.from));
}

export function orderIntercept(game, map, constants, house, { orderId, from, warriors, nowMs = Date.now() } = {}) {
  const count = Math.max(1, Math.floor(Number(warriors) || 0));
  const offers = listInterceptions(game, map, house, { nowMs });
  const offer = offers.find(item => item.order_id === orderId && item.from === from);
  if (!offer) throw new Error('этот поход отсюда не перехватить');
  if (count > offer.max) throw new Error(`отсюда можно выслать не больше ${offer.max}`);
  const next = structuredClone(game);
  const order = next.orders.find(item => item.id === orderId);
  if (!order || order.status !== 'PENDING') throw new Error('такого похода уже нет');
  order.ambush ||= [];
  order.ambush.push({
    house, from: offer.from, land: offer.land, warriors: count,
    at: new Date(offer.at).toISOString(), laid_at: new Date(nowMs).toISOString()
  });
  next.state.journal.push({
    kind: 'AMBUSH_LAID', house, houses: [house], territory: offer.from, road: offer.land,
    warriors: count, against: offer.house, at: new Date(nowMs).toISOString()
  });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

function sideOf(house, heads, comp, stars, commander) {
  const stats = commanderStats(commander);
  return {
    house, heads, comp, stars,
    strength: strengthOf(comp, heads, { defending: false, stars }) + stats.attack + rulerLeadBonus(commander),
    defense: stats.defense
  };
}

// A die nobody rolls: the same road, the same hour, the same throw.
function roadDie(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % AMBUSH.die) + 1;
}

/**
 * Settles every ambush whose hour has come. Mutates `game` (a fresh copy made
 * by the caller) and returns the number of fights fought.
 */
export function processAmbushes(game, map, constants, nowMs = Date.now()) {
  let fought = 0;
  for (const order of game.orders || []) {
    if (order.status !== 'PENDING' || !order.ambush?.length) continue;
    const ready = order.ambush.filter(item => !item.done && Date.parse(item.at) <= nowMs);
    if (!ready.length) continue;
    for (const laid of ready) {
      laid.done = true;
      const state = game.state;
      const land = state.territories?.[laid.from];
      const column = Number(order.action?.warriors || 0);
      const waiting = Math.min(Number(laid.warriors || 0), Number(land?.warriors?.[laid.house] || 0));
      // The land changed hands, or the men are gone: nobody rides out.
      if (!land || land.owner !== laid.house || waiting < 1 || column < 1) continue;
      if (order.status !== 'PENDING' || order.halted) continue;

      const them = order.action.house;
      declareWarInPlace(game, laid.house, them, { nowMs, cause: 'ATTACK' });

      // The strongest of the garrison ride out; the column fights with what it carries.
      const ourComp = compAt(state, map, laid.from, laid.house);
      const us = sideOf(laid.house, waiting, ourComp,
        starsAt(state, laid.from, laid.house), commanderAt(state, laid.house, laid.from));
      const theirComp = order.action.ranks || compAt(state, map, order.action.from, them);
      const theirs = sideOf(them, column, theirComp,
        Number(order.stars || 0), order.commander_id ? state.characters?.[order.commander_id] || null : null);

      const dieUs = roadDie(`${game.id}:${order.id}:${laid.house}:us`);
      const dieThem = roadDie(`${game.id}:${order.id}:${laid.house}:them`);
      const ourStrength = us.strength + dieUs;
      const theirStrength = theirs.strength + dieThem;
      // No walls on the road: only what a commander is worth stands in the way.
      const toThem = Math.max(0, Math.ceil(ourStrength / 2) - theirs.defense);
      const toUs = Math.max(0, Math.ceil(theirStrength / 2) - us.defense);
      const ourLost = Math.min(waiting, headsLost(us.comp, waiting, toUs));
      const theirLost = Math.min(column, headsLost(theirs.comp, column, toThem));
      const ourLeft = waiting - ourLost;
      const theirLeft = column - theirLost;
      const weWin = ourStrength > theirStrength && ourLeft > 0;

      // Our losses are taken off the land the men rode out from, in the books
      // of its garrison and in the ledger of ranks alike.
      if (ourLost > 0) {
        moveRanks(state, map, laid.from, null, laid.house, 0, { losses: ourLost });
        const left = Math.max(0, Number(land.warriors?.[laid.house] || 0) - ourLost);
        if (left > 0) land.warriors[laid.house] = left; else delete land.warriors[laid.house];
      }
      // A marching host is still on the books of the land it set out from, so
      // its dead are struck off there, and the order carries fewer men on.
      if (theirLost > 0) {
        order.action.warriors = theirLeft;
        if (Array.isArray(order.action.ranks)) takeWeakest(order.action.ranks, theirLost);
        const home = state.territories?.[order.action.from];
        const onBooks = Number(home?.warriors?.[them] || 0);
        if (onBooks > 0) {
          const gone = Math.min(onBooks, theirLost);
          moveRanks(state, map, order.action.from, null, them, 0, { losses: gone });
          const left = onBooks - gone;
          if (left > 0) home.warriors[them] = left; else delete home.warriors[them];
        }
      }

      state.journal.push({
        kind: 'AMBUSH', house: laid.house, houses: [laid.house, them], against: them,
        territory: laid.from, road: laid.land, order_id: order.id,
        ours: waiting, our_lost: ourLost, theirs: column, their_lost: theirLost,
        won: weWin, at: new Date(nowMs).toISOString()
      });
      fought += 1;

      // A column cut down to the last man never arrives at all.
      if (theirLeft <= 0) {
        order.status = 'FAILED';
        order.resolved_at = new Date(nowMs).toISOString();
        order.result = { kind: 'AMBUSHED' };
        state.journal.push({
          kind: 'MARCH_FAILED', order_id: order.id, house: them, houses: [them],
          territory: order.action.to, reason: 'рать перебита на дороге', at: order.resolved_at
        });
        continue;
      }
      // A column that is beaten turns for home; one that holds walks on.
      if (!weWin) continue;
      order.return_home = true;
      order.due_at = new Date(nowMs + Math.max(1000, Math.round((Date.parse(order.due_at) - Date.parse(order.created_at)) / 2))).toISOString();
    }
  }
  return fought;
}
