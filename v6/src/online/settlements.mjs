// How a settlement grows, and how it is wiped off the earth.
//
// A land is born as the map made it — a village, a town, a capital. From there
// it climbs: village, great village, small town, town. Each step costs gold
// and time and wants people enough to be worth the name, and each one feeds
// the House better and lets it raise better men.
//
// The other way is shorter. A House that takes a land may burn it to the
// ground: the people are gone, nobody owns it, no gold comes from it and no
// man is raised there. Armies walk through the ashes freely. Later anyone who
// stands there with men may raise a village on the ruin and begin again.
//
// What a land is right now lives in state.tier[id]; where there is nothing
// written, it is what the map says.

import { moveRanks } from './ranks.mjs';
import { nearestOwnLand as nearestOwnLandFor } from './guests.mjs';

export const WASTE = 'Пустошь';

// The ladder, lowest first. A capital is nobody's step: it stands apart.
export const LADDER = Object.freeze(['Деревня', 'Большая деревня', 'Малый город', 'Город']);

export const GROWS = Object.freeze({
  'Деревня': { into: 'Большая деревня', gold: 6, people: 14, dayShare: 1 / 2 },
  'Большая деревня': { into: 'Малый город', gold: 10, people: 20, dayShare: 3 / 4 },
  'Малый город': { into: 'Город', gold: 16, people: 28, dayShare: 1 }
});

// Raising a village on a burnt land.
export const REBUILD = Object.freeze({ gold: 8, people: 4, order: 55, dayShare: 1 / 2 });

// What a sacking to the ground is worth, in gold for every soul.
export const RAZE_GOLD_PER_HEAD = 2;

// What the land is now: what has been built or burnt, else what the map says.
export function landKind(state, map, id) {
  const written = state?.tier?.[id];
  if (written) return written;
  return map?.territories?.find(t => t.id === id)?.type ?? null;
}

export function isWaste(state, id) {
  return state?.tier?.[id] === WASTE;
}

export function setKind(state, id, kind) {
  state.tier ||= {};
  state.tier[id] = kind;
}

// Whether this land can be grown, and what stands in the way.
export function growthStep(state, map, house, id) {
  const kind = landKind(state, map, id);
  const step = GROWS[kind];
  if (!step) return null;
  const land = state.territories?.[id];
  const people = Math.floor(Number(state.population?.[id] || 0));
  return {
    from: kind,
    into: step.into,
    gold: step.gold,
    people_needed: step.people,
    people,
    ours: land?.owner === house,
    enough_people: people >= step.people,
    gold_enough: Number(state.houses?.[house]?.gold || 0) >= step.gold,
    dayShare: step.dayShare
  };
}

export function assertCanGrow(state, map, house, id) {
  const step = growthStep(state, map, house, id);
  if (!step) throw new Error('этой земле некуда расти');
  if (!step.ours) throw new Error('это не твоя земля');
  if (!step.enough_people) throw new Error(`для этого нужно ${step.people_needed} душ, а здесь ${step.people}`);
  if (!step.gold_enough) throw new Error(`нужно ${step.gold} золота`);
  return step;
}

// Burns a land to the ground. The people are gone, the land is nobody's, and
// what stood on it stands no more.
export function razeLand(state, map, id, house, { nowMs = Date.now() } = {}) {
  const land = state.territories?.[id];
  if (!land) throw new Error('такой земли нет');
  const people = Math.floor(Number(state.population?.[id] || 0));
  const gold = people * RAZE_GOLD_PER_HEAD;

  // The hosts standing there do not burn with the town: they fall back to the
  // nearest land of their own. Only men with nowhere to go are lost. The ashes
  // are nobody's from this moment, so nobody falls back onto them.
  land.owner = null;
  const leaving = [];
  for (const [who, count] of Object.entries(land.warriors || {})) {
    const men = Math.floor(Number(count || 0));
    if (men <= 0) continue;
    const home = map ? nearestOwnLandFor(state, map, who, id) : null;
    if (home && home !== id) {
      moveRanks(state, map, id, home, who, men);
      const there = state.territories[home];
      there.warriors ||= {};
      there.warriors[who] = Number(there.warriors[who] || 0) + men;
      leaving.push({ house: who, men, to: home });
    } else {
      moveRanks(state, map, id, null, who, 0, { losses: men });
      leaving.push({ house: who, men, to: null });
    }
  }

  setKind(state, id, WASTE);
  state.population ||= {};
  state.population[id] = 0;
  if (state.growth) delete state.growth[id];
  if (state.order) delete state.order[id];
  delete land.fort;
  delete land.port;
  land.owner = null;
  land.warriors = {};
  state.houses[house].gold = Number(state.houses[house].gold || 0) + gold;
  state.journal.push({
    kind: 'LAND_RAZED', house, houses: [house], territory: id,
    gold, people_lost: people, fell_back: leaving, at: new Date(nowMs).toISOString()
  });
  return gold;
}

// Raising a village on the ashes: the House must stand there with men.
export function assertCanRebuild(state, map, house, id) {
  if (!isWaste(state, id)) throw new Error('эта земля не разорена');
  const land = state.territories?.[id];
  const men = Number(land?.warriors?.[house] || 0);
  if (men < 1) throw new Error('на пепелище надо стоять с воинами');
  if (Number(state.houses?.[house]?.gold || 0) < REBUILD.gold) throw new Error(`нужно ${REBUILD.gold} золота`);
  return true;
}

export function raiseVillage(state, map, id, house, { nowMs = Date.now() } = {}) {
  setKind(state, id, 'Деревня');
  state.population ||= {};
  state.population[id] = REBUILD.people;
  state.territories[id].owner = house;
  state.order ||= {};
  state.order[id] = REBUILD.order;
  state.journal.push({
    kind: 'LAND_REBUILT', house, houses: [house], territory: id, at: new Date(nowMs).toISOString()
  });
}

export function growLand(state, map, id, house, into, { nowMs = Date.now() } = {}) {
  setKind(state, id, into);
  state.journal.push({
    kind: 'LAND_GREW', house, houses: [house], territory: id, into, at: new Date(nowMs).toISOString()
  });
}

// ---------- what the land itself holds ----------
//
// Not every land is a village. Some are empty country with nothing on them but
// grass and stones — no people, no gold, nothing to take. Whoever walks in
// holds them, and whoever cares to may found a village there. And some lands,
// settled or not, hold something worth having: a seam of iron, a salt pan, a
// herd of horses on the open grass, a quarry of good stone.

export const RICHES = Object.freeze({
  'рудник': { name: 'Рудник', gold: 2, people: 0, lore: 'Железная жила: кузни работают, казна прибывает на 2 золота с рассветом.' },
  'солеварня': { name: 'Солеварня', gold: 1, people: 1, lore: 'Соляные варницы: золото и люди идут сюда сами — +1 золота и +1 душа с рассветом.' },
  'табун': { name: 'Табун', gold: 0, people: 1, lore: 'Вольные кони на лугах: +1 душа с рассветом, и всадников здесь растят, а не покупают.' },
  'каменоломня': { name: 'Каменоломня', gold: 1, people: 0, lore: 'Добрый камень: +1 золота с рассветом, и стены здесь кладут из своего.' }
});

export function richesAt(state, id) {
  const key = state?.riches?.[id];
  return RICHES[key] ? { key, ...RICHES[key] } : null;
}

// Lays out the empty country and what the land holds. Done once, when the
// game is made, from the map's own seed, so every player sees the same world.
export function seedLands(game, map) {
  const state = game.state;
  state.tier ||= {};
  state.riches ||= {};
  let seed = (Number(map.seed) || 7) ^ 0x3f21ab;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const keys = Object.keys(RICHES);
  const capitals = new Set(Object.values(map.capitals || {}));

  const makeEmpty = id => {
    state.tier[id] = WASTE;
    if (state.population) state.population[id] = 0;
    if (state.order) delete state.order[id];
    state.empty ||= {};
    state.empty[id] = true;
    // Nobody lives there, so nobody holds it against a comer.
    if (state.wild_guards) state.wild_guards[id] = 0;
  };

  // The lands around a capital are the same for every House, so whatever is
  // decided for one House's k-th land is decided for all of them: open country
  // and good ground fall evenly, and no House starts richer than another.
  const petal = /^([A-F])([1-6])$/;
  for (let k = 1; k <= 6; k += 1) {
    const mine = map.territories.filter(t => petal.test(t.id) && t.id.endsWith(String(k)));
    if (!mine.length) continue;
    const wild = mine.every(t => t.type === 'Дикая земля');
    const bare = wild && random() < 0.5;
    const rich = random() < 0.3 ? keys[Math.floor(random() * keys.length)] : null;
    for (const t of mine) {
      if (bare) makeEmpty(t.id);
      if (rich) state.riches[t.id] = rich;
    }
  }

  // Everything else — the marches between realms, the free city, the inner
  // ring — is laid out land by land.
  for (const t of [...map.territories].sort((a, b) => a.id.localeCompare(b.id))) {
    if (capitals.has(t.id) || petal.test(t.id)) continue;
    const free = !state.territories?.[t.id]?.owner;
    if (free && t.type === 'Дикая земля' && random() < 0.45) makeEmpty(t.id);
    if (random() < 0.3) state.riches[t.id] = keys[Math.floor(random() * keys.length)];
  }
  return game;
}

// Empty country that was never settled, as against a land burnt to the ground.
export function wasNeverSettled(state, id) {
  return Boolean(state?.empty?.[id]);
}
