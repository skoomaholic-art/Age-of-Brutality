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

// The lie of the land. The roads between lands decide the game and stay fair
// in every shape; the shape decides where the water runs:
// - wheel: one continent, the homes around a free city in the middle;
// - peninsulas: every home on its own peninsula, joined to the heartland by a
//   neck of land, with bays of sea between neighbours;
// - archipelago: every home on its own island, the heartland an island too;
// - inland: a ring of land around an inland sea, no city in the middle.
// A warp then bends the whole picture (stretched, crescent, wavy) without
// changing a single road.
// - atoll: a ring of island homes with islets between them around a lagoon;
// - lake-isle: a ring of land around a lake with the free city on an isle in it;
// - fjords: one continent cut by deep bays between the homes;
// - shattered: island homes around a heartland broken into islets.
export const MAP_SHAPES = ['wheel', 'peninsulas', 'archipelago', 'inland', 'atoll', 'lake-isle', 'fjords', 'shattered'];
export const MAP_WARPS = ['none', 'stretch', 'crescent', 'wave', 'spiral', 'hourglass', 'ripple', 'zigzag', 'shear', 'teardrop'];
export const SHAPE_NAMES = {
  wheel: 'материк', peninsulas: 'полуострова', archipelago: 'архипелаг', inland: 'внутреннее море',
  atoll: 'кольцо островов', 'lake-isle': 'остров в озере', fjords: 'фьорды', shattered: 'россыпь островов'
};
const SHAPE = {
  wheel: { r: 1 },
  peninsulas: { r: 1.5, apart: true, neck: true },
  archipelago: { r: 1.9, apart: true, straits: true },
  inland: { r: 1, noHub: true, lake: true },
  atoll: { r: 1.6, noHub: true, lake: true },
  'lake-isle': { r: 1.5, lake: true },
  fjords: { r: 1.2, apart: true, neck: true },
  shattered: { r: 1.9, apart: true, straits: true }
};
// Shapes that need at least three Houses fall back to a kin shape for two.
const FOR_TWO = { peninsulas: 'wheel', fjords: 'wheel', shattered: 'archipelago' };

export function pickMapShape(count, seed) {
  const random = seeded((Number(seed) || 1) ^ 0x51ed27);
  const shapes = count === 2 ? MAP_SHAPES.filter(s => !FOR_TWO[s]) : MAP_SHAPES;
  const shape = shapes[Math.floor(random() * shapes.length)];
  const warp = MAP_WARPS[Math.floor(random() * MAP_WARPS.length)];
  return { shape, warp };
}

// How many lands a game of `count` Houses gets, by kind.
export function mapPlan(count, shape = 'wheel') {
  if (count === 2 && FOR_TWO[shape]) shape = FOR_TWO[shape];
  const ringRadius = count === 2 ? 2 * STEP : HOME_SPAN / (2 * Math.sin(Math.PI / count));
  const apart = Boolean(SHAPE[shape]?.apart);
  const innerRing = count >= 3 && (apart || (shape === 'wheel' && ringRadius - STEP > DIRECT_HUB));
  const islandPairs = count === 2 ? 1 : count % 2 === 0 ? count / 2 : count;
  const borderlands = count === 2 ? 2 : count;
  const hub = SHAPE[shape]?.noHub ? 0 : 1;
  const lands = count * 7 + borderlands + hub + (innerRing ? count : 0) + islandPairs * 2;
  return { houses: count, shape, ringRadius, innerRing, islandPairs, borderlands, lands };
}

export function generateMap(baseMap, constants, { houses, seed = 1, shape = 'wheel', warp = 'none', seaMesh = false } = {}) {
  if (!MAP_SHAPES.includes(shape)) shape = 'wheel';
  if (!MAP_WARPS.includes(warp)) warp = 'none';
  if (houses.length === 2 && FOR_TWO[shape]) shape = FOR_TWO[shape];
  const form = SHAPE[shape];
  const count = houses.length;
  if (count < MIN_HOUSES || count > MAX_HOUSES) {
    throw new Error(`a map needs ${MIN_HOUSES} to ${MAX_HOUSES} Houses`);
  }
  for (const house of houses) {
    if (!constants.houses.includes(house)) throw new Error(`unknown house ${house}`);
  }

  const random = seeded(Number(seed) || 1);
  const plan = mapPlan(count, shape);
  const apart = Boolean(form.apart);
  // Peninsulas and islands stand farther out, so the sea can run between them.
  const R = plan.ringRadius * form.r;
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
  let bendRiver = null;
  const edges = new Set();
  const link = (a, b) => edges.add([a, b].sort().join('|'));
  const site = (id, pos, type, sector, name, extra = {}) => {
    sites.push({ id, pos, type, sector, name, mass: 'M', ...extra });
    // Which lands share one shore: a home island, the heartland, or an islet of its own.
    if (!extra.mass) {
      const home = /^[A-F]\d$/.test(id);
      if (['archipelago', 'shattered', 'atoll'].includes(shape) && home) sites[sites.length - 1].mass = `H${id[0]}`;
      else if (shape === 'archipelago' && !home) sites[sites.length - 1].mass = 'C';
      else if ((shape === 'shattered' || shape === 'atoll') && !home) sites[sites.length - 1].mass = id;
      else if (shape === 'lake-isle' && id === 'X0') sites[sites.length - 1].mass = 'C';
    }
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

  // The free city in the middle (an inland sea has none).
  const hub = form.noHub ? null : site('X0', { x: 0, y: 0 }, 'Город', 'Срединные земли', takeName());
  // Joins a borderland to the `k` nearest lands of a home.
  const linkNearest = (id, i, k) => {
    const from = sites.find(s => s.id === id).pos;
    const near = [0, 1, 2, 3, 4, 5].map(n => petal(i, n))
      .map(pid => ({ pid, d: dist(sites.find(s => s.id === pid).pos, from) }))
      .sort((a, b) => a.d - b.d || (a.pid < b.pid ? -1 : 1));
    for (const { pid } of near.slice(0, k)) link(id, pid);
  };

  if (count === 2 && (shape === 'atoll' || shape === 'lake-isle')) {
    // Two homes around a lagoon or a lake, a borderland on each flank.
    for (const [n, side] of [[1, 1], [2, -1]]) {
      const id = site(`P${n}`, polar(R * 0.75, angles[0] + (side * Math.PI) / 2), 'Дикая земля', 'Пограничье', takeName());
      if (shape === 'lake-isle') { linkNearest(id, 0, 1); linkNearest(id, 1, 1); }
    }
  } else if ((shape === 'atoll' || shape === 'lake-isle') && count > 2) {
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      const a = polar(R, angles[i]);
      const b = polar(R, angles[next]);
      const id = site(`P${i + 1}`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'Дикая земля', 'Пограничье', takeName());
      if (shape === 'lake-isle') { linkNearest(id, i, 1); linkNearest(id, next, 1); }
    }
  } else if (count === 2 && shape === 'inland') {
    // Two homes around a lake, a pass on each flank.
    for (const [n, side] of [[1, 1], [2, -1]]) {
      const id = site(`P${n}`, polar(STEP + 2, angles[0] + (side * Math.PI) / 2), 'Дикая земля', 'Пограничье', takeName());
      link(id, petal(0, side === 1 ? 2 : 4));
      link(id, petal(1, side === 1 ? 4 : 2));
    }
  } else if (count === 2 && shape === 'archipelago') {
    // Two island homes and a heartland island with a pass at each end.
    for (const [n, side] of [[1, 1], [2, -1]]) {
      const id = site(`P${n}`, polar(STEP + 2, angles[0] + (side * Math.PI) / 2), 'Дикая земля', 'Пограничье', takeName());
      link(id, hub);
    }
  } else if (apart) {
    // The heartland: the free city, an inner ring, and a borderland between
    // every two spokes. Each home is joined to it by a single neck of land
    // (peninsulas) or only by sea (archipelago).
    const inner = Math.min((R - STEP) / 2, 95);
    const islets = shape === 'shattered';
    for (let i = 0; i < count; i += 1) {
      const id = site(`X${i + 1}`, polar(inner, angles[i]), 'Деревня', 'Срединные земли', takeName());
      if (!islets) link(id, hub);
      if (form.neck) link(id, petal(i, 3));
    }
    for (let i = 0; i < count; i += 1) {
      const id = site(`P${i + 1}`, polar(inner * 1.25, angles[i] + Math.PI / count), 'Дикая земля', 'Пограничье', takeName());
      if (!islets) {
        link(id, `X${i + 1}`);
        link(id, `X${((i + 1) % count) + 1}`);
      }
      // Fjords: the borderland also touches both homes, so the bays stay bays.
      if (shape === 'fjords') { linkNearest(id, i, 1); linkNearest(id, (i + 1) % count, 1); }
    }
  } else if (count === 2) {
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
    if (!hub) {
      // An inland sea in the middle: the homes and borderlands make a ring around it.
    } else if (plan.innerRing) {
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

  // Lands that lie side by side share a border (where the shape is one piece).
  if (!apart && shape !== 'atoll' && shape !== 'lake-isle') {
    for (let i = 0; i < sites.length; i += 1) {
      for (let j = i + 1; j < sites.length; j += 1) {
        if (dist(sites[i].pos, sites[j].pos) <= NEAR) link(sites[i].id, sites[j].id);
      }
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
  // Inner waters: the straits between island homes and the inland sea.
  const innerNodes = [];
  if (form.straits || form.lake) {
    const lake = Boolean(form.lake);
    for (let i = 0; i < count; i += 1) {
      const angle = shape === 'atoll' ? angles[i] + Math.PI / (2 * count) : angles[i] + Math.PI / count;
      const radius = shape === 'inland' ? Math.max(8, (R - STEP - 30) * 0.5)
        : shape === 'atoll' ? (R - STEP - 30) * 0.6
          : shape === 'lake-isle' ? (26 + (R - STEP - 30)) / 2
            : (Math.min((R - STEP) / 2, 95) * 1.25 + R - STEP) / 2 + 6;
      innerNodes.push({ id: `M-${lake ? 'L' : 'I'}${i + 1}`, pos: polar(radius, angle), angle });
    }
  }
  // The broken heartland has its own waters between the islets.
  const coreNodes = [];
  if (shape === 'shattered') {
    const inner = Math.min((R - STEP) / 2, 95);
    for (let i = 0; i < count; i += 1) {
      const angle = angles[i] + Math.PI / count;
      coreNodes.push({ id: `M-C${i + 1}`, pos: polar(inner * 0.55, angle), angle });
    }
    for (let k = 0; k < coreNodes.length; k += 1) {
      if (coreNodes.length > 2 || k === 0) lanes.push([coreNodes[k].id, coreNodes[(k + 1) % coreNodes.length].id]);
      lanes.push([coreNodes[k].id, `M-I${k + 1}`]);
    }
    innerNodes.push(...coreNodes);
  }
  const allNodes = [...ring, ...innerNodes];
  const mainSites = [...sites];
  const ringNodes = innerNodes.filter(node => !coreNodes.includes(node));
  for (let k = 0; k < ringNodes.length; k += 1) {
    const node = ringNodes[k];
    if (ringNodes.length > 2 || k === 0) lanes.push([node.id, ringNodes[(k + 1) % ringNodes.length].id]);
    // The straits open to the outer sea; a lake stays a lake; a lagoon has passes out.
    if (form.straits) {
      const out = ring.find(item => item.id === `M-B${k + 1}`) || ring[Math.round(k * ringSize / count + perHouse / 2) % ringSize];
      lanes.push([node.id, out.id]);
    }
    if (shape === 'atoll') {
      const gap = a => Math.abs(Math.atan2(Math.sin(a - node.angle), Math.cos(a - node.angle)));
      const out = [...ring].sort((a, b) => gap(a.angle) - gap(b.angle) || (a.id < b.id ? -1 : 1))[0];
      lanes.push([node.id, out.id]);
    }
  }
  for (let k = 0; k < allNodes.length; k += 1) {
    const node = allNodes[k];
    waypoints[node.id] = node.pos;
    if (k < ringSize) lanes.push([node.id, ring[(k + 1) % ringSize].id]);
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
    // In the newer inner waters every shore around the water gets a harbour on it.
    if (k >= ringSize && ['lake-isle', 'atoll', 'shattered'].includes(shape) && clear.length) {
      const seenMass = new Set();
      for (const { s, d } of clear) {
        if (seenMass.has(s.mass) || d > clear[0].d * 1.8 + 10) continue;
        seenMass.add(s.mass);
        if (!lanes.some(([a, b]) => a === s.id && b === node.id)) { lanes.push([s.id, node.id]); ports.add(s.id); }
      }
    }
  }

  // Every shore has a harbour: a piece of land with no port yet gets one at
  // its nearest open water.
  const portsByMass = new Set(mainSites.filter(s => ports.has(s.id)).map(s => s.mass));
  for (const mass of [...new Set(mainSites.map(s => s.mass))]) {
    if (portsByMass.has(mass)) continue;
    let best = null;
    for (const s of mainSites.filter(item => item.mass === mass)) {
      for (const node of allNodes) {
        if (mainSites.some(t => t !== s && toSegment(t.pos, s.pos, node.pos) < 36)) continue;
        const d = dist(s.pos, node.pos);
        if (!best || d < best.d - 1e-6) best = { s, node, d };
      }
    }
    if (best) { lanes.push([best.s.id, best.node.id]); ports.add(best.s.id); }
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

  // Open water everywhere: a net of sea points over all the water, and every
  // shore that can reach it may build a port. Lands only become ports when a
  // port is built (or at the start, the harbour of every home).
  let startingPorts = null;
  if (seaMesh) {
    const landSegs = [...edges].map(key => key.split('|')).map(([a, b]) => [sites.find(s => s.id === a).pos, sites.find(s => s.id === b).pos]);
    const sitePts = sites.map(s => s.pos);
    const clearance = p => Math.min(
      ...landSegs.map(([a, b]) => toSegment(p, a, b)),
      ...sitePts.map(q => dist(p, q))
    );
    const lineClear = (a, b, need) => {
      const n = Math.max(2, Math.ceil(dist(a, b) / 8));
      for (let k = 0; k <= n; k += 1) {
        const p = { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n };
        if (clearance(p) < need) return false;
      }
      return true;
    };
    const outer = Math.max(...Object.values(waypoints).map(p => Math.hypot(p.x, p.y)));
    const sector = (2 * Math.PI) / count;
    const meshPts = [];
    for (let r = 40; r <= outer + 1; r += 62) {
      const steps = Math.max(1, Math.round((sector * r) / 66));
      for (let j = 0; j < steps; j += 1) {
        const a = angles[0] + (j + (Math.round(r / 62) % 2 ? 0.5 : 0)) * (sector / steps);
        for (let i = 0; i < count; i += 1) {
          const p = polar(r, a + i * sector);
          if (clearance(p) < 54) continue;
          if (Object.values(waypoints).some(q => dist(p, q) < 40)) continue;
          meshPts.push(p);
        }
      }
    }
    meshPts.forEach((p, k) => { waypoints[`M-N${k + 1}`] = p; });
    const ids = Object.keys(waypoints);
    const lanesSet = new Set(lanes.map(([a, b]) => [a, b].sort().join('|')));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = waypoints[ids[i]], b = waypoints[ids[j]];
        const d = dist(a, b);
        if (d > 100) continue;
        const key = [ids[i], ids[j]].sort().join('|');
        if (lanesSet.has(key) || !lineClear(a, b, 36)) continue;
        lanesSet.add(key);
        lanes.push([ids[i], ids[j]]);
      }
    }
    // Every shore with a clear run to open water close by may hold a port.
    for (const s of sites) {
      const near = ids
        .map(id => ({ id, d: dist(s.pos, waypoints[id]) }))
        .filter(({ id, d }) => d <= 105 && !sites.some(t => t !== s && toSegment(t.pos, s.pos, waypoints[id]) < 36))
        .sort((x, y) => x.d - y.d || (x.id < y.id ? -1 : 1))
        .slice(0, 2);
      for (const { id } of near) {
        const key = [s.id, id].sort().join('|');
        if (lanesSet.has(key)) continue;
        lanesSet.add(key);
        lanes.push([s.id, id]);
      }
      if (near.length) ports.add(s.id);
    }
    // The harbour of every home is there from the start: the settlement facing the sea.
    startingPorts = houses.map((_, i) => petal(i, 0)).filter(id => ports.has(id));
  }

  // Bend the whole picture; the roads stay as they are.
  if (warp !== 'none') {
    const shaper = seeded(((Number(seed) || 1) ^ 0x2f3a9d) >>> 0);
    const reachAll = Math.max(...[...sites.map(s => s.pos), ...Object.values(waypoints)].map(p => Math.hypot(p.x, p.y)));
    const tilt = shaper() * Math.PI;
    const bend = p => {
      // Turn so the warp runs along a random direction, warp, turn back.
      const c = Math.cos(tilt), s = Math.sin(tilt);
      let x = p.x * c + p.y * s, y = -p.x * s + p.y * c;
      if (warp === 'stretch') { x *= 1.5 + shaper.fixed * 0.4; }
      if (warp === 'crescent') {
        const D = reachAll * 1.5;
        const a = x / D;
        const r = D + y;
        x = Math.sin(a) * r * 1.15;
        y = D - Math.cos(a) * r;
      }
      if (warp === 'wave') { y += Math.sin(x / (reachAll * 0.38) + shaper.fixed * 6) * reachAll * 0.22; x *= 1.25; }
      if (warp === 'spiral') {
        const r = Math.hypot(x, y), a = Math.atan2(y, x) + 0.9 * (r / reachAll) * (shaper.fixed > 0.5 ? 1 : -1);
        x = Math.cos(a) * r; y = Math.sin(a) * r;
      }
      if (warp === 'hourglass') { y *= 0.5 + 0.75 * Math.min(1, Math.abs(x) / reachAll); x *= 1.2; }
      if (warp === 'ripple') {
        const r = Math.hypot(x, y) || 1, k = 1 + 0.16 * Math.sin(r / (reachAll * 0.22) + shaper.fixed * 6);
        x *= k; y *= k;
      }
      if (warp === 'zigzag') {
        const phase = (x / (reachAll * 0.6) + shaper.fixed) % 1;
        y += (Math.abs(((phase + 1) % 1) * 2 - 1) - 0.5) * reachAll * 0.45; x *= 1.2;
      }
      if (warp === 'shear') { x += y * (0.55 + shaper.fixed * 0.3); }
      if (warp === 'teardrop') {
        const a = Math.atan2(y, x), k = 1 + 0.45 * Math.cos(a);
        x *= k; y *= k;
      }
      return { x: x * c - y * s, y: x * s + y * c };
    };
    shaper.fixed = shaper();
    for (const s of sites) s.pos = bend(s.pos);
    for (const id of Object.keys(waypoints)) waypoints[id] = bend(waypoints[id]);
    // Where the bend squeezes lands together, the whole picture grows back.
    let closest = Infinity;
    for (let i = 0; i < sites.length; i += 1) {
      for (let j = i + 1; j < sites.length; j += 1) closest = Math.min(closest, dist(sites[i].pos, sites[j].pos));
    }
    const grow = closest < 42 ? 42 / closest : 1;
    if (grow > 1) {
      for (const s of sites) s.pos = { x: s.pos.x * grow, y: s.pos.y * grow };
      for (const id of Object.keys(waypoints)) waypoints[id] = { x: waypoints[id].x * grow, y: waypoints[id].y * grow };
    }
    bendRiver = p => { const q = bend(p); return { x: q.x * grow, y: q.y * grow }; };
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

  // A river runs out of the heartland along every border and falls into the
  // sea; where the homes stand apart it runs out of every home instead.
  const rivers = [];
  for (let i = 0; i < boundaries; i += 1) {
    let angle = boundaryAngle(i) + (random() - 0.5) * 0.5;
    let start = polar(count === 2 ? 24 : Math.max(26, R * 0.32), boundaryAngle(i) + (random() - 0.5) * 0.6);
    if (shape !== 'wheel' && i < count) {
      angle = angles[i] + Math.PI / 6;
      start = add(polar(R, angles[i]), polar(22, angle));
    }
    if (bendRiver) {
      const ahead = bendRiver(add(start, polar(10, angle)));
      start = bendRiver(start);
      angle = Math.atan2(ahead.y - start.y, ahead.x - start.x);
    }
    rivers.push({ ...shift(start), angle, seed: Math.floor(random() * 1e6) });
  }

  return {
    game: baseMap.game,
    version: shape === 'wheel' && warp === 'none' ? 'V6-GENERATED-2' : 'V6-GENERATED-3',
    generated: true,
    seed: Number(seed) || 1,
    shape,
    warp,
    ...(seaMesh ? { buildable_ports: true, starting_ports: startingPorts } : {}),
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
