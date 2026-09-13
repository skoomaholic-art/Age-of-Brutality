import { buildAdjacency } from './map.mjs';
import { validateMarch, classifyDestination } from './movement.mjs';
import { warriorsAt } from './state.mjs';
import { grantOnce } from './scoring.mjs';

function d6(x, label) {
  if (!Number.isInteger(x) || x < 1 || x > 6) throw new Error(`${label} must be d6 1..6`);
  return x;
}

function stat(x, label) {
  const n = Number(x ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 2) throw new Error(`${label} must be 0..2`);
  return n;
}

function temporary(x, label) {
  const n = Number(x ?? 0);
  if (!Number.isInteger(n)) throw new Error(`${label} must be integer`);
  return n;
}

export function baseDefense(map, state, constants, territoryId) {
  const t = map.territories.find(x => x.id === territoryId);
  if (!t) throw new Error(`unknown territory ${territoryId}`);
  return Math.max(constants.combat.base_defense[t.type] ?? 0, state.territories[territoryId]?.fort ? constants.combat.fort_defense : 0);
}

export function validateSupport(state, map, sideHouse, supportFrom, battleTerritory, attackerOrigin = null) {
  if (!supportFrom) return 0;
  if (supportFrom === attackerOrigin) throw new Error('attacker origin cannot support its own attacking group');
  if (state.territories[supportFrom]?.owner !== sideHouse) throw new Error(`${supportFrom} is not controlled by ${sideHouse}`);
  if (warriorsAt(state, supportFrom, sideHouse) < 1) throw new Error(`${supportFrom} has no supporting warrior`);
  const adj = buildAdjacency(map.land_edges);
  if (!adj.get(supportFrom)?.has(battleTerritory)) throw new Error(`${supportFrom} is not land-adjacent to ${battleTerritory}`);
  return 1;
}

export function legalDefenderRetreats(state, map, defenderHouse, battleTerritory, survivors, constants) {
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

export function resolveBattle(state, map, constants, action, options = {}) {
  const errors = validateMarch(state, map, constants, action);
  if (errors.length) throw new Error(errors.join('; '));
  if (classifyDestination(state, action.house, action.to) !== 'ENEMY') throw new Error(`${action.to} is not enemy-controlled`);

  const defenderHouse = state.territories[action.to].owner;
  const defenderWarriors = warriorsAt(state, action.to, defenderHouse);
  if (defenderWarriors < 1) throw new Error('battle requires at least one defending warrior');

  const attackerDie = d6(options.attackerDie, 'attackerDie');
  const defenderDie = d6(options.defenderDie, 'defenderDie');
  const ac = options.attackerCommander || {};
  const dc = options.defenderCommander || {};
  const attackerAttack = stat(ac.attack, 'attacker commander attack');
  const attackerDefense = stat(ac.defense, 'attacker commander defense');
  const defenderAttack = stat(dc.attack, 'defender commander attack');
  const defenderCommanderDefense = stat(dc.defense, 'defender commander defense');
  const attackerSupport = validateSupport(state,map,action.house,options.attackerSupportFrom,action.to,action.from);
  const defenderSupport = validateSupport(state,map,defenderHouse,options.defenderSupportFrom,action.to,null);
  const attackerTempStrength = temporary(options.attackerStrengthModifier,'attackerStrengthModifier');
  const defenderTempStrength = temporary(options.defenderStrengthModifier,'defenderStrengthModifier');
  const attackerTempDefense = temporary(options.attackerDefenseModifier,'attackerDefenseModifier');
  const defenderTempDefense = temporary(options.defenderDefenseModifier,'defenderDefenseModifier');

  const attackerStrength = action.warriors + attackerDie + attackerAttack + attackerSupport + attackerTempStrength;
  const defenderStrength = defenderWarriors + defenderDie + defenderAttack + defenderSupport + defenderTempStrength;
  const defenderDefense = baseDefense(map,state,constants,action.to) + defenderCommanderDefense + defenderTempDefense;
  const attackerDefenseValue = attackerDefense + attackerTempDefense;
  const damageToDefender = Math.max(0, Math.ceil(attackerStrength/2) - defenderDefense);
  const damageToAttacker = Math.max(0, Math.ceil(defenderStrength/2) - attackerDefenseValue);
  const attackerLosses = Math.min(action.warriors, damageToAttacker);
  const defenderLosses = Math.min(defenderWarriors, damageToDefender);
  const attackerSurvivors = action.warriors - attackerLosses;
  const defenderSurvivors = defenderWarriors - defenderLosses;
  const attackerWins = attackerStrength > defenderStrength;

  const next = structuredClone(state);
  const origin = next.territories[action.from];
  const target = next.territories[action.to];
  origin.warriors[action.house] -= action.warriors;
  if (origin.warriors[action.house] === 0) delete origin.warriors[action.house];
  delete target.warriors[defenderHouse];

  let defenderRetreatTo = null;
  let defenderRemovedForNoRetreat = 0;
  let captured = false;
  let battleVpHouse = null;
  let capitalVp = 0;

  if (attackerWins && attackerSurvivors > 0) {
    captured = true;
    target.owner = action.house;
    target.warriors[action.house] = attackerSurvivors;
    if (defenderSurvivors > 0) {
      const legal = legalDefenderRetreats(state,map,defenderHouse,action.to,defenderSurvivors,constants);
      if (options.defenderRetreatTo && !legal.includes(options.defenderRetreatTo)) throw new Error(`illegal defender retreat to ${options.defenderRetreatTo}`);
      defenderRetreatTo = options.defenderRetreatTo || legal[0] || null;
      if (defenderRetreatTo) {
        const rt = next.territories[defenderRetreatTo];
        rt.warriors[defenderHouse] = (rt.warriors[defenderHouse] || 0) + defenderSurvivors;
      } else {
        defenderRemovedForNoRetreat = defenderSurvivors;
      }
    }
    if (grantOnce(next, action.house, 'VP-W2', constants.victory['VP-W2'])) battleVpHouse = action.house;
    if (map.capitals[defenderHouse] === action.to && grantOnce(next, action.house, 'VP-W3A', constants.victory['VP-W3A'])) capitalVp = 1;
  } else {
    if (attackerSurvivors > 0) origin.warriors[action.house] = (origin.warriors[action.house] || 0) + attackerSurvivors;
    if (defenderSurvivors > 0) target.warriors[defenderHouse] = defenderSurvivors;
    target.owner = defenderHouse;
    if (grantOnce(next, defenderHouse, 'VP-W2', constants.victory['VP-W2'])) battleVpHouse = defenderHouse;
  }

  if (attackerSurvivors === 0 && defenderSurvivors === 0) target.owner = defenderHouse;

  const result = {
    attacker:action.house, defender:defenderHouse, from:action.from, to:action.to,
    attackerStrength, defenderStrength, attackerWins, attackerLosses, defenderLosses,
    attackerSurvivors, defenderSurvivors, defenderDefense, attackerDefense:attackerDefenseValue,
    damageToDefender, damageToAttacker, captured, defenderRetreatTo, defenderRemovedForNoRetreat,
    battle_vp_awarded_to:battleVpHouse, capital_capture_vp:capitalVp
  };
  next.journal.push({kind:'BATTLE', ...result, attackerDie, defenderDie, attackerSupport, defenderSupport});
  return {state:next, result};
}
