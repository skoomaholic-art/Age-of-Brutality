import { spyLearns } from './heart.mjs';
import { houseCourtTotals } from './court.mjs';
// Spies. A House hires a spy and hides him in a band of wayfarers resting in
// one of its lands. He walks with the band along its own round, so nothing
// marks him out, and when the band reaches the land he was sent to he watches
// it: the House sees that land and its neighbours for a while. Then he slips
// home with other travellers and can be sent again.

import { bandNow, buildWayfarers, nextArrival, wayfarerLegMs } from './wayfarers.mjs';

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

export function attachSpy(game, map, { house, agentId, band: bandId, target }, { nowMs = Date.now() } = {}) {
  const bands = buildWayfarers(game, map);
  const band = bands.find(item => item.id === Number(bandId));
  if (!band) throw new Error('такой группы путников нет');
  const legMs = wayfarerLegMs(game);
  const now = bandNow(band, legMs, nowMs);
  if (!now.resting || game.state.territories?.[now.from]?.owner !== house) {
    throw new Error('группа должна стоять в твоей земле, чтобы принять шпиона');
  }
  if (target === now.from) throw new Error('шпион уже здесь');
  const arriveAt = nextArrival(band, legMs, nowMs, target);
  if (!arriveAt) throw new Error('эта группа туда не ходит');

  const next = structuredClone(game);
  const agent = (next.agents?.[house] || []).find(item => item.id === agentId && item.status === 'IDLE') ||
    (next.agents?.[house] || []).find(item => item.status === 'IDLE');
  if (!agent) throw new Error('свободного шпиона нет');
  Object.assign(agent, {
    status: 'TRAVEL',
    band: band.id,
    from: now.from,
    target,
    arrive_at: new Date(arriveAt).toISOString()
  });
  next.updated_at = new Date(nowMs).toISOString();
  return { game: next, agent };
}

export function processAgents(game, map, { nowMs = Date.now() } = {}) {
  if (!game.agents) return game;
  const due = agent =>
    (agent.status === 'TRAVEL' && Date.parse(agent.arrive_at) <= nowMs) ||
    (agent.status === 'WATCH' && Date.parse(agent.until) <= nowMs);
  if (!Object.values(game.agents).some(list => list.some(due))) return game;

  const next = structuredClone(game);
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
        for (const key of ['band', 'from', 'target', 'arrive_at', 'until']) delete agent[key];
      }
    }
  }
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

export function nextAgentDueAt(game) {
  const times = [];
  for (const list of Object.values(game.agents || {})) {
    for (const agent of list) {
      if (agent.status === 'TRAVEL') times.push(agent.arrive_at);
      if (agent.status === 'WATCH') times.push(agent.until);
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
