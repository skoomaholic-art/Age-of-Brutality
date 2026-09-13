import { buildAdjacency } from './map.mjs';
import { validateMarch, classifyDestination } from './movement.mjs';
import { warriorsAt } from './state.mjs';
import { grantOnce } from './scoring.mjs';

export function clearRetreatStreakForHouse(state, house) {
  const next = structuredClone(state);
  for (const t of Object.values(next.territories)) {
    if (t.retreat_streak) delete t.retreat_streak[house];
  }
  return next;
}

export function voluntaryRetreatLoss(streak) {
  if (!Number.isInteger(streak) || streak < 0) throw new Error('retreat streak must be a non-negative integer');
  if (streak >= 2) throw new Error('third consecutive voluntary retreat is forbidden');
  return streak + 1;
}

export function legalVoluntaryRetreats(state, map, constants, defenderHouse, battleTerritory) {
  const defenders = warriorsAt(state, battleTerritory, defenderHouse);
  const streak = Number(state.territories[battleTerritory]?.retreat_streak?.[defenderHouse] ?? 0);
  if (streak >= 2) return [];
  const loss = voluntaryRetreatLoss(streak);
  const survivors = defenders - loss;
  if (survivors < 1) return [];

  const adj = buildAdjacency(map.land_edges);
  const out = [];
  for (const to of adj.get(battleTerritory) || []) {
    const t = state.territories[to];
    if (t.owner !== defenderHouse) continue;
    const total = Object.values(t.warriors || {}).reduce((a,b)=>a+Number(b||0),0);
    if (total + survivors <= constants.territory_warrior_cap) out.push(to);
  }
  return out;
}

export function resolveVoluntaryRetreat(state, map, constants, action, retreatTo) {
  const errors = validateMarch(state,map,constants,action);
  if (errors.length) throw new Error(errors.join('; '));
  if (classifyDestination(state,action.house,action.to) !== 'ENEMY') throw new Error(`${action.to} is not enemy-controlled`);

  const defenderHouse = state.territories[action.to].owner;
  const defenders = warriorsAt(state,action.to,defenderHouse);
  const streak = Number(state.territories[action.to].retreat_streak?.[defenderHouse] ?? 0);
  const loss = voluntaryRetreatLoss(streak);
  const survivors = defenders - loss;
  if (survivors < 1) throw new Error('voluntary retreat cannot leave zero warriors');
  const legal = legalVoluntaryRetreats(state,map,constants,defenderHouse,action.to);
  if (!legal.includes(retreatTo)) throw new Error(`illegal voluntary retreat destination ${retreatTo}`);

  const next = structuredClone(state);
  const origin = next.territories[action.from];
  const target = next.territories[action.to];
  const destination = next.territories[retreatTo];

  origin.warriors[action.house] -= action.warriors;
  if (origin.warriors[action.house] === 0) delete origin.warriors[action.house];
  delete target.warriors[defenderHouse];
  delete target.retreat_streak[defenderHouse];
  target.owner = action.house;
  target.warriors[action.house] = action.warriors;

  destination.warriors[defenderHouse] = (destination.warriors[defenderHouse] || 0) + survivors;
  destination.retreat_streak[defenderHouse] = Math.max(Number(destination.retreat_streak[defenderHouse] || 0), streak + 1);

  let capitalVp = 0;
  if (map.capitals[defenderHouse] === action.to && grantOnce(next,action.house,'VP-W3A',constants.victory['VP-W3A'])) capitalVp = 1;

  const result = {
    attacker:action.house, defender:defenderHouse, from:action.from, to:action.to,
    retreatTo, streak_before:streak, streak_after:streak+1, retreat_loss:loss,
    defenders_before:defenders, defenders_after:survivors, captured:true,
    battle_occurred:false, capital_capture_vp:capitalVp
  };
  next.journal.push({kind:'VOLUNTARY_RETREAT',...result});
  return {state:next,result};
}
