import { enumerateMarches, assertLegalAction } from './legal-actions.mjs';
import { classifyDestination, applyFriendlyMarch } from './movement.mjs';
import { resolveNeutralCapture } from './neutral.mjs';
import { resolveBattle } from './combat.mjs';
import { resolveVoluntaryRetreat, clearRetreatStreakForHouse } from './retreat.mjs';
import { resolveEmptyEnemyOccupation } from './occupation.mjs';
import { resolvePendingCapitalHold } from './scoring.mjs';
import { currentHouse, spendActionAndAdvance } from './turns.mjs';
import { validateState, warriorsAt } from './state.mjs';

export function prepareCurrentAction(state, map, constants) {
  if (state.phase !== 'ACTIONS') throw new Error(`actions are not allowed during phase ${state.phase}`);
  const house = currentHouse(state,constants);
  const holdChecked = resolvePendingCapitalHold(state,map,constants,house).state;
  return clearRetreatStreakForHouse(holdChecked,house);
}

export function listLegalMarchActions(state,map,constants) {
  const prepared = prepareCurrentAction(state,map,constants);
  const house = currentHouse(prepared,constants);
  return enumerateMarches(prepared,map,constants,house);
}

export function executeMarchAction(state,map,constants,action,resolution={}) {
  const prepared = prepareCurrentAction(state,map,constants);
  const actingHouse = currentHouse(prepared,constants);
  if (action.house !== actingHouse) throw new Error(`current House is ${actingHouse}, not ${action.house}`);
  const legal = enumerateMarches(prepared,map,constants,actingHouse);
  assertLegalAction(action,legal);

  const destination = classifyDestination(prepared,action.house,action.to);
  let resolved;
  if (destination === 'FRIENDLY') {
    resolved = {state:applyFriendlyMarch(prepared,map,constants,action),result:{kind:'FRIENDLY_MARCH'}};
  } else if (destination === 'NEUTRAL') {
    resolved = resolveNeutralCapture(prepared,map,constants,action,resolution.neutralDice);
  } else {
    const defenderHouse=prepared.territories[action.to].owner;
    const defenders=warriorsAt(prepared,action.to,defenderHouse);
    if (defenders===0) {
      resolved=resolveEmptyEnemyOccupation(prepared,map,constants,action);
    } else if (resolution.voluntaryRetreatTo) {
      resolved = resolveVoluntaryRetreat(prepared,map,constants,action,resolution.voluntaryRetreatTo);
    } else {
      resolved = resolveBattle(prepared,map,constants,action,resolution);
    }
  }

  const stateErrors = validateState(resolved.state,map,constants);
  if (stateErrors.length) throw new Error(`post-action state invalid: ${stateErrors.join('; ')}`);
  const advanced = spendActionAndAdvance(resolved.state,constants,{kind:'ACTION_COMMITTED',action_type:'MARCH',mode:action.mode,from:action.from,to:action.to});
  return {state:advanced,result:resolved.result};
}
