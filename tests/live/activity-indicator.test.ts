import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright-core';
import { ActivityIndicator } from '../../src/browser/activity-indicator.js';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { extractCompressedDom } from '../../src/analyzers/dom-compressor.js';
import { extractDesignTokens } from '../../src/analyzers/token-extractor.js';
import { runLayoutForensics } from '../../src/analyzers/layout-forensics.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.SPECTOR_TEST_CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
});
afterAll(async () => { await browser?.close(); });

test('activity is per tab, non-blocking on mobile, excluded from capture and analysis', async () => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage(); const other = await context.newPage();
  await page.setContent('<html lang="id"><title>Fixture</title><style>body{margin:0;background:white}button{position:fixed;right:8px;bottom:8px}</style><main><input aria-label="Name"><button onclick="this.textContent=\'Clicked\'">Click</button></main></html>');
  const manager = new CdpSessionManager(); manager.page = page;
  const before = { dom: await extractCompressedDom(page), tokens: await extractDesignTokens(page), layout: await runLayoutForensics(page) };
  const box = await page.locator('button').boundingBox();
  const clean = await manager.captureScreenshotBuffer(page);
  await manager.activity.run(page, async () => {
    expect(await page.locator('[data-spector-activity]').count()).toBe(1);
    expect(await other.locator('[data-spector-activity]').count()).toBe(0);
    expect(await page.locator('button').boundingBox()).toEqual(box);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    expect(await extractCompressedDom(page)).toBe(before.dom);
    expect(await extractDesignTokens(page)).toEqual(before.tokens);
    expect(await runLayoutForensics(page)).toEqual(before.layout);
    expect(await manager.captureScreenshotBuffer(page)).toEqual(clean);
    expect(await page.locator('[data-spector-activity]').isVisible()).toBe(true);
    const bounds = await page.locator('[data-spector-activity]').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    expect(bounds!.x + bounds!.width <= box!.x || bounds!.y + bounds!.height <= box!.y || bounds!.x >= box!.x + box!.width || bounds!.y >= box!.y + box!.height).toBe(true);
    await page.screenshot({ path: '/tmp/spector-activity-mobile.png' });
    await manager.activity.withoutIndicator(page, async () => {
      await page.screenshot({ path: '/tmp/spector-product-mobile.png' });
    });
    await page.locator('button').click();
    expect(await page.locator('button').textContent()).toBe('Clicked');
    await page.locator('input').focus(); await page.keyboard.type('Human');
    expect(await page.locator('input').inputValue()).toBe('Human');
  });
  expect(await page.locator('[data-spector-activity]').count()).toBe(0);
  await manager.activity.run(page, async () => { expect(await page.locator('[data-spector-activity]').isVisible()).toBe(true); });
  await context.close();
});

test('overlap, failure, navigation and local expiry clean up without releasing another operation', async () => {
  const page = await browser.newPage(); const indicator = new ActivityIndicator(1000);
  await page.route('http://activity.test/**', route => route.fulfill({ body: '<main>Activity fixture</main>' }));
  await page.goto('http://activity.test/first');
  await indicator.run(page, async () => {
    await expect(indicator.run(page, async () => { throw new Error('Operation failed'); })).rejects.toThrow('Operation failed');
    expect(await page.locator('[data-spector-activity]').isVisible()).toBe(true);
    await page.goto('http://activity.test/next');
    await page.locator('[data-spector-activity]').waitFor({ state: 'visible', timeout: 800 });
    await page.waitForTimeout(1100);
    expect(await page.locator('[data-spector-activity]').count()).toBe(0);
  });
  expect(await page.locator('[data-spector-activity]').count()).toBe(0);
  await page.close();
});

test('disconnect cleanup cannot remove a later operation indicator', async () => {
  const page = await browser.newPage(); const indicator = new ActivityIndicator();
  let release!: () => void; const gate = new Promise<void>(r => release = r);
  let started!: () => void; const ready = new Promise<void>(r => started = r);
  const first = indicator.run(page, async () => { started(); await gate; });
  await ready; await indicator.clear();
  await indicator.run(page, async () => {
    release(); await first;
    expect(await page.locator('[data-spector-activity]').isVisible()).toBe(true);
  });
  expect(await page.locator('[data-spector-activity]').count()).toBe(0); await page.close();
});
