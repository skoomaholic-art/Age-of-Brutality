import { buildAdjacency } from '../core/map.mjs';

export const ROUTE_MODE = Object.freeze({
  LAND:'LAND',
  SEA:'SEA',
  MIXED:'MIXED'
});

export function isSeaWaypoint(map, id) {
  return Boolean(map.sea_waypoints?.[id]);
}

export function onlinePositionOwner(state, id) {
  if (state.territories?.[id]) return state.territories[id].owner ?? null;
  return state.sea_nodes?.[id]?.owner ?? null;
}

// Warriors standing as guests on another House's land (right of passage) are
// kept apart from the land's garrison: state.guests[territory][house].
export function guestWarriors(state, id, house) {
  return Number(state.guests?.[id]?.[house] || 0);
}

export function onlinePositionWarriors(state, id, house) {
  if (state.territories?.[id]) {
    return Number(state.territories[id].warriors?.[house] || 0) + guestWarriors(state, id, house);
  }
  return Number(state.sea_nodes?.[id]?.warriors?.[house] || 0);
}

function edgeKey(a,b) {
  return [String(a),String(b)].sort().join('::');
}

function graph(map, timing) {
  const out = new Map();
  const add = (a,b,mode,durationMs) => {
    if (!out.has(a)) out.set(a,[]);
    if (!out.has(b)) out.set(b,[]);
    out.get(a).push({to:b,mode,duration_ms:durationMs});
    out.get(b).push({to:a,mode,duration_ms:durationMs});
  };

  for (const [a,b] of map.land_edges || []) {
    add(a,b,'LAND',Number(timing.landSegmentMs || 3000));
  }
  for (const [a,b] of map.sea_lane_edges || []) {
    add(a,b,'SEA',Number(timing.seaSegmentMs || 5000));
  }

  for (const edges of out.values()) {
    edges.sort((a,b) =>
      a.duration_ms - b.duration_ms ||
      String(a.to).localeCompare(String(b.to))
    );
  }
  return out;
}

function canPassThrough(state,map,house,node,destination) {
  if (node === destination) return true;

  if (isSeaWaypoint(map,node)) {
    const owner = onlinePositionOwner(state,node);
    return owner === null || owner === house;
  }

  const owner = onlinePositionOwner(state,node);
  // Our own land, or the land of a House that gave us right of passage.
  return owner === house || Boolean(owner && state.passage?.[owner]?.includes(house));
}

function destinationAllowed(state,map,house,to) {
  if (isSeaWaypoint(map,to)) {
    const owner = onlinePositionOwner(state,to);
    return owner === null || owner === house;
  }
  return Boolean(state.territories?.[to]);
}

function routeMode(segments) {
  const modes = new Set(segments.map(segment => segment.mode));
  if (modes.size === 1) return [...modes][0];
  return ROUTE_MODE.MIXED;
}

function reconstruct(previous,from,to) {
  const segments=[];
  let node=to;
  while(node!==from) {
    const step=previous.get(node);
    if(!step) return null;
    segments.push({
      from:step.from,
      to:node,
      mode:step.mode,
      duration_ms:step.duration_ms
    });
    node=step.from;
  }
  segments.reverse();
  return segments;
}

export function findOnlineRoute(
  state,
  map,
  constants,
  house,
  from,
  to,
  timing
) {
  if (!constants.houses.includes(house)) return null;
  if (from === to) return null;

  const g=graph(map,timing);
  if (!g.has(from) || !g.has(to)) return null;
  if (!destinationAllowed(state,map,house,to)) return null;

  const owner=onlinePositionOwner(state,from);
  // A march starts from our own land or fleet, or from a camp of our guests.
  const camped=owner!==house && guestWarriors(state,from,house)>0;
  if ((owner!==house && !camped) || onlinePositionWarriors(state,from,house)<1) return null;

  const dist=new Map([[from,0]]);
  const hops=new Map([[from,0]]);
  const previous=new Map();
  const visited=new Set();

  while(true) {
    let current=null;
    let best=Infinity;
    let bestHops=Infinity;
    for(const [node,value] of dist) {
      if(visited.has(node)) continue;
      const h=hops.get(node) || 0;
      if(
        value<best ||
        (value===best && h<bestHops) ||
        (value===best && h===bestHops && String(node)<String(current))
      ) {
        current=node;
        best=value;
        bestHops=h;
      }
    }

    if(current===null) break;
    if(current===to) break;
    visited.add(current);

    for(const edge of g.get(current) || []) {
      const next=edge.to;
      if(visited.has(next)) continue;
      if(!canPassThrough(state,map,house,next,to)) continue;

      const candidate=best+edge.duration_ms;
      const candidateHops=bestHops+1;
      const known=dist.get(next);
      const knownHops=hops.get(next) ?? Infinity;
      const prev=previous.get(next);

      if(
        known===undefined ||
        candidate<known ||
        (candidate===known && candidateHops<knownHops) ||
        (
          candidate===known &&
          candidateHops===knownHops &&
          String(current)<String(prev?.from || '')
        )
      ) {
        dist.set(next,candidate);
        hops.set(next,candidateHops);
        previous.set(next,{
          from:current,
          mode:edge.mode,
          duration_ms:edge.duration_ms
        });
      }
    }
  }

  if(!dist.has(to)) return null;
  const segments=reconstruct(previous,from,to);
  if(!segments?.length) return null;

  const path=[from,...segments.map(segment=>segment.to)];
  return {
    from,
    to,
    path,
    segments,
    hops:segments.length,
    duration_ms:segments.reduce((sum,segment)=>sum+segment.duration_ms,0),
    mode:routeMode(segments)
  };
}

export function listReachableOnlineRoutes(
  state,
  map,
  constants,
  house,
  from,
  timing
) {
  const nodes=[
    ...Object.keys(state.territories || {}),
    ...Object.keys(map.sea_waypoints || {})
  ];

  const out=[];
  for(const to of nodes) {
    if(to===from) continue;
    const route=findOnlineRoute(
      state,map,constants,house,from,to,timing
    );
    if(route) out.push(route);
  }

  return out.sort((a,b) =>
    a.duration_ms-b.duration_ms ||
    a.hops-b.hops ||
    String(a.to).localeCompare(String(b.to))
  );
}

export function validateStoredRoute(
  state,
  map,
  constants,
  house,
  route,
  timing
) {
  if(!route?.from || !route?.to || !Array.isArray(route.path)) {
    return {valid:false,reason:'route is missing'};
  }

  const current=findOnlineRoute(
    state,map,constants,house,route.from,route.to,timing
  );
  if(!current) return {valid:false,reason:'destination is no longer reachable'};

  const same=
    current.path.length===route.path.length &&
    current.path.every((id,index)=>id===route.path[index]);

  if(!same) {
    return {
      valid:false,
      reason:'stored route is no longer the legal shortest route',
      replacement:current
    };
  }
  return {valid:true,route:current};
}

export function routeEdgeKinds(map) {
  const kinds=new Map();
  for(const [a,b] of map.land_edges || []) kinds.set(edgeKey(a,b),'LAND');
  for(const [a,b] of map.sea_lane_edges || []) kinds.set(edgeKey(a,b),'SEA');
  return kinds;
}
