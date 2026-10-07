import { queueTimedOrder } from './orders.mjs';
import { queueFortJob, queueRecruitJob } from './economy.mjs';
import { assertRoundAction, spendRoundAction } from './rounds.mjs';

export const COMMAND_TYPE = Object.freeze({
  MARCH: 'MARCH',
  RECRUIT: 'RECRUIT',
  BUILD_FORT: 'BUILD_FORT'
});

function requiredString(value, label) {
  const out = String(value || '').trim();
  if (!out) throw new Error(`${label} required`);
  return out;
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be positive integer`);
  return n;
}

export function normalizeCommand(input) {
  const type = requiredString(input?.type, 'command type').toUpperCase();

  if (type === COMMAND_TYPE.MARCH) {
    const command = {
      type,
      house: requiredString(input.house, 'house'),
      mode: String(input.mode || 'LAND').toUpperCase(),
      from: requiredString(input.from, 'from'),
      to: requiredString(input.to, 'to'),
      warriors: positiveInt(input.warriors, 'warriors')
    };

    if (input.commander_id) {
      command.commander_id = requiredString(
        input.commander_id,
        'commander_id'
      );
    }

    return command;
  }

  if (type === COMMAND_TYPE.RECRUIT) {
    return {
      type,
      house: requiredString(input.house, 'house'),
      territory: requiredString(input.territory, 'territory'),
      warriors: positiveInt(input.warriors, 'warriors')
    };
  }

  if (type === COMMAND_TYPE.BUILD_FORT) {
    return {
      type,
      house: requiredString(input.house, 'house'),
      territory: requiredString(input.territory, 'territory')
    };
  }

  throw new Error(`unsupported command type ${type}`);
}

export function commandHouse(command) {
  return command.house;
}

// Every command is one action. In a game played in rounds the House must have
// an action left, and the action is spent only once the command was accepted.
export function executeCommand(game, map, constants, rawCommand, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const command = normalizeCommand(rawCommand);
  assertRoundAction(game, command.house, nowMs);

  const result = queueCommand(game, map, constants, command, { nowMs });
  result.game = spendRoundAction(result.game, command.house, {
    orderId: result.response.order?.id || null,
    jobId: result.response.job?.id || null
  });
  return result;
}

function queueCommand(game, map, constants, command, { nowMs }) {

  if (command.type === COMMAND_TYPE.MARCH) {
    const queued = queueTimedOrder(
      game,
      map,
      constants,
      {
        type: 'MARCH',
        mode: command.mode,
        house: command.house,
        from: command.from,
        to: command.to,
        warriors: command.warriors,
        commander_id: command.commander_id
      },
      { nowMs }
    );

    return {
      game: queued.game,
      command,
      response: {
        command_type: command.type,
        order: queued.order
      }
    };
  }

  if (command.type === COMMAND_TYPE.RECRUIT) {
    const queued = queueRecruitJob(
      game,
      constants,
      {
        house: command.house,
        territory: command.territory,
        warriors: command.warriors
      },
      { nowMs }
    );

    return {
      game: queued.game,
      command,
      response: {
        command_type: command.type,
        job: queued.job
      }
    };
  }

  if (command.type === COMMAND_TYPE.BUILD_FORT) {
    const queued = queueFortJob(
      game,
      map,
      constants,
      {
        house: command.house,
        territory: command.territory
      },
      { nowMs }
    );

    return {
      game: queued.game,
      command,
      response: {
        command_type: command.type,
        job: queued.job
      }
    };
  }

  throw new Error(`unsupported command type ${command.type}`);
}
