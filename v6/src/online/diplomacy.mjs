import { houseCourtTotals } from './court.mjs';
// Relations between Houses: neutral by default, war by deed, alliance by marriage.
//
// - Neutral Houses whose armies meet on the road go to war and fight.
// - Enemies fight on sight.
// - Allies let each other pass.
// An alliance is sealed only by a marriage: one House gives a daughter into
// the other's family. Whoever breaks it is an oathbreaker: he pays in gold and
// influence, and the other Houses remember.
// War is also declared by attacking a House's land; attacking an ally is
// treachery and turns the alliance into war.

export const RELATION = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  WAR: 'WAR',
  ALLIANCE: 'ALLIANCE'
});

// A House may keep one alliance at a time, so the table cannot close ranks.
export const MAX_ALLIES = 1;

function pairKey(a, b) {
  return [String(a), String(b)].sort().join('::');
}

function offerKey(from, to) {
  return `${from}>${to}`;
}

function ensure(game) {
  game.diplomacy ||= {};
  game.diplomacy.relations ||= {};
  game.diplomacy.offers ||= {};
  return game.diplomacy;
}

export function relationOf(game, a, b) {
  if (a === b) return RELATION.ALLIANCE;
  return game?.diplomacy?.relations?.[pairKey(a, b)] || RELATION.NEUTRAL;
}

export function areAllies(game, a, b) {
  return a !== b && relationOf(game, a, b) === RELATION.ALLIANCE;
}

export function alliesOf(game, house) {
  const out = [];
  for (const [key, value] of Object.entries(game?.diplomacy?.relations || {})) {
    if (value !== RELATION.ALLIANCE) continue;
    const [a, b] = key.split('::');
    if (a === house) out.push(b);
    if (b === house) out.push(a);
  }
  return out;
}

// Right of passage: the host lets the guest's armies cross his lands. It is
// kept with the board state (state.passage[host] = [guests]) because the road
// finder reads it. A guest may march through, not stop: ending a march on the
// host's land is still an attack.
export function hasPassage(state, host, guest) {
  return Boolean(host && guest && state?.passage?.[host]?.includes(guest));
}

function setPassage(game, host, guest, on) {
  game.state.passage ||= {};
  const list = new Set(game.state.passage[host] || []);
  if (on) list.add(guest); else list.delete(guest);
  if (list.size) game.state.passage[host] = [...list].sort();
  else delete game.state.passage[host];
}

function abandoned(game, house) {
  return Boolean(game?.lifecycle?.abandoned_houses?.[house]);
}

function stamp(game, nowMs) {
  game.updated_at = new Date(nowMs).toISOString();
}

// Mutates `game` (callers pass their own clone). Returns true when war is new.
export function declareWarInPlace(game, a, b, { nowMs = Date.now(), cause = 'ATTACK' } = {}) {
  if (!a || !b || a === b) return false;
  const diplomacy = ensure(game);
  const key = pairKey(a, b);
  const before = diplomacy.relations[key] || RELATION.NEUTRAL;
  if (before === RELATION.WAR) return false;

  diplomacy.relations[key] = RELATION.WAR;
  delete diplomacy.offers[offerKey(a, b)];
  delete diplomacy.offers[offerKey(b, a)];
  // War closes the roads both ways.
  setPassage(game, a, b, false);
  setPassage(game, b, a, false);
  diplomacy.passage_requests ||= {};
  delete diplomacy.passage_requests[offerKey(a, b)];
  delete diplomacy.passage_requests[offerKey(b, a)];
  const price = before === RELATION.ALLIANCE ? punishOathbreaker(game, a, b) : {};
  game.state.journal.push({
    kind: 'WAR_DECLARED',
    aggressor: a,
    target: b,
    cause,
    betrayal: before === RELATION.ALLIANCE,
    ...price,
    at: new Date(nowMs).toISOString()
  });
  stamp(game, nowMs);
  return true;
}

// Under fog a House can deal only with the Houses it has met on the map.
export function hasMet(game, house, other) {
  if (game?.rounds?.mode !== 'days') return true;
  return Boolean(game.contacts?.[house]?.includes(other));
}

function assertHouses(game, constants, house, target) {
  if (!constants.houses.includes(house)) throw new Error(`unknown house ${house}`);
  if (!constants.houses.includes(target)) throw new Error(`unknown house ${target}`);
  if (house === target) throw new Error('дипломатия с самим собой невозможна');
  if (!hasMet(game, house, target)) throw new Error('этот Дом тебе ещё не встретился');
  if (abandoned(game, target)) throw new Error('это государство брошено, договариваться не с кем');
}

const DAUGHTER_NAMES = {
  'Варкайр': 'Торвейна', 'Сайрвен': 'Элсайра', 'Ортайн': 'Майвена',
  'Эркай': 'Рейтара', 'Тасвар': 'Кайсара', 'Айрель': 'Элияра'
};
export const OATH_INFLUENCE = 2;   // influence the oathbreaker loses
export const OATH_GOLD = 3;        // gold he pays to the wronged House

// Every House has a daughter of marriageable age.
function dynastyOf(game, house) {
  game.dynasty ||= {};
  game.dynasty[house] ||= {
    daughters: [{ id: `D-${house}-1`, name: DAUGHTER_NAMES[house] || `Дочь Дома ${house}`, married_to: null, married_at: null }]
  };
  return game.dynasty[house];
}

export function freeDaughter(game, house) {
  const known = game?.dynasty?.[house];
  if (!known) return { id: `D-${house}-1`, name: DAUGHTER_NAMES[house] || `Дочь Дома ${house}`, married_to: null };
  return known.daughters.find(daughter => !daughter.married_to) || null;
}

export function isOathbreaker(game, house) {
  return Number(game?.diplomacy?.oathbreakers?.[house] || 0) > 0;
}

// The price of a broken marriage alliance. Mutates `game`.
function punishOathbreaker(game, breaker, wronged) {
  const diplomacy = ensure(game);
  diplomacy.oathbreakers ||= {};
  diplomacy.oathbreakers[breaker] = Number(diplomacy.oathbreakers[breaker] || 0) + 1;
  const purse = game.state.houses[breaker];
  const influence = Math.min(OATH_INFLUENCE, Math.max(0, Number(purse.influence || 0)));
  const gold = Math.min(OATH_GOLD, Math.max(0, Number(purse.gold || 0)));
  purse.influence = Number(purse.influence || 0) - influence;
  purse.gold = Number(purse.gold || 0) - gold;
  if (game.state.houses[wronged]) game.state.houses[wronged].gold = Number(game.state.houses[wronged].gold || 0) + gold;
  return { influence_lost: influence, gold_paid: gold };
}

function canAlly(game, a, b, bride = a) {
  if (![a, b].includes(bride)) return 'невеста должна быть из одного из двух Домов';
  if (!freeDaughter(game, bride)) return `у Дома ${bride} нет незамужней дочери`;
  if (relationOf(game, a, b) === RELATION.WAR) return 'с этим Домом идёт война';
  if (relationOf(game, a, b) === RELATION.ALLIANCE) return 'союз уже заключён';
  if (alliesOf(game, a).length >= MAX_ALLIES) return `у Дома ${a} уже есть союзник`;
  if (alliesOf(game, b).length >= MAX_ALLIES) return `у Дома ${b} уже есть союзник`;
  return null;
}

function formAlliance(game, a, b, nowMs, bride = a) {
  const diplomacy = ensure(game);
  diplomacy.relations[pairKey(a, b)] = RELATION.ALLIANCE;
  const groom = bride === a ? b : a;
  const daughter = dynastyOf(game, bride).daughters.find(item => !item.married_to);
  daughter.married_to = groom;
  daughter.married_at = new Date(nowMs).toISOString();
  for (const key of Object.keys(diplomacy.offers)) {
    const [from, to] = key.split('>');
    if ([a, b].includes(from) || [a, b].includes(to)) delete diplomacy.offers[key];
  }
  game.state.journal.push({
    kind: 'ALLIANCE_FORMED',
    houses: [a, b],
    bride_house: bride,
    bride_name: daughter.name,
    groom_house: groom,
    at: new Date(nowMs).toISOString()
  });
  stamp(game, nowMs);
}

const offerBride = (offer, from) => (offer && typeof offer === 'object' && offer.bride) || from;

// `bride` names the House whose daughter marries: the offerer's by default
// ("we give our daughter"), or the other's ("we ask for your daughter's hand").
export function offerAlliance(game, constants, house, target, { nowMs = Date.now(), bride = house } = {}) {
  assertHouses(game, constants, house, target);
  const reason = canAlly(game, house, target, bride);
  if (reason) throw new Error(reason);

  const next = structuredClone(game);
  const diplomacy = ensure(next);
  const theirs = diplomacy.offers[offerKey(target, house)];
  if (theirs && offerBride(theirs, target) === bride) {
    formAlliance(next, house, target, nowMs, bride);
    return next;
  }
  diplomacy.offers[offerKey(house, target)] = { at: new Date(nowMs).toISOString(), bride };
  stamp(next, nowMs);
  return next;
}

export function acceptAlliance(game, constants, house, from, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, house, from);
  if (!game?.diplomacy?.offers?.[offerKey(from, house)]) {
    throw new Error('такого предложения союза нет');
  }
  const bride = offerBride(game.diplomacy.offers[offerKey(from, house)], from);
  const reason = canAlly(game, house, from, bride);
  if (reason) throw new Error(reason);
  const next = structuredClone(game);
  formAlliance(next, from, house, nowMs, bride);
  return next;
}

export function declineAlliance(game, house, from, { nowMs = Date.now() } = {}) {
  const next = structuredClone(game);
  const diplomacy = ensure(next);
  // Declining also withdraws our own offer to that House.
  delete diplomacy.offers[offerKey(from, house)];
  delete diplomacy.offers[offerKey(house, from)];
  stamp(next, nowMs);
  return next;
}

export function breakAlliance(game, house, other, { nowMs = Date.now() } = {}) {
  if (!areAllies(game, house, other)) throw new Error('союза с этим Домом нет');
  const next = structuredClone(game);
  delete ensure(next).relations[pairKey(house, other)];
  const price = punishOathbreaker(next, house, other);
  next.state.journal.push({
    kind: 'ALLIANCE_BROKEN',
    house,
    other,
    ...price,
    at: new Date(nowMs).toISOString()
  });
  stamp(next, nowMs);
  return next;
}

export function declareWar(game, constants, house, target, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, house, target);
  if (relationOf(game, house, target) === RELATION.WAR) throw new Error('война уже идёт');
  const next = structuredClone(game);
  declareWarInPlace(next, house, target, { nowMs, cause: 'DECLARATION' });
  return next;
}

export function requestPassage(game, constants, guest, host, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, guest, host);
  if (relationOf(game, guest, host) === RELATION.WAR) throw new Error('с этим Домом идёт война');
  if (hasPassage(game.state, host, guest)) throw new Error('право прохода уже дано');
  const next = structuredClone(game);
  const diplomacy = ensure(next);
  diplomacy.passage_requests ||= {};
  diplomacy.passage_requests[offerKey(guest, host)] = new Date(nowMs).toISOString();
  stamp(next, nowMs);
  return next;
}

// The host's answer to a request, or the withdrawal of a right already given.
export function answerPassage(game, constants, host, guest, grant, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, host, guest);
  const next = structuredClone(game);
  const diplomacy = ensure(next);
  diplomacy.passage_requests ||= {};
  const asked = Boolean(diplomacy.passage_requests[offerKey(guest, host)]);
  const held = hasPassage(next.state, host, guest);
  if (!asked && !held) throw new Error('этот Дом не просил прохода');
  delete diplomacy.passage_requests[offerKey(guest, host)];
  if (grant && relationOf(next, host, guest) === RELATION.WAR) throw new Error('с этим Домом идёт война');
  setPassage(next, host, guest, Boolean(grant));
  next.state.journal.push({
    kind: grant ? 'PASSAGE_GRANTED' : held ? 'PASSAGE_REVOKED' : 'PASSAGE_DENIED',
    host,
    guest,
    houses: [host, guest],
    at: new Date(nowMs).toISOString()
  });
  stamp(next, nowMs);
  return next;
}

// Houses led by the AI answer offers at once: they take an ally when free and
// open their roads to anyone they are not at war with.
export function answerAiOffers(game, aiHouses, { nowMs = Date.now() } = {}) {
  const offers = Object.keys(game?.diplomacy?.offers || {});
  const asks = Object.keys(game?.diplomacy?.passage_requests || {});
  if ((!offers.length && !asks.length) || !aiHouses?.length) return game;

  let next = null;
  for (const key of asks) {
    const [guest, host] = key.split('>');
    if (!aiHouses.includes(host)) continue;
    const from = next || game;
    next = answerPassage(from, { houses: [guest, host] }, host, guest, relationOf(from, host, guest) !== RELATION.WAR, { nowMs });
  }
  for (const key of offers) {
    const [from, to] = key.split('>');
    if (!aiHouses.includes(to) || abandoned(game, to)) continue;
    next ||= structuredClone(game);
    if (!ensure(next).offers[key]) continue;
    const bride = offerBride(next.diplomacy.offers[key], from);
    // No House gives or takes a daughter with a known oathbreaker.
    if (canAlly(next, to, from, bride) || isOathbreaker(next, from)) {
      delete next.diplomacy.offers[key];
      stamp(next, nowMs);
    } else {
      formAlliance(next, from, to, nowMs, bride);
    }
  }
  return next || game;
}

// What one House is shown: every war and alliance is public, offers are not.
export function diplomacyView(game, house, known = null) {
  const seen = known ? new Set([house, ...known]) : null;
  const relations = {};
  for (const [key, value] of Object.entries(game?.diplomacy?.relations || {})) {
    // Dealings between Houses this one has not met stay unknown to it.
    if (seen && !key.split('::').every(name => seen.has(name))) continue;
    relations[key] = value;
  }
  const offers_in = [];
  const offers_out = [];
  const offer_brides = {};
  for (const [key, offer] of Object.entries(game?.diplomacy?.offers || {})) {
    const [from, to] = key.split('>');
    if (house && to === house) { offers_in.push(from); offer_brides[from] = offerBride(offer, from); }
    if (house && from === house) { offers_out.push(to); offer_brides[to] = offerBride(offer, from); }
  }
  const visible = name => !seen || seen.has(name);
  const marriages = [];
  for (const [bride, family] of Object.entries(game?.dynasty || {})) {
    for (const daughter of family.daughters || []) {
      if (daughter.married_to && visible(bride) && visible(daughter.married_to)) {
        marriages.push({ bride_house: bride, name: daughter.name, groom_house: daughter.married_to });
      }
    }
  }
  const passage_asked_in = [];
  const passage_asked_out = [];
  for (const key of Object.keys(game?.diplomacy?.passage_requests || {})) {
    const [guest, host] = key.split('>');
    if (house && host === house) passage_asked_in.push(guest);
    if (house && guest === house) passage_asked_out.push(host);
  }
  const passage = game?.state?.passage || {};
  return {
    relations,
    offers_in,
    offers_out,
    max_allies: MAX_ALLIES,
    known: known ? [...known] : null,
    // Whose daughter an offer is about, the marriages made, and who broke his word.
    offer_brides,
    marriages,
    my_daughter: house ? freeDaughter(game, house)?.name || null : null,
    free_daughters: Object.fromEntries((known || []).map(other => [other, freeDaughter(game, other)?.name || null])),
    oathbreakers: Object.keys(game?.diplomacy?.oathbreakers || {}).filter(visible),
    oath_price: { influence: OATH_INFLUENCE, gold: OATH_GOLD },
    passage_asked_in,
    passage_asked_out,
    // Whose roads are open to us, and to whom ours are.
    passage_from: Object.keys(passage).filter(host => passage[host].includes(house)),
    passage_to: [...(passage[house] || [])]
  };
}

// ---------- deals ----------
// A deal is a letter in two halves, as at the courts of old: what one House
// gives and what it asks in return. Each half holds any of: a marriage (the
// giver's daughter goes to the other House and the two become allies), gold,
// the right of passage through the giver's lands, or one of the giver's lands.
// An empty half means "without conditions".
export const DEAL_LIMIT_GOLD = 999;
const LAND_WORTH = { 'Город': 9, 'Деревня': 5, 'Дикая земля': 3, 'Половина острова': 4 };

function cleanHalf(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of items.slice(0, 8)) {
    const type = String(raw?.type || '').toUpperCase();
    if (type === 'GOLD') {
      const amount = Math.floor(Number(raw.amount));
      if (!(amount > 0)) continue;
      if (seen.has('GOLD')) continue;
      out.push({ type, amount: Math.min(DEAL_LIMIT_GOLD, amount) });
    } else if (type === 'PASSAGE' || type === 'MARRIAGE') {
      if (seen.has(type)) continue;
      out.push({ type });
    } else if (type === 'LAND') {
      const territory = String(raw.territory || '');
      if (!territory || seen.has('LAND:' + territory)) continue;
      seen.add('LAND:' + territory);
      out.push({ type, territory });
      continue;
    } else continue;
    seen.add(type);
  }
  return out;
}

// Can `giver` hand these items over to `taker` right now? Returns a reason or null.
function halfProblem(game, map, giver, taker, items) {
  const purse = game.state.houses[giver];
  for (const item of items) {
    if (item.type === 'GOLD' && Number(purse?.gold || 0) < item.amount) return `у Дома ${giver} нет ${item.amount} золота`;
    if (item.type === 'PASSAGE' && hasPassage(game.state, giver, taker)) return `дороги Дома ${giver} уже открыты Дому ${taker}`;
    if (item.type === 'LAND') {
      const land = game.state.territories[item.territory];
      const name = map?.territories?.find(t => t.id === item.territory)?.name || item.territory;
      if (!land || land.owner !== giver) return `земля ${name} не принадлежит Дому ${giver}`;
      if (Object.values(map?.capitals || {}).includes(item.territory)) return 'столицу не отдают по договору';
    }
  }
  return null;
}

function dealProblem(game, map, from, to, deal) {
  const marriages = [...deal.give, ...deal.take].filter(item => item.type === 'MARRIAGE');
  if (marriages.length > 1) return 'в одном договоре может быть только одна свадьба';
  if (!deal.give.length && !deal.take.length) return 'договор пуст';
  if (relationOf(game, from, to) === RELATION.WAR) return 'с этим Домом идёт война';
  if (marriages.length) {
    const bride = deal.give.some(item => item.type === 'MARRIAGE') ? from : to;
    const reason = canAlly(game, from, to, bride);
    if (reason) return reason;
  }
  return halfProblem(game, map, from, to, deal.give) || halfProblem(game, map, to, from, deal.take);
}

function handOver(game, map, constants, giver, taker, items, nowMs) {
  for (const item of items) {
    if (item.type === 'GOLD') {
      game.state.houses[giver].gold = Number(game.state.houses[giver].gold || 0) - item.amount;
      game.state.houses[taker].gold = Number(game.state.houses[taker].gold || 0) + item.amount;
    } else if (item.type === 'PASSAGE') {
      setPassage(game, giver, taker, true);
    } else if (item.type === 'MARRIAGE') {
      formAlliance(game, giver, taker, nowMs, giver);
    } else if (item.type === 'LAND') {
      const land = game.state.territories[item.territory];
      // The giver's garrison goes home to the capital, as many as find room there.
      const leaving = Number(land.warriors?.[giver] || 0);
      if (land.warriors) delete land.warriors[giver];
      const capitalId = map?.capitals?.[giver];
      const capital = capitalId && game.state.territories[capitalId];
      if (leaving && capital && capital.owner === giver) {
        const here = Object.values(capital.warriors || {}).reduce((sum, value) => sum + Number(value || 0), 0);
        const room = Math.max(0, Number(constants?.territory_warrior_cap || 99) - here);
        capital.warriors ||= {};
        capital.warriors[giver] = Number(capital.warriors[giver] || 0) + Math.min(leaving, room);
      }
      land.owner = taker;
    }
  }
}

function describeHalf(items, map) {
  return items.map(item => {
    if (item.type === 'GOLD') return { type: 'GOLD', amount: item.amount };
    if (item.type === 'LAND') return { type: 'LAND', territory: item.territory, name: map?.territories?.find(t => t.id === item.territory)?.name || item.territory };
    return { type: item.type };
  });
}

export function proposeDeal(game, constants, map, from, to, { give = [], take = [] } = {}, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, from, to);
  const deal = { give: cleanHalf(give), take: cleanHalf(take) };
  const reason = dealProblem(game, map, from, to, deal);
  if (reason) throw new Error(reason);
  const next = structuredClone(game);
  const diplomacy = ensure(next);
  diplomacy.deals ||= {};
  diplomacy.deals[offerKey(from, to)] = { ...deal, at: new Date(nowMs).toISOString() };
  stamp(next, nowMs);
  return next;
}

export function acceptDeal(game, constants, map, house, from, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, house, from);
  const deal = game?.diplomacy?.deals?.[offerKey(from, house)];
  if (!deal) throw new Error('такого договора нет');
  const reason = dealProblem(game, map, from, house, deal);
  if (reason) throw new Error(reason);
  const next = structuredClone(game);
  delete ensure(next).deals[offerKey(from, house)];
  handOver(next, map, constants, from, house, deal.give, nowMs);
  handOver(next, map, constants, house, from, deal.take, nowMs);
  next.state.journal.push({
    kind: 'DEAL_MADE', from, to: house, houses: [from, house],
    give: describeHalf(deal.give, map), take: describeHalf(deal.take, map),
    at: new Date(nowMs).toISOString()
  });
  stamp(next, nowMs);
  return next;
}

export function declineDeal(game, house, from, { nowMs = Date.now(), reason = null, withdraw = false } = {}) {
  const next = structuredClone(game);
  const deals = ensure(next).deals ||= {};
  const key = withdraw ? offerKey(house, from) : offerKey(from, house);
  if (!deals[key]) return game;
  delete deals[key];
  if (!withdraw) {
    next.state.journal.push({ kind: 'DEAL_REJECTED', from, to: house, houses: [from, house], reason, at: new Date(nowMs).toISOString() });
  }
  stamp(next, nowMs);
  return next;
}

// How a House led by the AI weighs a letter: what it gets against what it gives.
function itemWorth(game, map, item, receiver, giver) {
  if (item.type === 'GOLD') return item.amount;
  if (item.type === 'PASSAGE') return 1;
  if (item.type === 'LAND') {
    const type = map?.territories?.find(t => t.id === item.territory)?.type;
    return LAND_WORTH[type] || 4;
  }
  return 0;
}

export function aiVerdict(game, map, from, to) {
  const deal = game?.diplomacy?.deals?.[offerKey(from, to)];
  if (!deal) return null;
  const marriage = [...deal.give, ...deal.take].some(item => item.type === 'MARRIAGE');
  if (marriage && isOathbreaker(game, from)) return { accept: false, reason: 'не породнится с клятвопреступником' };
  const problem = dealProblem(game, map, from, to, deal);
  if (problem) return { accept: false, reason: problem };
  let gain = 0;
  for (const item of deal.give) gain += itemWorth(game, map, item, to, from);
  // Giving away is weighed heavier than taking: land most of all, roads hardly at all.
  for (const item of deal.take) {
    if (item.type === 'LAND') gain -= itemWorth(game, map, item, from, to) * 2;
    else if (item.type === 'PASSAGE') gain -= 0;
    else gain -= itemWorth(game, map, item, from, to);
  }
  // An alliance is worth having; a daughter given away is worth a little gold.
  if (marriage) gain += 3 + (deal.take.some(item => item.type === 'MARRIAGE') ? -1 : 1);
  // A well-spoken lord at the proposer's court sways the answer.
  gain += houseCourtTotals(game.state, from).deals * 2;
  if (gain >= 0) return { accept: true, reason: null };
  return { accept: false, reason: `сочли договор невыгодным: не хватает примерно ${Math.ceil(-gain)} золота` };
}

export function answerAiDeals(game, map, constants, aiHouses, { nowMs = Date.now() } = {}) {
  const keys = Object.keys(game?.diplomacy?.deals || {});
  if (!keys.length || !aiHouses?.length) return game;
  let next = game;
  for (const key of keys) {
    const [from, to] = key.split('>');
    if (!aiHouses.includes(to) || abandoned(next, to)) continue;
    const verdict = aiVerdict(next, map, from, to);
    if (!verdict) continue;
    next = verdict.accept
      ? acceptDeal(next, constants, map, to, from, { nowMs })
      : declineDeal(next, to, from, { nowMs, reason: verdict.reason });
  }
  return next;
}

export function dealsView(game, map, house) {
  const deals_in = [];
  const deals_out = [];
  for (const [key, deal] of Object.entries(game?.diplomacy?.deals || {})) {
    const [from, to] = key.split('>');
    const view = { give: describeHalf(deal.give, map), take: describeHalf(deal.take, map), at: deal.at };
    if (to === house) deals_in.push({ from, ...view });
    if (from === house) deals_out.push({ to, ...view });
  }
  return { deals_in, deals_out };
}
