import { calculateHouseIncome, applyIncomePulse } from '../core/economy.mjs';
import { totalHouseWarriors, validateState } from '../core/state.mjs';
import { applyRetrain, planRetrain } from './units.mjs';
import { REBUILD, assertCanGrow, assertCanRebuild, growLand, raiseVillage } from './settlements.mjs';

export const ONLINE_ECONOMY_TIMING = Object.freeze({
  incomeIntervalMs: 120_000,
  recruitBuildMs: 4_000,
  fortBuildMs: 5_000,
  retrainBuildMs: 4_500,
  // Growing a settlement and raising a village on ashes are measured in days.
  growBuildMs: 9_000,
  rebuildMs: 7_000
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

// Building takes a share of the game day (see rounds.mjs); 1 in older games.
function buildScale(game) {
  const scale = Number(game?.clock?.time_scale);
  return scale > 0 ? scale : 1;
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
  if (game.state?.population) throw new Error('в этом веке войска нанимают по родам: открой грамоту земли');
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
  const duration = Math.round(timing.recruitBuildMs * buildScale(next));
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

// Men are not retrained in a breath: they go to learn, and the new banner is
// raised over them when the lesson is done.
// A settlement climbing a step: village, great village, small town, town.
export function queueGrowJob(game, map, house, territory, { nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING } = {}) {
  const step = assertCanGrow(game.state, map, house, territory);
  if ((game.jobs || []).some(job => job.status === 'PENDING' && job.territory === territory && (job.type === 'GROW' || job.type === 'REBUILD'))) {
    throw new Error('здесь уже строят');
  }
  const next = normalizeOnlineEconomy(game, nowMs, timing);
  const id = jobId(next);
  const job = {
    id, type: 'GROW', status: 'PENDING', house, territory,
    into: step.into, gold_paid: step.gold,
    created_at: new Date(nowMs).toISOString(),
    due_at: new Date(nowMs + Math.round(timing.growBuildMs * buildScale(next) * step.dayShare * 2)).toISOString(),
    failure_reason: null
  };
  next.next_job_id += 1;
  next.state.houses[house].gold -= step.gold;
  next.jobs.push(job);
  next.updated_at = new Date(nowMs).toISOString();
  next.state.journal.push({
    kind: 'GROW_QUEUED', job_id: id, house, houses: [house], territory,
    into: step.into, gold_spent: step.gold, due_at: job.due_at, at: new Date(nowMs).toISOString()
  });
  return next;
}

// Raising a village on a burnt land: the House must stand there with men.
export function queueRebuildJob(game, map, house, territory, { nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING } = {}) {
  assertCanRebuild(game.state, map, house, territory);
  if ((game.jobs || []).some(job => job.status === 'PENDING' && job.territory === territory && job.type === 'REBUILD')) {
    throw new Error('здесь уже строят');
  }
  const next = normalizeOnlineEconomy(game, nowMs, timing);
  const id = jobId(next);
  const job = {
    id, type: 'REBUILD', status: 'PENDING', house, territory,
    gold_paid: REBUILD.gold,
    created_at: new Date(nowMs).toISOString(),
    due_at: new Date(nowMs + Math.round(timing.rebuildMs * buildScale(next))).toISOString(),
    failure_reason: null
  };
  next.next_job_id += 1;
  next.state.houses[house].gold -= REBUILD.gold;
  next.jobs.push(job);
  next.updated_at = new Date(nowMs).toISOString();
  next.state.journal.push({
    kind: 'REBUILD_QUEUED', job_id: id, house, houses: [house], territory,
    gold_spent: REBUILD.gold, due_at: job.due_at, at: new Date(nowMs).toISOString()
  });
  return next;
}

export function queueRetrainJob(game, map, house, { territory, from, to, count }, { nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING } = {}) {
  const plan = planRetrain(game, map, house, territory, from, to, count);
  const next = normalizeOnlineEconomy(game, nowMs, timing);
  const id = jobId(next);
  const duration = Math.round(timing.retrainBuildMs * buildScale(next));
  const job = {
    id,
    type: 'RETRAIN',
    status: 'PENDING',
    house,
    territory,
    from: plan.from,
    to: plan.to,
    count: plan.count,
    gold_paid: plan.gold,
    created_at: new Date(nowMs).toISOString(),
    due_at: new Date(nowMs + duration).toISOString(),
    failure_reason: null
  };
  next.next_job_id += 1;
  next.state.houses[house].gold -= plan.gold;
  next.jobs.push(job);
  next.updated_at = new Date(nowMs).toISOString();
  next.state.journal.push({
    kind: 'RETRAIN_QUEUED',
    job_id: id,
    house,
    houses: [house],
    territory,
    from: plan.from,
    to: plan.to,
    count: plan.count,
    gold_spent: plan.gold,
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

  const fortMs = Math.round(timing.fortBuildMs * buildScale(next));
  const id = jobId(next);
  const job = {
    id,
    type: 'FORT',
    status: 'PENDING',
    house,
    territory,
    gold_paid: constants.economy.fort_cost,
    created_at: new Date(nowMs).toISOString(),
    due_at: new Date(nowMs + fortMs).toISOString(),
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
    planned_duration_ms: fortMs
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

// A land taken while something was being raised or built there keeps the work:
// it is finished for the new master, at the expense of the one who paid.
function seized(next, job, captor, nowMs, extra = {}) {
  job.seized_by = captor;
  next.state.journal.push({
    kind: 'JOB_SEIZED',
    job_id: job.id,
    job_type: job.type,
    house: job.house,
    captor,
    houses: [job.house, captor],
    territory: job.territory,
    gold_lost: Number(job.gold_paid || 0),
    at: new Date(nowMs).toISOString(),
    ...extra
  });
}

function resolveRecruit(next, constants, job, nowMs) {
  const territory = next.state.territories[job.territory];
  const master = territory.owner;
  if (!master || !next.state.houses[master]) throw new Error('territory has no master to raise warriors for');
  const taken = master !== job.house;
  const totalHere = Object.values(territory.warriors || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const room = Math.min(
    constants.house_warrior_cap - totalHouseWarriors(next.state, master),
    constants.territory_warrior_cap - totalHere
  );
  if (!taken && room < job.warriors) {
    throw new Error(totalHere + job.warriors > constants.territory_warrior_cap
      ? 'territory warrior cap reached before recruitment completed'
      : 'house warrior cap reached before recruitment completed');
  }
  // A captor takes as many of the levy as he has room for; the rest disperse.
  const raised = Math.max(0, Math.min(job.warriors, room));
  if (raised > 0) territory.warriors[master] = (territory.warriors[master] || 0) + raised;
  if (taken) seized(next, job, master, nowMs, { warriors: raised });
  next.state.journal.push({
    kind: 'RECRUIT_COMPLETE',
    job_id: job.id,
    house: master,
    paid_by: job.house,
    territory: job.territory,
    warriors: raised,
    gold_spent: taken ? 0 : job.gold_paid,
    started_at: job.created_at,
    completed_at: new Date(nowMs).toISOString(),
    planned_duration_ms: Math.max(0, Date.parse(job.due_at) - Date.parse(job.created_at)),
    actual_duration_ms: Math.max(0, nowMs - Date.parse(job.created_at))
  });
}

function resolveFort(next, map, constants, job, nowMs) {
  const territory = next.state.territories[job.territory];
  const meta = map.territories.find(item => item.id === job.territory);
  const master = territory.owner;
  if (!master || !next.state.houses[master]) throw new Error('territory has no master to build for');
  const taken = master !== job.house;
  if (meta.type === 'Столица') throw new Error('fort cannot be built in a capital');
  if (territory.fort) throw new Error('territory already has a fort');
  const ownForts = Array.isArray(next.state.houses[master].forts) ? next.state.houses[master].forts.length : 0;
  if (ownForts >= constants.economy.own_fort_cap) {
    if (!taken) throw new Error('no own fort tokens available');
    // The captor cannot keep one more fort: the half-built walls are abandoned.
    seized(next, job, master, nowMs, { wasted: true });
    return;
  }
  territory.fort = true;
  if (!Array.isArray(next.state.houses[master].forts)) next.state.houses[master].forts = [];
  next.state.houses[master].forts.push(job.territory);
  if (taken) seized(next, job, master, nowMs);
  next.state.journal.push({
    kind: 'FORT_COMPLETE',
    job_id: job.id,
    house: master,
    paid_by: job.house,
    territory: job.territory,
    gold_spent: taken ? 0 : job.gold_paid,
    started_at: job.created_at,
    completed_at: new Date(nowMs).toISOString(),
    planned_duration_ms: Math.max(0, Date.parse(job.due_at) - Date.parse(job.created_at)),
    actual_duration_ms: Math.max(0, nowMs - Date.parse(job.created_at))
  });
}

export function processEconomy(game, map, constants, nowMs = Date.now(), timing = ONLINE_ECONOMY_TIMING) {
  const next = normalizeOnlineEconomy(game, nowMs, timing);
  let changed = false;

  if (!next.rounds?.enabled && Date.parse(next.next_income_at) <= nowMs) {
    // Every pulse missed while nobody was playing is paid in one step. Ownership
    // cannot change between those pulses, so the total equals replaying them one by
    // one, but replaying thousands of them after days of idling blocked the server
    // and produced more writes than one save can hold.
    const firstAt = Date.parse(next.next_income_at);
    const pulses = Math.floor((nowMs - firstAt) / timing.incomeIntervalMs) + 1;
    const result = applyIncomePulse(next.state, map, constants);
    next.state = result.state;

    const gains = {};
    for (const [house, gain] of Object.entries(result.gains)) {
      next.state.houses[house].gold += gain.gold * (pulses - 1);
      next.state.houses[house].influence += gain.influence * (pulses - 1);
      gains[house] = { gold: gain.gold * pulses, influence: gain.influence * pulses };
    }

    const entry = {
      kind: 'ONLINE_INCOME_PULSE',
      at: new Date(firstAt + (pulses - 1) * timing.incomeIntervalMs).toISOString(),
      gains
    };
    if (pulses > 1) entry.pulses = pulses;
    next.state.journal.push(entry);
    next.next_income_at = new Date(firstAt + pulses * timing.incomeIntervalMs).toISOString();
    changed = true;
  }

  // Cancellations whose countdown has run out. The gold comes back only if the
  // land is still ours: a land lost in the meantime keeps the work for its captor.
  for (const job of next.jobs) {
    if (job.status !== 'PENDING' || !job.cancel_at || Date.parse(job.cancel_at) > nowMs) continue;
    if (Date.parse(job.cancel_at) > Date.parse(job.due_at)) continue;
    if (next.state.territories[job.territory]?.owner !== job.house) {
      job.cancel_at = null;
      changed = true;
      continue;
    }
    job.status = 'CANCELLED';
    job.resolved_at = new Date(nowMs).toISOString();
    next.state.houses[job.house].gold += Number(job.gold_paid || 0);
    next.state.journal.push({
      kind: `${job.type}_CANCELLED`,
      job_id: job.id,
      house: job.house,
      territory: job.territory,
      gold_refunded: Number(job.gold_paid || 0),
      at: job.resolved_at
    });
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
      else if (job.type === 'RETRAIN') applyRetrain(next, map, job.house, job.territory, job.from, job.to, job.count, nowMs);
      else if (job.type === 'GROW') {
        if (next.state.territories[job.territory]?.owner !== job.house) throw new Error('земля больше не твоя');
        growLand(next.state, map, job.territory, job.house, job.into, { nowMs });
      }
      else if (job.type === 'REBUILD') {
        assertCanRebuild(next.state, map, job.house, job.territory);
        raiseVillage(next.state, map, job.territory, job.house, { nowMs });
      }
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

// Calling a levy or a building off takes a moment: the order is carried out
// after a countdown, and until then the work can still fall to a captor.
export const CANCEL_DELAY_MS = 10_000;

export function cancelJob(game, { house, jobId }, { nowMs = Date.now() } = {}) {
  const next = structuredClone(game);
  const job = (next.jobs || []).find(item => item.id === jobId);
  if (!job || job.house !== house) throw new Error('такого найма или стройки у твоего Дома нет');
  if (job.status !== 'PENDING') throw new Error('эта работа уже завершена');
  if (job.cancel_at) throw new Error('отмена уже объявлена');
  if (next.state.territories[job.territory]?.owner !== house) {
    throw new Error('земля захвачена: работа достанется захватчику');
  }
  const cancelAt = nowMs + CANCEL_DELAY_MS;
  if (cancelAt >= Date.parse(job.due_at)) throw new Error('слишком поздно: работа завершится раньше отмены');
  job.cancel_at = new Date(cancelAt).toISOString();
  next.updated_at = new Date(nowMs).toISOString();
  return { game: next, job };
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
