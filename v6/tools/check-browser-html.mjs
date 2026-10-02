import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  path.join(root, 'online/index.html'),
  path.join(root, 'online/lobby.html')
];

let failures = 0;

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

  if (!scripts.length) {
    console.error(`No inline script found in ${path.relative(root, file)}`);
    failures += 1;
    continue;
  }

  scripts.forEach((match, index) => {
    try {
      new vm.Script(match[1], {
        filename: `${path.relative(root, file)}#script-${index + 1}`
      });
      console.log(`OK ${path.relative(root, file)} script ${index + 1}`);
    } catch (error) {
      failures += 1;
      console.error(error);
    }
  });
}

if (failures) process.exit(1);
