import { createInitialCharacterLayer, validateCharacterLayer } from './characters.mjs';
export function createInitialState(map, constants, characterCatalog = null) {
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

  const state = {
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

  if (characterCatalog) {
    Object.assign(
      state,
      createInitialCharacterLayer(characterCatalog, map, constants)
    );
  }

  return state;
}

export function warriorsAt(state, territoryId, house) {
  return Number(state.territories[territoryId]?.warriors?.[house] ?? 0);
}

export function totalHouseWarriors(state, house) {
  const land = Object.values(state.territories || {})
    .reduce((sum, t) => sum + Number(t.warriors?.[house] ?? 0), 0);
  const sea = Object.values(state.sea_nodes || {})
    .reduce((sum, node) => sum + Number(node.warriors?.[house] ?? 0), 0);
  return land + sea;
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

  const seaWaypointIds = new Set(Object.keys(map.sea_waypoints || {}));
  for (const [id, node] of Object.entries(state.sea_nodes || {})) {
    if (!seaWaypointIds.has(id)) errors.push(`state has unknown sea node ${id}`);

    const entries = Object.entries(node.warriors || {})
      .filter(([,count]) => Number(count || 0) > 0);
    const total = entries.reduce((sum,[,count]) => sum + Number(count || 0), 0);

    if (total > constants.territory_warrior_cap) {
      errors.push(`${id} exceeds sea waypoint warrior cap: ${total}`);
    }
    if (entries.length > 1) {
      errors.push(`${id} contains armies from multiple houses`);
    }

    for (const [house, count] of entries) {
      if (!constants.houses.includes(house)) {
        errors.push(`${id} contains unknown house ${house}`);
      }
      if (!Number.isInteger(count) || count < 0) {
        errors.push(`${id}/${house} has invalid warrior count ${count}`);
      }
      if (node.owner !== house) {
        errors.push(`${id} has ${count} warriors of ${house} while sea owner is ${node.owner}`);
      }
    }

    if (!entries.length && node.owner !== null) {
      errors.push(`${id} has owner ${node.owner} but no warriors`);
    }
  }
  if (state.round < 1 || state.round > constants.rounds) errors.push(`invalid round ${state.round}`);
  if (state.cycle < 1 || state.cycle > constants.actions_per_round) errors.push(`invalid action cycle ${state.cycle}`);
  errors.push(...validateCharacterLayer(state, map, constants));
  return errors;
}
