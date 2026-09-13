import { validateMarch, classifyDestination } from './movement.mjs';
import { warriorsAt } from './state.mjs';
import { registerForeignCapitalCapture } from './scoring.mjs';

export function resolveEmptyEnemyOccupation(state,map,constants,action) {
  const errors=validateMarch(state,map,constants,action);
  if (errors.length) throw new Error(errors.join('; '));
  if (classifyDestination(state,action.house,action.to) !== 'ENEMY') throw new Error(`${action.to} is not enemy-controlled`);
  const defenderHouse=state.territories[action.to].owner;
  if (warriorsAt(state,action.to,defenderHouse) !== 0) throw new Error(`${action.to} is not an empty enemy territory`);

  const next=structuredClone(state);
  const origin=next.territories[action.from];
  const target=next.territories[action.to];
  origin.warriors[action.house]-=action.warriors;
  if (origin.warriors[action.house]===0) delete origin.warriors[action.house];
  target.owner=action.house;
  target.warriors[action.house]=action.warriors;
  if (target.retreat_streak) delete target.retreat_streak[defenderHouse];

  const capital=registerForeignCapitalCapture(next,map,constants,action.house,action.to,defenderHouse);
  const result={
    kind:'EMPTY_ENEMY_OCCUPATION', attacker:action.house, defender:defenderHouse,
    from:action.from,to:action.to,warriors:action.warriors,battle_occurred:false,captured:true,
    battle_vp_awarded_to:null,capital_capture_vp:capital.immediateVp
  };
  next.journal.push(result);
  return {state:next,result};
}
