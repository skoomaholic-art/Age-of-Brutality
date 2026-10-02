import { enumerateMarches, assertLegalAction } from '../core/legal-actions.mjs';
import { applyFriendlyMarch, classifyDestination, findLegalLandPaths } from '../core/movement.mjs';
import { resolveNeutralCapture } from '../core/neutral.mjs';
import { resolveBattle } from '../core/combat.mjs';
import { resolveEmptyEnemyOccupation } from '../core/occupation.mjs';
import { validateState, warriorsAt } from '../core/state.mjs';
import {
  autoCommanderForMarch,
  beginCommanderMarch,
  commanderAt,
  commanderStats,
  markCommanderFatePending,
  settleCommander
} from '../core/characters.mjs';

export const ONLINE_TIMING = Object.freeze({
  landSegmentMs: 3_000,
  landMaxMs: 5_000,
  seaSegmentMs: 5_000
});

function actionKey(action) {
  return JSON.stringify([
    action.type,
    action.mode,
    action.house,
    action.from,
    action.to,
    action.warriors
  ]);
}

function hash32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicDice(seed) {
  const a = hash32(seed);
  const b = hash32(seed + ':second');
  return [(a % 6) + 1, (b % 6) + 1];
}

export function reservedWarriors(game, house, from) {
  return game.orders
    .filter(order =>
      order.status === 'PENDING' &&
      order.action.house === house &&
      order.action.from === from
    )
    .reduce((sum, order) => sum + order.action.warriors, 0);
}

export function listQueueableMarches(game, map, constants, house) {
  const legal = enumerateMarches(game.state, map, constants, house);
  return legal.filter(action => {
    const available = warriorsAt(game.state, action.from, house);
    const reserved = reservedWarriors(game, house, action.from);
    return action.warriors <= available - reserved;
  });
}

export function travelDurationMs(state, map, constants, action, timing = ONLINE_TIMING) {
  if (action.mode === 'SEA') return timing.seaSegmentMs;

  const paths = findLegalLandPaths(
    state,
    map,
    action.house,
    action.from,
    action.to,
    constants.march.max_land_segments
  );
  if (!paths.length) throw new Error('no legal land path for timed order');
  const segments = Math.min(...paths.map(path => path.length - 1));
  return Math.min(
    Number(timing.landMaxMs || Number.MAX_SAFE_INTEGER),
    timing.landSegmentMs * segments
  );
}

export function queueTimedOrder(
  game,
  map,
  constants,
  action,
  { nowMs = Date.now(), timing = ONLINE_TIMING } = {}
) {
  const legal = listQueueableMarches(game, map, constants, action.house);
  assertLegalAction(action, legal);

  let next = structuredClone(game);
  const id = `O${String(next.next_order_id).padStart(6, '0')}`;
  const durationMs = travelDurationMs(next.state, map, constants, action, timing);
  const availableWarriors =
    warriorsAt(game.state, action.from, action.house) -
    reservedWarriors(game, action.house, action.from);
  const commander = autoCommanderForMarch(
    game.state,
    action,
    availableWarriors
  );
  const order = {
    id,
    status: 'PENDING',
    created_at: new Date(nowMs).toISOString(),
    due_at: new Date(nowMs + durationMs).toISOString(),
    duration_ms: durationMs,
    action: structuredClone(action),
    commander_id: commander?.id || null,
    result: null,
    failure_reason: null
  };

  if (order.commander_id) {
    next.state = beginCommanderMarch(
      next.state,
      order.commander_id,
      order
    );
  }

  next.next_order_id += 1;
  next.orders.push(order);
  next.state.journal.push({
    kind: 'MARCH_QUEUED',
    order_id: id,
    house: action.house,
    from: action.from,
    to: action.to,
    warriors: action.warriors,
    mode: action.mode,
    commander_id: order.commander_id,
    commander_name: commander?.name || null,
    started_at: order.created_at,
    due_at: order.due_at,
    planned_duration_ms: durationMs
  });
  next.updated_at = new Date(nowMs).toISOString();
  return { game: next, order };
}

function resolveOrder(state, map, constants, gameId, order, nowMs) {
  const legal = enumerateMarches(state, map, constants, order.action.house);
  assertLegalAction(order.action, legal);

  const destination = classifyDestination(
    state,
    order.action.house,
    order.action.to
  );

  if (destination === 'FRIENDLY') {
    let moved = applyFriendlyMarch(state, map, constants, order.action);
    moved = settleCommander(
      moved,
      order.commander_id,
      order.action.to
    );
    return {
      state: moved,
      result: {
        kind: 'FRIENDLY_MARCH',
        commander_id: order.commander_id || null
      }
    };
  }

  if (destination === 'NEUTRAL') {
    const dice = deterministicDice(`${gameId}:${order.id}:neutral`);
    let resolved = resolveNeutralCapture(
      state,
      map,
      constants,
      order.action,
      dice
    );
    resolved.state = settleCommander(
      resolved.state,
      order.commander_id,
      resolved.result.success ? order.action.to : order.action.from
    );
    resolved.result.commander_id = order.commander_id || null;
    return resolved;
  }

  const defenderHouse = state.territories[order.action.to].owner;
  const defenders = warriorsAt(state, order.action.to, defenderHouse);

  if (defenders === 0) {
    let resolved = resolveEmptyEnemyOccupation(
      state,
      map,
      constants,
      order.action
    );
    resolved.state = settleCommander(
      resolved.state,
      order.commander_id,
      order.action.to
    );
    resolved.result.commander_id = order.commander_id || null;
    return resolved;
  }

  const attackerCommander = order.commander_id
    ? state.characters?.[order.commander_id] || null
    : null;
  const defenderCommander = commanderAt(
    state,
    defenderHouse,
    order.action.to
  );

  const [attackerDie, defenderDie] = deterministicDice(
    `${gameId}:${order.id}:battle`
  );

  let resolved = resolveBattle(
    state,
    map,
    constants,
    order.action,
    {
      attackerDie,
      defenderDie,
      attackerCommander: commanderStats(attackerCommander),
      defenderCommander: commanderStats(defenderCommander)
    }
  );

  resolved.result.attacker_commander_id = attackerCommander?.id || null;
  resolved.result.defender_commander_id = defenderCommander?.id || null;

  if (resolved.result.attackerWins) {
    resolved.state = settleCommander(
      resolved.state,
      attackerCommander?.id,
      order.action.to
    );

    if (defenderCommander) {
      resolved.state = markCommanderFatePending(
        resolved.state,
        defenderCommander.id,
        {
          battle_territory: order.action.to,
          opponent_house: order.action.house,
          side: 'DEFENDER',
          army_destroyed:
            Number(resolved.result.defenderSurvivors || 0) === 0,
          fallback_territory:
            resolved.result.defenderRetreatTo || null,
          created_at: new Date(nowMs).toISOString()
        }
      );
    }
  } else {
    if (defenderCommander) {
      resolved.state = settleCommander(
        resolved.state,
        defenderCommander.id,
        order.action.to
      );
    }

    if (attackerCommander) {
      resolved.state = markCommanderFatePending(
        resolved.state,
        attackerCommander.id,
        {
          battle_territory: order.action.to,
          opponent_house: defenderHouse,
          side: 'ATTACKER',
          army_destroyed:
            Number(resolved.result.attackerSurvivors || 0) === 0,
          fallback_territory:
            Number(resolved.result.attackerSurvivors || 0) > 0
              ? order.action.from
              : null,
          created_at: new Date(nowMs).toISOString()
        }
      );
    }
  }

  return resolved;
}

export function processDueOrders(game, map, constants, nowMs = Date.now()) {
  const next = structuredClone(game);
  const due = next.orders
    .filter(order => order.status === 'PENDING' && Date.parse(order.due_at) <= nowMs)
    .sort((a, b) => {
      const timeDiff = Date.parse(a.due_at) - Date.parse(b.due_at);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

  for (const dueOrder of due) {
    const liveOrder = next.orders.find(order => order.id === dueOrder.id);
    try {
      const journalStart = next.state.journal.length;
      const resolved = resolveOrder(
        next.state,
        map,
        constants,
        next.id,
        liveOrder,
        nowMs
      );
      const errors = validateState(resolved.state, map, constants);
      if (errors.length) throw new Error(`post-order state invalid: ${errors.join('; ')}`);

      next.state = resolved.state;
      liveOrder.status = 'RESOLVED';
      liveOrder.resolved_at = new Date(nowMs).toISOString();
      liveOrder.result = resolved.result;
      liveOrder.failure_reason = null;

      for (let i = journalStart; i < next.state.journal.length; i += 1) {
        Object.assign(next.state.journal[i], {
          order_id: liveOrder.id,
          started_at: liveOrder.created_at,
          completed_at: liveOrder.resolved_at,
          planned_duration_ms: liveOrder.duration_ms,
          actual_duration_ms: Math.max(0, nowMs - Date.parse(liveOrder.created_at))
        });
      }
    } catch (error) {
      if (liveOrder.commander_id) {
        next.state = settleCommander(
          next.state,
          liveOrder.commander_id,
          liveOrder.action.from
        );
      }
      liveOrder.status = 'FAILED';
      liveOrder.resolved_at = new Date(nowMs).toISOString();
      liveOrder.failure_reason = error instanceof Error ? error.message : String(error);
      next.state.journal.push({
        kind: 'MARCH_FAILED',
        order_id: liveOrder.id,
        house: liveOrder.action.house,
        from: liveOrder.action.from,
        to: liveOrder.action.to,
        warriors: liveOrder.action.warriors,
        mode: liveOrder.action.mode,
        commander_id: liveOrder.commander_id || null,
        reason: liveOrder.failure_reason,
        started_at: liveOrder.created_at,
        completed_at: liveOrder.resolved_at,
        planned_duration_ms: liveOrder.duration_ms,
        actual_duration_ms: Math.max(0, nowMs - Date.parse(liveOrder.created_at))
      });
    }
  }

  if (due.length) next.updated_at = new Date(nowMs).toISOString();
  return next;
}

export function isSameAction(a, b) {
  return actionKey(a) === actionKey(b);
}
