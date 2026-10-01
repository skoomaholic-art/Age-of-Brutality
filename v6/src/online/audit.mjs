function territoryName(map, id) {
  return map.territories.find(t => t.id === id)?.name || id || '';
}

function battleWinner(entry) {
  return entry.attackerWins ? entry.attacker : entry.defender;
}

export function journalEntryToAudit(entry, map, game) {
  const base = {
    game_id: game.id,
    session_id: game.session_id,
    type: entry.kind || 'EVENT'
  };

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
        due_at: entry.due_at
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
        destination: entry.destination
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
        reason: entry.reason
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
        victory_points_awarded: entry.victory_points_awarded
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
        capital_capture_vp: entry.capital_capture_vp
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
        captured: true
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
        complete
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
        complete
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
        gold_refunded: entry.gold_refunded
      }
    };
  }

  if (entry.kind === 'ONLINE_INCOME_PULSE') {
    return {
      ...base,
      message: `Начислен доход всем Домам.`,
      details: {
        at: entry.at,
        gains: entry.gains
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
  return next;
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
    const converted = journalEntryToAudit(journal[index], map, next);
    if (!converted) continue;

    const item = {
      seq: next.audit_seq,
      at: new Date(nowMs).toISOString(),
      ...converted
    };
    next.audit_seq += 1;
    next.audit_log.push(item);
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
    details: item.details
  };
  console.log(JSON.stringify(payload));
}
