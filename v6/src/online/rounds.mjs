import { applyIncomePulse } from '../core/economy.mjs';
import { buildVictoryStatus } from '../core/victory.mjs';

// Online adaptation of the tabletop round structure (Rules §4), in two modes.
//
// `days` (used by every new game): the game runs in real time for
// `constants.rounds` game days. Income is paid at each day change, orders are
// not limited in number and take time instead, and the game finishes itself
// after the last day.
//
// `rounds`: Income -> Actions (3 per House) -> end of round. Houses spend their
// actions simultaneously instead of in table order.
//
// Event and Dynasty phases are not migrated to V6 yet and are skipped, not invented.

// How long one game day lasts. Travel and build times scale with it.
export const GAME_PACES = Object.freeze({
  fast: { day_ms: 10 * 60_000, label: 'Быстрая: день за 10 минут' },
  evening: { day_ms: 60 * 60_000, label: 'Вечерняя: день за час' },
  classic: { day_ms: 24 * 60 * 60_000, label: 'Долгая: день за сутки' }
});
export const DEFAULT_PACE = 'fast';

// A land march of one road takes a sixth of a day, which matches the reach of
// three tabletop actions of two roads each. The prototype timings in orders.mjs
// and economy.mjs (3 s per road) are multiplied by this factor.
const BASE_ROAD_MS = 3_000;
export function timeScaleForDay(dayMs) {
  return dayMs / 6 / BASE_ROAD_MS;
}

export function daysMode(game) {
  return game?.rounds?.mode === 'days';
}

export const ONLINE_ROUND_TIMING = Object.freeze({
  // Prototype value, not canon. Solo games have no deadline: the round waits for the player.
  multiplayerRoundMs: 300_000,
  aiActionDelayMs: 1_500
});

const RUNNING = 'RUNNING';
const FINISHED = 'FINISHED';

export function roundsEnabled(game) {
  return Boolean(game?.rounds?.enabled);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function hasPendingWork(game) {
  return (
    (game.orders || []).some(order => order.status === 'PENDING') ||
    (game.jobs || []).some(job => job.status === 'PENDING')
  );
}

export function houseRoundStatus(game, house) {
  const rounds = game.rounds;
  const used = Number(rounds.actions_used?.[house] || 0);
  if (rounds.mode === 'days') {
    return {
      house,
      used,
      left: null,
      passed: false,
      done: false,
      ai: (rounds.ai_houses || []).includes(house)
    };
  }
  const limit = Number(rounds.actions_per_round);
  // An abandoned realm issues no orders and never holds a round open.
  const passed = Boolean(rounds.passed?.[house]) ||
    Boolean(game.lifecycle?.abandoned_houses?.[house]);
  return {
    house,
    used,
    left: passed ? 0 : Math.max(0, limit - used),
    passed,
    done: passed || used >= limit,
    ai: (rounds.ai_houses || []).includes(house)
  };
}

function deadlinePassed(game, nowMs) {
  const deadline = game.rounds.deadline_at;
  return Boolean(deadline) && Date.parse(deadline) <= nowMs;
}

function beginRound(next, map, constants, number, nowMs, timing) {
  const rounds = next.rounds;
  const income = applyIncomePulse(next.state, map, constants);
  next.state = income.state;

  // A game day starts exactly when the previous one ended, even if the server
  // noticed late, so the days keep their length.
  const days = rounds.mode === 'days';
  const startMs = days && rounds.deadline_at ? Date.parse(rounds.deadline_at) : nowMs;

  rounds.number = number;
  rounds.started_at = iso(startMs);
  rounds.deadline_at = rounds.round_duration_ms
    ? iso(startMs + rounds.round_duration_ms)
    : null;
  rounds.actions_used = Object.fromEntries(rounds.houses.map(house => [house, 0]));
  rounds.passed = Object.fromEntries(rounds.houses.map(house => [house, false]));
  rounds.refunds = Object.fromEntries(rounds.houses.map(house => [house, 0]));
  if (!days || number === 1) {
    const aiCount = Math.max(1, (rounds.ai_houses || []).length);
    rounds.ai_next_at = Object.fromEntries(
      (rounds.ai_houses || []).map((house, index) => [
        house,
        days
          // Spread the first orders of the AI Houses over the opening of day one.
          ? iso(nowMs + (aiOrderIntervalMs(rounds) * (index + 1)) / aiCount)
          : iso(nowMs + timing.aiActionDelayMs + index * 400)
      ])
    );
  }

  next.state.round = number;
  next.state.cycle = 1;
  next.state.journal.push({
    kind: 'ROUND_STARTED',
    at: rounds.started_at,
    mode: rounds.mode,
    round: number,
    max_rounds: rounds.max,
    deadline_at: rounds.deadline_at,
    gains: income.gains
  });
  next.updated_at = iso(nowMs);
}

// How often an AI House issues an order in a game played in days.
export function aiOrderIntervalMs(rounds) {
  return Number(rounds.round_duration_ms) / 5;
}

export function startRounds(game, map, constants, {
  nowMs = Date.now(),
  timing = ONLINE_ROUND_TIMING,
  mode = 'rounds',
  pace = DEFAULT_PACE,
  // Overrides the length of a game day; used by tests and local runs.
  dayMs: dayMsOverride = null
} = {}) {
  const next = structuredClone(game);
  const claims = next.lifecycle?.house_claims || {};
  const solo = next.lifecycle?.game_mode === 'SOLO';
  const days = mode === 'days';
  const paceKey = GAME_PACES[pace] ? pace : DEFAULT_PACE;
  const dayMs = Number(dayMsOverride) > 0 ? Number(dayMsOverride) : GAME_PACES[paceKey].day_ms;
  // Every House without a player is played by the House AI.
  const aiHouses = constants.houses.filter(house => !claims[house]);

  next.rounds = {
    enabled: true,
    mode: days ? 'days' : 'rounds',
    pace: days ? paceKey : null,
    number: 0,
    max: Number(constants.rounds),
    actions_per_round: days ? null : Number(constants.actions_per_round),
    houses: [...constants.houses],
    ai_houses: aiHouses,
    round_duration_ms: days ? dayMs : solo ? null : Number(timing.multiplayerRoundMs),
    actions_used: {},
    passed: {},
    refunds: {},
    ai_next_at: {},
    started_at: null,
    deadline_at: null,
    finished: false,
    winners: []
  };
  // Income is paid at the start of each round instead of on a wall-clock timer.
  next.next_income_at = null;
  // Marches, recruitment and forts take a share of the game day.
  next.clock = { time_scale: days ? timeScaleForDay(dayMs) : 1 };

  beginRound(next, map, constants, 1, nowMs, timing);
  return next;
}

export function assertRoundAction(game, house, nowMs = Date.now()) {
  if (!roundsEnabled(game)) return true;
  const rounds = game.rounds;
  if (rounds.finished) throw new Error('game is not running: FINISHED');
  if (!rounds.houses.includes(house)) {
    throw new Error('house does not take part in this game');
  }
  // In a game played in days orders are limited by time and gold, not by count.
  if (rounds.mode === 'days') return true;
  const status = houseRoundStatus(game, house);
  if (status.passed) throw new Error('round already ended for this House');
  if (status.left < 1) throw new Error('no actions left this round');
  if (deadlinePassed(game, nowMs)) throw new Error('round time expired');
  return true;
}

// `item` is the order or job the action created; it is tagged so a failed
// resolution can give the action back (a failed action must not cost a slot).
export function spendRoundAction(game, house, { orderId = null, jobId = null } = {}) {
  if (!roundsEnabled(game)) return game;
  const next = structuredClone(game);
  const rounds = next.rounds;
  rounds.actions_used[house] = Number(rounds.actions_used[house] || 0) + 1;

  const item = orderId
    ? (next.orders || []).find(order => order.id === orderId)
    : (next.jobs || []).find(job => job.id === jobId);
  if (item) item.round = rounds.number;
  return next;
}

export function passRound(game, house, nowMs = Date.now()) {
  if (!roundsEnabled(game) || daysMode(game)) {
    throw new Error('rounds are not enabled for this game');
  }
  const rounds = game.rounds;
  if (rounds.finished) throw new Error('game is not running: FINISHED');
  if (!rounds.houses.includes(house)) {
    throw new Error('house does not take part in this game');
  }
  if (rounds.passed[house]) throw new Error('round already ended for this House');

  const next = structuredClone(game);
  next.rounds.passed[house] = true;
  next.state.journal.push({
    kind: 'ROUND_PASSED',
    at: iso(nowMs),
    round: rounds.number,
    house,
    actions_used: Number(rounds.actions_used[house] || 0)
  });
  next.updated_at = iso(nowMs);
  return next;
}

export function refundFailedRoundActions(game, nowMs = Date.now()) {
  if (!roundsEnabled(game) || daysMode(game)) return game;
  const number = game.rounds.number;
  const failed = item =>
    item.status === 'FAILED' && item.round === number && !item.round_refunded;
  if (!(game.orders || []).some(failed) && !(game.jobs || []).some(failed)) return game;

  const next = structuredClone(game);
  for (const item of [...(next.orders || []), ...(next.jobs || [])]) {
    if (!failed(item)) continue;
    const house = item.house || item.action?.house;
    item.round_refunded = true;
    if (!house || !(house in next.rounds.actions_used)) continue;
    next.rounds.actions_used[house] = Math.max(
      0,
      Number(next.rounds.actions_used[house] || 0) - 1
    );
    next.rounds.refunds = next.rounds.refunds || {};
    next.rounds.refunds[house] = Number(next.rounds.refunds[house] || 0) + 1;
    next.state.journal.push({
      kind: 'ROUND_ACTION_REFUNDED',
      at: iso(nowMs),
      round: number,
      house,
      source_id: item.id
    });
  }
  next.updated_at = iso(nowMs);
  return next;
}

export function roundComplete(game, nowMs = Date.now()) {
  if (!roundsEnabled(game) || game.rounds.finished) return false;
  // A game day ends on the clock; armies on the march simply keep marching.
  if (daysMode(game)) return deadlinePassed(game, nowMs);
  if (hasPendingWork(game)) return false;
  if (deadlinePassed(game, nowMs)) return true;
  return game.rounds.houses.every(house => houseRoundStatus(game, house).done);
}

function finishByRoundLimit(next, map, constants, nowMs) {
  const at = iso(nowMs);
  next.state.phase = FINISHED;
  next.lifecycle = {
    ...(next.lifecycle || {}),
    status: FINISHED,
    finished_at: at,
    finish_reason: 'ROUND_LIMIT'
  };

  const victory = buildVictoryStatus(next, map, constants);
  const winners = [...victory.winners];
  next.lifecycle.winner_houses = winners;
  next.rounds.finished = true;
  next.rounds.winners = winners;
  next.rounds.deadline_at = null;
  next.rounds.ai_next_at = {};

  next.state.journal.push({
    kind: 'GAME_FINISHED',
    at,
    game_id: next.id,
    reason: 'ROUND_LIMIT',
    winner_house: winners.length === 1 ? winners[0] : null,
    winners,
    standings: victory.standings
  });
  next.updated_at = at;
}

export function advanceRound(game, map, constants, {
  nowMs = Date.now(),
  timing = ONLINE_ROUND_TIMING
} = {}) {
  const next = structuredClone(game);
  const rounds = next.rounds;
  next.state.journal.push({
    kind: 'ROUND_ENDED',
    at: iso(nowMs),
    round: rounds.number,
    actions_used: { ...rounds.actions_used }
  });

  if (rounds.number >= rounds.max) {
    finishByRoundLimit(next, map, constants, nowMs);
  } else {
    beginRound(next, map, constants, rounds.number + 1, nowMs, timing);
  }
  return next;
}

// Earliest moment the scheduler has to wake this game up for round bookkeeping.
export function roundsNextDueAt(game) {
  if (!roundsEnabled(game) || game.rounds.finished) return null;
  if (game.lifecycle?.status !== RUNNING) return null;

  const candidates = [];
  if (game.rounds.deadline_at) candidates.push(game.rounds.deadline_at);

  for (const house of game.rounds.ai_houses || []) {
    if (houseRoundStatus(game, house).done) continue;
    const at = game.rounds.ai_next_at?.[house];
    if (at) candidates.push(at);
  }

  const everyoneDone = !daysMode(game) && game.rounds.houses.every(
    house => houseRoundStatus(game, house).done
  );
  if (everyoneDone && !hasPendingWork(game)) {
    candidates.push(game.updated_at || game.rounds.started_at);
  }

  return candidates.filter(Boolean).sort()[0] || null;
}

export function roundsView(game, nowMs = Date.now()) {
  if (!roundsEnabled(game)) return null;
  const rounds = game.rounds;
  return {
    mode: rounds.mode || 'rounds',
    pace: rounds.pace || null,
    day_ms: rounds.mode === 'days' ? rounds.round_duration_ms : null,
    number: rounds.number,
    max: rounds.max,
    actions_per_round: rounds.actions_per_round,
    started_at: rounds.started_at,
    deadline_at: rounds.deadline_at,
    finished: Boolean(rounds.finished),
    winners: [...(rounds.winners || [])],
    waiting_for_orders: hasPendingWork(game),
    houses: rounds.houses.map(house => houseRoundStatus(game, house)),
    server_time: iso(nowMs)
  };
}
