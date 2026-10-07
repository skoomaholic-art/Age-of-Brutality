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
import { declareWarInPlace } from './diplomacy.mjs';
import {
  finishSeaLandingBridge,
  isSeaWaypoint
} from './sea-navigation.mjs';
import {
  findOnlineRoute,
  listReachableOnlineRoutes,
  onlinePositionOwner,
  onlinePositionWarriors
} from './route-planner.mjs';

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
    action.path || null
  ]);
}

function assertOnlineLegalAction(action, legalActions) {
  const allowed = new Set(legalActions.map(actionKey));
  if (!allowed.has(actionKey(action))) {
    throw new Error('action was not emitted by ONLINE_LEGAL_ACTIONS');
  }
  return true;
}

function hydrateOnlineRoute(state,map,constants,action,timing=ONLINE_TIMING) {
  const route=findOnlineRoute(
    state,
    map,
    constants,
    action.house,
    action.from,
    action.to,
    timing
  );
  if(!route) {
    throw new Error(`no legal route from ${action.from} to ${action.to}`);
  }

  if(Array.isArray(action.path) && action.path.length) {
    const same=
      action.path.length===route.path.length &&
      route.path.every((id,index)=>id===action.path[index]);
    if(!same) {
      throw new Error(
        `stored route is no longer legal: ${action.path.join(' -> ')}`
      );
    }
  }

  return {
    ...structuredClone(action),
    mode:route.mode,
    path:[...route.path],
    route_segments:route.segments.map(segment=>({...segment})),
    route_hops:route.hops,
    route_duration_ms:route.duration_ms
  };
}

// The online game has no dice: numbers and facts decide.
//
// The core rules still take dice, so the online layer feeds them fixed values
// that stand for an average throw:
// - a neutral land falls when the warriors outnumber its resistance
//   (2d6 fixed at 7, so `7 + warriors > 7 + resistance`);
// - in a battle both sides get the same 3, so the larger force wins, ties go
//   to the defender, and losses stay at the level of the dice rules.
const NEUTRAL_DICE = Object.freeze([3, 4]);
const BATTLE_DIE = 3;

// A beaten commander's Fate depends on how heavy the defeat was instead of a
// throw: an even fight counts as a 9, and every point of strength the loser was
// short takes one off. The core then applies survival and the usual thresholds
// (10 saved, 7 weakened, 5 captured, below that dead).
function fateDiceForDefeat(result) {
  const margin = Math.abs(
    Number(result.attackerStrength || 0) - Number(result.defenderStrength || 0)
  );
  const total = Math.max(2, Math.min(12, 9 - margin));
  const first = Math.max(1, Math.min(6, Math.floor(total / 2)));
  return [first, total - first];
}

// Marches take a share of the game day (see rounds.mjs); 1 in older games.
export function timeScale(game) {
  const scale = Number(game?.clock?.time_scale);
  return scale > 0 ? scale : 1;
}

function scaleRoute(action, scale) {
  if (scale === 1) return action;
  return {
    ...action,
    route_duration_ms: Math.round(Number(action.route_duration_ms || 0) * scale),
    route_segments: (action.route_segments || []).map(segment => ({
      ...segment,
      duration_ms: Math.round(Number(segment.duration_ms || 0) * scale)
    }))
  };
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

function destinationCapacityAllows(state,map,constants,house,route,warriors) {
  const to=route.to;
  const owner=onlinePositionOwner(state,to);
  if(owner!==house) return true;

  const current=onlinePositionWarriors(state,to,house);
  return current+warriors<=constants.territory_warrior_cap;
}

export function enumerateOnlineMarches(
  state,
  map,
  constants,
  house,
  timing=ONLINE_TIMING
) {
  const origins=[];

  for(const [id,territory] of Object.entries(state.territories || {})) {
    if(
      territory.owner===house &&
      onlinePositionWarriors(state,id,house)>0
    ) origins.push(id);
  }

  for(const id of Object.keys(map.sea_waypoints || {})) {
    if(
      onlinePositionOwner(state,id)===house &&
      onlinePositionWarriors(state,id,house)>0
    ) origins.push(id);
  }

  const actions=[];
  for(const from of origins) {
    const count=onlinePositionWarriors(state,from,house);
    const routes=listReachableOnlineRoutes(
      state,map,constants,house,from,timing
    );

    for(const route of routes) {
      for(let warriors=1;warriors<=count;warriors+=1) {
        if(!destinationCapacityAllows(
          state,map,constants,house,route,warriors
        )) continue;

        actions.push({
          type:'MARCH',
          mode:route.mode,
          house,
          from,
          to:route.to,
          warriors,
          path:[...route.path],
          route_segments:route.segments.map(segment=>({...segment})),
          route_hops:route.hops,
          route_duration_ms:route.duration_ms
        });
      }
    }
  }
  return actions;
}

export function listQueueableMarches(game,map,constants,house) {
  const legal=enumerateOnlineMarches(
    game.state,map,constants,house,ONLINE_TIMING
  );

  const scale=timeScale(game);
  return legal.filter(action => {
    const available=onlinePositionWarriors(
      game.state,action.from,house
    );
    const reserved=reservedWarriors(
      game,house,action.from
    );
    return action.warriors<=available-reserved;
  }).map(action => scaleRoute(action,scale));
}

export function travelDurationMs(
  state,
  map,
  constants,
  action,
  timing=ONLINE_TIMING
) {
  const route=findOnlineRoute(
    state,map,constants,action.house,action.from,action.to,timing
  );
  if(!route) throw new Error('no legal route for timed order');
  return route.duration_ms;
}

export function queueTimedOrder(
  game,
  map,
  constants,
  action,
  { nowMs = Date.now(), timing = ONLINE_TIMING } = {}
) {
  const hydratedAction = hydrateOnlineRoute(
    game.state,map,constants,action,timing
  );
  const legal = listQueueableMarches(
    game,
    map,
    constants,
    hydratedAction.house
  );
  assertOnlineLegalAction(hydratedAction, legal);

  const scale = timeScale(game);
  action = scaleRoute(hydratedAction, scale);
  let next = structuredClone(game);
  const id = `O${String(next.next_order_id).padStart(6, '0')}`;
  const durationMs = Math.round(
    travelDurationMs(next.state, map, constants, action, timing) * scale
  );
  const availableWarriors =
    onlinePositionWarriors(game.state, action.from, action.house) -
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
    route_path: [...(action.path || [])],
    route_hops: Number(action.route_hops || 0),
    route_segments: structuredClone(action.route_segments || []),
    route_duration_ms: Number(action.route_duration_ms || durationMs)
  });
  next.updated_at = new Date(nowMs).toISOString();
  return { game: next, order };
}

function removeFromOnlineOrigin(next,action) {
  const source=next.territories?.[action.from] ||
    next.sea_nodes?.[action.from];
  if(!source) throw new Error(`unknown route origin ${action.from}`);

  source.warriors[action.house]=
    Number(source.warriors?.[action.house] || 0)-action.warriors;
  if(source.warriors[action.house]<=0) {
    delete source.warriors[action.house];
  }

  if(next.sea_nodes?.[action.from]) {
    const houses=Object.keys(source.warriors || {})
      .filter(h=>Number(source.warriors[h] || 0)>0);
    source.owner=houses.length===1 ? houses[0] : null;
  }
}

function moveToSeaWaypoint(state,map,constants,action) {
  const next=structuredClone(state);
  removeFromOnlineOrigin(next,action);

  const target=next.sea_nodes?.[action.to];
  if(!target || !isSeaWaypoint(map,action.to)) {
    throw new Error('route destination is not a sea waypoint');
  }
  if(target.owner && target.owner!==action.house) {
    throw new Error(
      `sea waypoint ${action.to} is occupied by ${target.owner}; sea combat is not implemented`
    );
  }

  const current=Number(target.warriors?.[action.house] || 0);
  if(current+action.warriors>constants.territory_warrior_cap) {
    throw new Error(
      `sea waypoint ${action.to} would exceed warrior cap ${constants.territory_warrior_cap}`
    );
  }

  target.owner=action.house;
  target.warriors[action.house]=current+action.warriors;
  next.journal.push({
    kind:'ROUTE_MARCH',
    house:action.house,
    from:action.from,
    to:action.to,
    warriors:action.warriors,
    route_path:[...(action.path || [])],
    destination:'SEA_WAYPOINT'
  });
  return next;
}

function routeResolutionBridge(state,map,action) {
  const bridgedState=structuredClone(state);
  const bridgedMap=structuredClone(map);
  let syntheticOrigin=false;

  if(isSeaWaypoint(map,action.from)) {
    const sea=bridgedState.sea_nodes?.[action.from];
    if(!sea) throw new Error('missing sea origin state');

    bridgedState.territories[action.from]={
      owner:action.house,
      warriors:{
        [action.house]:Number(sea.warriors?.[action.house] || 0)
      },
      fort:false
    };
    bridgedMap.territories.push({
      id:action.from,
      name:action.from,
      house_sector:'Море',
      type:'Половина острова',
      gold_income:0,
      is_central_half:false,
      island:null,
      island_bonus:null,
      icon:''
    });
    syntheticOrigin=true;
  }

  bridgedMap.land_edges=[
    ...(bridgedMap.land_edges || []),
    [action.from,action.to]
  ];

  return {
    state:bridgedState,
    map:bridgedMap,
    action:{
      type:'MARCH',
      mode:'LAND',
      house:action.house,
      from:action.from,
      to:action.to,
      warriors:action.warriors,
      path:[action.from,action.to]
    },
    syntheticOrigin
  };
}

function finishRouteBridge(originalState,resolvedState,action,syntheticOrigin) {
  if(!syntheticOrigin) return resolvedState;

  const next=structuredClone(resolvedState);
  const synthetic=next.territories[action.from];
  const remaining=Number(synthetic?.warriors?.[action.house] || 0);

  delete next.territories[action.from];
  next.sea_nodes ||= {};
  next.sea_nodes[action.from] ||= {owner:null,warriors:{}};
  next.sea_nodes[action.from].warriors=remaining>0
    ? {[action.house]:remaining}
    : {};
  next.sea_nodes[action.from].owner=remaining>0
    ? action.house
    : null;
  return next;
}

function resolveOrder(state,map,constants,gameId,order,nowMs) {
  const action=hydrateOnlineRoute(
    state,map,constants,order.action,ONLINE_TIMING
  );
  const legal=enumerateOnlineMarches(
    state,map,constants,action.house,ONLINE_TIMING
  );
  assertOnlineLegalAction(action,legal);

  if(isSeaWaypoint(map,action.to)) {
    let moved=moveToSeaWaypoint(
      state,map,constants,action
    );
    moved=settleCommander(
      moved,order.commander_id,action.to
    );
    return {
      state:moved,
      result:{
        kind:'SEA_WAYPOINT_MARCH',
        route_path:[...action.path],
        commander_id:order.commander_id || null
      }
    };
  }

  const bridge=routeResolutionBridge(
    state,map,action
  );
  const resolutionState=bridge.state;
  const resolutionMap=bridge.map;
  const resolutionAction=bridge.action;

  const finalize=resolvedState =>
    finishRouteBridge(
      state,resolvedState,action,bridge.syntheticOrigin
    );

  const destination=classifyDestination(
    resolutionState,action.house,action.to
  );

  if(destination==='FRIENDLY') {
    let moved=applyFriendlyMarch(
      resolutionState,resolutionMap,constants,resolutionAction
    );
    moved=finalize(moved);
    moved=settleCommander(
      moved,order.commander_id,action.to
    );
    return {
      state:moved,
      result:{
        kind:'ROUTE_FRIENDLY_MARCH',
        route_path:[...action.path],
        commander_id:order.commander_id || null
      }
    };
  }

  if(destination==='NEUTRAL') {
    const dice=[...NEUTRAL_DICE];
    let resolved=resolveNeutralCapture(
      resolutionState,
      resolutionMap,
      constants,
      resolutionAction,
      dice
    );
    resolved.state=finalize(resolved.state);
    resolved.state=settleCommander(
      resolved.state,
      order.commander_id,
      resolved.result.success ? action.to : action.from
    );
    resolved.result.route_path=[...action.path];
    resolved.result.commander_id=order.commander_id || null;
    return resolved;
  }

  const defenderHouse=resolutionState.territories[action.to].owner;
  const defenders=warriorsAt(
    resolutionState,action.to,defenderHouse
  );

  if(defenders===0) {
    let resolved=resolveEmptyEnemyOccupation(
      resolutionState,
      resolutionMap,
      constants,
      resolutionAction
    );
    resolved.state=finalize(resolved.state);
    resolved.state=settleCommander(
      resolved.state,order.commander_id,action.to
    );
    resolved.result.route_path=[...action.path];
    resolved.result.commander_id=order.commander_id || null;
    return resolved;
  }

  const attackerCommander=order.commander_id
    ? state.characters?.[order.commander_id] || null
    : null;
  const defenderCommander=commanderAt(
    state,defenderHouse,action.to
  );

  const attackerDie=BATTLE_DIE;
  const defenderDie=BATTLE_DIE;

  let resolved=resolveBattle(
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

  resolved.state=finalize(resolved.state);
  resolved.result.route_path=[...action.path];
  resolved.result.attacker_commander_id=attackerCommander?.id || null;
  resolved.result.defender_commander_id=defenderCommander?.id || null;

  if(resolved.result.attackerWins) {
    resolved.state=settleCommander(
      resolved.state,attackerCommander?.id,action.to
    );

    if(defenderCommander) {
      resolved.state=markCommanderFatePending(
        resolved.state,
        defenderCommander.id,
        {
          battle_territory:action.to,
          opponent_house:action.house,
          side:'DEFENDER',
          army_destroyed:
            Number(resolved.result.defenderSurvivors || 0)===0,
          fallback_territory:
            resolved.result.defenderRetreatTo || null,
          created_at:new Date(nowMs).toISOString()
        }
      );
      const fateDice=fateDiceForDefeat(resolved.result);
      const fate=resolveCommanderFate(
        resolved.state,map,constants,defenderCommander.id,
        fateDice,{nowMs}
      );
      resolved.state=fate.state;
      resolved.result.defender_commander_fate=fate.result;
    }
  } else {
    if(defenderCommander) {
      resolved.state=settleCommander(
        resolved.state,defenderCommander.id,action.to
      );
    }

    if(attackerCommander) {
      resolved.state=markCommanderFatePending(
        resolved.state,
        attackerCommander.id,
        {
          battle_territory:action.to,
          opponent_house:defenderHouse,
          side:'ATTACKER',
          army_destroyed:
            Number(resolved.result.attackerSurvivors || 0)===0,
          fallback_territory:
            Number(resolved.result.attackerSurvivors || 0)>0
              ? action.from
              : null,
          created_at:new Date(nowMs).toISOString()
        }
      );
      const fateDice=fateDiceForDefeat(resolved.result);
      const fate=resolveCommanderFate(
        resolved.state,map,constants,attackerCommander.id,
        fateDice,{nowMs}
      );
      resolved.state=fate.state;
      resolved.result.attacker_commander_fate=fate.result;
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

      // Taking up arms against a House's land is war (and treachery, if it was an ally).
      const journalEnd = next.state.journal.length;
      for (let i = journalStart; i < journalEnd; i += 1) {
        const entry = next.state.journal[i];
        if (entry.kind === 'BATTLE' || entry.kind === 'EMPTY_ENEMY_OCCUPATION') {
          declareWarInPlace(next, entry.attacker, entry.defender, { nowMs, cause: 'ATTACK' });
        }
      }

      for (let i = journalStart; i < journalEnd; i += 1) {
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
