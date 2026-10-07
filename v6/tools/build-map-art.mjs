// Builds the painted classic map for the online client:
//   online/assets/map/terrain.svg and online/assets/map/provinces.json
// from src/data/map.v6.json. Run `npm run build:map` after changing the map data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMapArt } from '../src/online/map-art.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = JSON.parse(fs.readFileSync(path.join(root, 'src/data/map.v6.json'), 'utf8'));
const outDir = path.join(root, 'online/assets/map');

const art = buildMapArt(map);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'terrain.svg'), art.terrain);
fs.writeFileSync(path.join(outDir, 'provinces.json'), JSON.stringify({ bounds: art.bounds, provinces: art.provinces }));
console.log(`map art: ${JSON.stringify(art.stats)}, terrain.svg ${(art.terrain.length / 1024).toFixed(0)} KB`);
