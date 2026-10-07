// Usage: node --import ./tools/dev/register-fake-firestore.mjs src/online/server.mjs
import { register } from 'node:module';

register('./fake-firestore-loader.mjs', import.meta.url);
