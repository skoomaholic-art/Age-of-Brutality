import { stateSnapshot, sessionSummary } from './audit.mjs';

export function buildGameStats(game, map, constants, nowMs = Date.now()) {
  const snapshot = stateSnapshot(game, map).houses;
  const houses = {};

  for (const house of constants.houses) {
    houses[house] = {
      ...(snapshot[house] || {
        gold: 0,
        influence: 0,
        victory_points: 0,
        territories: 0,
        warriors: 0,
        forts: 0
      }),
      actions: Number(game.session_metrics?.actions_by_house?.[house] || 0),
      marches: 0,
      battles: 0,
      battle_wins: 0,
      battle_losses: 0,
      warriors_recruited: 0,
      forts_built: 0,
      neutral_captures: 0,
      enemy_captures: 0
    };
  }

  for (const event of game.audit_log || []) {
    const details = event.details || {};

    if (event.type === 'MARCH_QUEUED' && houses[details.house]) {
      houses[details.house].marches += 1;
    }

    if (event.type === 'BATTLE') {
      if (houses[details.attacker]) {
        houses[details.attacker].battles += 1;
        if (details.winner === details.attacker) houses[details.attacker].battle_wins += 1;
        else houses[details.attacker].battle_losses += 1;
      }
      if (houses[details.defender]) {
        houses[details.defender].battles += 1;
        if (details.winner === details.defender) houses[details.defender].battle_wins += 1;
        else houses[details.defender].battle_losses += 1;
      }
      if (details.captured && houses[details.attacker]) {
        houses[details.attacker].enemy_captures += 1;
      }
    }

    if (event.type === 'NEUTRAL_CAPTURE' && details.success && houses[details.house]) {
      houses[details.house].neutral_captures += 1;
    }

    if (event.type === 'RECRUIT_COMPLETE' && houses[details.house]) {
      houses[details.house].warriors_recruited += Number(details.warriors || 0);
    }

    if (event.type === 'FORT_COMPLETE' && houses[details.house]) {
      houses[details.house].forts_built += 1;
    }
  }

  return {
    game_id: game.id,
    session_id: game.session_id,
    lifecycle: game.lifecycle || null,
    session: sessionSummary(game, nowMs),
    houses
  };
}
