import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { buildGameStats } from '../src/online/stats.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('game stats aggregate current resources and event counters', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1000 });
  game.audit_log = [
    {
      type:'MARCH_QUEUED',
      details:{house:'Варкайр'}
    },
    {
      type:'NEUTRAL_CAPTURE',
      details:{house:'Варкайр', success:true}
    },
    {
      type:'RECRUIT_COMPLETE',
      details:{house:'Варкайр', warriors:3}
    },
    {
      type:'FORT_COMPLETE',
      details:{house:'Варкайр'}
    },
    {
      type:'BATTLE',
      details:{
        attacker:'Варкайр',
        defender:'Сайрвен',
        winner:'Варкайр',
        captured:true
      }
    }
  ];
  game.session_metrics = {
    started_at:'1970-01-01T00:00:01.000Z',
    first_action_at:'1970-01-01T00:00:02.000Z',
    last_action_at:'1970-01-01T00:00:05.000Z',
    actions_total:2,
    actions_by_house:{Варкайр:2}
  };

  const stats = buildGameStats(game, map, constants, 6000);
  assert.equal(stats.houses['Варкайр'].gold, 8);
  assert.equal(stats.houses['Варкайр'].warriors, 4);
  assert.equal(stats.houses['Варкайр'].marches, 1);
  assert.equal(stats.houses['Варкайр'].neutral_captures, 1);
  assert.equal(stats.houses['Варкайр'].warriors_recruited, 3);
  assert.equal(stats.houses['Варкайр'].forts_built, 1);
  assert.equal(stats.houses['Варкайр'].battles, 1);
  assert.equal(stats.houses['Варкайр'].battle_wins, 1);
  assert.equal(stats.houses['Варкайр'].enemy_captures, 1);
  assert.equal(stats.houses['Сайрвен'].battle_losses, 1);
  assert.equal(stats.houses['Варкайр'].actions, 2);
});
