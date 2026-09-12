"use strict";

const { createAllHouseAgents, loadConfig } = require("./house_agent");
const { PrisonerAgent } = require("./prisoner_agent");

class MultiAgentCoordinator {
  constructor(options = {}) {
    this.config = options.config || loadConfig(options.configPath);
    this.houseAgents = createAllHouseAgents({ config: this.config });
    this.prisonerAgents = Object.fromEntries(
      this.config.houses.map(house => [house, new PrisonerAgent(house, { config: this.config })])
    );
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

  describe() {
    return {
      houses: Object.keys(this.houseAgents),
      policy: this.config.decision_policy,
      gameVersion: this.config.game_version
    };
  }
}

module.exports = { MultiAgentCoordinator };
