// Order in the lands, revolts and what to do with a land just taken
// (games of the Heart, with people).
//
// Every land of a House has its order, from 0 to 100. A land taken from the
// wild folk starts calm (60), a land taken from another House sullen (30).
// Order settles by itself a little every dawn, faster with a garrison in it.
// A land in disorder (below 40) pays only half its gold. A land in deep
// disorder (below 20) with many people and too small a garrison rises at
// dawn: the House loses it to the wild folk, its garrison falls back.
//
// No dice: what happens is known in advance, and the land card says it.
//
// When a House takes a land it chooses what to do with it, as in Total War:
//   MERCY    take it in peace: order up, nothing taken;
//   TRIBUTE  lay a tribute: some gold, some people lost, order unchanged;
//   SACK     sack it: much gold, many people lost, order falls hard.
// A choice not made by the next dawn is MERCY.
import { legalDefenderRetreats } from '../core/combat.mjs';

export const ORDER = Object.freeze({
  fromWild: 60,
  fromHouse: 30,
  capital: 90,
  driftTo: 70,
  driftWithGarrisonTo: 90,
  drift: 5,
  garrisonDrift: 5,
  disorder: 40,
  revolt: 20,
  revoltPeople: 6
});

export const CHOICES = Object.freeze({
  MERCY: { name: 'Взять с миром', order: 25, goldPerPerson: 0, peopleShare: 0 },
  TRIBUTE: { name: 'Обложить данью', order: 0, goldPerPerson: 0.5, peopleShare: 0.1 },
  SACK: { name: 'Разграбить', order: -30, goldPerPerson: 1.5, peopleShare: 0.35 }
});

function iso(ms) {
  return new Date(ms).toISOString();
}

const clampOrder = n => Math.max(0, Math.min(100, Math.round(n)));

export function orderOf(state, id) {
  return state.order?.[id] ?? null;
}

export function seedOrder(game, map) {
  game.state.order = {};
  for (const t of map.territories) {
    if (game.state.territories[t.id]?.owner) game.state.order[t.id] = t.type === 'Столица' ? ORDER.capital : ORDER.driftTo;
  }
  game.state.capture_choices = {};
  return game;
}

// A land changed hands: its order starts low, and the taker may choose its fate.
export function orderOnCapture(state, territory, house, previousOwner, { nowMs = Date.now(), ai = false } = {}) {
  if (!state.order) return;
  state.order[territory] = previousOwner ? ORDER.fromHouse : ORDER.fromWild;
  state.capture_choices ||= {};
  state.capture_choices[territory] = { house, from: previousOwner || null, at: iso(nowMs) };
  // A House led by the AI decides at once.
  if (ai) applyCaptureChoice(state, territory, house, 'TRIBUTE', { nowMs });
}

// What each choice would give, for the dialog.
export function choiceOutcomes(state, territory) {
  const people = Number(state.population?.[territory] || 0);
  const order = Number(state.order?.[territory] ?? ORDER.fromWild);
  return Object.fromEntries(Object.entries(CHOICES).map(([key, c]) => {
    const lost = Math.ceil(people * c.peopleShare);
    return [key, {
      name: c.name,
      gold: Math.floor(people * c.goldPerPerson),
      people_lost: lost,
      order_after: clampOrder(order + c.order),
      risk: revoltRisk(clampOrder(order + c.order), people - lost, 0)
    }];
  }));
}

export function applyCaptureChoice(state, territory, house, choice, { nowMs = Date.now() } = {}) {
  const rule = CHOICES[choice];
  if (!rule) throw new Error('такого решения нет');
  if (state.territories?.[territory]?.owner !== house) throw new Error('эта земля не твоя');
  const pending = state.capture_choices?.[territory];
  if (!pending) throw new Error('судьба этой земли уже решена');
  if (pending.house !== house) throw new Error('решение не за тобой');
  const outcome = choiceOutcomes(state, territory)[choice];
  state.population[territory] = Number(state.population?.[territory] || 0) - outcome.people_lost;
  state.houses[house].gold = Number(state.houses[house].gold || 0) + outcome.gold;
  state.order[territory] = outcome.order_after;
  if (state.capture_choices) delete state.capture_choices[territory];
  state.journal.push({
    kind: 'CAPTURE_CHOICE', house, houses: [house], territory, choice,
    gold: outcome.gold, people_lost: outcome.people_lost, order: outcome.order_after, at: iso(nowMs)
  });
}

// How close a land is to rising: NONE, LOW (disorder), HIGH (it rises at the next dawn).
export function revoltRisk(order, people, garrison) {
  if (order >= ORDER.disorder) return 'NONE';
  if (order < ORDER.revolt && people >= ORDER.revoltPeople && garrison * 2 < people) return 'HIGH';
  return 'LOW';
}

// The garrison that keeps a land in deep disorder from rising.
export function garrisonToHold(people) {
  return Math.floor(people / 2) + 1;
}

function landGold(map, constants, id, owner) {
  const t = map.territories.find(x => x.id === id);
  const income = constants.economy?.income?.[t?.type] || {};
  return Number(t?.house_sector === owner ? income.home_gold : income.foreign_gold) || 0;
}

/**
 * At every dawn, after the income: open choices fall to mercy, lands in
 * disorder give back half their gold, order settles, and lands in deep
 * disorder rise. Mutates `state`; returns the lands that rose.
 */
export function orderDawn(state, map, constants, nowMs = Date.now()) {
  if (!state.order) return [];
  for (const [territory, pending] of Object.entries(state.capture_choices || {})) {
    if (state.territories[territory]?.owner === pending.house) applyCaptureChoice(state, territory, pending.house, 'MERCY', { nowMs });
    else delete state.capture_choices[territory];
  }
  const risen = [];
  for (const [id, land] of Object.entries(state.territories)) {
    const owner = land.owner;
    if (!owner) { delete state.order[id]; continue; }
    const type = map.territories.find(t => t.id === id)?.type;
    let order = state.order[id] ?? ORDER.driftTo;
    // Half the gold of a land in disorder never reaches the treasury.
    if (order < ORDER.disorder) {
      const lost = Math.floor(landGold(map, constants, id, owner) / 2);
      state.houses[owner].gold = Math.max(0, Number(state.houses[owner].gold || 0) - lost);
    }
    const garrison = Number(land.warriors?.[owner] || 0);
    const people = Number(state.population?.[id] || 0);
    if (type !== 'Столица' && revoltRisk(order, people, garrison) === 'HIGH') {
      risen.push(id);
      rise(state, map, constants, id, owner, people, garrison, nowMs);
      continue;
    }
    // Order settles towards calm; a garrison settles it faster and higher.
    const calm = garrison > 0 ? ORDER.driftWithGarrisonTo : ORDER.driftTo;
    if (order < calm) order = Math.min(calm, order + ORDER.drift + (garrison > 0 ? ORDER.garrisonDrift : 0));
    state.order[id] = clampOrder(order);
  }
  return risen;
}

// The people rise: the land goes back to the wild folk.
function rise(state, map, constants, id, owner, people, garrison, nowMs) {
  const land = state.territories[id];
  let retreatTo = null;
  if (garrison > 0) {
    retreatTo = legalDefenderRetreats(state, map, owner, id, garrison, constants)[0] || null;
    if (retreatTo) state.territories[retreatTo].warriors[owner] = Number(state.territories[retreatTo].warriors[owner] || 0) + garrison;
  }
  delete land.warriors[owner];
  land.owner = null;
  delete state.order[id];
  if (state.capture_choices) delete state.capture_choices[id];
  // The rebels hold the land now, as its wild guard.
  if (state.wild_guards) state.wild_guards[id] = Math.max(1, Math.ceil(people / 3));
  state.journal.push({
    kind: 'REVOLT', house: owner, houses: [owner], territory: id, rebels: Math.max(1, Math.ceil(people / 3)),
    garrison, retreat_to: retreatTo, at: iso(nowMs)
  });
}
