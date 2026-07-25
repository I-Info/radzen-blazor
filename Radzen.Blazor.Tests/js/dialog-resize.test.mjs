// Regression tests for the dialog resize gate in Radzen.Blazor.js.
//
//   node Radzen.Blazor.Tests/js/dialog-resize.test.mjs
//
// Needs playwright-core and a Chromium build; point PLAYWRIGHT_CHROMIUM at the
// executable, or let it fall back to the ms-playwright cache.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = 'file://' + path.join(here, 'dialog-resize.html');

const launchOptions = process.env.PLAYWRIGHT_CHROMIUM
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
  : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();

const results = [];
async function test(name, fn) {
  await page.goto(harness);
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ok   ' + name);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log('  FAIL ' + name + '\n       ' + err.message);
  }
}

// openDialog defers wiring by 500ms.
const settle = () => page.waitForTimeout(700);
const calls = () => page.evaluate(() => window.__calls);
const resizeCalls = async () => (await calls()).filter(c => c.method === 'RadzenDialog.OnResize');

async function open(name, opts) {
  await page.evaluate(([n, o]) => window.__openDialog(n, o), [name, opts]);
  await settle();
}

async function dragCorner(id, dx, dy) {
  const box = await page.locator('#' + id).boundingBox();
  const x = box.x + box.width - 3;
  const y = box.y + box.height - 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// The reported bug: an outer dialog whose height is content-driven got its measured
// size pinned as an inline width/height, so it could never auto-size again.
await test('content growth alone does not report a resize', async () => {
  await open('outer', { width: '600px' });
  await page.evaluate(() => window.__resetCalls());

  await page.evaluate(() => {
    document.getElementById('content-outer').innerHTML = '<p>line</p>'.repeat(40);
  });
  await page.waitForTimeout(200);

  assert.deepEqual(await resizeCalls(), [], 'OnResize must not fire for content growth');
});

await test('opening and closing a nested dialog does not report a resize', async () => {
  await open('outer', { width: '600px' });
  await page.evaluate(() => window.__resetCalls());

  await open('inner', { width: '400px' });
  // Reflow the outer dialog the way real content does while the nested one is up.
  await page.evaluate(() => {
    document.getElementById('content-outer').innerHTML = '<p>reloaded</p>'.repeat(30);
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__closeDialog('inner'));
  await page.waitForTimeout(300);

  assert.deepEqual(await resizeCalls(), [], 'nested dialog lifecycle must not pin the outer size');
});

// The gate must not break the feature it guards.
await test('dragging the native resize handle does report the new size', async () => {
  await open('outer', { width: '600px', height: '300px' });
  await page.evaluate(() => window.__resetCalls());

  await dragCorner('dialog-outer', 120, 90);

  const seen = await resizeCalls();
  assert.ok(seen.length > 0, 'a real drag must reach OnResize');

  const final = seen[seen.length - 1];
  const box = await page.locator('#dialog-outer').boundingBox();
  assert.equal(final.a, Math.round(box.width), 'final width must match the element');
  assert.equal(final.b, Math.round(box.height), 'final height must match the element');
});

await test('a drag on the outer dialog reports for the outer dialog only', async () => {
  await open('outer', { width: '600px', height: '300px' });
  await open('inner', { width: '300px', height: '200px' });
  await page.evaluate(() => window.__resetCalls());

  await dragCorner('dialog-inner', 80, 60);

  const seen = await resizeCalls();
  assert.ok(seen.length > 0, 'the nested dialog must still be resizable');
  assert.deepEqual([...new Set(seen.map(c => c.dialog))], ['inner'],
    'only the dragged dialog may report');
});

// A nested dialog used to overwrite the single global resizer slot and the single
// "[object HTMLDivElement]" drag-handler key.
await test('each dialog keeps its own resizer and drag handler', async () => {
  await open('outer', { width: '600px', height: '300px' });
  await open('inner', { width: '300px', height: '200px' });

  assert.equal(await page.evaluate(() => Radzen.dialogResizers.length), 2,
    'both dialogs must have a live resizer');
  assert.equal(
    await page.evaluate(() => typeof document.getElementById('titlebar-outer').dragHandler),
    'function', 'the outer titlebar must keep its own drag handler');

  await page.evaluate(() => window.__closeDialog('inner'));
  await page.waitForTimeout(200);
  // The outer dialog is still open, so its resizer must survive.
  await page.evaluate(() => window.__resetCalls());
  await dragCorner('dialog-outer', 60, 40);
  assert.ok((await resizeCalls()).length > 0,
    'the outer dialog must stay resizable after a nested dialog closes');
});

await test('closing the last dialog disposes every resizer', async () => {
  await open('outer', { width: '600px', height: '300px' });
  await open('inner', { width: '300px', height: '200px' });

  await page.evaluate(() => window.__closeDialog('inner'));
  await page.evaluate(() => window.__closeDialog('outer'));
  await page.waitForTimeout(200);

  assert.equal(await page.evaluate(() => Radzen.dialogResizers.length), 0);
  assert.equal(await page.evaluate(() => Radzen.dialogResizer), null);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.error(`\n${f.name}:\n${f.err.stack}`);
  process.exit(1);
}
