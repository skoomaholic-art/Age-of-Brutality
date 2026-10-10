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

export const PLAIN = 'равнина';

export const TERRAIN = Object.freeze({
  [PLAIN]: { name: 'равнина', slow: 1, wear: 0, why: '', lore: 'Ровная земля: идти по ней легко.' },
  'горы': {
    name: 'горы', slow: 1.8, wear: 0.1, why: 'в горах',
    lore: 'Горы: тропы круты, войско идёт вдвое медленнее и теряет людей на кручах.'
  },
  'болота': {
    name: 'болота', slow: 1.6, wear: 0.07, why: 'в болотах',
    lore: 'Болота: гати вязки, войско идёт медленно, а лихорадка косит людей.'
  },
  'пустыня': {
    name: 'пустыня', slow: 1.25, wear: 0.13, why: 'в пустыне',
    lore: 'Пустыня: воды нет, зной и песок изматывают войско.'
  },
  'снега': {
    name: 'снега', slow: 1.45, wear: 0.13, why: 'в снегах',
    lore: 'Снега: мороз и сугробы держат войско и уносят отставших.'
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
export function roadSlow(map, a, b) {
  const slowA = TERRAIN[terrainOf(map, a)]?.slow ?? 1;
  const slowB = TERRAIN[terrainOf(map, b)]?.slow ?? 1;
  return (slowA + slowB) / 2;
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
export function wearAt(map, state, id, house) {
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
  if (!here || here.wear <= 0) return null;
  return { rate: here.wear, why: here.why, text: here.lore, terrain: kind };
}
