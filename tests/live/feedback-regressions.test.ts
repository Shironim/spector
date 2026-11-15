import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright-core';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { runLayoutForensics } from '../../src/analyzers/layout-forensics.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.SPECTOR_TEST_CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }); });
afterAll(async () => { await browser?.close(); });
test('closed selected target never falls back to the other tab', async () => {
  const context = await browser.newContext(); const a = await context.newPage(); const b = await context.newPage();
  const manager = new CdpSessionManager(); manager.page = a; manager.context = context;
  await manager.setupPageListeners(a); await a.close();
  await expect(manager.ensurePage()).rejects.toMatchObject({code:'TARGET_CHANGED'});
  expect(b.isClosed()).toBe(false); await manager.disconnect(); await context.close();
});
test('queued breakpoint operation rejects a changed target before emulating it', async () => {
  const context = await browser.newContext(); const a = await context.newPage(); const b = await context.newPage();
  const manager = new CdpSessionManager(); manager.page = a;
  let release!: () => void; const gate = new Promise<void>(r => release = r);
  const first = manager.withBreakpointMetrics(['mobile'], async () => { await gate; });
  await new Promise(r => setTimeout(r, 200));
  const second = manager.withBreakpointMetrics(['desktop'], async () => 'unexpected', a);
  manager.page = b; release();
  const outcomes = await Promise.allSettled([first, second]);
  expect(outcomes.every(r => r.status === 'rejected' && r.reason.code === 'TARGET_CHANGED')).toBe(true);
  await context.close();
}, 20000);
test('selector captures footer at all breakpoints and restores viewport', async () => {
  const page = await browser.newPage({viewport:{width:1111,height:777}}); const manager = new CdpSessionManager(); manager.page = page;
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="height:2000px"></div><button id="footer">Footer CTA</button>');
  const captures = await manager.withBreakpointMetrics(['desktop','tablet','mobile'], async (_, dims) => {
    const buffer = await manager.captureScreenshotBuffer(page, {selector:'#footer'});
    expect(buffer.length).toBeGreaterThan(100); expect(await page.locator('#footer').isVisible()).toBe(true);
    expect((await manager.captureMetadata(page)).viewport.width).toBe(dims.width);
    return dims.width;
  }, page);
  expect(captures).toEqual([1440,768,375]); expect(await page.evaluate(() => innerWidth)).toBe(1111); await page.close();
}, 20000);
test('screen-reader caption reproduction retains real clipped content finding', async () => {
 const page = await browser.newPage(); await page.setContent(`<style>.reader{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.cut{width:40px;overflow:hidden;white-space:nowrap}</style><span id="caption" class="reader">Caption for screen reader only</span><div id="cut" class="cut">Real content that is cut off</div>`);
 const issues = (await runLayoutForensics(page)).clippingTraps;
 expect(issues.some(i => i.selector === '#caption' && i.issue === 'content-clipped')).toBe(false);
 expect(issues.some(i => i.selector === '#cut' && i.issue === 'content-clipped')).toBe(true); await page.close();
});

test('input actions update form events, focus and selection; URL mismatch prevents mutation', async () => {
  const page = await browser.newPage(); const manager = new CdpSessionManager(); manager.page = page;
  await page.setContent('<input id="name"><select id="choice"><option value="a">A</option><option value="b">B</option></select><output></output><script>document.querySelector("input").addEventListener("input", e => document.querySelector("output").textContent = e.target.value)</script>');
  await manager.interact('fill', '#name', undefined, 0, 'Ada');
  expect(await page.locator('output').textContent()).toBe('Ada');
  await manager.interact('pressKey', '#name', undefined, 0, 'Tab');
  expect(await page.locator('#choice').evaluate(el => document.activeElement === el)).toBe(true);
  await manager.interact('selectOption', '#choice', undefined, 0, 'b');
  expect(await page.locator('#choice').inputValue()).toBe('b');
  await expect(manager.interact('fill', '#name', undefined, 0, 'Wrong', 'http://unexpected.test')).rejects.toMatchObject({code:'TARGET_CHANGED'});
  expect(await page.locator('#name').inputValue()).toBe('Ada');
  await page.close();
});

test('metadata redacts credentials, query values and fragment but keeps target identity', async () => {
 const page = await browser.newPage(); const manager = new CdpSessionManager(); manager.page = page;
 await page.route('http://fixture.test/**', route => route.fulfill({body:'<div>Fixture</div>'}));
 await page.goto('http://fixture.test/path?token=secret&view=mobile#private');
 const meta = await manager.captureMetadata(page);
 expect(meta.url).not.toContain('secret'); expect(meta.url).not.toContain('private');
 expect(meta.targetId).toBe(manager.targetId(page));
 expect(() => manager.assertTarget(page, 'http://fixture.test/path?token=secret&view=desktop#private')).toThrow();
 await page.close();
});

test('reattach preserves selection and explicit selection recovers after target closes', async () => {
 const context = await browser.newContext(); const a = await context.newPage(); const b = await context.newPage();
 const manager = new CdpSessionManager(); manager.browser = browser; manager.context = context; manager.page = a;
 await manager.attach('http://localhost:9222', true, false);
 expect(await manager.ensurePage()).toBe(a);
 await a.close(); await expect(manager.attach('http://localhost:9222', true, false)).rejects.toMatchObject({code:'TARGET_CHANGED'});
 await manager.selectTab({index:0}); expect(await manager.ensurePage()).toBe(b);
 manager.browser = null; await manager.disconnect(); await context.close();
});

test('navigation during breakpoint run is rejected and old scroll is not restored', async () => {
 const page = await browser.newPage(); const manager = new CdpSessionManager(); manager.page = page;
 await page.setContent('<div style="height:3000px">Old</div>'); await page.evaluate(() => scrollTo(0, 400));
 await expect(manager.withBreakpointMetrics(['mobile'], async () => { await page.goto('data:text/html,<div>New</div>'); }, page)).rejects.toMatchObject({code:'TARGET_CHANGED'});
 expect(await page.evaluate(() => scrollY)).toBe(0); await page.close();
}, 15000);

test('same-URL reload invalidates capture and does not restore old scroll', async () => {
 const page = await browser.newPage(); const manager = new CdpSessionManager(); manager.page = page;
 await page.route('http://reload.test/**', route => route.fulfill({body:'<div style="height:3000px">Reload</div>'}));
 await page.goto('http://reload.test/'); await page.evaluate(() => scrollTo(0, 400));
 await expect(manager.withBreakpointMetrics(['mobile'], async () => { await page.reload(); await page.evaluate(() => scrollTo(0, 120)); }, page)).rejects.toMatchObject({code:'TARGET_CHANGED'});
 expect(await page.evaluate(() => scrollY)).toBe(120); await page.close();
}, 15000);

test('operation context cannot silently follow another selected page', async () => {
 const context = await browser.newContext(); const a = await context.newPage(); const b = await context.newPage();
 const manager = new CdpSessionManager(); manager.page = a;
 await expect(manager.runBrowserOperation(async () => { manager.page = b; await manager.ensurePage(); })).rejects.toMatchObject({code:'TARGET_CHANGED'});
 expect(await a.locator('[data-spector-activity]').count()).toBe(0);
 expect(await b.locator('[data-spector-activity]').count()).toBe(0); await context.close();
});

test('page and full-page PNG widths match the emulated breakpoint', async () => {
 const page = await browser.newPage({viewport:{width:1111,height:777}}); const manager = new CdpSessionManager(); manager.page = page;
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="height:2300px">Tall page</div>');
 for (const fullPage of [false, true]) {
   await manager.withBreakpointMetrics(['mobile','desktop'], async (_, dims) => {
     const buffer = await manager.captureScreenshotBuffer(page, { fullPage });
     expect(buffer.readUInt32BE(16)).toBe(dims.width);
     expect(await page.evaluate(() => innerWidth)).toBe(dims.width);
   }, page);
 }
 await page.close();
}, 15000);
