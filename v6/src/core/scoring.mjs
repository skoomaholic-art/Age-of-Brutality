export function grantOnce(state, house, achievementId, points) {
  // A game of the Heart counts glory by the Heart alone.
  if (state.heart) return false;
  if (!state.houses[house].achievements) state.houses[house].achievements = {};
  if (state.houses[house].achievements[achievementId]) return false;
  state.houses[house].achievements[achievementId] = true;
  state.houses[house].victory_points += points;
  return true;
}

export function registerForeignCapitalCapture(state, map, constants, attackerHouse, territoryId, formerOwner) {
  if (state.heart) return {immediateVp:0, pending:false};
  if (map.capitals[formerOwner] !== territoryId) return {immediateVp:0, pending:false};
  const immediateVp = grantOnce(state,attackerHouse,'VP-W3A',constants.victory['VP-W3A']) ? constants.victory['VP-W3A'] : 0;
  if (immediateVp > 0) {
    state.houses[attackerHouse].pending_capital_hold = {territoryId, formerOwner};
  }
  return {immediateVp, pending:immediateVp > 0};
}

export function resolvePendingCapitalHold(state, map, constants, house) {
  const next = structuredClone(state);
  const pending = next.houses[house]?.pending_capital_hold || null;
  if (!pending) return {state:next,result:null};

  const stillControls = next.territories[pending.territoryId]?.owner === house;
  const awarded = stillControls && grantOnce(next,house,'VP-W3B',constants.victory['VP-W3B']);
  delete next.houses[house].pending_capital_hold;
  const result = {
    kind:'CAPITAL_HOLD_CHECK',
    house,
    territoryId:pending.territoryId,
    formerOwner:pending.formerOwner,
    stillControls,
    victory_points_awarded:awarded ? constants.victory['VP-W3B'] : 0
  };
  next.journal.push(result);
  return {state:next,result};
}
