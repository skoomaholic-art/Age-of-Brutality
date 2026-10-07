// Relations between Houses: neutral by default, war or alliance by deed.
//
// - Neutral Houses whose armies meet on the road go to war and fight.
// - Enemies fight on sight.
// - Allies let each other pass.
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
  game.state.journal.push({
    kind: 'WAR_DECLARED',
    aggressor: a,
    target: b,
    cause,
    betrayal: before === RELATION.ALLIANCE,
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

function canAlly(game, a, b) {
  if (relationOf(game, a, b) === RELATION.WAR) return 'с этим Домом идёт война';
  if (relationOf(game, a, b) === RELATION.ALLIANCE) return 'союз уже заключён';
  if (alliesOf(game, a).length >= MAX_ALLIES) return `у Дома ${a} уже есть союзник`;
  if (alliesOf(game, b).length >= MAX_ALLIES) return `у Дома ${b} уже есть союзник`;
  return null;
}

function formAlliance(game, a, b, nowMs) {
  const diplomacy = ensure(game);
  diplomacy.relations[pairKey(a, b)] = RELATION.ALLIANCE;
  for (const key of Object.keys(diplomacy.offers)) {
    const [from, to] = key.split('>');
    if ([a, b].includes(from) || [a, b].includes(to)) delete diplomacy.offers[key];
  }
  game.state.journal.push({
    kind: 'ALLIANCE_FORMED',
    houses: [a, b],
    at: new Date(nowMs).toISOString()
  });
  stamp(game, nowMs);
}

export function offerAlliance(game, constants, house, target, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, house, target);
  const reason = canAlly(game, house, target);
  if (reason) throw new Error(reason);

  const next = structuredClone(game);
  const diplomacy = ensure(next);
  if (diplomacy.offers[offerKey(target, house)]) {
    formAlliance(next, house, target, nowMs);
    return next;
  }
  diplomacy.offers[offerKey(house, target)] = new Date(nowMs).toISOString();
  stamp(next, nowMs);
  return next;
}

export function acceptAlliance(game, constants, house, from, { nowMs = Date.now() } = {}) {
  assertHouses(game, constants, house, from);
  if (!game?.diplomacy?.offers?.[offerKey(from, house)]) {
    throw new Error('такого предложения союза нет');
  }
  const reason = canAlly(game, house, from);
  if (reason) throw new Error(reason);
  const next = structuredClone(game);
  formAlliance(next, from, house, nowMs);
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
  next.state.journal.push({
    kind: 'ALLIANCE_BROKEN',
    house,
    other,
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
    if (canAlly(next, to, from)) {
      delete next.diplomacy.offers[key];
      stamp(next, nowMs);
    } else {
      formAlliance(next, from, to, nowMs);
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
  for (const key of Object.keys(game?.diplomacy?.offers || {})) {
    const [from, to] = key.split('>');
    if (house && to === house) offers_in.push(from);
    if (house && from === house) offers_out.push(to);
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
    passage_asked_in,
    passage_asked_out,
    // Whose roads are open to us, and to whom ours are.
    passage_from: Object.keys(passage).filter(host => passage[host].includes(house)),
    passage_to: [...(passage[house] || [])]
  };
}
