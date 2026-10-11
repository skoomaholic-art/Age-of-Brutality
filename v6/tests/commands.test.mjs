import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../src/core/map.mjs';
import { createOnlineGame } from '../src/online/store.mjs';
import {
  COMMAND_TYPE,
  executeCommand,
  normalizeCommand
} from '../src/online/commands.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));

test('normalize unified commands', () => {
  assert.deepEqual(normalizeCommand({
    type: 'march',
    house: 'Варкайр',
    from: 'W01',
    to: 'W06',
    warriors: 4
  }), {
    type: COMMAND_TYPE.MARCH,
    house: 'Варкайр',
    mode: 'LAND',
    from: 'W01',
    to: 'W06',
    warriors: 4
  });

  assert.equal(normalizeCommand({
    type: 'build_fort',
    house: 'Варкайр',
    territory: 'W02'
  }).type, COMMAND_TYPE.BUILD_FORT);
});

test('unified command engine queues a march', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1000 });
  const result = executeCommand(game, map, constants, {
    type: 'MARCH',
    house: 'Варкайр',
    from: 'W01',
    to: 'W06',
    warriors: 4
  }, { nowMs: 2000 });

  assert.equal(result.response.command_type, 'MARCH');
  assert.equal(result.response.order.status, 'PENDING');
  assert.equal(result.game.orders.length, 1);
});

test('the old way of hiring is gone: only the six kinds remain', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1000 });
  assert.throws(() => executeCommand(game, map, constants, {
    type: 'RECRUIT',
    house: 'Варкайр',
    territory: 'W01',
    warriors: 2
  }, { nowMs: 2000 }), /RECRUIT/);
});

test('unified command engine raises a fort', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1000 });
  // The House starts with its capital alone; a fort needs some other land of its own.
  const land = Object.keys(game.state.territories)
    .find(id => !game.state.territories[id].owner && id !== map.capitals['Варкайр']);
  game.state.territories[land].owner = 'Варкайр';
  game.state.territories[land].warriors = { 'Варкайр': 1 };
  const result = executeCommand(game, map, constants, {
    type: 'BUILD_FORT',
    house: 'Варкайр',
    territory: land
  }, { nowMs: 2000 });

  assert.equal(result.response.command_type, 'BUILD_FORT');
  assert.equal(result.response.job.type, 'FORT');
});

test('unsupported command is rejected before mutation', () => {
  const game = createOnlineGame(map, constants, { nowMs: 1000 });
  assert.throws(() => executeCommand(game, map, constants, {
    type: 'NUCLEAR_OPTION',
    house: 'Варкайр'
  }), /unsupported command type/);
});
