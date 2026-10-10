// What one House thinks of another.
//
// Every deed is remembered: a blow struck, a land taken, an oath broken, a
// marriage made, gold given in a fair bargain. The memory of it fades a little
// with every dawn, but it never turns on its own from hate into love — only
// deeds do that. A House under the AI weighs this when it chooses whom to
// strike and whose word to take.
//
// game.diplomacy.opinion["A>B"] = number, from -100 (hatred) to 100 (love),
// read as "what A thinks of B".

export const OPINION = Object.freeze({
  floor: -100,
  ceiling: 100,
  // How far a memory fades back towards indifference at every dawn.
  fade: 3,
  deeds: {
    ATTACKED: -35,        // marched on our land
    LAND_TAKEN: -25,      // and took it
    CAPITAL_TAKEN: -45,   // took the seat of the House
    WAR: -20,             // declared war
    OATH_BROKEN: -50,     // broke an alliance or a truce
    SPY_CAUGHT: -15,      // sent a spy and was caught at it
    AMBUSHED: -15,        // caught our column on the road
    PEACE: 12,            // made peace
    PASSAGE: 10,          // let our hosts through
    GIFT: 4,              // per gold given in a bargain
    MARRIAGE: 30,         // married into our House
    ALLIANCE: 25,         // stood with us
    HELPED: 20,           // fought on our side
    NEIGHBOUR: -12        // came up to our border where there was nobody before
  }
});

const key = (a, b) => `${a}>${b}`;

function book(game) {
  game.diplomacy ||= {};
  game.diplomacy.opinion ||= {};
  return game.diplomacy.opinion;
}

export function opinionOf(game, a, b) {
  if (a === b) return OPINION.ceiling;
  return Math.round(Number(game?.diplomacy?.opinion?.[key(a, b)] || 0));
}

// In words, as a herald would put it.
export function opinionWord(value) {
  if (value <= -60) return 'ненависть';
  if (value <= -25) return 'вражда';
  if (value < -8) return 'холодно';
  if (value <= 8) return 'ровно';
  if (value < 30) return 'приязнь';
  if (value < 60) return 'дружба';
  return 'братство';
}

// `a` thinks worse (or better) of `b` by `delta`.
export function nudgeOpinion(game, a, b, delta) {
  if (!a || !b || a === b || !Number.isFinite(delta) || delta === 0) return;
  const ledger = book(game);
  const now = Number(ledger[key(a, b)] || 0) + delta;
  ledger[key(a, b)] = Math.max(OPINION.floor, Math.min(OPINION.ceiling, Math.round(now)));
}

// A deed by `doer` against or for `about`, remembered by everyone who saw it.
// The House it was done to remembers it fully; the rest of the world a third
// as much, and only for the deeds that are nobody's private business.
export function rememberDeed(game, { doer, about, deed, amount = 1, houses = [] }) {
  const worth = OPINION.deeds[deed];
  if (!worth || !doer || !about) return;
  const full = deed === 'GIFT' ? worth * Math.max(1, Math.round(amount)) : worth;
  nudgeOpinion(game, about, doer, full);
  // A marriage or an alliance is felt on both sides; a blow only by the struck.
  if (deed === 'MARRIAGE' || deed === 'ALLIANCE' || deed === 'PEACE') nudgeOpinion(game, doer, about, full);
  const loud = ['OATH_BROKEN', 'CAPITAL_TAKEN', 'WAR'];
  if (!loud.includes(deed)) return;
  for (const other of houses) {
    if (other === doer || other === about) continue;
    nudgeOpinion(game, other, doer, Math.round(full / 3));
  }
}

// Every dawn the sting of an old deed dulls a little.
export function opinionDawn(game) {
  const ledger = game?.diplomacy?.opinion;
  if (!ledger) return;
  for (const [pair, value] of Object.entries(ledger)) {
    const now = Number(value || 0);
    if (!now) { delete ledger[pair]; continue; }
    const next = now > 0 ? Math.max(0, now - OPINION.fade) : Math.min(0, now + OPINION.fade);
    if (next === 0) delete ledger[pair];
    else ledger[pair] = next;
  }
}


// Who stands on whose border. A House that was far away and is suddenly over
// the fence is a worry, whatever it says: the first time it comes up to our
// march, we think the worse of it. Afterwards the two are simply neighbours
// and nothing more is held against them for it.
export function watchBorders(game, map, { nowMs = Date.now() } = {}) {
  const state = game.state;
  if (!state?.territories) return false;
  const near = {};
  for (const [a, b] of map.land_edges || []) { (near[a] ||= []).push(b); (near[b] ||= []).push(a); }
  const touching = {};
  for (const house of Object.keys(state.houses || {})) touching[house] = new Set();
  for (const [id, land] of Object.entries(state.territories)) {
    const owner = land.owner;
    if (!owner) continue;
    for (const other of near[id] || []) {
      const theirs = state.territories[other]?.owner;
      if (!theirs || theirs === owner) continue;
      (touching[owner] ||= new Set()).add(theirs);
    }
  }
  // The borders a game begins with are nobody's doing: they are written down
  // once, quietly, and only what changes afterwards is held against anyone.
  const first = !state.borders_seen;
  const known = state.borders_seen ||= {};
  let changed = false;
  for (const [house, others] of Object.entries(touching)) {
    const before = new Set(known[house] || []);
    if (!first) {
      for (const other of others) {
        if (before.has(other)) continue;
        rememberDeed(game, { doer: other, about: house, deed: 'NEIGHBOUR' });
        state.journal.push({
          kind: 'NEW_NEIGHBOUR', house, houses: [house, other], other,
          at: new Date(nowMs).toISOString()
        });
        changed = true;
      }
    }
    known[house] = [...others].sort();
  }
  return changed;
}
