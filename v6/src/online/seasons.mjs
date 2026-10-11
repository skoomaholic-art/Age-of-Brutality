// The turning year. A game does not stand in one season: two days of summer,
// two days of winter, and round again. The map is repainted when the season
// turns, and winter is felt on the road — the going is heavier and the cold
// takes its own from every host that stands outside its own realm.
//
// The season follows from the day alone, so the server, the painter and every
// player agree on it without anything being written down.

export const SUMMER = 'лето';
export const WINTER = 'зима';

// How many days one season holds.
export const SEASON_DAYS = 2;

// Winter: the roads are heavier, and the cold wears a host even on open ground.
export const COLD = Object.freeze({ slow: 1.2, wear: 0.04, why: 'в стужу' });

// A world made in winter begins in winter; one made in summer begins in summer.
function firstSpell(map) {
  return map?.season === WINTER ? 1 : 0;
}

export function seasonOfDay(map, day) {
  const number = Math.max(1, Math.floor(Number(day) || 1));
  const spell = Math.floor((number - 1) / SEASON_DAYS) + firstSpell(map);
  return spell % 2 === 0 ? SUMMER : WINTER;
}

export function seasonNow(game, map) {
  return seasonOfDay(map, game?.rounds?.number || 1);
}

export function isWinter(game, map) {
  return seasonNow(game, map) === WINTER;
}

// The first day of the next season, for the word under the map.
export function seasonTurnsOn(game, map) {
  const day = Math.max(1, Math.floor(Number(game?.rounds?.number) || 1));
  const here = seasonOfDay(map, day);
  let next = day + 1;
  while (next < day + SEASON_DAYS * 2 + 2 && seasonOfDay(map, next) === here) next += 1;
  return next;
}
