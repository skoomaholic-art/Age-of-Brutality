// Влияние: чем меряется век.
//
// A House is weighed by how far its word reaches, and its word reaches as far
// as its arms. Влияние is earned by taking ground and by winning in the field:
//
//   +1 — за вольную землю, взятую у вольных людей (один раз за землю);
//   +2 — за землю, отнятую у другого Дома;
//   +1 — за выигранную сечу с ратью другого Дома.
//
// Nothing else gives it and nothing takes it away but an oath broken. On the
// last day of the age the House with the most влияние has won.

export const INFLUENCE = Object.freeze({
  wildLand: 1,
  rivalLand: 2,
  battle: 1
});

export const INFLUENCE_WHY = Object.freeze({
  WILD_LAND: 'вольная земля взята',
  RIVAL_LAND: 'земля отнята у Дома',
  BATTLE: 'сеча выиграна'
});

/**
 * Adds влияние to a House and writes it in the chronicle. Mutates `state`;
 * returns what was added.
 */
export function addInfluence(state, house, amount, why, { territory = null, against = null, nowMs = null } = {}) {
  const gain = Math.floor(Number(amount) || 0);
  if (!house || gain <= 0 || !state?.houses?.[house]) return 0;
  state.houses[house].influence = Number(state.houses[house].influence || 0) + gain;
  state.journal ||= [];
  state.journal.push({
    kind: 'INFLUENCE', house, houses: [house], influence: gain, why,
    reason: INFLUENCE_WHY[why] || why,
    total: state.houses[house].influence,
    ...(territory ? { territory } : {}),
    ...(against ? { against } : {}),
    ...(nowMs ? { at: new Date(nowMs).toISOString() } : {})
  });
  return gain;
}

// Where every House stands, most влияние first.
export function influenceTable(state, houses) {
  return [...(houses || Object.keys(state?.houses || {}))]
    .map(house => ({ house, influence: Number(state?.houses?.[house]?.influence || 0) }))
    .sort((a, b) => b.influence - a.influence || a.house.localeCompare(b.house, 'ru'));
}

// Who is winning right now: everyone level at the top.
export function influenceLeaders(state, houses, { abandoned = {} } = {}) {
  const table = influenceTable(state, houses).filter(item => !abandoned[item.house]);
  if (!table.length) return [];
  const top = table[0].influence;
  return table.filter(item => item.influence === top).map(item => item.house);
}
