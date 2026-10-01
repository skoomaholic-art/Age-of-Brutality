import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import { journalEntryToAudit, syncAuditFromJournal } from '../src/online/audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('audit converts movement into named human-readable route', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1000 });
  const item = journalEntryToAudit({
    kind: 'MARCH_QUEUED',
    house: 'Варкайр',
    from: 'W01',
    to: 'W02',
    warriors: 3,
    mode: 'LAND',
    order_id: 'O1',
    due_at: '1970-01-01T00:00:02.000Z'
  }, map, game);

  assert.match(item.message, /Варкайр/);
  assert.match(item.message, /Торкайр/);
  assert.match(item.message, /Хольмвейн/);
  assert.equal(item.details.warriors, 3);
});

test('audit records battle participants, actual winner and losses', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1000 });
  const item = journalEntryToAudit({
    kind: 'BATTLE',
    attacker: 'Варкайр',
    defender: 'Сайрвен',
    from: 'W01',
    to: 'W08',
    attackerWins: true,
    attackerLosses: 4,
    defenderLosses: 4,
    attackerSurvivors: 0,
    defenderSurvivors: 0,
    captured: false,
    defenderRetreatTo: null,
    defenderRemovedForNoRetreat: 0,
    battle_vp_awarded_to: 'Сайрвен',
    capital_capture_vp: 0,
    attackerStrength: 10,
    defenderStrength: 8,
    attackerDie: 6,
    defenderDie: 4
  }, map, game);

  assert.equal(item.details.winner, 'Сайрвен');
  assert.match(item.message, /Варкайр против Сайрвен/);
  assert.match(item.message, /Победитель: Сайрвен/);
  assert.match(item.message, /Варкайр -4/);
  assert.match(item.message, /Сайрвен -4/);
});

test('sync audit keeps a cursor and does not duplicate journal events', () => {
  let game = createOnlineGame(map, constants, { nowMs: 1000 });
  const emitted = [];
  game = syncAuditFromJournal(game, map, {
    nowMs: 1100,
    emit: item => emitted.push(item)
  });
  assert.equal(game.audit_log.length, 1);
  assert.equal(emitted.length, 1);
  assert.equal(game.audit_log[0].stats.houses['Варкайр'].gold, 8);
  assert.equal(game.audit_log[0].stats.houses['Варкайр'].victory_points, 0);
  assert.equal(game.audit_log[0].stats.houses['Варкайр'].warriors, 4);
  assert.equal(game.audit_log[0].session.actions_total, 0);

  game = syncAuditFromJournal(game, map, {
    nowMs: 1200,
    emit: item => emitted.push(item)
  });
  assert.equal(game.audit_log.length, 1);
  assert.equal(emitted.length, 1);
});


test('audit tracks real action window and resource stats', () => {
  let game = createOnlineGame(map, constants, { nowMs: 10_000 });
  game.state.journal.push({
    kind: 'MARCH_QUEUED',
    house: 'Варкайр',
    from: 'W01',
    to: 'W02',
    warriors: 2,
    mode: 'LAND',
    order_id: 'O1',
    started_at: '1970-01-01T00:00:11.000Z',
    due_at: '1970-01-01T00:00:14.000Z',
    planned_duration_ms: 3000
  });
  game = syncAuditFromJournal(game, map, { nowMs: 11_000 });

  game.state.houses['Варкайр'].gold = 6;
  game.state.journal.push({
    kind: 'RECRUIT_QUEUED',
    job_id: 'J1',
    house: 'Варкайр',
    territory: 'W01',
    warriors: 2,
    gold_spent: 2,
    started_at: '1970-01-01T00:00:15.000Z',
    due_at: '1970-01-01T00:00:19.000Z',
    planned_duration_ms: 4000
  });
  game = syncAuditFromJournal(game, map, { nowMs: 15_000 });

  const last = game.audit_log.at(-1);
  assert.equal(last.session.actions_total, 2);
  assert.equal(last.session.action_span_seconds, 4);
  assert.equal(last.session.actions_by_house['Варкайр'], 2);
  assert.equal(last.stats.houses['Варкайр'].gold, 6);
});
