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

// The clerks' reasons, said plainly.
function marchFailWords(reason) {
  const text = String(reason || '');
  if (/no legal route|not emitted|no longer legal/i.test(text)) return 'Дорога туда закрылась, пока войско шло.';
  if (/warrior cap/i.test(text)) return 'Там больше воинов не уместить.';
  if (/commander/i.test(text)) return 'Воевода не может остаться без войска.';
  if (/[а-яё]/i.test(text)) return text.endsWith('.') ? text : text + '.';
  return 'Войско вернулось ни с чем.';
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
      message: 'Жестокий век начался. Да хранит Господь правых.',
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
      message: entry.reason === 'HEART'
        ? `Век окончен: Дом ${winners[0] || '—'} набрал славу, держа Сердце земель.${outcome}`
        : `Век окончен.${outcome}`,
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
        ? `Настал день ${entry.round} из ${entry.max_rounds}. Казначеи обошли земли всех Домов.`
        : `Раунд ${entry.round} из ${entry.max_rounds} начался. Казначеи обошли земли всех Домов.`,
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
      message: `Дому ${entry.house} возвращено дело: повеление не сбылось.`,
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
      message: 'Свиток этого века убран в ларец.',
      details: {
        game_id: entry.game_id || game.id,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'HOUSE_RELEASED') {
    return {
      ...base,
      message: `Дом ${entry.house} остался без правителя.`,
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

  if (entry.kind === 'COMMANDER_FATE') {
    const where = entry.battle_territory ? ` у ${territoryName(map, entry.battle_territory)}` : '';
    const fate = {
      DEAD: 'пал в бою',
      CAPTURED: `взят в плен Домом ${entry.opponent_house || '—'}`,
      WEAKENED: 'ранен и ослаблен',
      SAVED: 'вышел из боя ослабленным'
    }[entry.outcome] || entry.outcome;
    return {
      ...base,
      message: `Судьба командира: ${entry.character_name} (Дом ${entry.house}) ${fate}${where}.`,
      details: {
        character_id: entry.character_id,
        character_name: entry.character_name,
        house: entry.house,
        captor: entry.opponent_house || null,
        houses: [entry.house, entry.opponent_house].filter(Boolean),
        outcome: entry.outcome === 'SAVED' ? 'WEAKENED' : entry.outcome,
        territory: entry.battle_territory ? territoryName(map, entry.battle_territory) : null,
        at: entry.at || null
      }
    };
  }

  const CAPTIVE_NEWS = {
    CAPTIVE_RELEASED: e => `Дом ${e.captor} отпустил пленника: ${e.character_name} вернулся ко двору Дома ${e.house}.`,
    CAPTIVE_EXECUTED: e => `Дом ${e.captor} казнил пленника: ${e.character_name} из Дома ${e.house} мёртв.`,
    CAPTIVE_IMPRISONED: e => `${e.character_name} из Дома ${e.house} заточён Домом ${e.captor} в крепости ${territoryName(map, e.territory)}.`,
    RANSOM_DEMANDED: e => `Дом ${e.captor} требует выкуп ${e.amount} золота за пленника: ${e.character_name} из Дома ${e.house}.`,
    RANSOM_PAID: e => `Дом ${e.house} заплатил Дому ${e.captor} выкуп ${e.amount} золота: ${e.character_name} свободен.`,
    RANSOM_REFUSED: e => `Дом ${e.house} отказался платить выкуп ${e.amount} золота. ${e.character_name} остаётся в руках Дома ${e.captor}.`,
    PRISONER_FREED: e => `Крепость ${territoryName(map, e.territory)} пала, и ${e.character_name} из Дома ${e.house} вышел на свободу.`,
    PRISONER_TAKEN_OVER: e => `Крепость ${territoryName(map, e.territory)} сменила хозяина: пленник ${e.character_name} из Дома ${e.house} теперь в руках Дома ${e.captor}.`,
    COMMANDER_RECOVERED: e => `${e.character_name} из Дома ${e.house} оправился от ран и снова в силе.`
  };
  if (CAPTIVE_NEWS[entry.kind]) {
    return {
      ...base,
      message: CAPTIVE_NEWS[entry.kind](entry),
      details: {
        character_id: entry.character_id,
        character_name: entry.character_name,
        house: entry.house,
        captor: entry.captor || null,
        houses: [...(entry.houses || [])],
        amount: entry.amount ?? null,
        territory: entry.territory ? territoryName(map, entry.territory) : null,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'SPY_ARRIVED' || entry.kind === 'SPY_RETURNED') {
    const territory = territoryName(map, entry.territory);
    return {
      ...base,
      message: entry.kind === 'SPY_ARRIVED'
        ? `Шпион на месте: ${entry.agent_name} вошёл в ${territory} с путниками и шлёт вести.`
        : `Шпион вернулся: ${entry.agent_name} ушёл из ${territory} с другими путниками и снова при дворе.`,
      details: { house: entry.house, agent_name: entry.agent_name, territory_id: entry.territory, territory, at: entry.at || null }
    };
  }

  if (entry.kind === 'JOB_SEIZED') {
    const territory = territoryName(map, entry.territory);
    const what = entry.job_type === 'RECRUIT' ? 'набранные воины' : 'начатая крепость';
    return {
      ...base,
      message: entry.wasted
        ? `${territory} захвачен Домом ${entry.captor}: крепость, начатая Домом ${entry.house}, брошена недостроенной.`
        : `${territory} захвачен Домом ${entry.captor}: ${what}, оплаченные Домом ${entry.house}, достались захватчику.`,
      details: {
        house: entry.house,
        captor: entry.captor,
        houses: [...entry.houses],
        job_type: entry.job_type,
        territory_id: entry.territory,
        territory,
        warriors: entry.warriors ?? null,
        wasted: Boolean(entry.wasted),
        gold_lost: entry.gold_lost,
        at: entry.at || null
      }
    };
  }

  if (entry.kind === 'RECRUIT_CANCELLED' || entry.kind === 'FORT_CANCELLED') {
    const territory = territoryName(map, entry.territory);
    return {
      ...base,
      message: `Дом ${entry.house} отозвал ${entry.kind === 'RECRUIT_CANCELLED' ? 'вербовщиков' : 'каменщиков'} из земли ${territory}; ${entry.gold_refunded} золота вернулось в казну.`,
      details: { house: entry.house, territory_id: entry.territory, territory, gold_refunded: entry.gold_refunded, at: entry.at || null }
    };
  }

  if (entry.kind === 'WAR_DECLARED') {
    const how = entry.truce_broken
      ? `Дом ${entry.aggressor} нарушил перемирие с Домом ${entry.target}. Он прослыл клятвопреступником (влияние -${Number(entry.influence_lost || 0)}, пеня ${Number(entry.gold_paid || 0)} золота).`
      : entry.betrayal
      ? `Дом ${entry.aggressor} предал брачный союз и поднял оружие на Дом ${entry.target}. Он прослыл клятвопреступником` +
        ` (влияние -${Number(entry.influence_lost || 0)}, пеня ${Number(entry.gold_paid || 0)} золота).`
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

  if (entry.kind === 'BRIDGE_BURNT') {
    return {
      ...base,
      message: `Дом ${entry.house} сжёг мост на дороге ${territoryName(map, entry.a)} — ${territoryName(map, entry.b)}. Там теперь не пройти, пока мост не отстроят.`,
      details: { house: entry.house, a: entry.a, b: entry.b, territory_id: entry.a, at: entry.at || null }
    };
  }

  if (entry.kind === 'BRIDGE_STARTED' || entry.kind === 'BRIDGE_BUILT') {
    const where = `${territoryName(map, entry.a)} — ${territoryName(map, entry.b)}`;
    return {
      ...base,
      ...(entry.kind === 'BRIDGE_STARTED' ? { visibility: 'PRIVATE' } : {}),
      message: entry.kind === 'BRIDGE_STARTED'
        ? `Начали ставить мост через реку на дороге ${where}.`
        : `Мост через реку на дороге ${where} готов (построил Дом ${entry.house}). Теперь по нему ходят все.`,
      details: { house: entry.house, a: entry.a, b: entry.b, territory: entry.a, at: entry.at || null }
    };
  }

  if (entry.kind === 'UNITS_REPLENISHED') {
    return {
      ...base,
      visibility: 'PRIVATE',
      message: `Отряд в земле ${territoryName(map, entry.territory)} пополнен: ${entry.men} человек встали на место раненых и павших. Заплачено ${entry.gold} золота.`,
      details: { house: entry.house, territory_id: entry.territory, at: entry.at || null }
    };
  }

  if (entry.kind === 'UNITS_HIRED' || entry.kind === 'UNITS_RETRAINED' || entry.kind === 'GROWTH_BUILT') {
    const where = territoryName(map, entry.territory);
    const kinds = ['крестьян', 'копейщиков', 'лучников', 'ратников', 'конных сержантов', 'рыцарей'];
    const hired = (entry.counts || []).map((n, i) => n ? `${n} ${kinds[i]}` : '').filter(Boolean).join(', ');
    return {
      ...base,
      visibility: 'PRIVATE',
      message: entry.kind === 'UNITS_HIRED'
        ? `В земле ${where} наняты ${hired} за ${entry.gold} золота.`
        : entry.kind === 'UNITS_RETRAINED'
          ? `В земле ${where} переучены ${entry.count} ${kinds[entry.from]} в ${kinds[entry.to]} за ${entry.gold} золота.`
          : `В земле ${where} заложены ${['Город', 'Столица'].includes(map.territories.find(t => t.id === entry.territory)?.type) ? 'ярмарка' : 'поля'}: люди будут прибывать с каждым рассветом.`,
      details: { house: entry.house, territory_id: entry.territory, at: entry.at || null }
    };
  }

  if (entry.kind === 'CAPTURE_CHOICE' || entry.kind === 'REVOLT') {
    const where = territoryName(map, entry.territory);
    const words = { MERCY: 'взял с миром', TRIBUTE: 'обложил данью', SACK: 'разграбил' };
    return {
      ...base,
      message: entry.kind === 'REVOLT'
        ? `Бунт в земле ${where}! Люди поднялись против Дома ${entry.house}: земля отпала к вольным людям (их ${entry.rebels}).${entry.garrison ? ` Гарнизон ${entry.retreat_to ? `отошёл в ${territoryName(map, entry.retreat_to)}` : 'разбежался'}.` : ''}`
        : `Дом ${entry.house} ${words[entry.choice] || 'решил судьбу'} землю ${where}.${entry.gold ? ` Взято ${entry.gold} золота.` : ''}${entry.people_lost ? ` Людей потеряно: ${entry.people_lost}.` : ''} Порядок: ${entry.order}.`,
      details: { house: entry.house, territory_id: entry.territory, choice: entry.choice || null, at: entry.at || null }
    };
  }

  if (entry.kind === 'DESERTION') {
    return {
      ...base,
      visibility: 'PRIVATE',
      message: `Казна не смогла заплатить войску: нужно было ${entry.owed} золота, нашлось ${entry.paid}. Неоплаченные разошлись по домам: ${entry.deserted} человек.`,
      details: { house: entry.house, at: entry.at || null }
    };
  }

  if (entry.kind === 'SEA_TOLL') {
    return {
      ...base,
      visibility: 'PRIVATE',
      message: `Море берёт своё: флот Дома ${entry.house} в открытом море уже ${entry.days}-й рассвет, ${entry.lost} человек сгинули от хвори, голода и бурь. Осталось ${entry.left}. Причаль к берегу, чтобы потери прекратились.`,
      details: { house: entry.house, position: entry.position, lost: entry.lost, left: entry.left, at: entry.at || null }
    };
  }

  if (entry.kind === 'PORT_BUILT') {
    return {
      ...base,
      message: `Порт построен: ${territoryName(map, entry.territory)} (Дом ${entry.house}). Из него корабли выходят в открытое море.`,
      details: { house: entry.house, territory: entry.territory, at: entry.at || null }
    };
  }

  if (entry.kind === 'RIDER_SENT' || entry.kind === 'RIDER_CAPTURED' || entry.kind === 'RIDER_TURNED_BACK') {
    const to = territoryName(map, entry.to || entry.territory);
    return {
      ...base,
      ...(entry.kind === 'RIDER_SENT' ? { visibility: 'PRIVATE' } : {}),
      message: entry.kind === 'RIDER_SENT'
        ? `${entry.character_name} выехал из столицы к войску в ${to}. Поведёт его, когда доберётся.`
        : entry.kind === 'RIDER_CAPTURED'
          ? `${entry.character_name} из Дома ${entry.house} схвачен в пути: в ${to} его взяли люди Дома ${entry.captor}.`
          : `${entry.character_name} не нашёл войска в ${to} и вернулся ко Двору.`,
      details: { house: entry.house, captor: entry.captor || null, character_name: entry.character_name, territory: entry.to || entry.territory || null, at: entry.at || null }
    };
  }

  if (entry.kind === 'LEVY_RAISED' || entry.kind === 'DRILL_DONE' || entry.kind === 'YARD_BUILT') {
    const names = ['селян', 'ополченцев', 'ратников'];
    const raised = (entry.counts || []).map((n, i) => (n ? `${n} ${names[i]}` : '')).filter(Boolean).join(', ');
    return {
      ...base,
      visibility: 'PRIVATE',
      message: entry.kind === 'LEVY_RAISED'
        ? `Сбор войск: Дом ${entry.house} созвал ${raised}. Люди идут в столицу.`
        : entry.kind === 'DRILL_DONE'
          ? `Учения окончены: теперь в столице ${entry.risen_text || 'обученные воины'}.`
          : `Учебный двор Дома ${entry.house} готов: можно учить латников и дружинников.`,
      details: { house: entry.house, counts: entry.counts || null, risen: entry.risen || null, at: entry.at || null }
    };
  }

  if (entry.kind === 'PEACE_MADE') {
    return {
      ...base,
      message: `Мир: Дома ${entry.houses[0]} и ${entry.houses[1]} сложили оружие. Перемирие до ${new Date(entry.until).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: кто нарушит, прослывёт клятвопреступником.`,
      details: { houses: entry.houses, until: entry.until, at: entry.at || null }
    };
  }

  if (entry.kind === 'DEAL_MADE' || entry.kind === 'DEAL_REJECTED') {
    const say = items => (items || []).map(item =>
      item.type === 'GOLD' ? `${item.amount} золота`
        : item.type === 'PASSAGE' ? 'право прохода'
          : item.type === 'MARRIAGE' ? 'дочь в жёны'
            : item.type === 'PEACE' ? 'мир'
            : item.type === 'LAND' ? `землю ${item.name || item.territory}` : '').filter(Boolean).join(', ') || 'ничего';
    return {
      ...base,
      message: entry.kind === 'DEAL_MADE'
        ? `Договор скреплён печатями: Дом ${entry.from} даёт ${say(entry.give)}, Дом ${entry.to} даёт ${say(entry.take)}.`
        : `Дом ${entry.to} вернул письмо Дома ${entry.from} без печати${entry.reason ? ': ' + entry.reason : ''}.`,
      details: { houses: [entry.from, entry.to], from: entry.from, to: entry.to, give: entry.give || [], take: entry.take || [], reason: entry.reason || null, at: entry.at || null }
    };
  }

  if (entry.kind === 'ALLIANCE_FORMED') {
    return {
      ...base,
      message: entry.bride_name
        ? `Союз: Дом ${entry.bride_house} отдал дочь, ${entry.bride_name}, в семью Дома ${entry.groom_house}. Свадьба сыграна, союз скреплён.`
        : `Союз: Дома ${entry.houses[0]} и ${entry.houses[1]} скрепили союз. Их войска не тронут друг друга.`,
      details: { houses: [...entry.houses], bride_house: entry.bride_house || null, bride_name: entry.bride_name || null, groom_house: entry.groom_house || null, at: entry.at || null }
    };
  }

  if (entry.kind === 'PASSAGE_GRANTED' || entry.kind === 'PASSAGE_DENIED' || entry.kind === 'PASSAGE_REVOKED') {
    const message = {
      PASSAGE_GRANTED: `Право прохода: Дом ${entry.host} открыл свои дороги войскам Дома ${entry.guest}.`,
      PASSAGE_DENIED: `Право прохода: Дом ${entry.host} отказал Дому ${entry.guest}.`,
      PASSAGE_REVOKED: `Право прохода: Дом ${entry.host} закрыл свои дороги для Дома ${entry.guest}.`
    }[entry.kind];
    return {
      ...base,
      message,
      details: { host: entry.host, guest: entry.guest, houses: [...entry.houses], at: entry.at || null }
    };
  }

  if (entry.kind === 'GUEST_MARCH') {
    return {
      ...base,
      message: `${entry.house}: отряд (${entry.warriors}) вошёл гостем в ${territoryName(map, entry.to)}, землю Дома ${entry.host}.`,
      details: { house: entry.house, host: entry.host, houses: [...entry.houses], to_id: entry.to, to: territoryName(map, entry.to), warriors: entry.warriors }
    };
  }

  if (entry.kind === 'GUESTS_EXPELLED') {
    const from = territoryName(map, entry.from);
    const tail = entry.to
      ? ` и ушли в ${territoryName(map, entry.to)}` + (entry.lost ? `; ${entry.lost} разбрелись по дороге` : '')
      : ': идти им было некуда, отряд распущен';
    return {
      ...base,
      message: `Гости ушли: воины Дома ${entry.house} (${entry.warriors}) оставили ${from}${tail}.`,
      details: { house: entry.house, host: entry.host, houses: [...entry.houses], from, to: entry.to ? territoryName(map, entry.to) : null, warriors: entry.warriors, lost: entry.lost, at: entry.at || null }
    };
  }

  if (entry.kind === 'ALLIANCE_BROKEN') {
    return {
      ...base,
      message: `Союз расторгнут: Дом ${entry.house} разорвал брачный союз с Домом ${entry.other} и прослыл клятвопреступником` +
        ` (влияние -${Number(entry.influence_lost || 0)}, пеня ${Number(entry.gold_paid || 0)} золота Дому ${entry.other}).`,
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
      message: `Писарь выправил счёт ратей: строк ${repairs.length}.`,
      details: {
        reason: entry.reason || null,
        repairs
      }
    };
  }

  if (entry.kind === 'SNAPSHOT_RESTORED') {
    return {
      ...base,
      message: 'Век возвращён к записанному в свитке.',
      details: {
        snapshot_saved_at: entry.snapshot_saved_at || null,
        restored_at: entry.at || null
      }
    };
  }

  if (entry.kind === 'SESSION_START') {
    return {
      ...base,
      message: `Летописец открыл новую тетрадь.`,
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
      message: `Рать Дома ${entry.house} выступила: ${from} → ${to}, мечей ${entry.warriors}.`,
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
      message: `Рать Дома ${entry.house} дошла: ${from} → ${to}, мечей ${entry.warriors}.`,
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
      message: `Поход Дома ${entry.house} не удался: ${from} → ${to}. ${marchFailWords(entry.reason)}`,
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

  if (entry.kind === 'WILD_BATTLE') {
    const to = territoryName(map, entry.to);
    return {
      ...base,
      message: entry.success
        ? `Вольные люди в земле ${to} разбиты: земля наша. Пало наших ${entry.losses}, стражи было ${entry.guards}.${entry.glory ? ` Слава +${entry.glory}.` : ''}`
        : `Приступ на вольную землю ${to} отбит. Пало наших ${entry.losses}, стражи полегло ${entry.guard_losses}, осталось ${entry.guards_left}.`,
      details: {
        house: entry.house,
        from_id: entry.from,
        territory_id: entry.to,
        to,
        success: entry.success,
        guards: entry.guards,
        guards_left: entry.guards_left,
        losses: entry.losses,
        glory: entry.glory,
        order_id: entry.order_id || null,
        at: entry.at || null,
        ...timingFields(entry)
      }
    };
  }

  if (['HEARTS_APPEARED', 'HEART_RUMOUR', 'HEART_FOUND', 'HEART_SPIED'].includes(entry.kind)) {
    const where = entry.territory ? territoryName(map, entry.territory) : '';
    const messages = {
      HEARTS_APPEARED: `Знамение! Посреди мира восстали Сердца земель, числом ${entry.count}, и свет их видно сквозь тучи: ${(entry.candidates || []).map(id => territoryName(map, id)).join(', ')}. Монахи пишут, что лишь одно из них истинное. Прочие же — печати, и под ними спит народ незнаемый. На того, кто сорвёт ложную печать, падёт гнев.`,
      HEART_RUMOUR: `Старец-схимник поведал летописцу: Сердце в земле ${where} ложное. Под ним спит орда языков незнаемых, не ходите туда, дабы не отворить бездну. Неразгаданных Сердец осталось: ${entry.left}.`,
      HEART_FOUND: `Возрадуйтесь! Истинное Сердце земель — ${where}, и воссел в нём Дом ${entry.house}. Прочие Сердца — ложные печати, и горе тому, кто их сорвёт.`,
      HEART_SPIED: entry.truth
        ? `Наш соглядатай вернулся с вестью: Сердце в земле ${where} истинное, и благодать на нём.`
        : `Наш соглядатай вернулся бледен: Сердце в земле ${where} ложное. Под ним он слышал топот бессчётных коней из-под земли.`
    };
    return {
      ...base,
      ...(entry.kind === 'HEART_SPIED' ? { visibility: 'PRIVATE' } : {}),
      message: messages[entry.kind],
      details: { house: entry.house || null, territory_id: entry.territory || null, at: entry.at || null }
    };
  }

  if (entry.kind === 'HORDE_COUNTDOWN' || entry.kind === 'HORDE_UNLEASHED') {
    return {
      ...base,
      message: entry.kind === 'HORDE_COUNTDOWN'
        ? `Недобрые знамения по всем землям. Хвостатая звезда стоит над Сердцами, в колодцах вода обратилась в кровь, вороны кружат над городами. Истинное Сердце пустует, и печати трещат. Сказано в Откровении: «и отворился кладезь бездны». Если до рассвета дня ${entry.day} никто не воссядет в истинном Сердце, ложные печати падут, и народ незнаемый пойдёт на все столицы. Кайтесь и точите мечи.`
        : `Печати сорваны! Из ложных Сердец вышли языцы, о которых никто толком не ведает, кто они, откуда пришли, каков их язык и какая у них вера. Зовут их тартарами, ибо вышли они из Тартара. На каждую столицу идут ${entry.men} всадников. И пред всеми открылось истинное Сердце: ${territoryName(map, entry.territory)}.`,
      details: { territory_id: entry.territory || null, at: entry.at || null }
    };
  }

  if (entry.kind.startsWith('HORDE_')) {
    const where = territoryName(map, entry.territory);
    const messages = {
      HORDE_AWAKENED: `Горе Дому ${entry.house}! Сорвал он ложную печать в земле ${where}, и из бездны вышел народ незнаемый: ${entry.men} всадников на низких мохнатых конях. Идут они на столицу${entry.toward ? ` ${territoryName(map, entry.toward)}` : ''}, и людям кажется, что нет им числа.`,
      HORDE_TOOK: `Тартары взяли землю ${where} у Дома ${entry.house}: жгут, секут и угоняют людей. ${entry.stayed} из них остались там, остальные ${entry.men} идут дальше.`,
      HORDE_BROKEN: `Чудо! У земли ${where} воинство Дома ${entry.house} разбило тартар. Звонят колокола, в храмах служат благодарственный молебен.`,
      HORDE_FORDING: `Тартары встали у реки близ земли ${where}: моста нет, кони их ищут брод. Молитесь, чтобы река была глубока.`,
      HORDE_SPENT: `Тартары выдохлись у земли ${where}. Остатки их ушли в леса и стали там разбойниками.`
    };
    return {
      ...base,
      message: messages[entry.kind] || `Орда: ${where}.`,
      details: { house: entry.house, territory_id: entry.territory, men: entry.men ?? null, at: entry.at || null }
    };
  }

  if (entry.kind === 'HEART_TAKEN' || entry.kind === 'HEART_HELD') {
    const where = territoryName(map, entry.territory);
    return {
      ...base,
      message: entry.kind === 'HEART_TAKEN'
        ? `Сердце земель, ${where}, в руках Дома ${entry.house}${entry.previous ? ` (прежде держал Дом ${entry.previous})` : ''}. Каждый рассвет, что он его держит, приносит ему всё больше славы.`
        : `Дом ${entry.house} держит Сердце земель ${entry.streak}-й рассвет: слава +${entry.glory}, всего ${entry.total} из ${entry.target}.`,
      details: { house: entry.house, territory_id: entry.territory, streak: entry.streak || null, glory: entry.glory || null, total: entry.total || null, target: entry.target || null, at: entry.at || null }
    };
  }

  if (entry.kind === 'NEUTRAL_CAPTURE') {
    const from = territoryName(map, entry.from);
    const to = territoryName(map, entry.to);
    return {
      ...base,
      message: `Дом ${entry.house} пришёл из земли ${from} в вольную землю ${to}: ${entry.success ? 'земля покорилась' : 'приступ отбит'}, пало ${entry.loss}.`,
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

  if (entry.kind === 'BATTLE' && entry.melee) {
    const to = territoryName(map, entry.to);
    const side = list => list.map(m => `${m.house} (${m.warriors}, −${m.losses})`).join(', ');
    const winner = entry.attackerWins ? entry.attacker : entry.defender;
    return {
      ...base,
      message: `Сеча за ${to}: ${side(entry.attackers)} против ${side(entry.defenders)}. Верх взял ${winner}${entry.attackers.length + entry.defenders.length > 2 ? ' со своей стороной' : ''}. ${entry.captured ? `Земля отошла Дому ${entry.captor}.` : 'Земля устояла.'}`,
      details: {
        melee: true,
        attacker: entry.attacker,
        defender: entry.defender,
        winner,
        houses: entry.houses,
        attackers: entry.attackers,
        defenders: entry.defenders,
        from_id: entry.from,
        territory_id: entry.to,
        territory: to,
        attacker_strength: entry.attackerStrength,
        defender_strength: entry.defenderStrength,
        attacker_losses: entry.attackerLosses,
        defender_losses: entry.defenderLosses,
        attacker_survivors: entry.attackerSurvivors,
        defender_survivors: entry.defenderSurvivors,
        captured: entry.captured,
        captor: entry.captor,
        order_id: entry.order_id || null,
        at: entry.at || null,
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
      message: `Битва: ${entry.attacker} против ${entry.defender} за ${to}. Победитель: ${winner}. Потери: ${entry.attacker} -${entry.attackerLosses}, ${entry.defender} -${entry.defenderLosses}. Земля ${entry.captured ? 'взята' : 'устояла'}.`,
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
      message: `Дом ${entry.attacker} вошёл в ${to}, оставленный Домом ${entry.defender} без стражи: ${from} → ${to}, мечей ${entry.warriors}.`,
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
      message: `Дом ${entry.house}: в земле ${territory} ${complete ? 'встали под знамя' : 'вербовщики созывают'} воинов (${entry.warriors}).`,
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
      message: `Дом ${entry.house}: крепость в земле ${territory} ${complete ? 'возведена' : 'заложена'}.`,
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
      message: `Дом ${entry.house}: ${entry.kind === 'RECRUIT_FAILED' ? 'сбор воинов' : 'крепость'} в земле ${territory} не задались, золото возвращено. ${entry.reason}`,
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
        ? `Казначеи обошли земли за ${entry.pulses} пропущенных срока.`
        : 'Казначеи обошли земли всех Домов.',
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
