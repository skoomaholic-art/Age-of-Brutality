import { calculateHouseIncome, applyIncomePulse } from '../core/economy.mjs';
import { totalHouseWarriors, validateState } from '../core/state.mjs';

export const ONLINE_ECONOMY_TIMING = Object.freeze({
  incomeIntervalMs: 120_000,
  recruitBuildMs: 4_000,
  fortBuildMs: 5_000
});

export function normalizeOnlineEconomy(game, nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING) {
  const next = structuredClone(game);
  if (!Array.isArray(next.jobs)) next.jobs = [];
  if (!Number.isInteger(next.next_job_id)) next.next_job_id = 1;
  // Games played in rounds are paid at the start of each round (see rounds.mjs).
  if (next.rounds?.enabled) {
    next.next_income_at = null;
  } else if (!next.next_income_at) {
    next.next_income_at = new Date(nowMs + timing.incomeIntervalMs).toISOString();
  }
  return next;
}

function jobId(game) {
  return `J${String(game.next_job_id).padStart(6, '0')}`;
}

function pendingRecruitTotal(game, house, territoryId = null) {
  return game.jobs
    .filter(job =>
      job.status === 'PENDING' &&
      job.type === 'RECRUIT' &&
      job.house === house &&
      (!territoryId || job.territory === territoryId)
    )
    .reduce((sum, job) => sum + job.warriors, 0);
}

function pendingFortCount(game, house) {
  return game.jobs.filter(job =>
    job.status === 'PENDING' &&
    job.type === 'FORT' &&
    job.house === house
  ).length;
}

export function queueRecruitJob(game, constants, {
  house,
  territory,
  warriors
}, { nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING } = {}) {
  const next = normalizeOnlineEconomy(game, nowMs, timing);
  const count = Number(warriors);
  if (!constants.houses.includes(house)) throw new Error('unknown house');
  if (!next.state.territories[territory]) throw new Error('unknown territory');
  if (next.state.territories[territory].owner !== house) throw new Error('territory is not controlled by this house');
  if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('recruit must be 1..3 warriors');
  if (next.state.houses[house].gold < count) throw new Error('not enough gold');

  const houseProjected = totalHouseWarriors(next.state, house) + pendingRecruitTotal(next, house) + count;
  if (houseProjected > constants.house_warrior_cap) throw new Error(`house warrior cap ${constants.house_warrior_cap} exceeded`);

  const currentTerritory = Object.values(next.state.territories[territory].warriors || {})
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const territoryProjected = currentTerritory + pendingRecruitTotal(next, house, territory) + count;
  if (territoryProjected > constants.territory_warrior_cap) {
    throw new Error(`territory warrior cap ${constants.territory_warrior_cap} exceeded`);
  }

  const id = jobId(next);
  const duration = timing.recruitBuildMs;
  const job = {
    id,
    type: 'RECRUIT',
    status: 'PENDING',
    house,
    territory,
    warriors: count,
    gold_paid: count,
    created_at: new Date(nowMs).toISOString(),
    due_at: new Date(nowMs + duration).toISOString(),
    failure_reason: null
  };

  next.next_job_id += 1;
  next.state.houses[house].gold -= count;
  next.jobs.push(job);
  next.updated_at = new Date(nowMs).toISOString();
  next.state.journal.push({
    kind: 'RECRUIT_QUEUED',
    job_id: id,
    house,
    territory,
    warriors: count,
    gold_spent: count,
    started_at: job.created_at,
    due_at: job.due_at,
    planned_duration_ms: duration
  });
  return { game: next, job };
}

export function queueFortJob(game, map, constants, {
  house,
  territory
}, { nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING } = {}) {
  const next = normalizeOnlineEconomy(game, nowMs, timing);
  if (!constants.houses.includes(house)) throw new Error('unknown house');
  const target = next.state.territories[territory];
  const meta = map.territories.find(item => item.id === territory);
  if (!target || !meta) throw new Error('unknown territory');
  if (target.owner !== house) throw new Error('territory is not controlled by this house');
  if (meta.type === 'Столица') throw new Error('fort cannot be built in a capital');
  if (target.fort) throw new Error('territory already has a fort');
  if (next.jobs.some(job => job.status === 'PENDING' && job.type === 'FORT' && job.territory === territory)) {
    throw new Error('fort is already being built here');
  }

  const ownForts = Array.isArray(next.state.houses[house].forts) ? next.state.houses[house].forts.length : 0;
  if (ownForts + pendingFortCount(next, house) >= constants.economy.own_fort_cap) {
    throw new Error('no own fort tokens available');
  }
  if (next.state.houses[house].gold < constants.economy.fort_cost) throw new Error('not enough gold');

  const id = jobId(next);
  const job = {
    id,
    type: 'FORT',
    status: 'PENDING',
    house,
    territory,
    gold_paid: constants.economy.fort_cost,
    created_at: new Date(nowMs).toISOString(),
    due_at: new Date(nowMs + timing.fortBuildMs).toISOString(),
    failure_reason: null
  };

  next.next_job_id += 1;
  next.state.houses[house].gold -= constants.economy.fort_cost;
  next.jobs.push(job);
  next.updated_at = new Date(nowMs).toISOString();
  next.state.journal.push({
    kind: 'FORT_QUEUED',
    job_id: id,
    house,
    territory,
    gold_spent: constants.economy.fort_cost,
    started_at: job.created_at,
    due_at: job.due_at,
    planned_duration_ms: timing.fortBuildMs
  });
  return { game: next, job };
}

function failAndRefund(next, job, reason, nowMs) {
  job.status = 'FAILED';
  job.failure_reason = reason;
  job.resolved_at = new Date(nowMs).toISOString();
  next.state.houses[job.house].gold += Number(job.gold_paid || 0);
  next.state.journal.push({
    kind: `${job.type}_FAILED`,
    house: job.house,
    territory: job.territory,
    reason,
    gold_refunded: Number(job.gold_paid || 0),
    job_id: job.id,
    started_at: job.created_at,
    completed_at: job.resolved_at,
    planned_duration_ms: Math.max(0, Date.parse(job.due_at) - Date.parse(job.created_at)),
    actual_duration_ms: Math.max(0, nowMs - Date.parse(job.created_at))
  });
}

function resolveRecruit(next, constants, job, nowMs) {
  const territory = next.state.territories[job.territory];
  if (territory.owner !== job.house) throw new Error('territory changed owner before recruitment completed');
  if (totalHouseWarriors(next.state, job.house) + job.warriors > constants.house_warrior_cap) {
    throw new Error('house warrior cap reached before recruitment completed');
  }
  const totalHere = Object.values(territory.warriors || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  if (totalHere + job.warriors > constants.territory_warrior_cap) {
    throw new Error('territory warrior cap reached before recruitment completed');
  }
  territory.warriors[job.house] = (territory.warriors[job.house] || 0) + job.warriors;
  next.state.journal.push({
    kind: 'RECRUIT_COMPLETE',
    job_id: job.id,
    house: job.house,
    territory: job.territory,
    warriors: job.warriors,
    gold_spent: job.gold_paid,
    started_at: job.created_at,
    completed_at: new Date(nowMs).toISOString(),
    planned_duration_ms: Math.max(0, Date.parse(job.due_at) - Date.parse(job.created_at)),
    actual_duration_ms: Math.max(0, nowMs - Date.parse(job.created_at))
  });
}

function resolveFort(next, map, constants, job, nowMs) {
  const territory = next.state.territories[job.territory];
  const meta = map.territories.find(item => item.id === job.territory);
  if (territory.owner !== job.house) throw new Error('territory changed owner before fort completed');
  if (meta.type === 'Столица') throw new Error('fort cannot be built in a capital');
  if (territory.fort) throw new Error('territory already has a fort');
  const ownForts = Array.isArray(next.state.houses[job.house].forts) ? next.state.houses[job.house].forts.length : 0;
  if (ownForts >= constants.economy.own_fort_cap) throw new Error('no own fort tokens available');
  territory.fort = true;
  if (!Array.isArray(next.state.houses[job.house].forts)) next.state.houses[job.house].forts = [];
  next.state.houses[job.house].forts.push(job.territory);
  next.state.journal.push({
    kind: 'FORT_COMPLETE',
    job_id: job.id,
    house: job.house,
    territory: job.territory,
    gold_spent: job.gold_paid,
    started_at: job.created_at,
    completed_at: new Date(nowMs).toISOString(),
    planned_duration_ms: Math.max(0, Date.parse(job.due_at) - Date.parse(job.created_at)),
    actual_duration_ms: Math.max(0, nowMs - Date.parse(job.created_at))
  });
}

export function processEconomy(game, map, constants, nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING) {
  const next = normalizeOnlineEconomy(game, nowMs, timing);
  let changed = false;

  while (!next.rounds?.enabled && Date.parse(next.next_income_at) <= nowMs) {
    const result = applyIncomePulse(next.state, map, constants);
    next.state = result.state;
    next.state.journal.push({
      kind: 'ONLINE_INCOME_PULSE',
      at: next.next_income_at,
      gains: result.gains
    });
    next.next_income_at = new Date(Date.parse(next.next_income_at) + timing.incomeIntervalMs).toISOString();
    changed = true;
  }

  const due = next.jobs
    .filter(job => job.status === 'PENDING' && Date.parse(job.due_at) <= nowMs)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.id.localeCompare(b.id));

  for (const dueJob of due) {
    const job = next.jobs.find(item => item.id === dueJob.id);
    try {
      if (job.type === 'RECRUIT') resolveRecruit(next, constants, job, nowMs);
      else if (job.type === 'FORT') resolveFort(next, map, constants, job, nowMs);
      else throw new Error(`unknown job type ${job.type}`);

      const errors = validateState(next.state, map, constants);
      if (errors.length) throw new Error(errors.join('; '));
      job.status = 'RESOLVED';
      job.resolved_at = new Date(nowMs).toISOString();
      job.failure_reason = null;
    } catch (error) {
      failAndRefund(next, job, error instanceof Error ? error.message : String(error), nowMs);
    }
    changed = true;
  }

  if (changed) next.updated_at = new Date(nowMs).toISOString();
  return next;
}

export function economyView(game, map, constants, house) {
  const income = calculateHouseIncome(game.state, map, constants, house);
  const territories = map.territories
    .filter(item => game.state.territories[item.id]?.owner === house)
    .map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      warriors: Number(game.state.territories[item.id].warriors?.[house] || 0),
      fort: Boolean(game.state.territories[item.id].fort),
      isCapital: item.type === 'Столица'
    }));

  return {
    house,
    income,
    next_income_at: game.next_income_at,
    territories,
    jobs: game.jobs.filter(job => job.house === house).slice().reverse()
  };
}
