// A battle on one land with more than two Houses in it.
//
// On a land there may stand the owner's garrison and the camps of guests
// (right of passage). When an army storms such a land, or when war breaks out
// between Houses camping side by side, everyone there takes a side:
//
//   - the House attacked, its allies, and whoever is already at war with the
//     attacker stand together;
//   - the attacker is joined by his own allies already at war with the
//     attacked House;
//   - the rest stand aside.
//
// No dice: each side's strength is the sum of its men by rank, its lords'
// gifts and a fixed share of fortune; the side holding the walls adds the
// land's defence. A side's losses are shared out by the size of each House's
// host, and in each host the weakest fall first. The defenders hold on a tie.
// If the owner's side is beaten, the land goes to the strongest House left
// standing on the winning side; the owner's men fall back to a land of his
// next door, beaten guests go home.
import { baseDefense, legalDefenderRetreats } from '../core/combat.mjs';
import { grantOnce, registerForeignCapitalCapture } from '../core/scoring.mjs';
import {
  commanderAt,
  commanderStats,
  markCommanderFatePending,
  resolveCommanderFate,
  settleCommander
} from '../core/characters.mjs';
import { areAllies, declareWarInPlace, relationOf, RELATION } from './diplomacy.mjs';
import { arriveRanks, compAt, guestKey, headsLost, MAX_STARS, moveRanks, reconcileRanks, starsAt, strengthOf } from './ranks.mjs';
import { rulerLeadBonus } from './court.mjs';
import { clearHoldAt, holdGuard } from './stance.mjs';
import { fateDice, recoveryMs, settleFate } from './fate.mjs';
import { nearestOwnLand } from './guests.mjs';
import { onLandTaken } from './units.mjs';

const BATTLE_DIE = 3;

function iso(ms) {
  return new Date(ms).toISOString();
}

// Who stands on a land: the owner's garrison and the guests' camps.
export function standingOn(state, land) {
  const out = [];
  const t = state.territories?.[land];
  if (t?.owner && Number(t.warriors?.[t.owner] || 0) > 0) {
    out.push({ house: t.owner, kind: 'GARRISON', heads: Number(t.warriors[t.owner]) });
  }
  for (const [house, n] of Object.entries(state.guests?.[land] || {})) {
    if (Number(n) > 0) out.push({ house, kind: 'GUEST', heads: Number(n) });
  }
  return out;
}

const atWar = (game, a, b) => relationOf(game, a, b) === RELATION.WAR;

// Splits the present Houses into the two sides of a fight between `aggressor` and `target`.
export function meleeSides(game, present, aggressor, target) {
  const attackers = new Set([aggressor]);
  const defenders = new Set([target]);
  for (const { house } of present) {
    if (house === aggressor || house === target) continue;
    if (areAllies(game, house, aggressor)) {
      if (atWar(game, house, target)) attackers.add(house);
      continue;
    }
    if (areAllies(game, house, target) || atWar(game, house, aggressor)) defenders.add(house);
  }
  return { attackers: [...attackers], defenders: [...defenders] };
}

// Does an arriving army meet more than the owner's garrison?
export function joinersAgainst(game, land, attacker) {
  const state = game.state;
  const owner = state.territories?.[land]?.owner;
  if (!owner || owner === attacker) return [];
  const present = standingOn(state, land);
  const { attackers, defenders } = meleeSides(game, present, attacker, owner);
  const here = new Set(present.map(p => p.house));
  return [...attackers, ...defenders].filter(h => h !== attacker && h !== owner && here.has(h));
}

// Whole points of damage shared by the size of each host.
function share(damage, members) {
  const total = members.reduce((sum, m) => sum + m.heads, 0);
  if (!total || damage <= 0) return members.map(() => 0);
  const exact = members.map(m => (damage * m.heads) / total);
  const out = exact.map(Math.floor);
  let left = damage - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}

function memberOf(state, map, land, entry, force) {
  if (force && entry.house === force.house) {
    const commander = force.commanderId ? state.characters?.[force.commanderId] || null : null;
    return { house: force.house, kind: 'MARCH', heads: force.heads, comp: force.ranks, stars: force.stars || 0, commander, from: force.from };
  }
  const key = entry.kind === 'GUEST' ? guestKey(land) : land;
  return { house: entry.house, kind: entry.kind, heads: entry.heads, comp: compAt(state, map, key, entry.house), stars: starsAt(state, key, entry.house), commander: commanderAt(state, entry.house, land) };
}

function sideStrength(members) {
  let strength = BATTLE_DIE;
  let defense = 0;
  for (const m of members) {
    const stats = commanderStats(m.commander);
    strength += strengthOf(m.comp, m.heads, { defending: m.kind === 'GARRISON', stars: m.stars }) + stats.attack + rulerLeadBonus(m.commander);
    defense = Math.max(defense, stats.defense);
  }
  return { strength, defense };
}

function setHeads(state, land, member, heads) {
  if (member.kind === 'GARRISON') {
    const t = state.territories[land];
    if (heads > 0) t.warriors[member.house] = heads;
    else delete t.warriors[member.house];
  } else if (member.kind === 'GUEST') {
    state.guests ||= {};
    state.guests[land] ||= {};
    if (heads > 0) state.guests[land][member.house] = heads;
    else delete state.guests[land][member.house];
    if (!Object.keys(state.guests[land]).length) delete state.guests[land];
  }
}

// Beaten guests leave for the nearest land of their own House, lords and all.
function sendHome(state, map, constants, land, house, nowMs) {
  const count = Number(state.guests?.[land]?.[house] || 0);
  if (count <= 0) return null;
  delete state.guests[land][house];
  if (!Object.keys(state.guests[land]).length) delete state.guests[land];
  const home = nearestOwnLand(state, map, house, land);
  let kept = 0;
  if (home) {
    const t = state.territories[home];
    const room = constants.territory_warrior_cap - Object.values(t.warriors || {}).reduce((s, n) => s + Number(n || 0), 0);
    kept = Math.max(0, Math.min(count, room));
    if (kept > 0) t.warriors[house] = Number(t.warriors[house] || 0) + kept;
    for (const army of Object.values(state.armies || {})) {
      if (army.house === house && army.territory === land && !army.moving_order_id) {
        army.territory = home;
        const commander = state.characters?.[army.commander_id];
        if (commander) commander.location = { kind: 'TERRITORY', territory: home };
      }
    }
  }
  return home;
}

/**
 * Fights it out on `land`. `force` is an army arriving from elsewhere
 * ({ house, heads, ranks, commanderId, from }) or null when the aggressor is
 * already camped there. Mutates and returns `game`; the result is returned too.
 */
export function fightOnLand(game, map, constants, land, aggressor, target, force = null, { nowMs = Date.now() } = {}) {
  let state = game.state;
  const owner = state.territories[land]?.owner ?? null;
  const present = standingOn(state, land);
  if (force && !present.some(p => p.house === force.house)) present.push({ house: force.house, kind: 'MARCH', heads: force.heads });
  const sides = meleeSides(game, present, aggressor, target);
  const here = new Map(present.map(p => [p.house, p]));
  const pick = list => list.filter(h => here.has(h)).map(h => memberOf(state, map, land, here.get(h), force));
  const attackers = pick(sides.attackers);
  const defenders = pick(sides.defenders);

  // Everyone who drew a sword is now at war with the other side.
  for (const a of attackers) for (const d of defenders) {
    declareWarInPlace(game, a.house, d.house, { nowMs, cause: a.house === aggressor && d.house === target ? 'ATTACK' : 'ALLY_DEFENSE' });
  }

  const wallsWith = members => members.some(m => m.kind === 'GARRISON');
  const att = sideStrength(attackers);
  const def = sideStrength(defenders);
  const walls = owner ? baseDefense(map, state, constants, land) : 0;
  // Whoever dug in here stands behind his own ditches as well as the walls.
  const dug = members => members.reduce((most, m) => Math.max(most, holdGuard(state, land, m.house)), 0);
  const attDefense = att.defense + (wallsWith(attackers) ? walls : 0) + dug(attackers);
  const defDefense = def.defense + (wallsWith(defenders) ? walls : 0) + dug(defenders);
  const toDefenders = Math.max(0, Math.ceil(att.strength / 2) - defDefense);
  const toAttackers = Math.max(0, Math.ceil(def.strength / 2) - attDefense);

  const apply = (members, damage) => share(damage, members).forEach((points, i) => {
    const m = members[i];
    m.lost = Math.min(m.heads, headsLost(m.comp, m.heads, points));
    m.survivors = m.heads - m.lost;
  });
  apply(attackers, toAttackers);
  apply(defenders, toDefenders);
  const survivors = members => members.reduce((s, m) => s + m.survivors, 0);
  const attackerWins = att.strength > def.strength && survivors(attackers) > 0;
  const winners = attackerWins ? attackers : defenders;
  const losers = attackerWins ? defenders : attackers;

  for (const m of [...attackers, ...defenders]) if (m.kind !== 'MARCH') setHeads(state, land, m, m.survivors);

  // The owner's side beaten: the land changes hands.
  let captor = null;
  let retreatTo = null;
  let removed = 0;
  const ownerMember = losers.find(m => m.house === owner && m.kind === 'GARRISON') || (owner && losers.some(m => m.house === owner) ? losers.find(m => m.house === owner) : null);
  if (ownerMember && survivors(winners) > 0) {
    const best = [...winners].filter(m => m.survivors > 0)
      .sort((a, b) => (b.house === aggressor) - (a.house === aggressor) || b.survivors - a.survivors || a.house.localeCompare(b.house))[0];
    captor = best.house;
    const t = state.territories[land];
    if (ownerMember.survivors > 0) {
      const legal = legalDefenderRetreats(state, map, owner, land, ownerMember.survivors, constants);
      retreatTo = legal[0] || null;
      if (ownerMember.kind === 'GARRISON') moveRanks(state, map, land, retreatTo, owner, retreatTo ? ownerMember.survivors : 0, { losses: retreatTo ? 0 : ownerMember.survivors });
      delete t.warriors[owner];
      if (retreatTo) state.territories[retreatTo].warriors[owner] = Number(state.territories[retreatTo].warriors[owner] || 0) + ownerMember.survivors;
      else removed = ownerMember.survivors;
    }
    t.owner = captor;
    // The ground changed hands: nobody's ditches here are theirs any more.
    clearHoldAt(state, land);
    if (best.kind === 'MARCH') {
      arriveRanks(state, map, land, captor, best.comp, best.survivors, Math.min(MAX_STARS, (best.stars || 0) + 1));
      t.warriors[captor] = best.survivors;
    }
    else if (best.kind === 'GUEST') {
      setHeads(state, land, best, 0);
      t.warriors[captor] = Number(t.warriors[captor] || 0) + best.survivors;
    }
    grantOnce(state, captor, 'VP-W2', constants.victory['VP-W2']);
    registerForeignCapitalCapture(state, map, constants, captor, land, owner);
  } else if (winners.length && survivors(winners) > 0) {
    grantOnce(state, winners[0].house, 'VP-W2', constants.victory['VP-W2']);
  }

  // An arriving army: on the land if it won, back home if not.
  const marcher = [...attackers, ...defenders].find(m => m.kind === 'MARCH');
  if (marcher && marcher.survivors > 0) {
    if (marcher.house === captor) {
      // Already placed as the new garrison.
    } else if (!attackerWins || !winners.includes(marcher)) {
      const origin = state.territories[marcher.from];
      if (origin) {
        arriveRanks(state, map, marcher.from, marcher.house, marcher.comp, marcher.survivors, marcher.stars);
        origin.warriors[marcher.house] = Number(origin.warriors[marcher.house] || 0) + marcher.survivors;
      }
    } else {
      // Won but the land went to another: it camps there beside its ally.
      state.guests ||= {};
      state.guests[land] ||= {};
      arriveRanks(state, map, guestKey(land), marcher.house, marcher.comp, marcher.survivors, Math.min(MAX_STARS, (marcher.stars || 0) + 1));
      state.guests[land][marcher.house] = Number(state.guests[land][marcher.house] || 0) + marcher.survivors;
    }
  }

  const entry = {
    kind: 'BATTLE',
    melee: true,
    attacker: aggressor,
    defender: target,
    from: force?.from || land,
    to: land,
    houses: [...new Set([...attackers, ...defenders].map(m => m.house))],
    attackers: attackers.map(m => ({ house: m.house, warriors: m.heads, losses: m.lost, survivors: m.survivors })),
    defenders: defenders.map(m => ({ house: m.house, warriors: m.heads, losses: m.lost, survivors: m.survivors })),
    attackerStrength: att.strength,
    defenderStrength: def.strength,
    attackerWins,
    winner: attackerWins ? aggressor : target,
    attackerLosses: attackers.reduce((s, m) => s + m.lost, 0),
    defenderLosses: defenders.reduce((s, m) => s + m.lost, 0),
    attackerSurvivors: survivors(attackers),
    defenderSurvivors: survivors(defenders),
    captured: Boolean(captor),
    captor,
    defenderRetreatTo: retreatTo,
    defenderRemovedForNoRetreat: removed,
    attackerDie: BATTLE_DIE,
    defenderDie: BATTLE_DIE,
    at: iso(nowMs)
  };
  state.journal.push(entry);

  // The lords: the winners stay (an arriving one takes his place on the land),
  // the beaten face their fate and fall back with their men.
  const recovery = recoveryMs(game);
  for (const m of losers) {
    if (!m.commander) continue;
    const fallback = m.kind === 'MARCH' ? (m.survivors > 0 ? m.from : null)
      : m.kind === 'GARRISON' ? (captor ? retreatTo : land)
        : (m.survivors > 0 ? nearestOwnLand(state, map, m.house, land) : null);
    state = markCommanderFatePending(state, m.commander.id, {
      battle_territory: land,
      opponent_house: winners[0]?.house || null,
      side: attackers.includes(m) ? 'ATTACKER' : 'DEFENDER',
      army_destroyed: m.survivors === 0,
      fallback_territory: fallback,
      created_at: iso(nowMs)
    });
    const fate = resolveCommanderFate(state, map, constants, m.commander.id, fateDice(entry, m.commander), { nowMs });
    state = settleFate(fate.state, map, m.commander.id, { nowMs, recovery });
  }
  if (marcher?.commander && winners.includes(marcher) && marcher.survivors > 0) {
    state = settleCommander(state, marcher.commander.id, marcher.house === captor ? land : land);
  }

  // Beaten guests do not stay: they go home.
  for (const m of losers) if (m.kind === 'GUEST' && m.survivors > 0) sendHome(state, map, constants, land, m.house, nowMs);
  reconcileRanks(state, map);
  game.state = state;
  return { game, result: entry };
}

// War broke out between Houses camped on the same land: they fight there.
export function processCampFights(game, map, constants, nowMs = Date.now()) {
  let next = null;
  for (const land of Object.keys(game.state?.guests || {}).sort()) {
    for (let round = 0; round < 6; round += 1) {
      const current = next || game;
      const present = standingOn(current.state, land);
      let pair = null;
      for (let i = 0; i < present.length && !pair; i += 1) {
        for (let j = i + 1; j < present.length && !pair; j += 1) {
          if (atWar(current, present[i].house, present[j].house)) pair = [present[i].house, present[j].house];
        }
      }
      if (!pair) break;
      next ||= structuredClone(game);
      // Who started it: the one who declared the war, else the guest against the owner.
      const declared = [...next.state.journal].reverse().find(e => e.kind === 'WAR_DECLARED' &&
        ((e.aggressor === pair[0] && e.target === pair[1]) || (e.aggressor === pair[1] && e.target === pair[0])));
      const owner = next.state.territories[land]?.owner;
      let aggressor = declared?.aggressor || (pair[0] === owner ? pair[1] : pair[0]);
      const target = aggressor === pair[0] ? pair[1] : pair[0];
      const ownerBefore = next.state.territories[land]?.owner ?? null;
      fightOnLand(next, map, constants, land, aggressor, target, null, { nowMs });
      const ownerAfter = next.state.territories[land]?.owner ?? null;
      if (ownerAfter && ownerAfter !== ownerBefore) onLandTaken(next, map, land, ownerBefore, nowMs);
    }
  }
  if (next) next.updated_at = iso(nowMs);
  return next || game;
}
