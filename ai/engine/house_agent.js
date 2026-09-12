"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "config", "canonical_v5.7.2.json");

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function roundPolicy(config, round) {
  const key = String(Math.max(1, Math.min(6, Math.trunc(finite(round, 1)))));
  return config.canonical_round_escalation[key] || { pvp_bonus: 0, late_neutral_penalty: 0 };
}

function relationCap(config, houseId) {
  return config.canonical_diplomacy.official_relation_soft_cap_by_house?.[houseId]
    ?? config.canonical_diplomacy.official_relation_soft_cap_default;
}

function sumExternalComponents(components = {}) {
  const out = [];
  let total = 0;
  for (const [name, raw] of Object.entries(components || {})) {
    const value = finite(raw, 0);
    if (value === 0) continue;
    total += value;
    out.push({ source: `external:${name}`, value });
  }
  return { total, out };
}

/**
 * Contract for action.target facts:
 * ownership: "neutral" | "enemy" | "self"
 * income, resistance, defenders: numbers
 * recaptureHome, recaptureCapital, completesIsland, firstCenterHalf,
 * isMainlandPort, isEnemyCapital: booleans
 *
 * This module never makes an illegal move legal. The caller must supply
 * legalActions after Rules/Arena validation.
 */
function scoreAction(config, houseId, context, action) {
  const contributions = [];
  let score = finite(action.baseScore, 0);
  if (score !== 0) contributions.push({ source: "action.baseScore", value: score });

  const ext = sumExternalComponents(action.scoreComponents);
  score += ext.total;
  contributions.push(...ext.out);

  const target = action.target || {};
  const weights = config.canonical_target_scoring;
  const escalation = roundPolicy(config, context.round);

  if (target.ownership === "neutral") {
    score += weights.neutral_base;
    contributions.push({ source: "AI_ROUTE_NEUTRAL:base", value: weights.neutral_base });

    const income = finite(target.income, 0);
    if (income) {
      score += income;
      contributions.push({ source: "AI_ROUTE_NEUTRAL:income", value: income });
    }

    const resistance = finite(target.resistance, 0);
    if (resistance) {
      score -= resistance;
      contributions.push({ source: "AI_ROUTE_NEUTRAL:resistance", value: -resistance });
    }

    if (escalation.late_neutral_penalty) {
      score -= escalation.late_neutral_penalty;
      contributions.push({ source: "AI_ROUND:late_neutral_penalty", value: -escalation.late_neutral_penalty });
    }
  }

  if (target.ownership === "enemy") {
    score += weights.enemy_base;
    contributions.push({ source: "AI_ROUTE_ENEMY:base", value: weights.enemy_base });

    const income = finite(target.income, 0);
    if (income) {
      score += income;
      contributions.push({ source: "AI_ROUTE_ENEMY:income", value: income });
    }

    if (escalation.pvp_bonus) {
      score += escalation.pvp_bonus;
      contributions.push({ source: "AI_ROUND:pvp_bonus", value: escalation.pvp_bonus });
    }
  }

  // Implementation guard: capital recapture uses the specific +12 bonus rather
  // than stacking +6 home and +12 capital. The current repository does not
  // preserve the old executable well enough to prove whether +18 was intended.
  if (target.recaptureCapital) {
    score += weights.recapture_capital_bonus;
    contributions.push({ source: "AI_RECAPTURE_CAPITAL", value: weights.recapture_capital_bonus });
  } else if (target.recaptureHome) {
    score += weights.recapture_home_bonus;
    contributions.push({ source: "AI_RECAPTURE_HOME", value: weights.recapture_home_bonus });
  }

  if (target.completesIsland) {
    score += weights.complete_island_bonus;
    contributions.push({ source: "AI_COMPLETE_ISLAND", value: weights.complete_island_bonus });
  } else if (target.firstCenterHalf) {
    score += weights.first_center_half_bonus;
    contributions.push({ source: "AI_FIRST_CENTER_HALF", value: weights.first_center_half_bonus });
  }

  if (target.isMainlandPort) {
    score += weights.mainland_port_bonus;
    contributions.push({ source: "AI_PORT_VALUE", value: weights.mainland_port_bonus });
  }

  if (target.isEnemyCapital) {
    score += weights.enemy_capital_bonus;
    contributions.push({ source: "AI_CAPITAL_ENEMY", value: weights.enemy_capital_bonus });
  }

  const defenders = Math.max(0, Math.trunc(finite(target.defenders, 0)));
  if (defenders) {
    const value = defenders * weights.defended_penalty_per_defender;
    score += value;
    contributions.push({ source: "AI_DEFENDED_PENALTY", value });
  }

  if (action.planId === "PORT_PREPARATION" && action.planMatch) {
    const value = config.canonical_naval_center.port_preparation_weight;
    score += value;
    contributions.push({ source: "AI_PORT_PREP_WEIGHT", value });
  }

  const activePlanMatch = Boolean(
    context.activePlan && action.planId === context.activePlan && action.planMatch !== false
  );

  const diplomacy = action.diplomacy || null;
  const cap = relationCap(config, houseId);
  const activeRelations = Math.max(0, Math.trunc(finite(context.activeOfficialRelations, 0)));
  const relationDelta = diplomacy ? Math.trunc(finite(diplomacy.officialRelationDelta, 0)) : 0;
  const diplomacySoftCapOk = relationDelta <= 0
    || activeRelations + relationDelta <= cap
    || Boolean(action.goalCritical);

  return {
    id: String(action.id),
    type: action.type || "unknown",
    score,
    activePlanMatch,
    diplomacySoftCapOk,
    relationCap: cap,
    contributions,
    action
  };
}

function compareScored(a, b) {
  // Deterministic implementation policy for reproducible playtests.
  if (a.activePlanMatch !== b.activePlanMatch) return a.activePlanMatch ? -1 : 1;
  if (a.diplomacySoftCapOk !== b.diplomacySoftCapOk) return a.diplomacySoftCapOk ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  return a.id.localeCompare(b.id, "ru");
}

class HouseAgent {
  constructor(houseId, options = {}) {
    this.config = options.config || loadConfig(options.configPath);
    assert(this.config.houses.includes(houseId), `Unknown House: ${houseId}`);
    this.houseId = houseId;
  }

  decide(context = {}) {
    const legalActions = Array.isArray(context.legalActions)
      ? context.legalActions.filter(action => action && action.legal !== false && action.id != null)
      : [];

    if (!legalActions.length) {
      return {
        house: this.houseId,
        decision: null,
        reason: "NO_LEGAL_ACTIONS",
        evaluated: [],
        policy: this.config.decision_policy.status
      };
    }

    const evaluated = legalActions.map(action => scoreAction(this.config, this.houseId, context, action));
    evaluated.sort(compareScored);
    const selected = evaluated[0];

    return {
      house: this.houseId,
      decision: selected.action,
      decisionId: selected.id,
      score: selected.score,
      reason: selected.contributions,
      activePlanMatch: selected.activePlanMatch,
      diplomacySoftCapOk: selected.diplomacySoftCapOk,
      relationCap: selected.relationCap,
      evaluated: evaluated.map(item => ({
        id: item.id,
        type: item.type,
        score: item.score,
        activePlanMatch: item.activePlanMatch,
        diplomacySoftCapOk: item.diplomacySoftCapOk,
        contributions: item.contributions
      })),
      policy: this.config.decision_policy.status
    };
  }
}

function createAllHouseAgents(options = {}) {
  const config = options.config || loadConfig(options.configPath);
  return Object.fromEntries(
    config.houses.map(house => [house, new HouseAgent(house, { config })])
  );
}

module.exports = {
  HouseAgent,
  createAllHouseAgents,
  loadConfig,
  relationCap,
  roundPolicy,
  scoreAction
};
