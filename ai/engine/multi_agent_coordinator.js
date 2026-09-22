"use strict";

const { createAllHouseAgents, loadConfig } = require("./house_agent");
const { PrisonerAgent } = require("./prisoner_agent");\nconst { OpenRouterClient } = require("./openrouter_client");

class MultiAgentCoordinator {
  constructor(options = {}) {
    this.config = options.config || loadConfig(options.configPath);
    this.houseAgents = createAllHouseAgents({ config: this.config });
    this.prisonerAgents = Object.fromEntries(
      this.config.houses.map(house => [house, new PrisonerAgent(house, { config: this.config })])
    );
    this.openRouter = options.openRouter || new OpenRouterClient(options.openRouterOptions);
  }

  decideHouseAction(houseId, context) {
    const agent = this.houseAgents[houseId];
    if (!agent) throw new Error(`Unknown House: ${houseId}`);
    return agent.decide(context);
  }

  decidePrisonerAction(houseId, context) {
    const agent = this.prisonerAgents[houseId];
    if (!agent) throw new Error(`Unknown House: ${houseId}`);
    return agent.decide(context);
  }

  evaluateIncomingRansom(houseId, context) {
    const agent = this.prisonerAgents[houseId];
    if (!agent) throw new Error(`Unknown House: ${houseId}`);
    return agent.evaluateIncomingRansom(context);
  }

  async explainHouseDecision(houseId, context) {
    const decision = this.decideHouseAction(houseId, context);
    if (!this.openRouter.enabled || !decision.decision) {
      return {
        decision,
        aiExplanation: null,
        aiUsed: false
      };
    }

    const prompt = JSON.stringify({
      house: houseId,
      round: context?.round ?? null,
      decisionId: decision.decisionId,
      score: decision.score,
      reason: decision.reason,
      evaluated: decision.evaluated
    });

    const aiExplanation = await this.openRouter.ask(prompt, {
      system: [
        "You explain a deterministic board-game AI decision.",
        "Do not choose a different move, invent rules, change legality, or alter scores.",
        "Explain only the supplied decision and evidence in concise Russian."
      ].join(" ")
    });

    return {
      decision,
      aiExplanation,
      aiUsed: true
    };
  }

  describe() {
    return {
      houses: Object.keys(this.houseAgents),
      policy: this.config.decision_policy,
      gameVersion: this.config.game_version,
      openRouterEnabled: this.openRouter.enabled
    };
  }
}

module.exports = { MultiAgentCoordinator };
