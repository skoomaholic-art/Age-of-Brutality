"use strict";

const assert = require("assert");
const path = require("path");
const {
  HouseAgent,
  createAllHouseAgents,
  relationCap,
  loadConfig
} = require("../engine/house_agent");
const { PrisonerAgent } = require("../engine/prisoner_agent");
const { MultiAgentCoordinator } = require("../engine/multi_agent_coordinator");

const config = loadConfig(path.join(__dirname, "..", "config", "canonical_v5.7.2.json"));

assert.deepStrictEqual(config.houses, ["Варкайр", "Сайрвен", "Ортайн", "Эркай", "Тасвар", "Айрель"]);
assert.strictEqual(relationCap(config, "Ортайн"), 3);
assert.strictEqual(relationCap(config, "Сайрвен"), 2);
assert.strictEqual(Object.keys(createAllHouseAgents({ config })).length, 6);

{
  const agent = new HouseAgent("Варкайр", { config });
  const out = agent.decide({
    round: 6,
    legalActions: [
      { id: "neutral", type: "march", target: { ownership: "neutral", income: 1, resistance: 1 } },
      { id: "enemy-capital", type: "attack", target: { ownership: "enemy", income: 1, defenders: 1, isEnemyCapital: true } }
    ]
  });
  assert.strictEqual(out.decisionId, "enemy-capital");
  assert.strictEqual(out.score, 23);
}

{
  const agent = new HouseAgent("Эркай", { config });
  const out = agent.decide({
    round: 1,
    activePlan: "RECAPTURE",
    legalActions: [
      { id: "recap-cap", type: "attack", planId: "RECAPTURE", planMatch: true, target: { ownership: "enemy", recaptureCapital: true } },
      { id: "other", type: "attack", target: { ownership: "enemy", isEnemyCapital: true } }
    ]
  });
  assert.strictEqual(out.decisionId, "recap-cap");
  assert.strictEqual(out.score, 17);
}

{
  const agent = new HouseAgent("Ортайн", { config });
  const out = agent.decide({
    round: 2,
    activeOfficialRelations: 2,
    legalActions: [
      { id: "pact", type: "diplomacy", diplomacy: { officialRelationDelta: 1 }, scoreComponents: { goal: 1 } },
      { id: "recruit", type: "recruit", scoreComponents: { goal: 1 } }
    ]
  });
  assert.strictEqual(out.decisionId, "pact");
}

{
  const agent = new HouseAgent("Сайрвен", { config });
  const out = agent.decide({
    round: 2,
    activeOfficialRelations: 2,
    legalActions: [
      { id: "pact", type: "diplomacy", diplomacy: { officialRelationDelta: 1 }, scoreComponents: { goal: 10 } },
      { id: "recruit", type: "recruit", scoreComponents: { goal: 1 } }
    ]
  });
  assert.strictEqual(out.decisionId, "recruit");
}

{
  const agent = new PrisonerAgent("Тасвар", { config });
  const out = agent.decide({
    activeEventId: "EV-P06",
    offeredN: 9,
    factorScores: {
      captor_current_needs_or_requests: 1,
      captor_active_ambition_or_objectives: 2,
      specific_prisoner_value: 3,
      prisoner_house_position: 4,
      overall_strategic_position_of_both_sides: 5
    },
    availableOptions: [
      { id: "hold", scoreComponents: { strategic: 1 } },
      { id: "ransom", amount: 9, scoreComponents: { strategic: 2 } }
    ]
  });
  assert.strictEqual(out.decision, "ransom");
  assert.strictEqual(out.offered_N, 2);
  for (const key of config.canonical_prisoner_ai.logging_required) {
    assert(Object.prototype.hasOwnProperty.call(out, key), `missing prisoner log field ${key}`);
  }
}

{
  const agent = new PrisonerAgent("Айрель", { config });
  const out = agent.evaluateIncomingRansom({
    offeredN: 3,
    ownerGold: 2,
    acceptScore: 100,
    rejectScore: 0
  });
  assert.strictEqual(out.decision, "reject");
}

{
  const coordinator = new MultiAgentCoordinator({ config });
  const out = coordinator.decideHouseAction("Сайрвен", { legalActions: [] });
  assert.strictEqual(out.reason, "NO_LEGAL_ACTIONS");
  assert.strictEqual(coordinator.describe().houses.length, 6);
}

console.log("AI agent tests OK");
