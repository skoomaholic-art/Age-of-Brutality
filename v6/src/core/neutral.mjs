import { validateMarch, classifyDestination } from './movement.mjs';
import { grantOnce } from './scoring.mjs';
import { isWaste, landKind } from '../online/settlements.mjs';

function validDie(x) { return Number.isInteger(x) && x >= 1 && x <= 6; }

export function neutralResistance(map, constants, territoryId, state = null) {
  const t = map.territories.find(x => x.id === territoryId);
  if (!t) throw new Error(`unknown territory ${territoryId}`);
  // Ashes hold nobody: a burnt land is walked into, not stormed.
  if (state && isWaste(state, territoryId)) return 0;
  if (Number.isInteger(t.resistance)) return t.resistance;
  const value = constants.neutral_resistance[state ? landKind(state, map, territoryId) ?? t.type : t.type];
  if (!Number.isInteger(value)) throw new Error(`territory ${territoryId} has no neutral resistance`);
  return value;
}

export function resolveNeutralCapture(state, map, constants, action, dice) {
  const errors = validateMarch(state, map, constants, action);
  if (errors.length) throw new Error(errors.join('; '));
  if (classifyDestination(state, action.house, action.to) !== 'NEUTRAL') throw new Error(`${action.to} is not neutral`);
  if (!Array.isArray(dice) || dice.length !== 2 || !dice.every(validDie)) throw new Error('neutral capture requires two d6 values');

  const resistance = neutralResistance(map, constants, action.to);
  const roll = dice[0] + dice[1];
  const total = roll + action.warriors;
  const target = 7 + resistance;
  const success = total > target;
  const next = structuredClone(state);
  const origin = next.territories[action.from];
  const destination = next.territories[action.to];
  let loss = 0;
  let vp = 0;

  if (success) {
    origin.warriors[action.house] -= action.warriors;
    if (origin.warriors[action.house] === 0) delete origin.warriors[action.house];
    destination.owner = action.house;
    destination.warriors[action.house] = action.warriors;
    if (grantOnce(next, action.house, 'VP-W1', constants.victory['VP-W1'])) vp = 1;
  } else {
    loss = Math.min(1, action.warriors);
    origin.warriors[action.house] -= loss;
    if (origin.warriors[action.house] === 0) delete origin.warriors[action.house];
  }

  next.journal.push({
    kind:'NEUTRAL_CAPTURE', house:action.house, from:action.from, to:action.to,
    warriors:action.warriors, dice:[...dice], roll, resistance, total, target,
    success, loss, victory_points_awarded:vp
  });
  return {state:next, result:{success, loss, roll, resistance, total, target, victory_points_awarded:vp}};
}
