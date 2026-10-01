import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson, validateMap } from '../src/core/map.mjs';
import { createInitialState, validateState } from '../src/core/state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const map = loadJson(path.join(root, 'src/data/map.v6.json'));
const constants = loadJson(path.join(root, 'src/data/constants.v6.json'));
const errors = [...validateMap(map), ...validateState(createInitialState(map, constants), map, constants)];
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('V6_VALIDATION_OK');
