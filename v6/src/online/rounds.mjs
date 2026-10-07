import { applyIncomePulse } from '../core/economy.mjs';
import { buildVictoryStatus } from '../core/victory.mjs';

// Online adaptation of the tabletop round structure (Rules §4):
// Income -> Actions (3 per House) -> end of round, for exactly `constants.rounds` rounds.
// Houses spend their actions simultaneously instead of in table order.
// Event and Dynasty phases are not migrated to V6 yet and are skipped, not invented.

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
  const limit = Number(rounds.actions_per_round);
  const passed = Boolean(rounds.passed?.[house]);
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

  rounds.number = number;
  rounds.started_at = iso(nowMs);
  rounds.deadline_at = rounds.round_duration_ms
    ? iso(nowMs + rounds.round_duration_ms)
    : null;
  rounds.actions_used = Object.fromEntries(rounds.houses.map(house => [house, 0]));
  rounds.passed = Object.fromEntries(rounds.houses.map(house => [house, false]));
  rounds.refunds = Object.fromEntries(rounds.houses.map(house => [house, 0]));
  rounds.ai_next_at = Object.fromEntries(
    (rounds.ai_houses || []).map((house, index) => [
      house,
      iso(nowMs + timing.aiActionDelayMs + index * 400)
    ])
  );

  next.state.round = number;
  next.state.cycle = 1;
  next.state.journal.push({
    kind: 'ROUND_STARTED',
    at: rounds.started_at,
    round: number,
    max_rounds: rounds.max,
    deadline_at: rounds.deadline_at,
    gains: income.gains
  });
  next.updated_at = iso(nowMs);
}

export function startRounds(game, map, constants, {
  nowMs = Date.now(),
  timing = ONLINE_ROUND_TIMING
} = {}) {
  const next = structuredClone(game);
  const claims = next.lifecycle?.house_claims || {};
  const solo = next.lifecycle?.game_mode === 'SOLO';
  const humanHouses = constants.houses.filter(house => Boolean(claims[house]));
  const aiHouses = solo
    ? constants.houses.filter(house => !claims[house])
    : [];

  next.rounds = {
    enabled: true,
    number: 0,
    max: Number(constants.rounds),
    actions_per_round: Number(constants.actions_per_round),
    houses: constants.houses.filter(
      house => humanHouses.includes(house) || aiHouses.includes(house)
    ),
    ai_houses: aiHouses,
    round_duration_ms: solo ? null : Number(timing.multiplayerRoundMs),
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
  if (!roundsEnabled(game)) throw new Error('rounds are not enabled for this game');
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
  if (!roundsEnabled(game)) return game;
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

  const everyoneDone = game.rounds.houses.every(
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
