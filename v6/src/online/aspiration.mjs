// What a House is setting out to do.
//
// At any time a House may name its aspiration: the way it means to be
// remembered. Each one is three steps, and each step is something the House
// has to actually do — win battles, fill the treasury, make peace, settle the
// land. A step taken pays glory once and for good, and the aspiration itself
// gives one standing gift from the moment it is named.
//
// Nothing here is luck: every step says plainly what it wants, and the House
// can see how far along it is.
//
// state.aspiration[house] = { key, taken: [stepIndex...], at }

import { landKind } from './settlements.mjs';
import { opinionOf } from './opinion.mjs';

export const ASPIRATIONS = Object.freeze({
  SWORD: {
    name: 'Путь меча',
    lore: 'Дом, о котором говорят через страх.',
    gift: { kind: 'attack', value: 1, text: '+1 к силе всякой твоей рати в бою' },
    steps: [
      { name: 'Пролить первую кровь', want: 'выиграть сечу', glory: 2 },
      { name: 'Отнять землю', want: 'взять землю у другого Дома', glory: 3 },
      { name: 'Взять престол', want: 'взять чужую столицу', glory: 6 }
    ]
  },
  GOLD: {
    name: 'Путь золота',
    lore: 'Дом, который покупает то, что другие берут силой.',
    gift: { kind: 'gold', value: 1, text: '+1 золота с каждым рассветом' },
    steps: [
      { name: 'Полная казна', want: 'скопить 40 золота', glory: 2 },
      { name: 'Богатая земля', want: 'держать рудник, солеварню или каменоломню', glory: 3 },
      { name: 'Три города', want: 'поднять три поселения выше деревни', glory: 5 }
    ]
  },
  WORD: {
    name: 'Путь слова',
    lore: 'Дом, чьё слово стоит дороже меча.',
    gift: { kind: 'influence', value: 1, text: '+1 влияния с каждым рассветом' },
    steps: [
      { name: 'Рука об руку', want: 'заключить союз', glory: 2 },
      { name: 'Замирить вражду', want: 'заключить мир после войны', glory: 3 },
      { name: 'Добрая слава', want: 'два Дома держат тебя в приязни', glory: 5 }
    ]
  },
  LAND: {
    name: 'Путь земли',
    lore: 'Дом, который кормит и растит, а не жжёт.',
    gift: { kind: 'people', value: 1, text: '+1 душа с каждым рассветом в столице' },
    steps: [
      { name: 'Десять земель', want: 'держать десять земель', glory: 2 },
      { name: 'Своей рукой', want: 'поставить деревню на пустой земле или на пепелище', glory: 3 },
      { name: 'Многолюдье', want: 'шестьдесят душ в своих землях', glory: 5 }
    ]
  }
});

export function aspirationOf(state, house) {
  const written = state?.aspiration?.[house];
  if (!written || !ASPIRATIONS[written.key]) return null;
  return written;
}

export function giftOf(state, house, kind) {
  const mine = aspirationOf(state, house);
  const gift = mine && ASPIRATIONS[mine.key].gift;
  return gift && gift.kind === kind ? gift.value : 0;
}

export function chooseAspiration(game, house, key, { nowMs = Date.now() } = {}) {
  if (!ASPIRATIONS[key]) throw new Error('такого устремления нет');
  const already = aspirationOf(game.state, house);
  if (already) throw new Error('устремление Дома уже названо и не меняется');
  const next = structuredClone(game);
  next.state.aspiration ||= {};
  next.state.aspiration[house] = { key, taken: [], at: new Date(nowMs).toISOString() };
  next.state.journal.push({
    kind: 'ASPIRATION_NAMED', house, houses: [house], aspiration: key,
    name: ASPIRATIONS[key].name, at: new Date(nowMs).toISOString()
  });
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

// What the House has to show for itself, step by step.
function stepDone(game, map, house, key, step) {
  const state = game.state;
  const lands = Object.entries(state.territories || {}).filter(([, land]) => land.owner === house);
  const journal = state.journal || [];
  const won = kind => journal.some(e => e.kind === kind && (e.winner === house || e.captor === house));

  if (key === 'SWORD') {
    if (step === 0) return journal.some(e => (e.kind === 'BATTLE' || e.kind === 'FIELD_BATTLE') && e.winner === house)
      || journal.some(e => e.kind === 'AMBUSH' && e.house === house && e.won);
    if (step === 1) return journal.some(e => e.kind === 'BATTLE' && e.captured && (e.captor === house || e.attacker === house && e.attackerWins));
    if (step === 2) return Object.entries(map.capitals || {}).some(([other, id]) => other !== house && state.territories?.[id]?.owner === house);
  }
  if (key === 'GOLD') {
    if (step === 0) return Number(state.houses?.[house]?.gold || 0) >= 40;
    if (step === 1) return lands.some(([id]) => ['рудник', 'солеварня', 'каменоломня'].includes(state.riches?.[id]));
    if (step === 2) return lands.filter(([id]) => ['Большая деревня', 'Малый город', 'Город', 'Столица'].includes(landKind(state, map, id))).length >= 3;
  }
  if (key === 'WORD') {
    if (step === 0) return Object.entries(game.diplomacy?.relations || {}).some(([pair, value]) => value === 'ALLIANCE' && pair.split('::').includes(house));
    if (step === 1) return journal.some(e => e.kind === 'PEACE_MADE' && (e.houses || []).includes(house));
    if (step === 2) return Object.keys(state.houses || {}).filter(other => other !== house && opinionOf(game, other, house) >= 15).length >= 2;
  }
  if (key === 'LAND') {
    if (step === 0) return lands.length >= 10;
    if (step === 1) return journal.some(e => e.kind === 'LAND_REBUILT' && e.house === house);
    if (step === 2) return lands.reduce((sum, [id]) => sum + Math.floor(Number(state.population?.[id] || 0)), 0) >= 60;
  }
  void won;
  return false;
}

export function aspirationView(game, map, house) {
  const mine = aspirationOf(game.state, house);
  if (!mine) return { chosen: null, choices: Object.entries(ASPIRATIONS).map(([key, item]) => ({ key, name: item.name, lore: item.lore, gift: item.gift.text, steps: item.steps })) };
  const plan = ASPIRATIONS[mine.key];
  return {
    chosen: mine.key,
    name: plan.name,
    lore: plan.lore,
    gift: plan.gift.text,
    steps: plan.steps.map((step, index) => ({
      ...step,
      done: mine.taken.includes(index) || stepDone(game, map, house, mine.key, index)
    }))
  };
}

/**
 * Pays for every step a House has taken since the last dawn. Mutates `game`;
 * returns true when anything was earned.
 */
export function checkAspirations(game, map, constants, { nowMs = Date.now() } = {}) {
  const state = game.state;
  if (!state?.aspiration) return false;
  let changed = false;
  for (const [house, mine] of Object.entries(state.aspiration)) {
    const plan = ASPIRATIONS[mine.key];
    if (!plan || !state.houses?.[house]) continue;
    mine.taken ||= [];
    for (let index = 0; index < plan.steps.length; index += 1) {
      if (mine.taken.includes(index)) continue;
      if (!stepDone(game, map, house, mine.key, index)) continue;
      mine.taken.push(index);
      const step = plan.steps[index];
      state.houses[house].victory_points = Number(state.houses[house].victory_points || 0) + step.glory;
      state.journal.push({
        kind: 'ASPIRATION_STEP', house, houses: [house], aspiration: mine.key,
        step: index, step_name: step.name, glory: step.glory,
        last: mine.taken.length === plan.steps.length, at: new Date(nowMs).toISOString()
      });
      changed = true;
    }
  }
  return changed;
}
