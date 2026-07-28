// Regression tests for the dialog resize gate, driving the real Radzen.Blazor.js
// in Chromium.
//
//   node Radzen.Blazor.Tests/js/dialog-resize.test.mjs
//   RADZEN_REF=<sha> node Radzen.Blazor.Tests/js/dialog-resize.test.mjs
//
// The second form runs the suite against that revision of Radzen.Blazor.js
// instead of the working tree, which is how the gate was A/B'd while it was
// being tightened.
//
// Needs playwright-core and a Chromium build; point PLAYWRIGHT_CHROMIUM at the
// executable, or let it fall back to the ms-playwright cache.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '..', '..');
const rel = 'Radzen.Blazor/wwwroot/Radzen.Blazor.js';

const ref = process.env.RADZEN_REF;
const js = ref
  ? execFileSync('git', ['-C', repo, 'show', `${ref}:${rel}`], { maxBuffer: 64 * 1024 * 1024 })
  : fs.readFileSync(path.join(repo, rel));
// The harness loads whichever revision is under test from a scratch file next to it.
fs.writeFileSync(path.join(here, 'radzen-under-test.js'), js);
fs.writeFileSync(path.join(here, 'dialog-resize.run.html'),
  fs.readFileSync(path.join(here, 'dialog-resize.html'), 'utf8')
    .replace('RADZEN_JS', 'radzen-under-test.js'));

const url = 'file://' + path.join(here, 'dialog-resize.run.html');
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage();

const results = [];
async function test(name, fn) {
  await page.goto(url);
  try { await fn(); results.push({ name, ok: true }); console.log('  ok   ' + name); }
  catch (err) { results.push({ name, ok: false }); console.log('  FAIL ' + name + '\n         ' + err.message); }
}

const settle = () => page.waitForTimeout(700); // openDialog defers its wiring by 500ms
const resizeCalls = async () =>
  (await page.evaluate(() => window.__calls)).filter(c => c.method === 'RadzenDialog.OnResize');

async function open(name, opts) {
  await page.evaluate(([n, o]) => window.__openDialog(n, o), [name, opts]);
  await settle();
}
async function dragCorner(name, dx, dy) {
  const box = await page.locator('#dialog-' + name).boundingBox();
  const x = box.x + box.width - 3, y = box.y + box.height - 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('\nRadzen.Blazor.js under test: ' + (ref || 'working tree'));

await test('content growth alone does not report a resize', async () => {
  await open('outer', { width: '300px' });
  await page.evaluate(() => window.__grow('outer'));
  await page.waitForTimeout(200);
  const c = await resizeCalls();
  assert(c.length === 0, 'expected no OnResize, got ' + JSON.stringify(c));
});

await test('opening a nested dialog does not report a resize', async () => {
  await open('outer', { width: '300px' });
  await open('inner', { width: '200px' });
  const c = await resizeCalls();
  assert(c.length === 0, 'expected no OnResize, got ' + JSON.stringify(c));
});

await test('dragging the native resize handle does report the new size', async () => {
  await open('outer', { width: '300px' });
  await dragCorner('outer', 90, 70);
  const c = await resizeCalls();
  assert(c.length > 0, 'expected an OnResize, got none');
  const box = await page.evaluate(() => window.__box('outer'));
  const last = c[c.length - 1];
  assert(last.a === box.w && last.b === box.h,
    'last OnResize ' + last.a + 'x' + last.b + ' != actual ' + box.w + 'x' + box.h);
});

await test('a plain click on the dialog does not report a resize', async () => {
  await open('outer', { width: '300px' });
  const b = await page.evaluate(() => window.__band('outer'));
  assert(b.band > 4, 'harness has no bare band to click (' + b.band + 'px)');
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const c = await resizeCalls();
  assert(c.length === 0, 'expected no OnResize, got ' + JSON.stringify(c));
});

await test('holding the dialog while it grows does not report a resize', async () => {
  await open('outer', { width: '300px' });
  const b = await page.evaluate(() => window.__band('outer'));
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.evaluate(() => window.__grow('outer'));
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const c = await resizeCalls();
  assert(c.length === 0, 'expected no OnResize, got ' + JSON.stringify(c));
});

await test('a secondary-button press does not arm the gate', async () => {
  await open('outer', { width: '300px' });
  const b = await page.evaluate(() => window.__band('outer'));
  await page.mouse.move(b.x, b.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(b.x + 20, b.y + 20, { steps: 4 });
  await page.evaluate(() => window.__grow('outer'));
  await page.waitForTimeout(150);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(150);
  const c = await resizeCalls();
  assert(c.length === 0, 'expected no OnResize, got ' + JSON.stringify(c));
});

await test('an open dialog holds no document listener until the gesture starts', async () => {
  await open('outer', { width: '300px' });
  await open('inner', { width: '200px' });
  const idle = await page.evaluate(() => window.__listeners);
  assert(idle.pointermove === 0,
    'expected no document pointermove listener while idle, got ' + idle.pointermove);

  const box = await page.locator('#dialog-inner').boundingBox();
  const x = box.x + box.width - 3, y = box.y + box.height - 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const during = await page.evaluate(() => window.__listeners);
  assert(during.pointermove === 1,
    'expected exactly one pointermove listener during the gesture, got ' + during.pointermove);

  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__listeners);
  assert(after.pointermove === 0 && after.pointerup === 0 && after.pointercancel === 0,
    'listeners not released after the drag: ' + JSON.stringify(after));
  const c = await resizeCalls();
  assert(c.length > 0, 'the instrumented drag still has to report a resize');
});

await test('a press that never moves releases its listeners', async () => {
  await open('outer', { width: '300px' });
  const b = await page.evaluate(() => window.__band('outer'));
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__listeners);
  assert(after.pointermove === 0 && after.pointerup === 0 && after.pointercancel === 0,
    'listeners leaked after a plain click: ' + JSON.stringify(after));
});

await test('a drag on the outer dialog reports for the outer dialog only', async () => {
  await open('outer', { width: '300px' });
  await open('inner', { width: '200px' });
  await page.evaluate(() => {
    const w = document.getElementById('wrapper-inner');
    w.style.pointerEvents = 'none'; // keep the inner dialog out of the way of the drag
  });
  await dragCorner('outer', 90, 70);
  const c = await resizeCalls();
  assert(c.length > 0, 'expected an OnResize for outer');
  assert(c.every(x => x.dialog === 'outer'), 'expected outer only, got ' + JSON.stringify(c.map(x => x.dialog)));
});

await browser.close();
const failed = results.filter(r => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
