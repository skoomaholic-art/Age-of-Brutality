import { chromium } from 'playwright';
const dir = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 620 } });
for (const name of ['wheel', 'inland', 'peninsulas']) {
  await p.goto('file://' + dir + '/' + name + '.svg');
  await p.waitForTimeout(900);
  await p.screenshot({ path: dir + '/' + name + '.png' });
}
await b.close();
