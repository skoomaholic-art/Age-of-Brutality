// The lie of the land under an army's feet.
//
// Every land of a generated map carries a `terrain`: plain ground, mountains,
// marsh, desert or snow. Rough ground slows a march and wears an army down:
// men fall sick, horses founder, stragglers are lost. None of it is a battle,
// so these are called non-battle losses, and a host taking them shows a small
// skull on the map.
//
// map.terrain  { territoryId: kind }
// map.ridges   [[a, b], ...]  roads a mountain wall closed for good
// map.reefs    [seaWaypointId, ...]  shallows that tear a fleet's hulls
// map.season   'зима' on a winter map, else null

import { COLD, WINTER } from './seasons.mjs';

export const PLAIN = 'равнина';

export const TERRAIN = Object.freeze({
  [PLAIN]: { name: 'равнина', slow: 1, wear: 0, guard: 0, why: '', lore: 'Ровная земля: идти по ней легко.' },
  'горы': {
    name: 'горы', slow: 1.8, wear: 0.1, guard: 2, why: 'в горах',
    lore: 'Горы: тропы круты, войско идёт вдвое медленнее. В чужих и вольных горах оно теряет людей на кручах; в исконных землях своего Дома воинов кормят и укрывают. Кто стоит в горах, тому +2 к обороне.'
  },
  'болота': {
    name: 'болота', slow: 1.6, wear: 0.07, guard: 1, why: 'в болотах',
    lore: 'Болота: гати вязки, войско идёт медленно. В чужих и вольных болотах его косит лихорадка; в исконных землях своего Дома стоят гати и жильё. Кто стоит в болотах, тому +1 к обороне.'
  },
  'пустыня': {
    name: 'пустыня', slow: 1.25, wear: 0.13, guard: 0, why: 'в пустыне',
    lore: 'Пустыня: зной и песок изматывают войско в чужих и вольных землях; в исконных землях своего Дома есть колодцы.'
  },
  'снега': {
    name: 'снега', slow: 1.45, wear: 0.13, guard: 1, why: 'в снегах',
    lore: 'Снега: мороз и сугробы держат войско, а в чужих и вольных землях уносят отставших; в исконных землях своего Дома есть тёплый кров. Кто стоит в снегах, тому +1 к обороне.'
  }
});

// A fleet standing over a reef is holed by the rocks; a storm is worse still.
export const REEF_SHARE = 0.12;
export const STORM_SHARE = 0.18;

export function terrainOf(map, id) {
  const kind = map?.terrain?.[id];
  return TERRAIN[kind] ? kind : PLAIN;
}

export function terrainInfo(map, id) {
  return TERRAIN[terrainOf(map, id)];
}

// How much longer a march over this road takes: the mean of both ends.
export function roadSlow(map, a, b, season = null) {
  const slowA = TERRAIN[terrainOf(map, a)]?.slow ?? 1;
  const slowB = TERRAIN[terrainOf(map, b)]?.slow ?? 1;
  // Winter lies on every road alike: snow, mud and short days.
  return ((slowA + slowB) / 2) * (season === WINTER ? COLD.slow : 1);
}

// What the lie of the land is worth to whoever stands on it in a fight: a pass
// in the mountains is held by few against many, a marsh breaks a charge.
export function terrainGuard(map, id) {
  return Number(TERRAIN[terrainOf(map, id)]?.guard || 0);
}

export function isReef(map, id) {
  return Boolean(map?.reefs?.includes(id));
}

// A storm standing over this water, if any.
export function stormAt(state, id) {
  return (state?.storms || []).find(storm => storm.at === id) || null;
}

/**
 * Why a host standing here bleeds without a battle, and how hard. Returns null
 * on safe ground. Used both by the dawn and by the skull the client shows.
 */
export function wearAt(map, state, id, house, season = null) {
  if (map?.sea_waypoints?.[id]) {
    const days = Number(state?.sea_nodes?.[id]?.days_at_sea?.[house] || 0);
    const storm = stormAt(state, id);
    if (storm) return { rate: STORM_SHARE, why: 'в шторме', text: 'Буря треплет ладьи: люди и кони тонут.' };
    if (isReef(map, id)) return { rate: REEF_SHARE, why: 'на рифах', text: 'Ладьи стоят над рифами: камни рвут днища.' };
    if (days >= 1) return { rate: 0.2, why: 'в море', text: `Ладьи в открытом море ${days}-й день: цинга, голод и шторма.` };
    return null;
  }
  const kind = terrainOf(map, id);
  const here = TERRAIN[kind];
  // In winter even open ground takes its toll of a host quartered abroad.
  const cold = season === WINTER ? COLD.wear : 0;
  const rate = (here?.wear || 0) + cold;
  if (rate <= 0) return null;
  if (!here || here.wear <= 0) {
    return { rate, why: COLD.why, text: 'Зима: мороз и бескормица уносят людей, стоящих на чужой земле.', terrain: kind };
  }
  return {
    rate, why: here.why,
    text: cold ? `${here.lore} Зимой стужа берёт своё сверх того.` : here.lore,
    terrain: kind
  };
}
