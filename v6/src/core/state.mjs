export function createInitialState(map, constants) {
  const houses = {};
  const territories = {};

  for (const house of constants.houses) {
    houses[house] = {
      gold: constants.start_gold,
      influence: constants.start_influence,
      victory_points: 0,
      actions_used: 0,
      intrigue_hand: [],
      forts: [],
      achievements: {},
      pending_capital_hold: null
    };
  }

  for (const t of map.territories) {
    territories[t.id] = {
      owner: null,
      warriors: {},
      fort: false,
      retreat_streak: {}
    };
  }

  for (const house of constants.houses) {
    const capital = map.capitals[house];
    territories[capital].owner = house;
    territories[capital].warriors[house] = constants.start_warriors;
  }

  return {
    version: constants.version,
    round: 1,
    cycle: 1,
    phase: 'ACTIONS',
    first_player_index: 0,
    current_house_index: 0,
    houses,
    territories,
    passage_rights: [],
    journal: []
  };
}

export function warriorsAt(state, territoryId, house) {
  return Number(state.territories[territoryId]?.warriors?.[house] ?? 0);
}

export function totalHouseWarriors(state, house) {
  return Object.values(state.territories).reduce((sum, t) => sum + Number(t.warriors?.[house] ?? 0), 0);
}

export function repairForeignWarriors(state) {
  const next = structuredClone(state);
  const repairs = [];

  for (const [territoryId, territory] of Object.entries(next.territories || {})) {
    for (const [house, count] of Object.entries(territory.warriors || {})) {
      const n = Number(count || 0);
      if (n > 0 && territory.owner !== house) {
        repairs.push({
          territory: territoryId,
          owner: territory.owner ?? null,
          removed_house: house,
          removed_warriors: n
        });
        delete territory.warriors[house];
      } else if (n === 0) {
        delete territory.warriors[house];
      }
    }
  }

  return { state: next, repairs };
}

export function validateState(state, map, constants) {
  const errors = [];
  const mapIds = new Set(map.territories.map(t => t.id));

  for (const id of Object.keys(state.territories)) {
    if (!mapIds.has(id)) errors.push(`state has unknown territory ${id}`);
  }

  for (const house of constants.houses) {
    if (!state.houses[house]) errors.push(`missing house state ${house}`);
    const total = totalHouseWarriors(state, house);
    if (total > constants.house_warrior_cap) errors.push(`${house} exceeds warrior cap: ${total}`);
  }

  for (const [id, t] of Object.entries(state.territories)) {
    const total = Object.values(t.warriors || {}).reduce((a,b) => a + Number(b || 0), 0);
    if (total > constants.territory_warrior_cap) errors.push(`${id} exceeds territory warrior cap: ${total}`);
    for (const [house, count] of Object.entries(t.warriors || {})) {
      if (!constants.houses.includes(house)) errors.push(`${id} contains unknown house ${house}`);
      if (!Number.isInteger(count) || count < 0) errors.push(`${id}/${house} has invalid warrior count ${count}`);
      if (Number(count) > 0 && t.owner !== house) {
        errors.push(`${id} has ${count} foreign warriors of ${house} while owner is ${t.owner}`);
      }
    }
  }

  if (state.round < 1 || state.round > constants.rounds) errors.push(`invalid round ${state.round}`);
  if (state.cycle < 1 || state.cycle > constants.actions_per_round) errors.push(`invalid action cycle ${state.cycle}`);
  return errors;
}
