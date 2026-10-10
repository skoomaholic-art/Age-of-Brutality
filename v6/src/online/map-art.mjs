// Paints a map: the static terrain picture and one outline per territory.
//
//   terrain    an SVG: sea, coasts, land, rivers, fields, forests and roads
//   provinces  { id: { d, x, y } } used by the client for colours and clicks
//
// Everything is derived from the map data and a seed, so the same map always
// gives the same picture. Used at build time for the classic map
// (tools/build-map-art.mjs) and at run time for generated maps.

import { contours } from 'd3-contour';

function legacyRivers() {
// Springs on the western land; the eastern land mirrors them.
const westSprings = [
  { x: 205, y: 150, angle: Math.PI * 0.94, seed: 3 },
  { x: 150, y: 215, angle: Math.PI * 0.08, seed: 12 },
  { x: 228, y: 322, angle: Math.PI * 1.04, seed: 8 },
  { x: 150, y: 372, angle: Math.PI * -0.05, seed: 15 },
  { x: 205, y: 448, angle: Math.PI * 0.93, seed: 5 }
];
return [
  ...westSprings,
  ...westSprings.map(spring => ({
    x: 840 - spring.x,
    y: spring.y,
    angle: Math.PI - spring.angle,
    seed: spring.seed + 100
  }))
];
}

export function buildMapArt(map, options = {}) {
  // Painted area. It is larger than the client's default view so panning and
  // letterboxing show open sea instead of an edge.
  const BOUNDS = options.bounds || { x0: -160, y0: -110, x1: 1000, y1: 660 };
  const STEP = options.step || 1.25;
  const SEED = Number(options.seed || 0);
  const COLS = Math.round((BOUNDS.x1 - BOUNDS.x0) / STEP);
  const ROWS = Math.round((BOUNDS.y1 - BOUNDS.y0) / STEP);

  // ---------- deterministic noise ----------

  function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function valueNoise(x, y, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed);
    const b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed);
    const d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // Fractal noise in roughly [-1, 1].
  function fbm(x, y, seed, octaves = 3) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i += 1) {
      sum += (valueNoise(x * freq, y * freq, seed + i * 17) * 2 - 1) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- geometry helpers ----------

  const f1 = value => Math.round(value * 10) / 10;

  function distToSegment(px, py, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    return Math.hypot(px - cx, py - cy);
  }

  function chaikin(ring, rounds) {
    let points = ring;
    for (let r = 0; r < rounds; r += 1) {
      const next = [];
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const q = points[(i + 1) % points.length];
        next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
        next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
      }
      points = next;
    }
    return points;
  }

  // Drops points that add no shape, to keep the files small.
  function thin(ring, minStep) {
    const out = [ring[0]];
    for (let i = 1; i < ring.length; i += 1) {
      const last = out[out.length - 1];
      if (Math.hypot(ring[i][0] - last[0], ring[i][1] - last[1]) >= minStep) out.push(ring[i]);
    }
    return out.length >= 3 ? out : ring;
  }

  function ringPath(ring) {
    return 'M' + ring.map(p => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z';
  }

  const gridX = col => BOUNDS.x0 + col * STEP;
  const gridY = row => BOUNDS.y0 + row * STEP;

  // Traces the outline of every cell where `test(index)` holds.
  function traceMask(test, { smooth = 1, minStep = 1.2, minArea = 12 } = {}) {
    const values = new Float32Array(COLS * ROWS);
    for (let i = 0; i < values.length; i += 1) values[i] = test(i) ? 1 : 0;
    const [shape] = contours().size([COLS, ROWS]).thresholds([0.5])(values);
    const rings = [];
    for (const polygon of shape.coordinates) {
      for (const ring of polygon) {
        const open = ring.slice(0, -1).map(([c, r]) => [
          BOUNDS.x0 + (c - 0.5) * STEP,
          BOUNDS.y0 + (r - 0.5) * STEP
        ]);
        let area = 0;
        for (let i = 0; i < open.length; i += 1) {
          const p = open[i];
          const q = open[(i + 1) % open.length];
          area += p[0] * q[1] - q[0] * p[1];
        }
        if (Math.abs(area / 2) < minArea) continue;
        rings.push(thin(chaikin(open, smooth), minStep));
      }
    }
    return rings;
  }

  // ---------- land and provinces ----------

  const sites = map.territories.map(t => ({
    ...t,
    x: map.coordinates[t.id].x,
    y: map.coordinates[t.id].y,
    mass: map.masses?.[t.id] ?? (t.is_central_half ? t.island : t.id[0]),
    small: Boolean(t.is_central_half || t.type === 'Половина острова')
  }));
  const siteById = new Map(sites.map(site => [site.id, site]));
  const masses = [...new Set(sites.map(site => site.mass))];
  const massIndex = new Map(masses.map((mass, index) => [mass, index]));
  const smallMass = new Set(sites.filter(site => site.small).map(site => massIndex.get(site.mass)));
  // A ridge is a road a mountain wall has closed: the ground is still there,
  // so the land mask knows it, but no road is drawn along it and no army walks it.
  const ridgeEdges = (map.ridges || []).filter(([a, b]) => siteById.has(a) && siteById.has(b));
  const roadEdges = map.land_edges;
  const segments = [...roadEdges, ...ridgeEdges].map(([a, b]) => ({ a: siteById.get(a), b: siteById.get(b) }));
  const roadSegments = roadEdges.map(([a, b]) => ({ a: siteById.get(a), b: siteById.get(b) }));
  const linked = new Set([...roadEdges.flat(), ...ridgeEdges.flat()]);
  const lonely = new Set(sites.filter(site => !site.small && !linked.has(site.id)).map(site => site.id));

  const landBox = {
    x0: Math.min(...sites.map(s => s.x)) - 70, x1: Math.max(...sites.map(s => s.x)) + 70,
    y0: Math.min(...sites.map(s => s.y)) - 70, y1: Math.max(...sites.map(s => s.y)) + 70
  };
  const landMass = new Int16Array(COLS * ROWS).fill(-1);
  const province = new Int16Array(COLS * ROWS).fill(-1);
  const coastDepth = new Float32Array(COLS * ROWS); // how far inside the land a cell is

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x = gridX(col);
      const y = gridY(row);
      const index = row * COLS + col;

      if (x < landBox.x0 || x > landBox.x1 || y < landBox.y0 || y > landBox.y1) { coastDepth[index] = -99; continue; }

      // Land follows the road network: a band around every land connection.
      let best = -Infinity;
      let bestMass = -1;
      for (const segment of segments) {
        const island = segment.a.small;
        const reach = island ? 15 : 31;
        const score = reach - distToSegment(x, y, segment.a, segment.b);
        if (score > best) {
          best = score;
          bestMass = massIndex.get(segment.a.mass);
        }
      }
      // Bays and headlands at three scales; a town always keeps dry ground under it.
      const rough =
        fbm(x / 70, y / 70, 11 + SEED, 2) * 15 +
        fbm(x / 27, y / 27, 19 + SEED, 3) * 9 +
        fbm(x / 8, y / 8, 23 + SEED, 2) * 2.4;
      // The islands are small: the same swell would weld neighbouring islands together.
      let depth = best + (smallMass.has(bestMass) ? rough * 0.4 : rough);
      for (const site of sites) {
        // A land with no road to any other is an islet: it gets a shore of its own.
        const keep = (site.small ? 9 : lonely.has(site.id) ? 28 + rough * 0.4 : 12) - Math.hypot(x - site.x, y - site.y);
        if (keep > depth) {
          depth = keep;
          bestMass = massIndex.get(site.mass);
        }
      }
      coastDepth[index] = depth;
      if (depth <= 0) continue;
      landMass[index] = bestMass;

      // Province borders wander a little instead of running dead straight.
      const wx = x + fbm(x / 26, y / 26, 41 + SEED, 2) * 9;
      const wy = y + fbm(x / 26, y / 26, 53 + SEED, 2) * 9;
      let nearest = Infinity;
      let owner = -1;
      for (let s = 0; s < sites.length; s += 1) {
        if (massIndex.get(sites[s].mass) !== bestMass) continue;
        const d = (wx - sites[s].x) ** 2 + (wy - sites[s].y) ** 2;
        if (d < nearest) {
          nearest = d;
          owner = s;
        }
      }
      province[index] = owner;
    }
  }

  const isLand = index => landMass[index] >= 0;
  const cellAt = (x, y) => {
    const col = Math.round((x - BOUNDS.x0) / STEP);
    const row = Math.round((y - BOUNDS.y0) / STEP);
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return -1;
    return row * COLS + col;
  };
  const landAt = (x, y) => {
    const index = cellAt(x, y);
    return index >= 0 && isLand(index);
  };
  const depthAt = (x, y) => {
    const index = cellAt(x, y);
    return index >= 0 ? coastDepth[index] : -99;
  };

  const coastRings = traceMask(isLand, { smooth: 2, minStep: 1.1 });
  const coastPath = coastRings.map(ringPath).join('');

  const provinces = {};
  sites.forEach((site, s) => {
    const rings = traceMask(index => province[index] === s, { smooth: 1, minStep: 1.4, minArea: 6 });
    provinces[site.id] = {
      d: rings.map(ringPath).join(''),
      x: site.x,
      y: site.y
    };
  });

  // ---------- rivers ----------

  // A river runs from an inland spring to the coast in the given direction,
  // swinging from side to side and bending away from towns.
  function traceRiver({ x, y, angle, seed }) {
    const random = seeded(seed);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let length = 0;
    while (length < 400 && depthAt(x + dirX * length, y + dirY * length) > -7) length += 2;
    if (length < 30) return [];

    const phase = random() * Math.PI * 2;
    const phase2 = random() * Math.PI * 2;
    const swing = 7 + random() * 5;
    const points = [];
    const steps = Math.ceil(length / 2.2);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const along = t * length;
      // No swing at the spring or at the mouth, the widest loops in between.
      const envelope = Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.7;
      const offset =
        (Math.sin(along / 15 + phase) * swing + Math.sin(along / 6.5 + phase2) * swing * 0.3) *
        envelope;
      let px = x + dirX * along - dirY * offset;
      let py = y + dirY * along + dirX * offset;
      for (const site of sites) {
        const d = Math.hypot(px - site.x, py - site.y);
        if (d < 15 && d > 0.01) {
          px += ((px - site.x) / d) * (15 - d);
          py += ((py - site.y) / d) * (15 - d);
        }
      }
      points.push([px, py]);
    }
    return points;
  }

  const riverStarts = options.rivers || legacyRivers();
  const rivers = riverStarts.map(traceRiver).filter(points => points.length > 12);

  const nearRiver = (x, y, reach) =>
    rivers.some(points => points.some(p => Math.hypot(p[0] - x, p[1] - y) < reach));

  function smoothLine(points) {
    let d = `M${f1(points[0][0])} ${f1(points[0][1])}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const mx = (points[i][0] + points[i + 1][0]) / 2;
      const my = (points[i][1] + points[i + 1][1]) / 2;
      d += `Q${f1(points[i][0])} ${f1(points[i][1])} ${f1(mx)} ${f1(my)}`;
    }
    const last = points[points.length - 1];
    return d + `L${f1(last[0])} ${f1(last[1])}`;
  }

  // ---------- roads ----------

  function roadCurve(a, b, seed) {
    const random = seeded(seed);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const nx = -dy / length;
    const ny = dx / length;
    const bend = (random() - 0.5) * length * 0.22;
    const bend2 = (random() - 0.5) * length * 0.16;
    const p1 = [a.x + dx * 0.33 + nx * bend, a.y + dy * 0.33 + ny * bend];
    const p2 = [a.x + dx * 0.66 + nx * bend2, a.y + dy * 0.66 + ny * bend2];
    return [[a.x, a.y], p1, p2, [b.x, b.y]];
  }

  function roadPath(a, b, seed) {
    const [p0, p1, p2, p3] = roadCurve(a, b, seed);
    return `M${f1(p0[0])} ${f1(p0[1])}C${f1(p1[0])} ${f1(p1[1])} ${f1(p2[0])} ${f1(p2[1])} ${f1(p3[0])} ${f1(p3[1])}`;
  }

  const roads = roadSegments.map((segment, index) => roadPath(segment.a, segment.b, 700 + index));

  // Where a road meets a river: a bridge is needed there to cross.
  function crossPoint(p, q, r, s) {
    const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
    const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  }
  const crossings = [];
  roadSegments.forEach((segment, index) => {
    if (!segment.a || !segment.b) return;
    const [p0, p1, p2, p3] = roadCurve(segment.a, segment.b, 700 + index);
    const line = [];
    for (let i = 0; i <= 32; i += 1) {
      const t = i / 32, m = 1 - t;
      line.push([
        m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
        m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]
      ]);
    }
    let found = null;
    // A river is drawn as a wide ribbon, so a road that runs within its banks
    // is cut by it as surely as one that crosses the middle: the eye sees a
    // river over the road either way, and the rules must agree with the eye.
    const BANK = 3.2;
    let nearest = { d: Infinity, point: null };
    for (const river of rivers) {
      for (let i = 0; i + 1 < line.length && !found; i += 1) {
        for (let j = 0; j + 1 < river.length && !found; j += 1) {
          const hit = crossPoint(line[i], line[i + 1], river[j], river[j + 1]);
          if (hit) found = hit;
          else {
            const d = distToSegment(line[i][0], line[i][1], { x: river[j][0], y: river[j][1] }, { x: river[j + 1][0], y: river[j + 1][1] });
            if (d < nearest.d) nearest = { d, point: line[i] };
          }
        }
      }
      if (found) break;
    }
    if (!found && nearest.point && nearest.d < BANK) found = nearest.point;
    if (found) crossings.push({ a: segment.a.id, b: segment.b.id, x: f1(found[0]), y: f1(found[1]) });
  });
  const nearRoad = (x, y, reach) =>
    segments.some(segment => distToSegment(x, y, segment.a, segment.b) < reach);
  const nearestSiteDistance = (x, y) =>
    sites.reduce((min, site) => Math.min(min, Math.hypot(x - site.x, y - site.y)), Infinity);

  // ---------- fields ----------

  const fieldRandom = seeded(90210);
  const fields = [];
  for (const site of sites) {
    const count = { 'Столица': 7, 'Город': 6, 'Деревня': 4, 'Половина острова': 1, 'Дикая земля': 0 }[site.type] || 0;
    let placed = 0;
    for (let attempt = 0; attempt < count * 12 && placed < count; attempt += 1) {
      const angle = fieldRandom() * Math.PI * 2;
      const radius = 12 + fieldRandom() * 15;
      const x = site.x + Math.cos(angle) * radius;
      const y = site.y + Math.sin(angle) * radius * 0.85;
      const w = 6 + fieldRandom() * 7;
      const h = 3.5 + fieldRandom() * 4;
      if (depthAt(x, y) < 6 || nearRiver(x, y, 5)) continue;
      if (fields.some(field => Math.hypot(field.x - x, field.y - y) < (field.w + w) / 2)) continue;
      if (nearestSiteDistance(x, y) < 10) continue;
      fields.push({ x, y, w, h, rot: (fieldRandom() - 0.5) * 70, tone: Math.floor(fieldRandom() * 3) });
      placed += 1;
    }
  }
  const inField = (x, y) => fields.some(field => Math.hypot(field.x - x, field.y - y) < field.w * 0.62);

  // ---------- forests ----------

  const forestAt = (x, y) => {
    if (depthAt(x, y) < 2.5) return false;
    if (nearestSiteDistance(x, y) < 12.5) return false;
    if (nearRoad(x, y, 3.4)) return false;
    if (nearRiver(x, y, 3.6)) return false;
    if (inField(x, y)) return false;
    const site = sites.reduce((best, item) =>
      Math.hypot(x - item.x, y - item.y) < Math.hypot(x - best.x, y - best.y) ? item : best);
    // Wild land is mostly woods; farmland around towns is mostly open.
    const bias = site.type === 'Дикая земля' ? 0.2 : site.type === 'Половина острова' ? -0.02 : -0.06;
    return fbm(x / 38, y / 38, 77 + SEED, 3) + fbm(x / 11, y / 11, 91 + SEED, 2) * 0.25 + bias > 0.04;
  };

  const treeRandom = seeded(4242);
  const trees = [];
  const TREE_STEP = 3.7;
  for (let y = BOUNDS.y0; y < BOUNDS.y1; y += TREE_STEP * 0.8) {
    for (let x = BOUNDS.x0; x < BOUNDS.x1; x += TREE_STEP) {
      const tx = x + (treeRandom() - 0.5) * TREE_STEP * 0.9;
      const ty = y + (treeRandom() - 0.5) * TREE_STEP * 0.8;
      if (!landAt(tx, ty) || !forestAt(tx, ty)) continue;
      trees.push({ x: tx, y: ty, size: 0.82 + treeRandom() * 0.5, tone: Math.floor(treeRandom() * 3) });
    }
  }
  trees.sort((a, b) => a.y - b.y);

  const forestFloor = traceMask(index => {
    if (!isLand(index)) return false;
    const col = index % COLS;
    const row = (index - col) / COLS;
    return forestAt(gridX(col), gridY(row));
  }, { smooth: 2, minStep: 1.6, minArea: 30 }).map(ringPath).join('');

  // Greener pasture and drier heath break up the open ground.
  const pasture = traceMask(index => {
    if (!isLand(index)) return false;
    const col = index % COLS;
    const row = (index - col) / COLS;
    return fbm(gridX(col) / 55, gridY(row) / 55, 131, 3) > 0.08;
  }, { smooth: 2, minStep: 2, minArea: 60 }).map(ringPath).join('');
  const heath = traceMask(index => {
    if (!isLand(index)) return false;
    const col = index % COLS;
    const row = (index - col) / COLS;
    return fbm(gridX(col) / 48, gridY(row) / 48, 151, 3) > 0.22;
  }, { smooth: 2, minStep: 2, minArea: 60 }).map(ringPath).join('');

  // ---------- hills on wild land ----------

  const hillRandom = seeded(1717);
  const hills = [];
  for (const site of sites.filter(item => item.type === 'Дикая земля')) {
    for (let i = 0; i < 7; i += 1) {
      const angle = hillRandom() * Math.PI * 2;
      const radius = 9 + hillRandom() * 18;
      const x = site.x + Math.cos(angle) * radius;
      const y = site.y + Math.sin(angle) * radius * 0.8;
      if (depthAt(x, y) < 5 || forestAt(x, y) || nearRoad(x, y, 3)) continue;
      hills.push({ x, y, size: 0.8 + hillRandom() * 0.7 });
    }
  }

  // ---------- the lie of the land: mountains, marshes, sand and snow ----------

  const terrainKind = id => map.terrain?.[id] || null;
  const provinceAt = (x, y) => {
    const index = cellAt(x, y);
    return index >= 0 ? province[index] : -1;
  };
  const TERRAIN_TINT = {
    'горы': '#8d8468',
    'болота': '#5c6f4a',
    'пустыня': '#d9c383',
    'снега': '#e8eef2'
  };
  // A blanket of colour over every rough province, under the glyphs.
  const terrainFloor = sites.map((site, index) => {
    const kind = terrainKind(site.id);
    if (!kind || !provinces[site.id]?.d) return '';
    void index;
    return `<path d="${provinces[site.id].d}" fill="${TERRAIN_TINT[kind]}" opacity="${kind === 'снега' ? '.72' : '.55'}"/>`;
  }).join('');

  // Glyphs scattered inside each rough province: peaks, reeds, dunes, drifts.
  const terrainRandom = seeded(5150 + SEED);
  const peak = (x, y, size, snow = false) =>
    `<path d="M${f1(x - 4.6 * size)} ${f1(y)}l${f1(4.6 * size)} ${f1(-6.4 * size)}l${f1(4.6 * size)} ${f1(6.4 * size)}Z" fill="${snow ? '#dfe7ec' : '#8a7c5c'}" stroke="#3f3524" stroke-width=".5" stroke-linejoin="round"/>` +
    `<path d="M${f1(x - 1.7 * size)} ${f1(y - 2.4 * size)}l${f1(1.7 * size)} ${f1(-4 * size)}l${f1(1.7 * size)} ${f1(4 * size)}Z" fill="${snow ? '#ffffff' : '#cfc49f'}" stroke="none"/>`;
  const reeds = (x, y, size) =>
    `<path d="M${f1(x - 2.2 * size)} ${f1(y)}q${f1(1.1 * size)} ${f1(-3.2 * size)} ${f1(2.2 * size)} 0M${f1(x + 0.6 * size)} ${f1(y + 0.6 * size)}q${f1(1.1 * size)} ${f1(-3.2 * size)} ${f1(2.2 * size)} 0" fill="none" stroke="#3f5230" stroke-width=".5" stroke-linecap="round"/>` +
    `<path d="M${f1(x - 1.2 * size)} ${f1(y + 1.4 * size)}h${f1(4.4 * size)}" stroke="#6d8a5e" stroke-width=".45" stroke-linecap="round" opacity=".8"/>`;
  const dune = (x, y, size) =>
    `<path d="M${f1(x - 4 * size)} ${f1(y)}q${f1(4 * size)} ${f1(-3 * size)} ${f1(8 * size)} 0" fill="none" stroke="#b79a51" stroke-width=".6" stroke-linecap="round"/>` +
    `<path d="M${f1(x - 1.6 * size)} ${f1(y + 1.8 * size)}q${f1(2.6 * size)} ${f1(-2 * size)} ${f1(5.2 * size)} 0" fill="none" stroke="#c9ae68" stroke-width=".45" stroke-linecap="round" opacity=".8"/>`;
  const drift = (x, y, size) =>
    `<path d="M${f1(x)} ${f1(y - 2.4 * size)}v${f1(4.8 * size)}M${f1(x - 2.1 * size)} ${f1(y - 1.2 * size)}l${f1(4.2 * size)} ${f1(2.4 * size)}M${f1(x - 2.1 * size)} ${f1(y + 1.2 * size)}l${f1(4.2 * size)} ${f1(-2.4 * size)}" stroke="#ffffff" stroke-width=".55" stroke-linecap="round" opacity=".85"/>`;

  const terrainGlyphs = [];
  sites.forEach((site, index) => {
    const kind = terrainKind(site.id);
    if (!kind) return;
    for (let attempt = 0; attempt < 90 && terrainGlyphs.length < 4000; attempt += 1) {
      const angle = terrainRandom() * Math.PI * 2;
      const radius = 4 + terrainRandom() * 26;
      const x = site.x + Math.cos(angle) * radius;
      const y = site.y + Math.sin(angle) * radius * 0.85;
      if (provinceAt(x, y) !== index || depthAt(x, y) < 3) continue;
      if (nearestSiteDistance(x, y) < 9 || nearRoad(x, y, 2.6) || nearRiver(x, y, 3)) continue;
      const size = 0.75 + terrainRandom() * 0.5;
      terrainGlyphs.push({ y,
        markup: kind === 'горы' ? peak(x, y, size)
          : kind === 'снега' ? (terrainRandom() < 0.45 ? peak(x, y, size, true) : drift(x, y, size))
            : kind === 'болота' ? reeds(x, y, size)
              : dune(x, y, size) });
    }
  });
  terrainGlyphs.sort((a, b) => a.y - b.y);
  const terrainMarkup = terrainGlyphs.map(item => item.markup).join('');

  // A wall of rock across a closed road: peaks shoulder to shoulder.
  const ridgeMarkup = ridgeEdges.map(([a, b]) => {
    const from = siteById.get(a);
    const to = siteById.get(b);
    const steps = Math.max(3, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 7));
    let out = '';
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t + (terrainRandom() - 0.5) * 3;
      const y = from.y + (to.y - from.y) * t + (terrainRandom() - 0.5) * 3;
      if (depthAt(x, y) < 1) continue;
      out += peak(x, y, 1.15 + terrainRandom() * 0.35, map.season === 'зима');
    }
    return out;
  }).join('');

  // Reefs: rocks awash, drawn low and broken, with foam breaking over them —
  // never the tidy triangles of a mountain.
  const reefMarkup = (map.reefs || []).map(id => {
    const point = map.sea_waypoints?.[id];
    if (!point) return '';
    let out = '';
    for (let i = 0; i < 7; i += 1) {
      const x = point.x + (terrainRandom() - 0.5) * 30;
      const y = point.y + (terrainRandom() - 0.5) * 22;
      if (depthAt(x, y) > -1) continue;
      const w = 2.6 + terrainRandom() * 2.4;
      const h = 0.9 + terrainRandom() * 1.1;
      const tilt = (terrainRandom() - 0.5) * 1.6;
      // A broken ridge of rock, barely above the water.
      out += `<path d="M${f1(x - w)} ${f1(y)}l${f1(w * 0.42)} ${f1(-h * 1.5 + tilt)}l${f1(w * 0.3)} ${f1(h * 0.6)}l${f1(w * 0.5)} ${f1(-h * 1.9)}l${f1(w * 0.4)} ${f1(h * 1.8)}l${f1(w * 0.38)} ${f1(-h * 0.5)}Z"` +
        ` fill="#4d6470" stroke="#26343c" stroke-width=".35" stroke-linejoin="round" opacity=".85"/>`;
      // Foam breaking over the rock.
      out += `<path d="M${f1(x - w * 1.2)} ${f1(y + 0.9)}q${f1(w * 0.6)} ${f1(-1.5)} ${f1(w * 1.2)} 0q${f1(w * 0.6)} ${f1(1.4)} ${f1(w * 1.2)} 0" fill="none" stroke="#eaf3f5" stroke-width=".55" stroke-linecap="round" opacity=".75"/>`;
    }
    return out;
  }).join('');

  // ---------- winter ----------
  // A world made in winter: the sea runs grey, fast ice clings to the shore,
  // floes drift beyond it, and snow lies over everything on land.
  const winter = map.season === 'зима';
  const seaWinter = winter
    ? `<rect ${'x="' + f1(BOUNDS.x0) + '" y="' + f1(BOUNDS.y0) + '" width="' + f1(BOUNDS.x1 - BOUNDS.x0) + '" height="' + f1(BOUNDS.y1 - BOUNDS.y0) + '"'} fill="#c6d6dd" opacity=".45"/>`
    : '';
  const floes = (() => {
    if (!winter) return '';
    const random = seeded(8231 + SEED);
    let out = '';
    for (let i = 0; i < 2200; i += 1) {
      const x = BOUNDS.x0 + random() * (BOUNDS.x1 - BOUNDS.x0);
      const y = BOUNDS.y0 + random() * (BOUNDS.y1 - BOUNDS.y0);
      const depth = depthAt(x, y);
      // Floes gather in the shallows near the shore, not in the deep.
      if (depth > -0.5 || depth < -26) continue;
      const w = 3.4 + random() * 7;
      const h = w * (0.4 + random() * 0.35);
      out += `<path d="M${f1(x)} ${f1(y)}l${f1(w * 0.5)} ${f1(-h * 0.6)}l${f1(w * 0.55)} ${f1(h * 0.3)}l${f1(-w * 0.3)} ${f1(h * 0.8)}l${f1(-w * 0.6)} ${f1(h * 0.1)}Z" fill="#e9f1f4" stroke="#b8c9d1" stroke-width=".3" opacity=".8"/>`;
    }
    return out;
  })();
  const fastIce = winter
    ? `<path d="${coastPath}" fill="none" stroke="#e4eef2" stroke-width="9" stroke-linejoin="round" opacity=".75"/>` +
      `<path d="${coastPath}" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" opacity=".55" stroke-dasharray="7 4"/>`
    : '';
  // The snow itself, over the fields and woods but under the towns.
  const snowBlanket = winter
    ? `<path d="${coastPath}" fill="#f4f9fb" opacity=".62"/>` +
      // Drifts gather in the hollows: a few soft white swells over the white.
      (() => {
        const random = seeded(9311 + SEED);
        let out = '';
        for (let i = 0; i < 900; i += 1) {
          const x = BOUNDS.x0 + random() * (BOUNDS.x1 - BOUNDS.x0);
          const y = BOUNDS.y0 + random() * (BOUNDS.y1 - BOUNDS.y0);
          if (depthAt(x, y) < 3) continue;
          const w = 5 + random() * 11;
          out += `<path d="M${f1(x - w)} ${f1(y)}q${f1(w)} ${f1(-w * 0.42)} ${f1(2 * w)} 0q${f1(-w)} ${f1(w * 0.3)} ${f1(-2 * w)} 0Z" fill="#ffffff" opacity=".5"/>`;
        }
        return out;
      })()
    : '';

  // ---------- settlements ----------

  function house(x, y, w, h, roof) {
    const wall = `<path d="M${f1(x)} ${f1(y)}h${f1(w)}v${f1(-h)}h${f1(-w)}Z" fill="#efe2bf" stroke="#3a2a1c" stroke-width=".35"/>`;
    const top = `<path d="M${f1(x - 0.5)} ${f1(y - h)}L${f1(x + w / 2)} ${f1(y - h - roof)}L${f1(x + w + 0.5)} ${f1(y - h)}Z" fill="#a8402a" stroke="#3a2a1c" stroke-width=".35"/>`;
    return wall + top;
  }

  function tower(x, y, w, h) {
    const body = `<path d="M${f1(x)} ${f1(y)}h${f1(w)}v${f1(-h)}h${f1(-w)}Z" fill="#e4d6b1" stroke="#3a2a1c" stroke-width=".4"/>`;
    const cap = `<path d="M${f1(x - 0.6)} ${f1(y - h)}L${f1(x + w / 2)} ${f1(y - h - w * 1.3)}L${f1(x + w + 0.6)} ${f1(y - h)}Z" fill="#8d3322" stroke="#3a2a1c" stroke-width=".4"/>`;
    return body + cap;
  }

  function settlement(site) {
    const { x, y } = site;
    let art = '';
    if (site.type === 'Столица') {
      // The castle itself is a painted figure placed by the client
      // (online/assets/img/capital-*.png); here only the ground it stands on.
      art += `<ellipse cx="${x}" cy="${f1(y + 3)}" rx="15" ry="7.5" fill="#b9a66a" opacity=".55"/>`;
    } else if (site.type === 'Город') {
      // Painted figure placed by the client (online/assets/img/city*.png).
      art += `<ellipse cx="${x}" cy="${f1(y + 2.5)}" rx="10" ry="5" fill="#b9a66a" opacity=".5"/>`;
    } else if (site.type === 'Деревня') {
      // Painted figure placed by the client (online/assets/img/village*.png).
      art += `<ellipse cx="${x}" cy="${f1(y + 2)}" rx="7.5" ry="3.8" fill="#b9a66a" opacity=".45"/>`;
    } else if (site.type === 'Половина острова') {
      // Painted tower by the water, placed by the client (online/assets/img/island.png).
    } else {
      // Wild land: the hunting lodge is a painted figure placed by the client.
      art += `<ellipse cx="${x}" cy="${f1(y + 2)}" rx="6.5" ry="3.3" fill="#b9a66a" opacity=".4"/>`;
    }
    return art;
  }

  // ---------- assemble the art ----------

  const TREE_TONES = ['#56672b', '#4d5f27', '#62722f'];
  const FIELD_TONES = ['#cdb96a', '#c4ad5b', '#d6c47c'];

  const treeMarkup = trees.map(tree => {
    const r = 2.25 * tree.size;
    const x = f1(tree.x);
    const y = f1(tree.y);
    return (
      `<ellipse cx="${x}" cy="${y}" rx="${f1(r)}" ry="${f1(r * 0.86)}" fill="${TREE_TONES[tree.tone]}" stroke="#2c3716" stroke-width=".4"/>` +
      `<path d="M${f1(tree.x - r * 0.55)} ${f1(tree.y - r * 0.1)}q${f1(r * 0.45)} ${f1(-r * 0.75)} ${f1(r * 1.0)} ${f1(-r * 0.25)}" fill="none" stroke="#8a9a44" stroke-width=".45" stroke-linecap="round"/>`
    );
  }).join('');

  const fieldMarkup = fields.map(field => {
    const stripes = [];
    for (let k = 1; k < 4; k += 1) {
      const sy = f1(-field.h / 2 + (field.h * k) / 4);
      stripes.push(`<path d="M${f1(-field.w / 2)} ${sy}H${f1(field.w / 2)}" stroke="#8f7f45" stroke-width=".3" opacity=".7"/>`);
    }
    return (
      `<g transform="translate(${f1(field.x)} ${f1(field.y)}) rotate(${f1(field.rot)}) skewX(-12)">` +
      `<rect x="${f1(-field.w / 2)}" y="${f1(-field.h / 2)}" width="${f1(field.w)}" height="${f1(field.h)}" fill="${FIELD_TONES[field.tone]}" stroke="#7b6c3a" stroke-width=".35"/>` +
      stripes.join('') +
      '</g>'
    );
  }).join('');

  const hillMarkup = hills.map(hill => {
    const s = hill.size;
    return (
      `<path d="M${f1(hill.x - 3.4 * s)} ${f1(hill.y)}q${f1(3.4 * s)} ${f1(-4.6 * s)} ${f1(6.8 * s)} 0" fill="#b9a45e" stroke="#5d4b28" stroke-width=".45"/>` +
      `<path d="M${f1(hill.x - 1.4 * s)} ${f1(hill.y - 1.5 * s)}l${f1(0.7 * s)} ${f1(1.3 * s)}M${f1(hill.x + 0.4 * s)} ${f1(hill.y - 2 * s)}l${f1(0.7 * s)} ${f1(1.7 * s)}" stroke="#5d4b28" stroke-width=".35" fill="none"/>`
    );
  }).join('');

  // A river widens towards its mouth: it is drawn as three overlapping stretches.
  const riverMarkup = rivers.map(points => {
    const stretch = (from, outer, inner) => {
      const d = smoothLine(points.slice(Math.floor(points.length * from)));
      return [
        `<path d="${d}" fill="none" stroke="#1f4f86" stroke-width="${outer}" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<path d="${d}" fill="none" stroke="#4f93cf" stroke-width="${inner}" stroke-linecap="round" stroke-linejoin="round"/>`
      ];
    };
    const tiers = [stretch(0, 2, 1.25), stretch(0.3, 3, 2.1), stretch(0.62, 4.2, 3.2)];
    const ripples = `<path d="${smoothLine(points.slice(Math.floor(points.length * 0.3)))}" fill="none" stroke="#bfe0f5" stroke-width=".4" stroke-dasharray="1.4 7.5" stroke-dashoffset="2" stroke-linecap="round" opacity=".8" transform="translate(.35 -.3)"/>`;
    return tiers.map(tier => tier[0]).join('') + tiers.map(tier => tier[1]).join('') + ripples;
  }).join('');

  const roadMarkup = roads.map(d =>
    `<path d="${d}" fill="none" stroke="#6f5d33" stroke-width="1.9" stroke-linecap="round" opacity=".75"/>` +
    `<path d="${d}" fill="none" stroke="#e6d7a0" stroke-width="1.15" stroke-linecap="round"/>`
  ).join('');

  // A compass rose in the open southern sea.
  const compass = (() => {
    if (options.compass === null) return '';
    const cx = options.compass?.x ?? 400;
    const cy = options.compass?.y ?? 470;
    let rose = `<circle cx="${cx}" cy="${cy}" r="21" fill="none" stroke="#3a2a1c" stroke-width=".5" opacity=".75"/>` +
      `<circle cx="${cx}" cy="${cy}" r="17.5" fill="none" stroke="#3a2a1c" stroke-width=".3" opacity=".7"/>`;
    for (let k = 0; k < 8; k += 1) {
      const angle = (k * Math.PI) / 4;
      const long = k % 2 === 0 ? 20 : 12;
      const tip = [cx + Math.sin(angle) * long, cy - Math.cos(angle) * long];
      const left = [cx + Math.sin(angle - 0.5) * 4, cy - Math.cos(angle - 0.5) * 4];
      const right = [cx + Math.sin(angle + 0.5) * 4, cy - Math.cos(angle + 0.5) * 4];
      rose += `<path d="M${f1(tip[0])} ${f1(tip[1])}L${f1(left[0])} ${f1(left[1])}L${cx} ${cy}Z" fill="${k === 0 ? '#a8402a' : '#efe2bf'}" stroke="#3a2a1c" stroke-width=".35"/>`;
      rose += `<path d="M${f1(tip[0])} ${f1(tip[1])}L${f1(right[0])} ${f1(right[1])}L${cx} ${cy}Z" fill="#3a2a1c" stroke="#3a2a1c" stroke-width=".35"/>`;
    }
    return `<g opacity=".82">${rose}</g>`;
  })();

  const width = BOUNDS.x1 - BOUNDS.x0;
  const height = BOUNDS.y1 - BOUNDS.y0;
  const box = `x="${BOUNDS.x0}" y="${BOUNDS.y0}" width="${width}" height="${height}"`;

  const terrain = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOUNDS.x0} ${BOUNDS.y0} ${width} ${height}">
  <defs>
  <pattern id="waves" width="22" height="11" patternUnits="userSpaceOnUse">
  <path d="M1 4q2.5 -2.4 5 0t5 0M12 9.5q2.5 -2.4 5 0t5 0" fill="none" stroke="#5f7884" stroke-width=".55" stroke-linecap="round" opacity=".5"/>
  </pattern>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="4" seed="7"/>
  <feColorMatrix values="0 0 0 0 .32  0 0 0 0 .25  0 0 0 0 .1  0 0 0 .55 -.12"/>
  </filter>
  <filter id="speckle" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="2" seed="3"/>
  <feColorMatrix values="0 0 0 0 .2  0 0 0 0 .15  0 0 0 0 .05  0 0 0 .5 -.2"/>
  </filter>
  <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
  <stop offset=".55" stop-color="#2a1c0c" stop-opacity="0"/>
  <stop offset="1" stop-color="#2a1c0c" stop-opacity=".42"/>
  </radialGradient>
  <clipPath id="land"><path d="${coastPath}"/></clipPath>
  </defs>
  <rect ${box} fill="#93a5a3"/>
  <rect ${box} fill="url(#waves)"/>
  ${seaWinter}
  ${floes}
  <path d="${coastPath}" fill="none" stroke="#6b838c" stroke-width="15" stroke-linejoin="round" opacity=".45"/>
  <path d="${coastPath}" fill="none" stroke="#a9b9b4" stroke-width="13.6" stroke-linejoin="round"/>
  <path d="${coastPath}" fill="none" stroke="#5f7884" stroke-width="7.6" stroke-linejoin="round" opacity=".6"/>
  <path d="${coastPath}" fill="none" stroke="#b5c3bc" stroke-width="6.4" stroke-linejoin="round"/>
  ${fastIce}
  <path d="${coastPath}" fill="${winter ? '#c3bf96' : '#afa457'}" stroke="#3a2a1c" stroke-width="1.1" stroke-linejoin="round"/>
  <g clip-path="url(#land)">
  <path d="${coastPath}" fill="none" stroke="#d2c27a" stroke-width="9" stroke-linejoin="round" opacity=".55"/>
  <path d="${pasture}" fill="#9aa04a" opacity=".55"/>
  <path d="${heath}" fill="#c7b468" opacity=".5"/>
  <path d="${forestFloor}" fill="#6f7a36" opacity=".9"/>
  ${terrainFloor}
  ${fieldMarkup}
  ${hillMarkup}
  ${riverMarkup}
  ${roadMarkup}
  ${terrainMarkup}
  ${ridgeMarkup}
  ${treeMarkup}
  ${snowBlanket}
  </g>
  ${reefMarkup}
  ${sites.map(settlement).join('')}
  ${compass}
  <rect ${box} filter="url(#grain)" opacity=".55"/>
  <rect ${box} filter="url(#speckle)" opacity=".35"/>
  <rect ${box} fill="url(#vignette)"/>
  </svg>
  `;


  return {
    terrain,
    provinces,
    bounds: BOUNDS,
    crossings,
    stats: { provinces: sites.length, trees: trees.length, fields: fields.length, rivers: rivers.length, terrain: terrainGlyphs.length, ridges: ridgeEdges.length, winter }
  };
}
