import { areAllies, inTruce } from './diplomacy.mjs';
import { neutralResistance } from '../core/neutral.mjs';
import { buildAdjacency } from '../core/map.mjs';
import { aiBridgeChoice, buildBridge } from './bridges.mjs';
import { menToTakeWild, ringGlory } from './heart.mjs';
import { aiHireChoice, hireUnits } from './units.mjs';
import { buildPort } from './levy.mjs';
import { canTake, garrisonToKeep, heartPlan, menToTake, wantsPeace } from './ai-heart.mjs';
import { atHome } from './attrition.mjs';
import { wearAt } from './terrain.mjs';
import { proposeDeal } from './diplomacy.mjs';
import { totalHouseWarriors } from '../core/state.mjs';
import { resolvePendingCapitalHold } from '../core/scoring.mjs';
import { commandersAt } from '../core/characters.mjs';
import { listQueueableMarches } from './orders.mjs';
import { executeCommand } from './commands.mjs';
import {
  ONLINE_ROUND_TIMING,
  advanceRound,
  aiOrderIntervalMs,
  daysMode,
  houseRoundStatus,
  passRound,
  refundFailedRoundActions,
  roundComplete,
  roundsEnabled
} from './rounds.mjs';

// House AI for Houses without a player. It never touches state directly:
// every decision is an ordinary command, validated and executed by the same
// code path a human player uses, so the AI cannot make an illegal move.

const PASS_THRESHOLD = 0.4;
const MAX_AI_REFUNDS_PER_ROUND = 2;

function hash32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function territoryMeta(map, id) {
  return map.territories.find(item => item.id === id) || null;
}

function warriorsOf(state, id, house) {
  return Number(state.territories[id]?.warriors?.[house] || 0);
}

function hasAchievement(state, house, id) {
  return Boolean(state.houses[house]?.achievements?.[id]);
}

// What owning the territory is worth: its income for this House plus a little for the land itself.
function territoryValue(map, constants, house, id) {
  const meta = territoryMeta(map, id);
  const income = constants.economy?.income?.[meta?.type] || {};
  const home = meta?.house_sector === house;
  const gold = Number(home ? income.home_gold : income.foreign_gold) || 0;
  const influence = Number(home ? income.home_influence : income.foreign_influence) || 0;
  const island = meta?.type === 'Половина острова' ? 0.8 : 0;
  return 1 + gold + influence * 1.5 + island;
}

// The online game has no dice (see orders.mjs), so the AI can tell the outcome
// of a fight from the numbers it sees. It does not know about commanders.

// A neutral land falls when the warriors outnumber its resistance.
function capturesNeutral(warriors, resistance) {
  return warriors > resistance;
}

// The larger force wins, ties go to the defender. Losses follow core/combat.mjs
// with both dice fixed at 3.
function battleOutlook(attackers, defenders) {
  const losses = Math.min(attackers, Math.ceil((defenders + 3) / 2));
  return {
    wins: attackers > defenders && attackers - losses > 0,
    losses
  };
}

function garrisonNeeded(state, map, house, from) {
  const commanders = commandersAt(state, house, from).length;
  if (state.heart) return Math.max(garrisonToKeep(state, map, house, from), commanders);
  const meta = territoryMeta(map, from);
  const base = meta?.type === 'Столица' ? 2 : 1;
  return Math.max(base, commanders);
}

// A game of the Heart: one plan, three kinds of move. Strength, not heads.
function heartCandidates(game, map, constants, house) {
  const state = game.state;
  const out = [];
  const legal = listQueueableMarches(game, map, constants, house);
  const pairs = new Map();
  const reach = new Map();
  for (const action of legal) {
    if (!state.territories[action.to] || !state.territories[action.from]) continue;
    const key = `${action.from}>${action.to}`;
    pairs.set(key, Math.max(pairs.get(key) || 0, action.warriors));
    (reach.get(action.from) || reach.set(action.from, new Set()).get(action.from)).add(action.to);
  }
  const plan = heartPlan(game, map, constants, house, from => [...(reach.get(from) || [])]);
  if (!plan) return [];
  const spareAt = id => warriorsOf(state, id, house) - garrisonNeeded(state, map, house, id);
  const command = (from, to, warriors) => ({ type: 'MARCH', house, from, to, warriors });
  // Ground that eats men without a battle: worth stepping off, not worth camping on.
  const wearOf = id => (atHome(map, id, house) ? null : wearAt(map, state, id, house));
  const wearCost = id => Number(wearOf(id)?.rate || 0) * 6;

  // 1. Strike: from the stage onto the next land, with the fewest men that win.
  if (plan.target) {
    const max = Math.min(pairs.get(`${plan.stage}>${plan.target}`) || 0, spareAt(plan.stage));
    const need = max > 0 ? menToTake(state, map, constants, house, plan.stage, plan.target, max) : null;
    if (need) {
      const owner = state.territories[plan.target].owner;
      // Spend a little more than the least so the host survives in strength.
      const warriors = Math.min(max, need + 1);
      const heart = plan.goal.kind === 'HEART' && plan.target === plan.goal.target ? 8 : 0;
      const war = owner && owner !== house && !areAllies(game, house, owner) && !inTruce(game, house, owner) ? -1 : 0;
      if (!(owner && (areAllies(game, house, owner) || inTruce(game, house, owner)))) {
        out.push({ kind: 'STRIKE', value: 6 + heart + war - wearCost(plan.target) * 0.3, command: command(plan.stage, plan.target, warriors) });
      }
    }
  }
  // 2. Muster: spare men from other own lands walk to the stage.
  for (const [key, max] of pairs) {
    const [from, to] = key.split('>');
    if (to !== plan.stage || from === plan.stage) continue;
    const spare = Math.min(spareAt(from), max);
    if (spare < 1) continue;
    // Mustering out of ground that bleeds is worth more; mustering into it, less.
    out.push({
      kind: 'MUSTER',
      value: (plan.goal.kind === 'DEFEND' ? 7 : plan.goal.kind === 'HOLD' ? 5 : 4) + Math.min(2, spare * 0.3) + wearCost(from) - wearCost(to),
      command: command(from, to, spare)
    });
  }
  // 3. Side gains: a free land next door that a land's spare men take on their own.
  for (const [key, max] of pairs) {
    const [from, to] = key.split('>');
    const land = state.territories[to];
    if (land.owner || to === plan.target) continue;
    const spare = Math.min(spareAt(from), max);
    const need = spare > 0 ? menToTake(state, map, constants, house, from, to, spare) : null;
    if (!need) continue;
    const decoy = (state.heart?.revealed || []).includes(to) || state.heart?.known?.[house]?.[to] === 'FALSE';
    if (decoy) continue;
    const unknownHeart = state.heart?.candidates?.includes(to) && to !== plan.goal.target;
    if (unknownHeart) continue;
    const glory = state.wild_taken?.[to] ? 0 : ringGlory(state, to);
    out.push({ kind: 'CAPTURE_NEUTRAL', value: 2 + glory * 0.8 + territoryValue(map, constants, house, to) * 0.3 - wearCost(to) * 0.4, command: command(from, to, Math.min(spare, need + 1)) });
  }
  // 4. Off the bad ground: men standing where the weather eats them, with
  // nothing to do there, walk to the nearest land of their own that is kind.
  for (const [key, max] of pairs) {
    const [from, to] = key.split('>');
    if (from === plan.stage || to === plan.target) continue;
    const leaving = wearOf(from);
    if (!leaving) continue;
    if (state.territories[to]?.owner !== house || wearOf(to)) continue;
    const spare = Math.min(warriorsOf(state, from, house) - 1, max);
    if (spare < 1) continue;
    out.push({ kind: 'OFF_BAD_GROUND', value: 3.2 + wearCost(from), command: command(from, to, spare) });
  }
  return out;
}

function isBorder(state, adjacency, house, id) {
  for (const other of adjacency.get(id) || []) {
    const owner = state.territories[other]?.owner ?? null;
    if (owner !== house) return true;
  }
  return false;
}

function marchCandidates(game, map, constants, house, adjacency) {
  const state = game.state;
  const options = new Map();
  for (const action of listQueueableMarches(game, map, constants, house)) {
    if (!state.territories[action.to] || !state.territories[action.from]) continue;
    const key = `${action.from}>${action.to}`;
    if (!options.has(key)) options.set(key, []);
    options.get(key).push(action.warriors);
  }

  const out = [];
  for (const [key, counts] of options) {
    const [from, to] = key.split('>');
    const spare = warriorsOf(state, from, house) - garrisonNeeded(state, map, house, from);
    const sizes = counts.filter(count => count <= spare).sort((a, b) => a - b);
    if (!sizes.length) continue;

    const owner = state.territories[to].owner ?? null;
    // An ally's land is not a target, nor a land of a House at truce.
    if (owner && owner !== house && areAllies(game, house, owner)) continue;
    if (owner && owner !== house && inTruce(game, house, owner)) continue;
    const worth = territoryValue(map, constants, house, to);
    const command = warriors => ({ type: 'MARCH', house, from, to, warriors });

    // A game of the Heart: the wild guard must be beaten; deeper lands give more glory,
    // and the Heart most of all.
    if (owner === null && state.wild_guards) {
      const guards = Number(state.wild_guards[to] || 0);
      const need = menToTakeWild(guards);
      const warriors = sizes.find(count => count >= need);
      if (!warriors) continue;
      const glory = state.wild_taken?.[to] ? 0 : ringGlory(state, to);
      // A Heart: the true one once known is worth most; a decoy exposed is avoided.
      const heart = state.heart?.territory === to ? 6
        : state.heart?.revealed?.includes(to) ? -20
          : state.heart?.candidates?.includes(to) ? 3 : 0;
      out.push({
        kind: 'CAPTURE_NEUTRAL',
        value: worth + glory * 1.2 + heart - Math.ceil(guards / 2) * 0.5 - warriors * 0.1,
        command: command(warriors)
      });
      continue;
    }

    if (owner === null) {
      let resistance;
      try {
        resistance = neutralResistance(map, constants, to);
      } catch {
        continue;
      }
      // The smallest force that is enough: spare warriors stay home.
      const warriors = sizes.find(count => capturesNeutral(count, resistance));
      if (!warriors) continue;
      const firstCapture = hasAchievement(state, house, 'VP-W1') ? 0 : 4;
      out.push({
        kind: 'CAPTURE_NEUTRAL',
        value: worth + firstCapture - warriors * 0.15,
        command: command(warriors)
      });
      continue;
    }

    if (owner !== house) {
      const defenders = warriorsOf(state, to, owner);
      const warriors = sizes[sizes.length - 1];
      if (defenders === 0) {
        out.push({
          kind: 'OCCUPY_EMPTY',
          value: worth + 2.5,
          command: command(sizes[0])
        });
        continue;
      }
      const outlook = battleOutlook(warriors, defenders);
      if (!outlook.wins) continue;
      const capital = territoryMeta(map, to)?.type === 'Столица' ? 4 : state.heart?.territory === to ? 6 : 0;
      const firstBattle = hasAchievement(state, house, 'VP-W2') ? 0 : 4;
      out.push({
        kind: 'ATTACK',
        value: worth + capital + firstBattle - outlook.losses * 0.7,
        command: command(warriors)
      });
      continue;
    }

    // Own territory: only worth an action to feed a thin border from the interior.
    const targetBorder = isBorder(state, adjacency, house, to);
    const originBorder = isBorder(state, adjacency, house, from);
    if (targetBorder && !originBorder && warriorsOf(state, to, house) < 2 && sizes.length) {
      out.push({
        kind: 'REINFORCE',
        value: 0.9,
        command: command(sizes[Math.min(sizes.length - 1, 1)])
      });
    }
  }
  return out;
}

function recruitCandidates(game, map, constants, house, adjacency) {
  const state = game.state;
  const gold = Number(state.houses[house]?.gold || 0);
  const houseRoom = constants.house_warrior_cap - totalHouseWarriors(state, house);
  // Games with troop kinds hire through hireUnits instead.
  if (state.population || gold < 1 || houseRoom < 1) return [];

  const total = totalHouseWarriors(state, house);
  const out = [];
  for (const meta of map.territories) {
    const territory = state.territories[meta.id];
    if (territory?.owner !== house) continue;
    const here = Object.values(territory.warriors || {})
      .reduce((sum, value) => sum + Number(value || 0), 0);
    const room = constants.territory_warrior_cap - here;
    const warriors = Math.min(3, gold, houseRoom, room);
    if (warriors < 1) continue;

    const capital = meta.type === 'Столица';
    const border = isBorder(state, adjacency, house, meta.id);
    if (!capital && !border) continue;
    // Recruiting matters most while the House is weak; it is worth less per warrior bought.
    const need = total <= 5 ? 3 : total <= 8 ? 1.6 : 0.6;
    out.push({
      kind: 'RECRUIT',
      value: need + warriors * 0.5 + (capital ? 0.3 : 0),
      command: { type: 'RECRUIT', house, territory: meta.id, warriors }
    });
  }
  return out;
}

function fortCandidates(game, map, constants, house, adjacency) {
  const state = game.state;
  const gold = Number(state.houses[house]?.gold || 0);
  const forts = Array.isArray(state.houses[house]?.forts) ? state.houses[house].forts.length : 0;
  if (gold < constants.economy.fort_cost + 3) return [];
  if (forts >= constants.economy.own_fort_cap) return [];

  const out = [];
  for (const meta of map.territories) {
    const territory = state.territories[meta.id];
    if (territory?.owner !== house || territory.fort) continue;
    if (meta.type === 'Столица') continue;
    if (!isBorder(state, adjacency, house, meta.id)) continue;
    out.push({
      kind: 'FORT',
      value: 1.1 + territoryValue(map, constants, house, meta.id) * 0.15,
      command: { type: 'BUILD_FORT', house, territory: meta.id }
    });
  }
  return out;
}

// Returns the candidates the House would consider, best first. Exposed for tests.
export function rankAiCommands(game, map, constants, house, { random = null } = {}) {
  const rng = random || seededRandom(
    `${game.id}:${game.rounds?.number || 0}:${house}:${game.rounds?.actions_used?.[house] || 0}`
  );
  const adjacency = buildAdjacency(map.land_edges);
  const candidates = [
    ...(game.state.heart ? heartCandidates(game, map, constants, house) : marchCandidates(game, map, constants, house, adjacency)),
    ...recruitCandidates(game, map, constants, house, adjacency),
    ...fortCandidates(game, map, constants, house, adjacency)
  ];
  // A little noise so six AI Houses with mirrored starts do not play identically.
  for (const candidate of candidates) candidate.value += rng() * 0.35;
  return candidates.sort(
    (a, b) =>
      b.value - a.value ||
      JSON.stringify(a.command).localeCompare(JSON.stringify(b.command))
  );
}

// Picks and executes one action for the House. Returns the new game and what was done.
export function takeAiAction(game, map, constants, house, { nowMs = Date.now() } = {}) {
  // An AI House whose orders keep failing ends its round instead of retrying forever,
  // so a round can never hang on it.
  const refunds = Number(game.rounds?.refunds?.[house] || 0);
  const ranked = refunds >= MAX_AI_REFUNDS_PER_ROUND
    ? []
    : rankAiCommands(game, map, constants, house);

  // Losing a war: ask for peace (once a day per foe).
  const foe = game.state.heart ? wantsPeace(game, map, house) : null;
  if (foe) {
    try {
      const next = proposeDeal(game, constants, map, house, foe, { give: [{ type: 'PEACE' }] }, { nowMs });
      next.rounds.ai_peace_asked ||= {};
      next.rounds.ai_peace_asked[`${house}>${foe}`] = Number(next.rounds.number || 0);
      return { game: next, decision: { kind: 'PEACE', value: 1, command: { type: 'PEACE', target: foe } } };
    } catch {
      // A letter is already on its way, or peace is not possible now.
    }
  }

  // A game with troop kinds: the House hires when it has a stage to hire at and gold to spare.
  const plan = game.state.heart ? heartPlan(game, map, constants, house) : null;
  const hire = aiHireChoice(game, map, house, plan?.stage || null);
  const bestMarch = ranked.find(c => c.kind === 'STRIKE' || c.kind === 'MUSTER');
  if (hire && !(bestMarch && bestMarch.kind === 'STRIKE')) {
    try {
      return { game: hireUnits(game, map, house, hire.territory, hire.counts, { nowMs }), decision: { kind: 'HIRE', value: 1, command: { type: 'HIRE', ...hire } } };
    } catch {
      // Not now.
    }
  }

  // The goal lies over the sea and the stage has no harbour: build one there.
  if (plan && !plan.target && plan.goal.kind !== 'DEFEND' && plan.goal.kind !== 'HOLD' && map.buildable_ports) {
    try {
      return { game: buildPort(game, map, house, plan.stage, { nowMs }), decision: { kind: 'PORT', value: 1, command: { type: 'PORT', territory: plan.stage } } };
    } catch {
      // No shore, no gold, or the port is already there or on its way.
    }
  }

  // A river in the way: the House builds a bridge from its own bank when it can spare the gold.
  const bridgeKey = aiBridgeChoice(game, house);
  if (bridgeKey && !bestMarch) {
    try {
      return { game: buildBridge(game, map, house, bridgeKey, { nowMs }), decision: { kind: 'BRIDGE', value: 1, command: { type: 'BRIDGE', key: bridgeKey } } };
    } catch {
      // Not now; go on with the usual choices.
    }
  }

  for (const candidate of ranked) {
    if (candidate.value < PASS_THRESHOLD) break;
    try {
      const result = executeCommand(game, map, constants, candidate.command, { nowMs });
      return { game: result.game, decision: candidate };
    } catch {
      // The command looked good but is not legal right now; try the next best one.
    }
  }

  // Nothing worth doing right now. In a game played in days the House simply
  // waits for its next turn to think; in rounds it ends its round.
  return {
    game: daysMode(game) ? game : passRound(game, house, nowMs),
    decision: { kind: 'PASS', value: 0, command: null }
  };
}

function ownWorkPending(game, house) {
  return (
    (game.orders || []).filter(
      order => order.status === 'PENDING' && order.action?.house === house
    ).length +
    (game.jobs || []).filter(job => job.status === 'PENDING' && job.house === house).length
  );
}

// Lets every AI House whose turn timer is due take one action.
export function runAiHouses(game, map, constants, {
  nowMs = Date.now(),
  timing = ONLINE_ROUND_TIMING
} = {}) {
  if (!roundsEnabled(game) || game.rounds.finished) return game;
  if (game.lifecycle?.status !== 'RUNNING') return game;

  const aiHouses = game.rounds.ai_houses || [];
  if (!aiHouses.length) return game;

  // The first House to act rotates each round, as the first player does at the table.
  const offset = (game.rounds.number - 1) % aiHouses.length;
  const order = [...aiHouses.slice(offset), ...aiHouses.slice(0, offset)];

  const days = daysMode(game);
  let next = game;
  for (const house of order) {
    if (houseRoundStatus(next, house).done) continue;
    const dueAt = Date.parse(next.rounds.ai_next_at?.[house] || 0);
    if (dueAt > nowMs) continue;
    // In rounds the House waits for its previous action to resolve, so it decides
    // on the real outcome. In days marches take long, so it may run up to three
    // things at once.
    if (ownWorkPending(next, house) >= (days ? 3 : 1)) continue;

    // Same check a player's command triggers: was a captured capital held until this action?
    const hold = resolvePendingCapitalHold(next.state, map, constants, house);
    if (hold.result) next = { ...structuredClone(next), state: hold.state };

    const acted = takeAiAction(next, map, constants, house, { nowMs });
    next = acted.game;
    next = next === game ? structuredClone(next) : next;
    next.rounds.ai_next_at[house] = new Date(
      nowMs + (days ? aiOrderIntervalMs(next.rounds) : timing.aiActionDelayMs)
    ).toISOString();
    next.updated_at = new Date(nowMs).toISOString();
  }
  return next;
}

// One bookkeeping step for a game played in rounds: give back actions whose
// orders failed, let due AI Houses act, then close the round when it is over.
export function processRounds(game, map, constants, {
  nowMs = Date.now(),
  timing = ONLINE_ROUND_TIMING
} = {}) {
  if (!roundsEnabled(game) || game.rounds.finished) return game;
  if (game.lifecycle?.status !== 'RUNNING') return game;

  let next = refundFailedRoundActions(game, nowMs);
  next = runAiHouses(next, map, constants, { nowMs, timing });
  if (roundComplete(next, nowMs)) {
    next = advanceRound(next, map, constants, { nowMs, timing });
  }
  return next;
}
