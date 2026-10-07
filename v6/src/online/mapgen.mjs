// Generates a map for a game of two to six Houses.
//
// The world is a wheel. Every House gets the same home: a capital ringed by
// six lands (one city, three villages, two wild lands), placed at equal
// distances around the centre. Neighbouring homes are joined by a borderland,
// the middle is a free city every House can reach, and the sea runs all around
// with islands off the borders. So each House has a land border and a sea
// border, the same number of towns at hand, and the same road to everyone.
//
// The seed turns the wheel, shuffles which petal holds the city and the
// villages, picks the names, and shapes coasts, rivers and woods.

const STEP = 60;                 // distance between neighbouring lands
const HOME_SPAN = 4 * STEP;      // capital to neighbouring capital
const NEAR = 80;                 // lands closer than this share a border
const DIRECT_HUB = 115;          // beyond this the centre needs an inner ring

export const MIN_HOUSES = 2;
export const MAX_HOUSES = 6;

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const round1 = value => Math.round(value * 10) / 10;
const polar = (radius, angle) => ({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const SYLLABLES_A = ['Вер', 'Тал', 'Кор', 'Мир', 'Сел', 'Рун', 'Хол', 'Нор', 'Эйр', 'Дай', 'Лиа', 'Тас', 'Кел', 'Аль', 'Жел', 'Орт', 'Бел', 'Гар', 'Сай', 'Тор'];
const SYLLABLES_B = ['вейн', 'мар', 'дал', 'хольм', 'гард', 'рен', 'вик', 'кар', 'бург', 'лин', 'стад', 'форд', 'мир', 'даль', 'рок', 'нес'];

function namePool(baseMap, random) {
  const classic = baseMap.territories
    .filter(t => t.type !== 'Столица' && t.type !== 'Половина острова')
    .map(t => t.name);
  const invented = [];
  for (const a of SYLLABLES_A) for (const b of SYLLABLES_B) invented.push(a + b);
  const seen = new Set();
  return [...shuffle(classic, random), ...shuffle(invented, random)].filter(name => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function incomeByType(baseMap) {
  const out = {};
  for (const t of baseMap.territories) if (!(t.type in out)) out[t.type] = t.gold_income;
  return out;
}

// How many lands a game of `count` Houses gets, by kind.
export function mapPlan(count) {
  const ringRadius = count === 2 ? 2 * STEP : HOME_SPAN / (2 * Math.sin(Math.PI / count));
  const innerRing = count >= 3 && ringRadius - STEP > DIRECT_HUB;
  const islandPairs = count === 2 ? 1 : count % 2 === 0 ? count / 2 : count;
  const borderlands = count === 2 ? 2 : count;
  const lands = count * 7 + borderlands + 1 + (innerRing ? count : 0) + islandPairs * 2;
  return { houses: count, ringRadius, innerRing, islandPairs, borderlands, lands };
}

export function generateMap(baseMap, constants, { houses, seed = 1 } = {}) {
  const count = houses.length;
  if (count < MIN_HOUSES || count > MAX_HOUSES) {
    throw new Error(`a map needs ${MIN_HOUSES} to ${MAX_HOUSES} Houses`);
  }
  for (const house of houses) {
    if (!constants.houses.includes(house)) throw new Error(`unknown house ${house}`);
  }

  const random = seeded(Number(seed) || 1);
  const plan = mapPlan(count);
  const R = plan.ringRadius;
  const turn = random() * Math.PI * 2;
  const income = incomeByType(baseMap);
  const names = namePool(baseMap, random);
  const takeName = () => names.shift();

  // Petals around a capital: 0 looks out to sea, 3 looks to the centre.
  // 0, 1 and 5 lie on the coast and hold the House's ports.
  const roles = (() => {
    const order = shuffle(['Город', 'Деревня', 'Деревня', 'Деревня', 'Дикая земля', 'Дикая земля'], random);
    // The harbour facing the open sea is always a settlement.
    const settled = order.findIndex(type => type !== 'Дикая земля');
    [order[0], order[settled]] = [order[settled], order[0]];
    return order;
  })();

  const sites = [];          // { id, pos, type, sector, name, mass, island }
  const edges = new Set();
  const link = (a, b) => edges.add([a, b].sort().join('|'));
  const site = (id, pos, type, sector, name, extra = {}) => {
    sites.push({ id, pos, type, sector, name, mass: 'M', ...extra });
    return id;
  };

  const classicCapital = Object.fromEntries(
    Object.entries(baseMap.capitals).map(([house, id]) => [
      house,
      baseMap.territories.find(t => t.id === id).name
    ])
  );

  const capitals = {};
  const angles = houses.map((_, i) => turn + (i * 2 * Math.PI) / count);
  const letter = i => String.fromCharCode(65 + i);
  const petal = (i, k) => `${letter(i)}${k + 1}`;

  houses.forEach((house, i) => {
    const centre = polar(R, angles[i]);
    const capital = site(`${letter(i)}0`, centre, 'Столица', house, classicCapital[house]);
    capitals[house] = capital;
    for (let k = 0; k < 6; k += 1) {
      const id = site(petal(i, k), add(centre, polar(STEP, angles[i] + (k * Math.PI) / 3)), roles[k], house, takeName());
      link(capital, id);
    }
    for (let k = 0; k < 6; k += 1) link(petal(i, k), petal(i, (k + 1) % 6));
  });

  // The free city in the middle.
  const hub = site('X0', { x: 0, y: 0 }, 'Город', 'Срединные земли', takeName());

  if (count === 2) {
    // Two Houses face each other across the free city, with a pass on each flank.
    link(hub, petal(0, 3));
    link(hub, petal(1, 3));
    for (const [n, side] of [[1, 1], [2, -1]]) {
      const id = site(`P${n}`, polar(STEP + 2, angles[0] + (side * Math.PI) / 2), 'Дикая земля', 'Пограничье', takeName());
      link(id, hub);
      link(id, petal(0, side === 1 ? 2 : 4));
      link(id, petal(1, side === 1 ? 4 : 2));
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      const a = polar(R, angles[i]);
      const b = polar(R, angles[next]);
      site(`P${i + 1}`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'Дикая земля', 'Пограничье', takeName());
    }
    if (plan.innerRing) {
      const inner = (R - STEP) / 2;
      for (let i = 0; i < count; i += 1) {
        const id = site(`X${i + 1}`, polar(inner, angles[i]), 'Деревня', 'Срединные земли', takeName());
        link(id, hub);
        link(id, petal(i, 3));
      }
      for (let i = 0; i < count; i += 1) link(`X${i + 1}`, `X${((i + 1) % count) + 1}`);
    } else {
      for (let i = 0; i < count; i += 1) link(hub, petal(i, 3));
    }
  }

  // Lands that lie side by side share a border.
  for (let i = 0; i < sites.length; i += 1) {
    for (let j = i + 1; j < sites.length; j += 1) {
      if (dist(sites[i].pos, sites[j].pos) <= NEAR) link(sites[i].id, sites[j].id);
    }
  }

  // The sea: a ring of waypoints around the land, one off every home and one
  // off every border, with islands at the border waypoints.
  const mainlandReach = Math.max(...sites.map(s => Math.hypot(s.pos.x, s.pos.y)));
  const waypoints = {};
  const lanes = [];
  const ports = new Set();
  const islands = {};
  const islandBonus = {};
  const bonusCycle = [[1, 0], [0, 1], [1, 1]];
  const classicIslands = [...new Set(baseMap.territories
    .filter(t => t.type === 'Половина острова')
    .map(t => t.name.replace(/\s*—\s*[AB]$/, '')))];
  const islandNames = shuffle(classicIslands, random);
  const bonusText = pair =>
    pair[0] && pair[1] ? '+1 золото и +1 Влияние в фазу дохода'
      : pair[0] ? '+1 золото в фазу дохода' : '+1 Влияние в фазу дохода';

  const boundaries = count === 2 ? 2 : count;
  const boundaryAngle = i => angles[i] + Math.PI / count;
  const hasIsland = i => (count === 2 ? i === 0 : count % 2 === 0 ? i % 2 === 0 : true);
  let islandIndex = 0;

  // Sea waypoints stand in open water all around the land, so no lane ever
  // runs over the shore: each is placed beyond the outermost land in its
  // direction, and a port is joined only by a line that crosses no other land.
  const mainland = sites.map(s => s.pos);
  const beyond = (angle, gap) => {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const reach = Math.max(...mainland.map(p => p.x * dir.x + p.y * dir.y));
    return polar(reach + gap, angle);
  };
  const toSegment = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  const perHouse = count <= 3 ? 4 : 2;
  const ringSize = count * perHouse;
  const ring = [];
  let extra = 0;
  for (let k = 0; k < ringSize; k += 1) {
    const angle = angles[0] + (k * 2 * Math.PI) / ringSize;
    const house = k / perHouse;
    const border = (k - perHouse / 2) / perHouse;
    const id = Number.isInteger(house) ? `M-O${house + 1}`
      : Number.isInteger(border) && border < boundaries ? `M-B${border + 1}`
        : `M-X${extra += 1}`;
    ring.push({ id, angle, pos: beyond(angle, 78) });
  }
  // Push the ring out until no stretch of it comes close to land.
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (let k = 0; k < ringSize; k += 1) {
      const a = ring[k], b = ring[(k + 1) % ringSize];
      if (mainland.some(p => toSegment(p, a.pos, b.pos) < 62)) {
        for (const node of [a, b]) node.gap = (node.gap || 78) + 14;
        moved = true;
      }
    }
    if (!moved) break;
    for (const node of ring) node.pos = beyond(node.angle, node.gap || 78);
  }
  const mainSites = [...sites];
  for (let k = 0; k < ringSize; k += 1) {
    const node = ring[k];
    waypoints[node.id] = node.pos;
    lanes.push([node.id, ring[(k + 1) % ringSize].id]);
    // The nearest shore lands with a clear run to this waypoint become its ports.
    const clear = mainSites
      .filter(s => !mainSites.some(t => t !== s && toSegment(t.pos, s.pos, node.pos) < 36))
      .map(s => ({ s, d: dist(s.pos, node.pos) }))
      .sort((x, y) => x.d - y.d || (x.s.id < y.s.id ? -1 : 1));
    for (const { s, d } of clear) {
      if (d > clear[0].d + 6) break;
      lanes.push([s.id, node.id]);
      ports.add(s.id);
    }
  }

  for (let i = 0; i < boundaries; i += 1) {
    if (!hasIsland(i)) continue;
    const id = `M-B${i + 1}`;
    const node = ring.find(item => item.id === id);
    const angle = node.angle;
    islandIndex += 1;
    const key = `S${String(islandIndex).padStart(2, '0')}`;
    const pair = bonusCycle[(islandIndex - 1) % bonusCycle.length];
    const centre = add(node.pos, polar(74, angle));
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
    const baseName = islandNames[(islandIndex - 1) % islandNames.length] || `Остров ${islandIndex}`;
    const halves = ['A', 'B'].map((half, h) => {
      const sign = h === 0 ? -1 : 1;
      const halfId = `${key}-${half}`;
      site(halfId, add(centre, { x: tangent.x * 16 * sign, y: tangent.y * 16 * sign }), 'Половина острова', 'Острова', `${baseName} — ${half}`, {
        mass: key,
        island: key,
        island_bonus: bonusText(pair)
      });
      lanes.push([id, halfId]);
      ports.add(halfId);
      return halfId;
    });
    link(halves[0], halves[1]);
    islands[key] = halves;
    islandBonus[key] = pair;
  }

  // Shift everything into positive coordinates with open sea around.
  const all = [...sites.map(s => s.pos), ...Object.values(waypoints)];
  const margin = 150;
  const minX = Math.min(...all.map(p => p.x)) - margin;
  const minY = Math.min(...all.map(p => p.y)) - margin;
  const maxX = Math.max(...all.map(p => p.x)) + margin;
  const maxY = Math.max(...all.map(p => p.y)) + margin;
  const shift = p => ({ x: round1(p.x - minX), y: round1(p.y - minY) });

  const coordinates = {};
  const masses = {};
  const territories = sites.map(s => {
    coordinates[s.id] = shift(s.pos);
    masses[s.id] = s.mass;
    return {
      id: s.id,
      name: s.name,
      house_sector: s.sector,
      type: s.type,
      gold_income: income[s.type] ?? 0,
      is_central_half: false,
      island: s.island || null,
      island_bonus: s.island_bonus || null,
      icon: s.type === 'Столица' ? '★' : '',
      ...(s.type === 'Половина острова' ? { resistance: 1 } : {})
    };
  });
  const seaWaypoints = Object.fromEntries(Object.entries(waypoints).map(([id, p]) => [id, shift(p)]));
  const origin = shift({ x: 0, y: 0 });

  // A river runs out of the heartland along every border and falls into the sea.
  const rivers = [];
  for (let i = 0; i < boundaries; i += 1) {
    const angle = boundaryAngle(i) + (random() - 0.5) * 0.5;
    const start = polar(count === 2 ? 24 : Math.max(26, R * 0.32), boundaryAngle(i) + (random() - 0.5) * 0.6);
    rivers.push({ ...shift(start), angle, seed: Math.floor(random() * 1e6) });
  }

  return {
    game: baseMap.game,
    version: 'V6-GENERATED-2',
    generated: true,
    seed: Number(seed) || 1,
    houses: [...houses],
    plan,
    territories,
    coordinates,
    land_edges: [...edges].sort().map(key => key.split('|')),
    sea_edges: [],
    ports: [...ports].sort(),
    capitals,
    islands,
    island_bonus: islandBonus,
    rules: { ...baseMap.rules },
    sea_waypoints: seaWaypoints,
    sea_lane_edges: lanes,
    masses,
    art: {
      bounds: { x0: 0, y0: 0, x1: round1(maxX - minX), y1: round1(maxY - minY) },
      centre: origin,
      rivers
    }
  };
}
