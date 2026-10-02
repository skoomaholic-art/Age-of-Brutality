export const CHARACTER_MODE = Object.freeze({
  COURT: 'COURT',
  ARMY: 'ARMY',
  CAPTIVE: 'CAPTIVE',
  DEAD: 'DEAD'
});

export const CHARACTER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  FATE_PENDING: 'FATE_PENDING'
});

export const CHARACTER_HEALTH = Object.freeze({
  HEALTHY: 'HEALTHY',
  WEAKENED: 'WEAKENED'
});

function listCatalog(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (Array.isArray(catalog?.characters)) return catalog.characters;
  return [];
}

function cloneStats(stats = {}) {
  return {
    attack: Number(stats.attack || 0),
    defense: Number(stats.defense || 0),
    survival: Number(stats.survival || 0),
    diplomacy: Number(stats.diplomacy || 0),
    intrigue: Number(stats.intrigue || 0),
    stewardship: Number(stats.stewardship || 0)
  };
}

function armyId(characterId) {
  return 'ARM-' + String(characterId);
}

function activeRecord(card, house, role, mode, map) {
  const inArmy = mode === CHARACTER_MODE.ARMY;
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    house,
    role,
    age: 'ADULT',
    alive: true,
    health: CHARACTER_HEALTH.HEALTHY,
    status: CHARACTER_STATUS.ACTIVE,
    mode,
    stats: cloneStats(card.stats),
    special_rule: card.special_rule || '—',
    army_id: inArmy ? armyId(card.id) : null,
    court_exhausted: false,
    fate_pending: null,
    location: inArmy
      ? { kind: 'TERRITORY', territory: map.capitals[house] }
      : { kind: 'COURT', territory: map.capitals[house] }
  };
}

export function createInitialCharacterLayer(catalog, map, constants) {
  const cards = listCatalog(catalog);
  const characters = {};
  const armies = {};

  for (const house of constants.houses) {
    const ruler = cards.find(card =>
      card.house_pool === house &&
      card.type === 'Правитель'
    );
    const heir = cards.find(card =>
      card.house_pool === house &&
      card.type === 'Законный ребёнок' &&
      card.start_status === 'Взрослый наследник'
    );

    if (!ruler) throw new Error('missing ruler card for ' + house);
    if (!heir) throw new Error('missing adult heir card for ' + house);

    const rulerMode = /СТАРТ:\s*АРМИЯ/u.test(String(ruler.special_rule || ''))
      ? CHARACTER_MODE.ARMY
      : CHARACTER_MODE.COURT;

    const rulerState = activeRecord(ruler, house, 'RULER', rulerMode, map);
    const heirState = activeRecord(heir, house, 'HEIR', CHARACTER_MODE.COURT, map);
    characters[rulerState.id] = rulerState;
    characters[heirState.id] = heirState;

    if (rulerMode === CHARACTER_MODE.ARMY) {
      armies[rulerState.army_id] = {
        id: rulerState.army_id,
        house,
        commander_id: rulerState.id,
        territory: map.capitals[house],
        moving_order_id: null,
        from: null,
        to: null
      };
    }
  }

  return {
    characters,
    armies
  };
}

export function normalizeCharacterLayer(state, catalog, map, constants) {
  if (!catalog || !listCatalog(catalog).length) return state;
  const next = structuredClone(state);
  const initial = createInitialCharacterLayer(catalog, map, constants);

  if (!next.characters || typeof next.characters !== 'object') {
    next.characters = initial.characters;
  } else {
    for (const [id, character] of Object.entries(initial.characters)) {
      if (!next.characters[id]) next.characters[id] = character;
    }
  }

  if (!next.armies || typeof next.armies !== 'object') {
    next.armies = initial.armies;
  } else {
    for (const [id, army] of Object.entries(initial.armies)) {
      if (
        !next.armies[id] &&
        next.characters?.[army.commander_id]?.mode === CHARACTER_MODE.ARMY &&
        !next.characters?.[army.commander_id]?.army_id
      ) {
        next.armies[id] = army;
        next.characters[army.commander_id].army_id = id;
      }
    }
  }

  return next;
}

export function charactersForHouse(state, house) {
  return Object.values(state.characters || {})
    .filter(character => character.house === house)
    .sort((a, b) => {
      const roleRank = role => role === 'RULER' ? 0 : role === 'HEIR' ? 1 : 9;
      const diff = roleRank(a.role) - roleRank(b.role);
      return diff || String(a.name).localeCompare(String(b.name), 'ru');
    });
}

export function armyForCharacter(state, characterId) {
  const character = state.characters?.[characterId];
  if (!character?.army_id) return null;
  return state.armies?.[character.army_id] || null;
}

export function commandersAt(state, house, territory) {
  return Object.values(state.armies || {})
    .filter(army =>
      army.house === house &&
      army.territory === territory &&
      !army.moving_order_id
    )
    .map(army => state.characters?.[army.commander_id])
    .filter(character =>
      character &&
      character.alive &&
      character.mode === CHARACTER_MODE.ARMY &&
      character.status === CHARACTER_STATUS.ACTIVE
    );
}

export function commanderAt(state, house, territory) {
  const commanders = commandersAt(state, house, territory);
  return commanders[0] || null;
}

export function commanderStats(character) {
  if (
    !character ||
    !character.alive ||
    character.mode !== CHARACTER_MODE.ARMY ||
    character.status !== CHARACTER_STATUS.ACTIVE ||
    character.health === CHARACTER_HEALTH.WEAKENED
  ) {
    return { attack: 0, defense: 0, survival: 0 };
  }

  return {
    attack: Number(character.stats?.attack || 0),
    defense: Number(character.stats?.defense || 0),
    survival: Number(character.stats?.survival || 0)
  };
}

export function assignCharacterToArmy(state, map, constants, {
  house,
  characterId
}) {
  const next = structuredClone(state);
  const character = next.characters?.[characterId];
  if (!character || character.house !== house) throw new Error('character does not belong to house');
  if (!character.alive) throw new Error('dead character cannot command');
  if (character.age !== 'ADULT') throw new Error('only adult character can command');
  if (character.health !== CHARACTER_HEALTH.HEALTHY) throw new Error('weakened character cannot command');
  if (character.status !== CHARACTER_STATUS.ACTIVE) throw new Error('character is not available');
  if (character.mode !== CHARACTER_MODE.COURT) throw new Error('character is not at court');

  const capital = map.capitals[house];
  const territory = next.territories?.[capital];
  const warriors = Number(territory?.warriors?.[house] || 0);
  if (territory?.owner !== house || warriors < 1) {
    throw new Error('army must be in own capital');
  }

  const activeArmyCharacters = charactersForHouse(next, house)
    .filter(item => item.mode === CHARACTER_MODE.ARMY);
  if (activeArmyCharacters.length >= 2) {
    throw new Error('house already has two army characters');
  }

  if (commandersAt(next, house, capital).length > 0) {
    throw new Error('capital army already has a commander');
  }

  const id = armyId(characterId);
  next.armies[id] = {
    id,
    house,
    commander_id: characterId,
    territory: capital,
    moving_order_id: null,
    from: null,
    to: null
  };
  character.mode = CHARACTER_MODE.ARMY;
  character.army_id = id;
  character.location = { kind: 'TERRITORY', territory: capital };

  next.journal.push({
    kind: 'CHARACTER_ASSIGNED_ARMY',
    house,
    character_id: characterId,
    character_name: character.name,
    territory: capital
  });
  return next;
}

export function returnCharacterToCourt(state, map, {
  house,
  characterId
}) {
  const next = structuredClone(state);
  const character = next.characters?.[characterId];
  if (!character || character.house !== house) throw new Error('character does not belong to house');
  if (character.mode !== CHARACTER_MODE.ARMY) throw new Error('character is not in army');
  if (character.status !== CHARACTER_STATUS.ACTIVE) throw new Error('character is not available');

  const army = armyForCharacter(next, characterId);
  const capital = map.capitals[house];
  if (!army || army.moving_order_id || army.territory !== capital) {
    throw new Error('army must be in own capital to return commander');
  }

  delete next.armies[army.id];
  character.mode = CHARACTER_MODE.COURT;
  character.army_id = null;
  character.location = { kind: 'COURT', territory: capital };

  next.journal.push({
    kind: 'CHARACTER_RETURNED_COURT',
    house,
    character_id: characterId,
    character_name: character.name,
    territory: capital
  });
  return next;
}

export function autoCommanderForMarch(state, action, availableWarriors) {
  const commanders = commandersAt(state, action.house, action.from);
  if (commanders.length !== 1) return null;
  if (Number(action.warriors) !== Number(availableWarriors)) return null;
  return commanders[0];
}

export function beginCommanderMarch(state, characterId, order) {
  if (!characterId) return state;
  const next = structuredClone(state);
  const character = next.characters?.[characterId];
  const army = armyForCharacter(next, characterId);
  if (!character || !army) throw new Error('commander army not found');
  if (army.moving_order_id) throw new Error('commander army is already moving');
  if (army.territory !== order.action.from) throw new Error('commander is not at march origin');

  army.moving_order_id = order.id;
  army.from = order.action.from;
  army.to = order.action.to;
  army.territory = null;
  character.location = { kind: 'ORDER', order_id: order.id };
  return next;
}

export function settleCommander(state, characterId, territory) {
  if (!characterId) return state;
  const next = structuredClone(state);
  const character = next.characters?.[characterId];
  const army = armyForCharacter(next, characterId);
  if (!character || !army) return next;

  army.moving_order_id = null;
  army.from = null;
  army.to = null;
  army.territory = territory;
  character.location = { kind: 'TERRITORY', territory };
  return next;
}

export function markCommanderFatePending(state, characterId, details) {
  if (!characterId) return state;
  const next = structuredClone(state);
  const character = next.characters?.[characterId];
  if (!character) return next;

  character.status = CHARACTER_STATUS.FATE_PENDING;
  character.fate_pending = {
    ...structuredClone(details),
    created_at: details?.created_at || null
  };

  if (character.army_id && next.armies?.[character.army_id]) {
    const army = next.armies[character.army_id];
    army.moving_order_id = null;
    army.from = null;
    army.to = null;
    army.territory = details?.fallback_territory || null;
  }

  character.location = details?.fallback_territory
    ? { kind: 'TERRITORY', territory: details.fallback_territory }
    : { kind: 'FATE_PENDING', territory: details?.battle_territory || null };

  next.journal.push({
    kind: 'COMMANDER_FATE_PENDING',
    character_id: character.id,
    character_name: character.name,
    house: character.house,
    ...structuredClone(details)
  });
  return next;
}

export function validateCharacterLayer(state, map, constants) {
  const errors = [];
  if (!state.characters && !state.armies) return errors;

  const armyCountByHouse = new Map();
  const commanderByArmy = new Set();

  for (const character of Object.values(state.characters || {})) {
    if (!constants.houses.includes(character.house)) {
      errors.push('character ' + character.id + ' has unknown house ' + character.house);
    }

    for (const [key, value] of Object.entries(character.stats || {})) {
      if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 2) {
        errors.push('character ' + character.id + ' has invalid stat ' + key);
      }
    }

    if (character.mode === CHARACTER_MODE.ARMY) {
      if (!character.army_id || !state.armies?.[character.army_id]) {
        errors.push('army character ' + character.id + ' has no army');
      }
      armyCountByHouse.set(
        character.house,
        Number(armyCountByHouse.get(character.house) || 0) + 1
      );
    }
  }

  for (const [house, count] of armyCountByHouse) {
    if (count > 2) errors.push(house + ' exceeds two army characters');
  }

  for (const army of Object.values(state.armies || {})) {
    if (!constants.houses.includes(army.house)) {
      errors.push('army ' + army.id + ' has unknown house');
    }
    if (!state.characters?.[army.commander_id]) {
      errors.push('army ' + army.id + ' has unknown commander');
    }
    if (commanderByArmy.has(army.commander_id)) {
      errors.push('commander ' + army.commander_id + ' assigned to multiple armies');
    }
    commanderByArmy.add(army.commander_id);

    if (army.territory && !state.territories?.[army.territory]) {
      errors.push('army ' + army.id + ' has unknown territory');
    }
  }

  return errors;
}
