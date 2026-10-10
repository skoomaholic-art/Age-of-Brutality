import { totalHouseWarriors } from './state.mjs';
import { landKind, richesAt } from '../online/settlements.mjs';

export function calculateHouseIncome(state, map, constants, house) {
  if (!constants.houses.includes(house)) throw new Error(`unknown house ${house}`);
  let gold = 0;
  let influence = 0;

  for (const territory of map.territories) {
    if (state.territories[territory.id]?.owner !== house) continue;
    const income = constants.economy?.income?.[landKind(state, map, territory.id)];
    if (!income) continue;
    const home = territory.house_sector === house;
    gold += Number(home ? income.home_gold : income.foreign_gold) || 0;
    influence += Number(home ? income.home_influence : income.foreign_influence) || 0;
    // What the ground itself holds pays whoever holds the ground.
    gold += Number(richesAt(state, territory.id)?.gold || 0);
  }

  for (const [island, halves] of Object.entries(map.islands || {})) {
    if (!halves.every(id => state.territories[id]?.owner === house)) continue;
    const bonus = map.island_bonus?.[island] || [0, 0];
    gold += Number(bonus[0] || 0);
    influence += Number(bonus[1] || 0);
  }

  return { gold, influence };
}

export function applyIncomePulse(state, map, constants) {
  const next = structuredClone(state);
  const gains = {};

  for (const house of constants.houses) {
    const gain = calculateHouseIncome(next, map, constants, house);
    next.houses[house].gold += gain.gold;
    next.houses[house].influence += gain.influence;
    gains[house] = gain;
  }

  next.journal.push({ kind: 'INCOME', gains });
  return { state: next, gains };
}

export function validateRecruit(state, constants, house, territoryId, warriors) {
  const errors = [];
  if (!constants.houses.includes(house)) errors.push(`unknown house ${house}`);
  const territory = state.territories[territoryId];
  if (!territory) errors.push(`unknown territory ${territoryId}`);
  if (errors.length) return errors;

  if (territory.owner !== house) errors.push(`${house} does not control ${territoryId}`);
  if (!Number.isInteger(warriors) || warriors < 1 || warriors > 3) {
    errors.push('recruit must add 1..3 warriors');
  }

  const cost = Number.isInteger(warriors) ? warriors : 0;
  if (state.houses[house].gold < cost) errors.push('not enough gold');

  const houseTotal = totalHouseWarriors(state, house);
  if (houseTotal + cost > constants.house_warrior_cap) {
    errors.push(`house warrior cap ${constants.house_warrior_cap} exceeded`);
  }

  const territoryTotal = Object.values(territory.warriors || {})
    .reduce((sum, count) => sum + Number(count || 0), 0);
  if (territoryTotal + cost > constants.territory_warrior_cap) {
    errors.push(`territory warrior cap ${constants.territory_warrior_cap} exceeded`);
  }

  return errors;
}

export function applyRecruit(state, constants, house, territoryId, warriors) {
  const errors = validateRecruit(state, constants, house, territoryId, warriors);
  if (errors.length) throw new Error(errors.join('; '));

  const next = structuredClone(state);
  next.houses[house].gold -= warriors;
  next.territories[territoryId].warriors[house] =
    (next.territories[territoryId].warriors[house] || 0) + warriors;
  next.journal.push({
    kind: 'RECRUIT',
    house,
    territory: territoryId,
    warriors,
    gold_spent: warriors
  });
  return next;
}

export function validateFort(state, map, constants, house, territoryId) {
  const errors = [];
  if (!constants.houses.includes(house)) errors.push(`unknown house ${house}`);
  const territoryState = state.territories[territoryId];
  const territory = map.territories.find(item => item.id === territoryId);
  if (!territoryState || !territory) errors.push(`unknown territory ${territoryId}`);
  if (errors.length) return errors;

  if (territoryState.owner !== house) errors.push(`${house} does not control ${territoryId}`);
  if (territory.type === 'Столица') errors.push('fort cannot be built in a capital');
  if (territoryState.fort) errors.push('territory already has a fort');

  const ownForts = Array.isArray(state.houses[house].forts) ? state.houses[house].forts.length : 0;
  if (ownForts >= constants.economy.own_fort_cap) errors.push('no own fort tokens available');
  if (state.houses[house].gold < constants.economy.fort_cost) errors.push('not enough gold');

  return errors;
}

export function applyFort(state, map, constants, house, territoryId) {
  const errors = validateFort(state, map, constants, house, territoryId);
  if (errors.length) throw new Error(errors.join('; '));

  const next = structuredClone(state);
  next.houses[house].gold -= constants.economy.fort_cost;
  next.territories[territoryId].fort = true;
  if (!Array.isArray(next.houses[house].forts)) next.houses[house].forts = [];
  next.houses[house].forts.push(territoryId);
  next.journal.push({
    kind: 'FORT_BUILT',
    house,
    territory: territoryId,
    gold_spent: constants.economy.fort_cost
  });
  return next;
}
