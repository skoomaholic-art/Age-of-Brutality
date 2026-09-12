"use strict";

const { loadConfig } = require("./house_agent");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

class PrisonerAgent {
  constructor(houseId, options = {}) {
    this.config = options.config || loadConfig(options.configPath);
    assert(this.config.houses.includes(houseId), `Unknown House: ${houseId}`);
    this.houseId = houseId;
  }

  /**
   * Scores already-legal prisoner options.
   *
   * Numeric prisoner weights are deliberately NOT hard-coded: the canonical
   * prisoner module marks them IMPLEMENTATION_BALANCE_TEST. The adapter or
   * playtest harness supplies scoreComponents. All canonical factors are still
   * logged so odd AI behavior can be audited later.
   */
  decide(input = {}) {
    const available = Array.isArray(input.availableOptions)
      ? input.availableOptions.filter(option => option && option.id && option.legal !== false)
      : [];

    const requiredFactors = this.config.canonical_prisoner_ai.offer_factors;
    const factorScores = Object.fromEntries(
      requiredFactors.map(key => [key, finite(input.factorScores?.[key], 0)])
    );

    if (!available.length) {
      return this._log(input, null, "NO_LEGAL_PRISONER_OPTIONS", factorScores);
    }

    const ranked = available.map(option => {
      const components = Object.entries(option.scoreComponents || {})
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([name, value]) => ({ name, value: Number(value) }));
      const optionScore = components.reduce((sum, item) => sum + item.value, 0);
      return { option, optionScore, components };
    }).sort((a, b) => b.optionScore - a.optionScore
      || String(a.option.id).localeCompare(String(b.option.id), "ru"));

    const selected = ranked[0].option;
    const decision = selected.id;
    let offeredN = input.offeredN ?? selected.amount ?? null;

    const congress = input.activeEventId
      === this.config.canonical_prisoner_ai.hostage_congress.event_id;

    if (decision === "ransom" && congress) {
      offeredN = this.config.canonical_prisoner_ai.hostage_congress.fixed_ransom_gold;
    }

    if (decision === "ransom" && offeredN != null) {
      assert(Number.isInteger(Number(offeredN)) && Number(offeredN) >= 1,
        "Ransom N must be a positive integer");
      offeredN = Number(offeredN);
    }

    return this._log(
      input,
      decision,
      selected.reason || `Highest legal prisoner option score (${ranked[0].optionScore})`,
      factorScores,
      offeredN,
      ranked
    );
  }

  evaluateIncomingRansom(input = {}) {
    const N = Number(input.offeredN);
    assert(Number.isInteger(N) && N >= 1, "Ransom N must be a positive integer");

    const congress = input.activeEventId
      === this.config.canonical_prisoner_ai.hostage_congress.event_id;
    const effectiveN = congress
      ? this.config.canonical_prisoner_ai.hostage_congress.fixed_ransom_gold
      : N;

    const affordable = finite(input.ownerGold, 0) >= effectiveN;

    // These two scores are explicit implementation inputs. The project has not
    // approved canonical numeric prisoner weights yet.
    const acceptScore = finite(input.acceptScore, 0);
    const rejectScore = finite(input.rejectScore, 0);
    const accept = affordable && acceptScore >= rejectScore;

    return {
      house: this.houseId,
      available_options: ["accept", "reject"],
      factor_scores: input.factorScores || {},
      offered_N: effectiveN,
      decision: accept ? "accept" : "reject",
      reason: !affordable
        ? `Недостаточно золота: ${finite(input.ownerGold, 0)} < ${effectiveN}`
        : `implementation scores: accept=${acceptScore}, reject=${rejectScore}`,
      policy: "IMPLEMENTATION_BALANCE_TEST"
    };
  }

  _log(input, decision, reason, factorScores, offeredN = null, ranked = []) {
    return {
      house: this.houseId,
      available_options: (input.availableOptions || []).map(option => option?.id).filter(Boolean),
      factor_scores: factorScores,
      offered_N: offeredN,
      decision,
      reason,
      ranked_options: ranked.map(item => ({
        id: item.option.id,
        score: item.optionScore,
        components: item.components
      })),
      policy: this.config.canonical_prisoner_ai.numeric_weights_status
    };
  }
}

module.exports = { PrisonerAgent };
