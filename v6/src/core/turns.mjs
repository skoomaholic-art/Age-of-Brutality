export function currentHouse(state, constants) {
  const order = constants.houses;
  return order[(state.first_player_index + state.current_house_index) % order.length];
}

export function spendActionAndAdvance(state, constants, actionLog = null) {
  const next = structuredClone(state);
  const house = currentHouse(next, constants);
  if (next.houses[house].actions_used >= constants.actions_per_round) {
    throw new Error(`${house} has no actions left this round`);
  }
  next.houses[house].actions_used += 1;
  if (actionLog) next.journal.push({round:next.round, cycle:next.cycle, house, ...actionLog});

  next.current_house_index += 1;
  if (next.current_house_index >= constants.houses.length) {
    next.current_house_index = 0;
    next.cycle += 1;
    if (next.cycle > constants.actions_per_round) {
      next.phase = 'DYNASTY';
      next.cycle = constants.actions_per_round;
    }
  }
  return next;
}

export function beginNextRound(state, constants) {
  if (state.phase !== 'DYNASTY') throw new Error('next round can begin only after Dynasty phase');
  if (state.round >= constants.rounds) return {...structuredClone(state), phase:'FINISHED'};
  const next = structuredClone(state);
  next.round += 1;
  next.phase = 'ACTIONS';
  next.cycle = 1;
  next.current_house_index = 0;
  next.first_player_index = (next.first_player_index + 1) % constants.houses.length;
  for (const h of constants.houses) next.houses[h].actions_used = 0;
  return next;
}
