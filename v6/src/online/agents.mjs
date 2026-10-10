import { spyLearns } from './heart.mjs';
import { houseCourtTotals } from './court.mjs';
// Spies. A House hires a spy and hides him in a band of wayfarers resting in
// one of its lands. He walks with the band along its own round, so nothing
// marks him out, and when the band reaches the land he was sent to he watches
// it: the House sees that land and its neighbours for a while. Then he slips
// home with other travellers and can be sent again.

import { bandNow, buildWayfarers, nextArrival, spyRound, wayfarerLegMs } from './wayfarers.mjs';

export const SPY_COST = 3;
export const MAX_SPIES = 2;

const SPY_NAMES = ['Тихон', 'Савва', 'Мышь', 'Кривой', 'Лука', 'Грач', 'Немой', 'Щегол'];

function watchMs(game) {
  return Math.round(Number(game?.rounds?.round_duration_ms || 600000) / 2);
}

export function hireSpy(game, constants, house, { nowMs = Date.now() } = {}) {
  const next = structuredClone(game);
  next.agents ||= {};
  const mine = (next.agents[house] ||= []);
  if (mine.length >= MAX_SPIES) throw new Error(`у Дома не больше ${MAX_SPIES} шпионов`);
  const purse = next.state.houses[house];
  // A lord skilled in intrigue at court makes spies cheaper.
  const cost = Math.max(1, SPY_COST - houseCourtTotals(next.state, house).spy);
  if (Number(purse.gold || 0) < cost) throw new Error('не хватает золота на шпиона');
  purse.gold -= cost;
  next.next_agent_id = Number(next.next_agent_id || 1);
  const id = `S${next.next_agent_id}`;
  next.next_agent_id += 1;
  mine.push({ id, name: SPY_NAMES[(next.next_agent_id + house.length) % SPY_NAMES.length], status: 'IDLE', missions: 0 });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// A spy is given his mark and sent to wait in one of the House's lands. He
// joins the next band of wayfarers that stops there, whoever they are.
export function orderSpy(game, map, { house, agentId, from, target }, { nowMs = Date.now() } = {}) {
  const land = game.state.territories?.[from];
  if (!land || land.owner !== house) throw new Error('ждать попутчиков шпион может только в твоей земле');
  if (!game.state.territories?.[target]) throw new Error('такой земли нет');
  if (target === from) throw new Error('шпион уже здесь');
  const next = structuredClone(game);
  const agent = (next.agents?.[house] || []).find(item => item.id === agentId && item.status === 'IDLE') ||
    (next.agents?.[house] || []).find(item => item.status === 'IDLE');
  if (!agent) throw new Error('свободного шпиона нет');
  const company = nextCompanyAt(next, map, from, nowMs);
  Object.assign(agent, {
    status: 'WAITING', from, target, band: null, arrive_at: null,
    wait_until: company ? new Date(company).toISOString() : null
  });
  next.state.journal.push({
    kind: 'SPY_WAITING', house, houses: [house], agent_name: agent.name,
    territory: from, target, at: new Date(nowMs).toISOString()
  });
  next.updated_at = new Date(nowMs).toISOString();
  return { game: next, agent };
}

// The round a band walks once it carries a spy, written down so that every
// player sees the same road.
function divertBand(next, map, band, at, target, nowMs) {
  const legMs = wayfarerLegMs(next);
  let seed = (Number(band.id) + 1) * 2654435761 + nowMs % 100000;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const path = spyRound(map, band, at, target, random);
  const n = path.length;
  const offset = ((-(nowMs / legMs) / n) % 1 + 1) % 1;
  const rounds = (next.state.band_rounds ||= {});
  rounds[band.id] = { path, offset, rest: band.rest, since: new Date(nowMs).toISOString() };
  // Only a few rounds of our own are ever kept; the oldest give way.
  const keys = Object.keys(rounds);
  if (keys.length > 8) {
    keys.sort((a, b) => Date.parse(rounds[a].since || 0) - Date.parse(rounds[b].since || 0));
    delete rounds[keys[0]];
  }
  return { ...band, path, offset };
}

// A spy waiting for company: the first band resting in his land takes him.
function boardWaiting(next, map, house, agent, nowMs) {
  const legMs = wayfarerLegMs(next);
  const bands = buildWayfarers(next, map);
  const here = bands.find(band => {
    const now = bandNow(band, legMs, nowMs);
    return now.resting && now.from === agent.from;
  });
  if (!here) return false;
  const diverted = divertBand(next, map, here, agent.from, agent.target, nowMs);
  const arriveAt = nextArrival(diverted, legMs, nowMs, agent.target);
  if (!arriveAt) return false;
  Object.assign(agent, {
    status: 'TRAVEL',
    band: here.id,
    wait_until: null,
    arrive_at: new Date(arriveAt).toISOString()
  });
  next.state.journal.push({
    kind: 'SPY_JOINED', house, houses: [house], agent_name: agent.name, band: here.id, kind_index: here.kind,
    territory: agent.from, target: agent.target, arrive_at: agent.arrive_at, at: new Date(nowMs).toISOString()
  });
  return true;
}

export function processAgents(game, map, { nowMs = Date.now() } = {}) {
  if (!game.agents) return game;
  const due = agent =>
    (agent.status === 'TRAVEL' && Date.parse(agent.arrive_at) <= nowMs) ||
    (agent.status === 'WATCH' && Date.parse(agent.until) <= nowMs);
  const waiting = agent => agent.status === 'WAITING';
  if (!Object.values(game.agents).some(list => list.some(item => due(item) || waiting(item)))) return game;

  const next = structuredClone(game);
  let boarded = false;
  for (const [house, list] of Object.entries(next.agents)) {
    for (const agent of list) {
      if (!waiting(agent)) continue;
      if (boardWaiting(next, map, house, agent, nowMs)) { boarded = true; continue; }
      // Still alone: when is the next band due here?
      const company = nextCompanyAt(next, map, agent.from, nowMs);
      const stamp = company ? new Date(company).toISOString() : null;
      if (stamp !== agent.wait_until) { agent.wait_until = stamp; boarded = true; }
    }
  }
  if (!Object.values(next.agents).some(list => list.some(due)) ) {
    if (!boarded) return game;
    next.updated_at = new Date(nowMs).toISOString();
    return next;
  }
  for (const [house, list] of Object.entries(next.agents)) {
    for (const agent of list) {
      if (!due(agent)) continue;
      next.state.spy_sight ||= {};
      const sight = (next.state.spy_sight[house] ||= {});
      if (agent.status === 'TRAVEL') {
        agent.status = 'WATCH';
        agent.until = new Date(nowMs + watchMs(next)).toISOString();
        sight[agent.target] = agent.until;
        // A spy at a Heart, or next to it, learns whether it is the true one.
        spyLearns(next.state, map, house, agent.target, nowMs);
        next.state.journal.push({ kind: 'SPY_ARRIVED', house, agent_name: agent.name, territory: agent.target, until: agent.until, at: new Date(nowMs).toISOString() });
      } else {
        delete sight[agent.target];
        if (!Object.keys(sight).length) delete next.state.spy_sight[house];
        next.state.journal.push({ kind: 'SPY_RETURNED', house, agent_name: agent.name, territory: agent.target, at: new Date(nowMs).toISOString() });
        agent.missions = Number(agent.missions || 0) + 1;
        agent.status = 'IDLE';
        for (const key of ['band', 'from', 'target', 'arrive_at', 'until', 'wait_until']) delete agent[key];
      }
    }
  }
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// When a band next comes to rest in `land`: the moment a waiting spy gets company.
export function nextCompanyAt(game, map, land, nowMs) {
  const legMs = wayfarerLegMs(game);
  let soonest = null;
  for (const band of buildWayfarers(game, map)) {
    const n = band.path.length;
    const shift = band.offset * n;
    const t = nowMs / legMs + shift;
    for (let step = Math.floor(t) + 1; step <= Math.floor(t) + n; step += 1) {
      if (band.path[step % n] !== land) continue;
      const at = Math.ceil((step - shift) * legMs);
      if (soonest === null || at < soonest) soonest = at;
      break;
    }
  }
  return soonest;
}

export function nextAgentDueAt(game) {
  const times = [];
  for (const list of Object.values(game.agents || {})) {
    for (const agent of list) {
      if (agent.status === 'TRAVEL') times.push(agent.arrive_at);
      if (agent.status === 'WATCH') times.push(agent.until);
      // A spy waiting for company wakes the game when the next band is due.
      if (agent.status === 'WAITING' && agent.wait_until) times.push(agent.wait_until);
    }
  }
  return times.sort()[0] || null;
}

export function agentsView(game, house) {
  return { list: structuredClone(game.agents?.[house] || []), cost: Math.max(1, SPY_COST - houseCourtTotals(game.state, house).spy), max: MAX_SPIES };
}

export function wayfarersView(game, map) {
  return { leg_ms: wayfarerLegMs(game), bands: buildWayfarers(game, map) };
}
