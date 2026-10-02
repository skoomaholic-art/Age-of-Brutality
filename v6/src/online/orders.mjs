import { enumerateMarches } from '../core/legal-actions.mjs';
import { applyFriendlyMarch, classifyDestination, findLegalLandPaths } from '../core/movement.mjs';
import { resolveNeutralCapture } from '../core/neutral.mjs';
import { resolveBattle } from '../core/combat.mjs';
import { resolveEmptyEnemyOccupation } from '../core/occupation.mjs';
import { validateState, warriorsAt } from '../core/state.mjs';
import {
  beginCommanderMarch,
  commanderAt,
  commandersAt,
  commanderStats,
  markCommanderFatePending,
  resolveCommanderFate,
  settleCommander
} from '../core/characters.mjs';
import {
  coreSeaAction,
  createSeaLandingBridge,
  enumerateOnlineSeaMarches,
  findSeaLaneRoute,
  finishSeaLandingBridge,
  isSeaWaypoint,
  onlineWarriorsAt,
  resolveSeaWaypointMove,
  seaRouteMap,
  validateOnlineSeaMarch
} from './sea-navigation.mjs';

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
    action.warriors,
    action.mode === 'SEA' ? (action.path || null) : null
  ]);
}

function assertOnlineLegalAction(action, legalActions) {
  const allowed = new Set(legalActions.map(actionKey));
  if (!allowed.has(actionKey(action))) {
    throw new Error('action was not emitted by ONLINE_LEGAL_ACTIONS');
  }
  return true;
}

function hydrateSeaAction(map, action) {
  if (action.mode !== 'SEA') return structuredClone(action);
  const route = findSeaLaneRoute(map, action.from, action.to);
  if (!route) throw new Error(`no sea-lane route from ${action.from} to ${action.to}`);

  if (Array.isArray(action.path) && action.path.length) {
    const same =
      action.path.length === route.path.length &&
      route.path.every((id, index) => id === action.path[index]);
    if (!same) {
      throw new Error(
        `stored sea path is no longer legal: ${action.path.join(' -> ')}`
      );
    }
  }

  return {
    ...structuredClone(action),
    path: [...route.path],
    sea_segments: route.segments
  };
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

export function enumerateOnlineMarches(state, map, constants, house) {
  const land = enumerateMarches(state, map, constants, house)
    .filter(action => action.mode === 'LAND');
  const sea = enumerateOnlineSeaMarches(state, map, constants, house);
  return [...land, ...sea];
}

export function listQueueableMarches(game, map, constants, house) {
  const legal = enumerateOnlineMarches(game.state, map, constants, house);
  return legal.filter(action => {
    const available = onlineWarriorsAt(game.state, action.from, house);
    const reserved = reservedWarriors(game, house, action.from);
    return action.warriors <= available - reserved;
  });
}

export function travelDurationMs(state, map, constants, action, timing = ONLINE_TIMING) {
  if (action.mode === 'SEA') {
    const route = findSeaLaneRoute(map, action.from, action.to);
    if (!route) throw new Error('no legal sea-lane route for timed order');
    return timing.seaSegmentMs * route.segments;
  }

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
  const hydratedAction = hydrateSeaAction(map, action);
  const legal = listQueueableMarches(
    game,
    map,
    constants,
    hydratedAction.house
  );
  assertOnlineLegalAction(hydratedAction, legal);

  action = hydratedAction;
  let next = structuredClone(game);
  const id = `O${String(next.next_order_id).padStart(6, '0')}`;
  const durationMs = travelDurationMs(next.state, map, constants, action, timing);
  const availableWarriors =
    onlineWarriorsAt(game.state, action.from, action.house) -
    reservedWarriors(game, action.house, action.from);
  const originCommanders = commandersAt(
    game.state,
    action.house,
    action.from
  );
  const requestedCommanderId = action.commander_id
    ? String(action.commander_id)
    : null;
  const commander = requestedCommanderId
    ? originCommanders.find(item => item.id === requestedCommanderId) || null
    : null;

  if (requestedCommanderId && !commander) {
    throw new Error('selected commander is not available at march origin');
  }

  const remainingWarriors = availableWarriors - Number(action.warriors);
  const commandersLeftBehind = originCommanders.filter(
    item => item.id !== requestedCommanderId
  ).length;

  if (remainingWarriors < commandersLeftBehind) {
    throw new Error('march would leave a commander without an army');
  }

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
    planned_duration_ms: durationMs,
    sea_path: action.mode === 'SEA' ? [...(action.path || [])] : null,
    sea_segments: action.mode === 'SEA' ? Number(action.sea_segments || 0) : null
  });
  next.updated_at = new Date(nowMs).toISOString();
  return { game: next, order };
}

function resolveOrder(state, map, constants, gameId, order, nowMs) {
  const action = hydrateSeaAction(map, order.action);
  const legal = enumerateOnlineMarches(
    state,
    map,
    constants,
    action.house
  );
  assertOnlineLegalAction(action, legal);

  if (action.mode === 'SEA' && isSeaWaypoint(map, action.to)) {
    let moved = resolveSeaWaypointMove(
      state,
      map,
      constants,
      action
    );
    moved = settleCommander(
      moved,
      order.commander_id,
      action.to
    );
    return {
      state:moved,
      result:{
        kind:'SEA_WAYPOINT_MARCH',
        waypoint:action.to,
        commander_id:order.commander_id || null
      }
    };
  }

  let resolutionState = state;
  let resolutionMap = map;
  let resolutionAction = action;
  let seaLanding = false;

  if (action.mode === 'SEA' && isSeaWaypoint(map, action.from)) {
    const bridge = createSeaLandingBridge(
      state,
      map,
      action
    );
    if (!bridge) throw new Error('sea landing bridge could not be created');
    resolutionState = bridge.state;
    resolutionMap = bridge.map;
    resolutionAction = coreSeaAction(action);
    seaLanding = true;
  } else if (action.mode === 'SEA') {
    resolutionMap = seaRouteMap(map, action);
    resolutionAction = coreSeaAction(action);
  }

  const finalizeSeaState = resolvedState => (
    seaLanding
      ? finishSeaLandingBridge(state, resolvedState, action)
      : resolvedState
  );

  const destination = classifyDestination(
    resolutionState,
    action.house,
    action.to
  );

  if (destination === 'FRIENDLY') {
    let moved = applyFriendlyMarch(
      resolutionState,
      resolutionMap,
      constants,
      resolutionAction
    );
    moved = finalizeSeaState(moved);
    moved = settleCommander(
      moved,
      order.commander_id,
      action.to
    );
    return {
      state:moved,
      result:{
        kind: action.mode === 'SEA'
          ? 'SEA_LANDING_FRIENDLY'
          : 'FRIENDLY_MARCH',
        commander_id:order.commander_id || null
      }
    };
  }

  if (destination === 'NEUTRAL') {
    const dice = deterministicDice(`${gameId}:${order.id}:neutral`);
    let resolved = resolveNeutralCapture(
      resolutionState,
      resolutionMap,
      constants,
      resolutionAction,
      dice
    );
    resolved.state = finalizeSeaState(resolved.state);
    resolved.state = settleCommander(
      resolved.state,
      order.commander_id,
      resolved.result.success ? action.to : action.from
    );
    resolved.result.commander_id = order.commander_id || null;
    return resolved;
  }

  const defenderHouse = resolutionState.territories[action.to].owner;
  const defenders = warriorsAt(
    resolutionState,
    action.to,
    defenderHouse
  );

  if (defenders === 0) {
    let resolved = resolveEmptyEnemyOccupation(
      resolutionState,
      resolutionMap,
      constants,
      resolutionAction
    );
    resolved.state = finalizeSeaState(resolved.state);
    resolved.state = settleCommander(
      resolved.state,
      order.commander_id,
      action.to
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
    action.to
  );

  const [attackerDie, defenderDie] = deterministicDice(
    `${gameId}:${order.id}:battle`
  );

  let resolved = resolveBattle(
    resolutionState,
    resolutionMap,
    constants,
    resolutionAction,
    {
      attackerDie,
      defenderDie,
      attackerCommander:commanderStats(attackerCommander),
      defenderCommander:commanderStats(defenderCommander)
    }
  );

  resolved.state = finalizeSeaState(resolved.state);
  resolved.result.attacker_commander_id = attackerCommander?.id || null;
  resolved.result.defender_commander_id = defenderCommander?.id || null;

  if (resolved.result.attackerWins) {
    resolved.state = settleCommander(
      resolved.state,
      attackerCommander?.id,
      action.to
    );

    if (defenderCommander) {
      resolved.state = markCommanderFatePending(
        resolved.state,
        defenderCommander.id,
        {
          battle_territory:action.to,
          opponent_house:action.house,
          side:'DEFENDER',
          army_destroyed:
            Number(resolved.result.defenderSurvivors || 0) === 0,
          fallback_territory:
            resolved.result.defenderRetreatTo || null,
          created_at:new Date(nowMs).toISOString()
        }
      );
      const fateDice = deterministicDice(
        `${gameId}:${order.id}:fate:${defenderCommander.id}`
      );
      const fate = resolveCommanderFate(
        resolved.state,
        map,
        constants,
        defenderCommander.id,
        fateDice,
        {nowMs}
      );
      resolved.state = fate.state;
      resolved.result.defender_commander_fate = fate.result;
    }
  } else {
    if (defenderCommander) {
      resolved.state = settleCommander(
        resolved.state,
        defenderCommander.id,
        action.to
      );
    }

    if (attackerCommander) {
      resolved.state = markCommanderFatePending(
        resolved.state,
        attackerCommander.id,
        {
          battle_territory:action.to,
          opponent_house:defenderHouse,
          side:'ATTACKER',
          army_destroyed:
            Number(resolved.result.attackerSurvivors || 0) === 0,
          fallback_territory:
            Number(resolved.result.attackerSurvivors || 0) > 0
              ? action.from
              : null,
          created_at:new Date(nowMs).toISOString()
        }
      );
      const fateDice = deterministicDice(
        `${gameId}:${order.id}:fate:${attackerCommander.id}`
      );
      const fate = resolveCommanderFate(
        resolved.state,
        map,
        constants,
        attackerCommander.id,
        fateDice,
        {nowMs}
      );
      resolved.state = fate.state;
      resolved.result.attacker_commander_fate = fate.result;
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
