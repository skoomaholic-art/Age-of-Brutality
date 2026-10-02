import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import {
  findOnlineRoute,
  listReachableOnlineRoutes
} from '../src/online/route-planner.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map=loadJson(path.join(root,'src/data/map.v6.json'));
const constants=loadJson(path.join(root,'src/data/constants.v6.json'));
const timing={landSegmentMs:3000,seaSegmentMs:5000};

test('auto route reaches a distant friendly land territory through owned intermediates', () => {
  const game=createOnlineGame(map,constants,{nowMs:1000});
  game.state.territories.W02.owner='Варкайр';
  game.state.territories.W03.owner='Варкайр';

  const route=findOnlineRoute(
    game.state,map,constants,'Варкайр','W01','W03',timing
  );

  assert.ok(route);
  assert.equal(route.path[0],'W01');
  assert.equal(route.path.at(-1),'W03');
  assert.ok(route.hops>=1);
  assert.equal(route.duration_ms,route.hops*3000);
});

test('auto route can mix land and sea and sums segment duration', () => {
  const game=createOnlineGame(map,constants,{nowMs:1000});
  game.state.territories.W02.owner='Варкайр';
  game.state.territories.W03.owner='Варкайр';
  game.state.territories.W04.owner='Варкайр';
  game.state.territories.W05.owner='Варкайр';
  game.state.territories.W06.owner='Варкайр';
  game.state.territories.W07.owner='Варкайр';

  const route=findOnlineRoute(
    game.state,map,constants,'Варкайр','W01','M-WN',timing
  );

  assert.ok(route);
  assert.equal(route.path.at(-1),'M-WN');
  assert.equal(route.mode,'MIXED');
  assert.equal(
    route.duration_ms,
    route.segments.reduce((sum,s)=>sum+s.duration_ms,0)
  );
});

test('neutral or enemy territory cannot be used as an intermediate shortcut', () => {
  const game=createOnlineGame(map,constants,{nowMs:1000});

  const routes=listReachableOnlineRoutes(
    game.state,map,constants,'Варкайр','W01',timing
  );

  const routeToW03=routes.find(route=>route.to==='W03');
  if(routeToW03) {
    assert.equal(
      routeToW03.path.slice(1,-1).some(id =>
        game.state.territories[id] &&
        game.state.territories[id].owner!=='Варкайр'
      ),
      false
    );
  }
});
