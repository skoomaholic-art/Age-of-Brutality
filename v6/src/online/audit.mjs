function territoryName(map, id) {
  return map.territories.find(t => t.id === id)?.name || id || '';
}

function battleWinner(entry) {
  return entry.captured ? entry.attacker : entry.defender;
}

function timingFields(entry) {
  const startedAt = entry.started_at || entry.created_at || null;
  const completedAt = entry.completed_at || entry.resolved_at || null;
  let actualMs = Number(entry.actual_duration_ms);
  if (!Number.isFinite(actualMs) && startedAt && completedAt) {
    actualMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
  }
  return {
    started_at: startedAt,
    completed_at: completedAt,
    due_at: entry.due_at || null,
    planned_duration_ms: Number.isFinite(Number(entry.planned_duration_ms))
      ? Number(entry.planned_duration_ms)
      : null,
    actual_duration_ms: Number.isFinite(actualMs) ? actualMs : null
  };
}

function houseFromEntry(entry) {
  return entry.house || entry.attacker || null;
}

function isPlayerAction(kind) {
  return kind === 'MARCH_QUEUED' || kind === 'RECRUIT_QUEUED' || kind === 'FORT_QUEUED';
}

export function stateSnapshot(game, map) {
  const houses = {};
  for (const [house, state] of Object.entries(game.state?.houses || {})) {
    let territories = 0;
    let warriors = 0;
    let forts = 0;
    for (const territory of map.territories) {
      const live = game.state.territories?.[territory.id];
      if (live?.owner === house) territories += 1;
      warriors += Number(live?.warriors?.[house] || 0);
      if (live?.owner === house && live?.fort) forts += 1;
    }
    houses[house] = {
      gold: Number(state.gold || 0),
      influence: Number(state.influence || 0),
      victory_points: Number(state.victory_points || 0),
      territories,
      warriors,
      forts
    };
  }
  return { houses };
}

export function journalEntryToAudit(entry, map, game) {
  const base = {
    game_id: game.id,
    session_id: game.session_id,
    type: entry.kind || 'EVENT'
  };

  if (entry.kind === 'GAME_STARTED') {
    return {
      ...base,
      message: 'Партия началась.',
      details: {
        game_id: entry.game_id || game.id,
        ruleset_version: entry.ruleset_version || null,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'GAME_FINISHED') {
    const winners = Array.isArray(entry.winners) ? entry.winners : [];
    const outcome = winners.length === 1
      ? ` Победил Дом ${winners[0]}.`
      : winners.length > 1
        ? ` Совместная победа: ${winners.join(', ')}.`
        : '';
    return {
      ...base,
      message: `Партия завершена.${outcome}`,
      details: {
        game_id: entry.game_id || game.id,
        reason: entry.reason || null,
        winners,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'ROUND_STARTED') {
    return {
      ...base,
      message: entry.mode === 'days'
        ? `Настал день ${entry.round} из ${entry.max_rounds}. Доход начислен всем Домам.`
        : `Раунд ${entry.round} из ${entry.max_rounds} начался. Доход начислен всем Домам.`,
      details: {
        round: entry.round,
        deadline_at: entry.deadline_at || null,
        gains: entry.gains,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'ROUND_PASSED') {
    return {
      ...base,
      message: `${entry.house}: раунд ${entry.round} завершён, использовано действий: ${entry.actions_used}.`,
      details: {
        house: entry.house,
        round: entry.round,
        actions_used: entry.actions_used,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'ROUND_ACTION_REFUNDED') {
    return {
      ...base,
      message: `${entry.house}: действие возвращено, приказ ${entry.source_id} не выполнен.`,
      details: {
        house: entry.house,
        round: entry.round,
        source_id: entry.source_id,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'GAME_ARCHIVED') {
    return {
      ...base,
      message: 'Партия отправлена в архив.',
      details: {
        game_id: entry.game_id || game.id,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'HOUSE_RELEASED') {
    return {
      ...base,
      message: `Игрок освободил Дом ${entry.house}.`,
      details: {
        player_id: entry.player_id || null,
        house: entry.house || null,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'HOUSE_ABANDONED') {
    const ruler = entry.player_name ? `, ${entry.player_name},` : '';
    return {
      ...base,
      message:
        `Дом ${entry.house} постигла смута. Его правитель${ruler} бросил свои земли на произвол судьбы, ` +
        'и теперь там хозяйничают разбойники и варвары.',
      details: {
        house: entry.house,
        player_name: entry.player_name || null,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'WAR_DECLARED') {
    const how = entry.betrayal
      ? `Дом ${entry.aggressor} предал союз и поднял оружие на Дом ${entry.target}.`
      : entry.cause === 'ENCOUNTER'
        ? `Войска Домов ${entry.aggressor} и ${entry.target} сошлись на дороге, и мира между ними больше нет.`
        : `Дом ${entry.aggressor} пошёл войной на Дом ${entry.target}.`;
    return {
      ...base,
      message: `Война: ${how}`,
      details: {
        aggressor: entry.aggressor,
        target: entry.target,
        houses: [entry.aggressor, entry.target],
        cause: entry.cause || null,
        betrayal: Boolean(entry.betrayal),
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'ALLIANCE_FORMED') {
    return {
      ...base,
      message: `Союз: Дома ${entry.houses[0]} и ${entry.houses[1]} скрепили союз. Их войска не тронут друг друга.`,
      details: { houses: [...entry.houses], at: entry.at || null }
    };
  }

  if (entry.kind === 'ALLIANCE_BROKEN') {
    return {
      ...base,
      message: `Союз расторгнут: Дом ${entry.house} более не союзник Дому ${entry.other}.`,
      details: { houses: [entry.house, entry.other], at: entry.at || null }
    };
  }

  if (entry.kind === 'FIELD_BATTLE') {
    const [a, b] = entry.sides;
    const place = entry.place_node
      ? `у ${territoryName(map, entry.place_node)}`
      : `между ${territoryName(map, entry.place_from)} и ${territoryName(map, entry.place_to)}`;
    const outcome = entry.winner
      ? `Победил Дом ${entry.winner} и продолжил поход; побеждённые повернули назад.`
      : 'Никто не взял верх, обе рати повернули назад.';
    return {
      ...base,
      message: `Встречный бой: войска Домов ${a.house} (${a.warriors}) и ${b.house} (${b.warriors}) столкнулись в пути ${place}. ${outcome} Потери: ${a.house} -${a.losses}, ${b.house} -${b.losses}.`,
      details: {
        houses: [...entry.houses],
        winner: entry.winner || null,
        war_declared: Boolean(entry.war_declared),
        place_from: entry.place_from || null,
        place_to: entry.place_to || null,
        place_node: entry.place_node || null,
        sides: structuredClone(entry.sides),
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'STATE_REPAIR') {
    const repairs = Array.isArray(entry.repairs) ? entry.repairs : [];
    return {
      ...base,
      message: `Исправлено некорректное состояние войск: ${repairs.length} записей.`,
      details: {
        reason: entry.reason || null,
        repairs
      }
    };
  }

  if (entry.kind === 'SNAPSHOT_RESTORED') {
    return {
      ...base,
      message: 'Состояние партии восстановлено из сохранения.',
      details: {
        snapshot_saved_at: entry.snapshot_saved_at || null,
        restored_at: entry.at || null
      }
    };
  }

  if (entry.kind === 'SESSION_START') {
    return {
      ...base,
      message: `Началась игровая сессия ${game.session_id}.`,
      details: {
        session_id: game.session_id,
        started_at: entry.at || game.created_at
      }
    };
  }

  if (entry.kind === 'MARCH_QUEUED') {
    const from = territoryName(map, entry.from);
    const to = territoryName(map, entry.to);
    return {
      ...base,
      message: `${entry.house} начал марш: ${from} -> ${to}, ${entry.warriors} воинов.`,
      details: {
        house: entry.house,
        from_id: entry.from,
        from,
        to_id: entry.to,
        to,
        warriors: entry.warriors,
        mode: entry.mode,
        order_id: entry.order_id,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'MARCH') {
    const from = territoryName(map, entry.from);
    const to = territoryName(map, entry.to);
    return {
      ...base,
      message: `${entry.house} завершил марш: ${from} -> ${to}, ${entry.warriors} воинов.`,
      details: {
        house: entry.house,
        from_id: entry.from,
        from,
        to_id: entry.to,
        to,
        warriors: entry.warriors,
        mode: entry.mode,
        destination: entry.destination,
        order_id: entry.order_id || null,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'MARCH_FAILED') {
    const from = territoryName(map, entry.from);
    const to = territoryName(map, entry.to);
    return {
      ...base,
      message: `Марш ${entry.house} сорван: ${from} -> ${to}. Причина: ${entry.reason}.`,
      details: {
        house: entry.house,
        from_id: entry.from,
        from,
        to_id: entry.to,
        to,
        warriors: entry.warriors,
        mode: entry.mode,
        order_id: entry.order_id,
        reason: entry.reason,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'NEUTRAL_CAPTURE') {
    const from = territoryName(map, entry.from);
    const to = territoryName(map, entry.to);
    return {
      ...base,
      message: `${entry.house}: ${from} -> ${to}. Захват нейтральной земли: ${entry.success ? 'УСПЕХ' : 'ПРОВАЛ'}, потери ${entry.loss}.`,
      details: {
        house: entry.house,
        from_id: entry.from,
        from,
        to_id: entry.to,
        to,
        warriors: entry.warriors,
        dice: entry.dice,
        roll: entry.roll,
        resistance: entry.resistance,
        total: entry.total,
        target: entry.target,
        success: entry.success,
        loss: entry.loss,
        victory_points_awarded: entry.victory_points_awarded,
        order_id: entry.order_id || null,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'BATTLE') {
    const from = territoryName(map, entry.from);
    const to = territoryName(map, entry.to);
    const winner = battleWinner(entry);
    const retreat = entry.defenderRetreatTo
      ? territoryName(map, entry.defenderRetreatTo)
      : null;
    return {
      ...base,
      message: `Битва: ${entry.attacker} против ${entry.defender} за ${to}. Победитель: ${winner}. Потери: ${entry.attacker} -${entry.attackerLosses}, ${entry.defender} -${entry.defenderLosses}. Захват: ${entry.captured ? 'да' : 'нет'}.`,
      details: {
        attacker: entry.attacker,
        defender: entry.defender,
        winner,
        from_id: entry.from,
        from,
        territory_id: entry.to,
        territory: to,
        attacker_die: entry.attackerDie,
        defender_die: entry.defenderDie,
        attacker_strength: entry.attackerStrength,
        defender_strength: entry.defenderStrength,
        attacker_losses: entry.attackerLosses,
        defender_losses: entry.defenderLosses,
        attacker_survivors: entry.attackerSurvivors,
        defender_survivors: entry.defenderSurvivors,
        captured: entry.captured,
        defender_retreat_to: retreat,
        defender_removed_for_no_retreat: entry.defenderRemovedForNoRetreat,
        battle_vp_awarded_to: entry.battle_vp_awarded_to,
        capital_capture_vp: entry.capital_capture_vp,
        order_id: entry.order_id || null,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'EMPTY_ENEMY_OCCUPATION') {
    const from = territoryName(map, entry.from);
    const to = territoryName(map, entry.to);
    return {
      ...base,
      message: `${entry.attacker} занял пустую территорию ${to} у ${entry.defender}: ${from} -> ${to}, ${entry.warriors} воинов.`,
      details: {
        attacker: entry.attacker,
        defender: entry.defender,
        from_id: entry.from,
        from,
        to_id: entry.to,
        to,
        warriors: entry.warriors,
        captured: true,
        order_id: entry.order_id || null,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'RECRUIT_QUEUED' || entry.kind === 'RECRUIT_COMPLETE') {
    const territory = territoryName(map, entry.territory);
    const complete = entry.kind === 'RECRUIT_COMPLETE';
    return {
      ...base,
      message: `${entry.house}: найм ${entry.warriors} воинов в ${territory} - ${complete ? 'завершён' : 'начат'}.`,
      details: {
        house: entry.house,
        territory_id: entry.territory,
        territory,
        warriors: entry.warriors,
        gold_spent: entry.gold_spent ?? null,
        job_id: entry.job_id || null,
        complete,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'FORT_QUEUED' || entry.kind === 'FORT_COMPLETE') {
    const territory = territoryName(map, entry.territory);
    const complete = entry.kind === 'FORT_COMPLETE';
    return {
      ...base,
      message: `${entry.house}: строительство крепости в ${territory} - ${complete ? 'завершено' : 'начато'}.`,
      details: {
        house: entry.house,
        territory_id: entry.territory,
        territory,
        gold_spent: entry.gold_spent ?? null,
        job_id: entry.job_id || null,
        complete,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'RECRUIT_FAILED' || entry.kind === 'FORT_FAILED') {
    const territory = territoryName(map, entry.territory);
    return {
      ...base,
      message: `${entry.house}: ${entry.kind === 'RECRUIT_FAILED' ? 'найм' : 'крепость'} в ${territory} - ПРОВАЛ. ${entry.reason}`,
      details: {
        house: entry.house,
        territory_id: entry.territory,
        territory,
        reason: entry.reason,
        gold_refunded: entry.gold_refunded,
        job_id: entry.job_id || null,
        ...timingFields(entry)
      }
    };
  }

  if (entry.kind === 'ONLINE_INCOME_PULSE') {
    return {
      ...base,
      message: Number(entry.pulses) > 1
        ? `Начислен доход всем Домам за ${entry.pulses} пропущенных циклов.`
        : 'Начислен доход всем Домам.',
      details: {
        at: entry.at,
        gains: entry.gains,
        pulses: Number(entry.pulses || 1)
      }
    };
  }

  return null;
}

export function normalizeAudit(game) {
  const next = structuredClone(game);
  if (!next.session_id) {
    const created = Date.parse(next.created_at) || Date.now();
    next.session_id = `S${created}`;
  }
  if (!Array.isArray(next.audit_log)) next.audit_log = [];
  if (!Number.isInteger(next.audit_seq)) next.audit_seq = 1;
  if (!Number.isInteger(next.audit_journal_cursor)) next.audit_journal_cursor = 0;
  if (!next.session_metrics || typeof next.session_metrics !== 'object') {
    next.session_metrics = {
      started_at: next.created_at,
      first_action_at: null,
      last_action_at: null,
      actions_total: 0,
      actions_by_house: {}
    };
  }
  if (!next.session_metrics.started_at) next.session_metrics.started_at = next.created_at;
  if (!next.session_metrics.actions_by_house) next.session_metrics.actions_by_house = {};
  if (!Number.isInteger(next.session_metrics.actions_total)) next.session_metrics.actions_total = 0;
  return next;
}

function recordActivity(next, item) {
  if (!isPlayerAction(item.type)) return;
  const at = item.at;
  const house = houseFromEntry(item.details || {});
  if (!next.session_metrics.first_action_at) next.session_metrics.first_action_at = at;
  next.session_metrics.last_action_at = at;
  next.session_metrics.actions_total += 1;
  if (house) {
    next.session_metrics.actions_by_house[house] =
      Number(next.session_metrics.actions_by_house[house] || 0) + 1;
  }
}

export function sessionSummary(game, nowMs = Date.now()) {
  const metrics = normalizeAudit(game).session_metrics;
  const startedMs = Date.parse(metrics.started_at);
  const firstMs = metrics.first_action_at ? Date.parse(metrics.first_action_at) : null;
  const lastMs = metrics.last_action_at ? Date.parse(metrics.last_action_at) : null;
  return {
    ...metrics,
    elapsed_seconds: Number.isFinite(startedMs)
      ? Math.max(0, Math.floor((nowMs - startedMs) / 1000))
      : null,
    action_span_seconds: firstMs !== null && lastMs !== null
      ? Math.max(0, Math.floor((lastMs - firstMs) / 1000))
      : 0
  };
}

export function syncAuditFromJournal(game, map, {
  nowMs = Date.now(),
  maxEntries = 2000,
  emit = null
} = {}) {
  const next = normalizeAudit(game);
  const journal = next.state?.journal || [];
  const start = Math.min(next.audit_journal_cursor, journal.length);

  for (let index = start; index < journal.length; index += 1) {
    const source = journal[index];
    const converted = journalEntryToAudit(source, map, next);
    if (!converted) continue;

    const sourceTime =
      source.completed_at ||
      source.resolved_at ||
      source.started_at ||
      source.created_at ||
      source.at ||
      null;
    const eventMs = sourceTime && Number.isFinite(Date.parse(sourceTime))
      ? Date.parse(sourceTime)
      : nowMs;

    const item = {
      seq: next.audit_seq,
      at: new Date(eventMs).toISOString(),
      ...converted,
      stats: stateSnapshot(next, map)
    };
    next.audit_seq += 1;
    next.audit_log.push(item);
    recordActivity(next, item);
    item.session = sessionSummary(next, eventMs);

    if (next.audit_log.length > maxEntries) {
      next.audit_log.splice(0, next.audit_log.length - maxEntries);
    }
    if (emit) emit(item);
  }

  next.audit_journal_cursor = journal.length;
  return next;
}

export function emitCloudAudit(item) {
  const payload = {
    severity: 'INFO',
    event: 'AOB_GAME_AUDIT',
    message: item.message,
    game_id: item.game_id,
    session_id: item.session_id,
    seq: item.seq,
    audit_type: item.type,
    at: item.at,
    details: item.details,
    stats: item.stats,
    session: item.session
  };
  console.log(JSON.stringify(payload));
}
