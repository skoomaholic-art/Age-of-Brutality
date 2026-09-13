export function grantOnce(state, house, achievementId, points) {
  if (!state.houses[house].achievements) state.houses[house].achievements = {};
  if (state.houses[house].achievements[achievementId]) return false;
  state.houses[house].achievements[achievementId] = true;
  state.houses[house].victory_points += points;
  return true;
}
