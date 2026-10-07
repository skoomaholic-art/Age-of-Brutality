import { neutralResistance } from '../core/neutral.mjs';
import { buildAdjacency } from '../core/map.mjs';
import { totalHouseWarriors } from '../core/state.mjs';
import { resolvePendingCapitalHold } from '../core/scoring.mjs';
import { commandersAt } from '../core/characters.mjs';
import { listQueueableMarches } from './orders.mjs';
import { executeCommand } from './commands.mjs';
import {
  ONLINE_ROUND_TIMING,
  advanceRound,
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

// Chance that 2d6 + warriors beats 7 + resistance (strictly greater).
function neutralCaptureChance(warriors, resistance) {
  const needed = 7 + resistance - warriors;
  let wins = 0;
  for (let a = 1; a <= 6; a += 1) {
    for (let b = 1; b <= 6; b += 1) if (a + b > needed) wins += 1;
  }
  return wins / 36;
}

// Exact battle odds over both dice, using the same formula as core/combat.mjs
// without commanders or support. Terrain defense only reduces defender losses,
// so it does not change whether the territory is taken.
function battleOutlook(attackers, defenders) {
  let captures = 0;
  let losses = 0;
  for (let a = 1; a <= 6; a += 1) {
    for (let d = 1; d <= 6; d += 1) {
      const attackStrength = attackers + a;
      const defendStrength = defenders + d;
      const damageToAttacker = Math.min(attackers, Math.ceil(defendStrength / 2));
      const survivors = attackers - damageToAttacker;
      if (attackStrength > defendStrength && survivors > 0) captures += 1;
      losses += damageToAttacker;
    }
  }
  return { chance: captures / 36, expectedLosses: losses / 36 };
}

function garrisonNeeded(state, map, house, from) {
  const meta = territoryMeta(map, from);
  const commanders = commandersAt(state, house, from).length;
  const base = meta?.type === 'Столица' ? 2 : 1;
  return Math.max(base, commanders);
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
    const worth = territoryValue(map, constants, house, to);
    const command = warriors => ({ type: 'MARCH', house, from, to, warriors });

    if (owner === null) {
      let resistance;
      try {
        resistance = neutralResistance(map, constants, to);
      } catch {
        continue;
      }
      // Smallest force that is reliable; otherwise the largest one if it is at least even odds.
      const reliable = sizes.find(count => neutralCaptureChance(count, resistance) >= 0.72);
      const warriors = reliable ?? sizes[sizes.length - 1];
      const chance = neutralCaptureChance(warriors, resistance);
      if (chance < 0.5) continue;
      const firstCapture = hasAchievement(state, house, 'VP-W1') ? 0 : 4;
      out.push({
        kind: 'CAPTURE_NEUTRAL',
        value: chance * (worth + firstCapture) - (1 - chance),
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
      if (outlook.chance < 0.55) continue;
      const capital = territoryMeta(map, to)?.type === 'Столица' ? 4 : 0;
      const firstBattle = hasAchievement(state, house, 'VP-W2') ? 0 : 4;
      out.push({
        kind: 'ATTACK',
        value:
          outlook.chance * (worth + capital + firstBattle) -
          outlook.expectedLosses * 0.7,
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
  if (gold < 1 || houseRoom < 1) return [];

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
    ...marchCandidates(game, map, constants, house, adjacency),
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

  for (const candidate of ranked) {
    if (candidate.value < PASS_THRESHOLD) break;
    try {
      const result = executeCommand(game, map, constants, candidate.command, { nowMs });
      return { game: result.game, decision: candidate };
    } catch {
      // The command looked good but is not legal right now; try the next best one.
    }
  }

  return {
    game: passRound(game, house, nowMs),
    decision: { kind: 'PASS', value: 0, command: null }
  };
}

function ownWorkPending(game, house) {
  return (
    (game.orders || []).some(
      order => order.status === 'PENDING' && order.action?.house === house
    ) ||
    (game.jobs || []).some(job => job.status === 'PENDING' && job.house === house)
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

  let next = game;
  for (const house of order) {
    if (houseRoundStatus(next, house).done) continue;
    const dueAt = Date.parse(next.rounds.ai_next_at?.[house] || 0);
    if (dueAt > nowMs) continue;
    // Wait for the House's previous action to resolve so it decides on the real outcome.
    if (ownWorkPending(next, house)) continue;

    // Same check a player's command triggers: was a captured capital held until this action?
    const hold = resolvePendingCapitalHold(next.state, map, constants, house);
    if (hold.result) next = { ...structuredClone(next), state: hold.state };

    const acted = takeAiAction(next, map, constants, house, { nowMs });
    next = acted.game;
    next.rounds.ai_next_at[house] = new Date(nowMs + timing.aiActionDelayMs).toISOString();
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
