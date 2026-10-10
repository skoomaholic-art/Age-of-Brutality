function territoryCount(state, house) {
  return Object.values(state.territories || {})
    .filter(territory => territory.owner === house)
    .length;
}

function standing(state, house) {
  const houseState = state.houses?.[house] || {};
  return {
    house,
    victory_points: Number(houseState.victory_points || 0),
    influence: Number(houseState.influence || 0),
    territories: territoryCount(state, house),
    gold: Number(houseState.gold || 0),
    exiled: territoryCount(state, house) === 0
  };
}

export function compareStandings(a, b) {
  return (
    Number(b.victory_points || 0) - Number(a.victory_points || 0) ||
    Number(b.influence || 0) - Number(a.influence || 0) ||
    Number(b.territories || 0) - Number(a.territories || 0) ||
    Number(b.gold || 0) - Number(a.gold || 0) ||
    String(a.house).localeCompare(String(b.house), 'ru')
  );
}

function sameCanonicalResult(a, b) {
  return (
    Number(a.victory_points || 0) === Number(b.victory_points || 0) &&
    Number(a.influence || 0) === Number(b.influence || 0) &&
    Number(a.territories || 0) === Number(b.territories || 0) &&
    Number(a.gold || 0) === Number(b.gold || 0)
  );
}

export function buildVictoryStatus(game, map, constants) {
  const state = game.state;
  // A realm whose ruler left the game stays on the map but cannot win.
  const abandoned = game.lifecycle?.abandoned_houses || {};
  const standings = constants.houses
    .map(house => ({ ...standing(state, house), abandoned: Boolean(abandoned[house]) }))
    .sort(compareStandings);

  const final =
    state.phase === 'FINISHED' ||
    game.lifecycle?.status === 'FINISHED';

  const contenders = standings.filter(item => !item.abandoned);
  const top = contenders[0] || null;
  const currentLeaders = top
    ? contenders.filter(item => sameCanonicalResult(item, top)).map(item => item.house)
    : [];

  return {
    status: final ? 'FINISHED' : 'RUNNING',
    round: Number(state.round || 1),
    max_rounds: Number(game.rounds?.max || constants.rounds || 6),
    phase: state.phase || null,
    canonical_end_condition: 'AFTER_DYNASTY_ROUND_6',
    standings,
    current_leaders: currentLeaders,
    winners: final ? currentLeaders : [],
    exiled_houses: standings.filter(item => item.exiled).map(item => item.house),
    scoring: {
      coverage: 'PARTIAL',
      implemented_vp_sources: [
        'VP-W1_FIRST_NEUTRAL_CAPTURE',
        'VP-W2_FIRST_BATTLE_WIN',
        'VP-W3A_FIRST_FOREIGN_CAPITAL_CAPTURE',
        'VP-W3B_HOLD_FIRST_FOREIGN_CAPITAL'
      ],
      not_yet_migrated: [
        'POWER',
        'DYNASTY',
        'CENTRAL_ISLAND',
        'SECRET_AMBITION'
      ]
    },
    online_adapter: {
      canonical_round_progression_connected: Boolean(game.rounds?.enabled),
      exile_return_connected: false
    }
  };
}
