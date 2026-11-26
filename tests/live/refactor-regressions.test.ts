import { afterAll, beforeAll, expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright-core';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { explainCssCascade, extractPseudoStateDelta } from '../../src/analyzers/cdp-styles.js';
import { runTokenAudit } from '../../src/analyzers/token-audit.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({
    executablePath: process.env.SPECTOR_TEST_CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox']
  });
});
afterAll(async () => { await browser?.close(); });

test('A01: Alt+P Queue sends two pins and their notes exactly once', async () => {
  const page = await browser.newPage();
  const manager = new CdpSessionManager();
  manager.page = page;
  try {
    await page.setContent('<style>body{padding-top:120px}button{width:120px;height:60px}</style><button id="one">One</button><button id="two">Two</button>');
    await page.evaluate(() => {
      (window as any).__spectorOverlay = { __version: 2, start: () => { throw new Error('Old overlay must be replaced'); } };
    });
    await manager.setupPageListeners(page);
    await page.keyboard.press('Alt+p');
    await page.locator('[data-spector-picker="toolbar"]').waitFor({ state: 'visible', timeout: 2000 });
    await page.locator('#one').click();
    await page.locator('[data-spector-picker="popover"] input').fill('First note');
    await page.getByRole('button', { name: '+ Pin', exact: true }).click();
    await page.locator('#two').click();
    await page.locator('[data-spector-picker="popover"] input').fill('Second note');
    await page.getByRole('button', { name: '+ Pin', exact: true }).click();
    await page.waitForTimeout(250);
    expect((await manager.getLastPicked())?.pins.length ?? 0).toBe(0);
    await page.getByRole('button', { name: 'Send (2)', exact: true }).click();
    for (let attempt = 0; attempt < 50 && (await manager.getLastPicked())?.pins.length !== 2; attempt++) {
      await page.waitForTimeout(20);
    }
    expect((await manager.getLastPicked())?.pins.map(p => [p.selector, p.role, p.note])).toEqual([
      ['#one', 'pin', 'First note'], ['#two', 'pin', 'Second note']
    ]);
    manager.clearPins();
    await page.keyboard.press('Alt+p');
    await page.locator('[data-spector-picker="toolbar"]').waitFor({ state: 'visible', timeout: 2000 });
    await page.locator('#one').click();
    await page.getByRole('button', { name: '+ Pin', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    expect((await manager.getLastPicked())?.pins.length ?? 0).toBe(0);
  } finally { await manager.disconnect(); await page.close(); }
}, 15000);

test('A02: important layer priority agrees with the rendered browser and deduplicates declarations', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>
      @layer base, override;
      @layer base { .target { color: red !important; background-color: red; } }
      @layer override { .target { color: blue !important; background-color: blue; } }
      .target { color: green !important; background-color: green; }
    </style><div class="target">Layer test</div>`);
    const result = await explainCssCascade(page, '.target', ['color', 'background-color']);
    expect(await page.locator('.target').evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 0, 0)');
    expect(result.properties.color.winningValue.replace(/\s*!important$/, '')).toBe('red');
    expect(result.properties['background-color'].winningValue).toBe('green');
    expect(result.properties.color.overridden).toHaveLength(2);
    expect(result.properties.color.winningSource).toContain('base');
    await page.locator('.target').evaluate(el => (el as HTMLElement).style.setProperty('color', 'purple', 'important'));
    expect((await explainCssCascade(page, '.target', ['color'])).properties.color.winningSource).toBe('element.style (inline)');
    await page.addStyleTag({ content: '@layer base { @layer first, last; @layer first {.nested{color:orange!important}} @layer last {.nested{color:cyan!important}} }' });
    await page.evaluate(() => { const el = document.createElement('div'); el.className = 'nested'; document.body.append(el); });
    expect((await explainCssCascade(page, '.nested', ['color'])).properties.color.winningValue.replace(/\s*!important$/, '')).toBe('orange');
  } finally { await page.close(); }
});

test('A03: hover/focus capture transition endpoints, preserve CSS, and reset pseudo states', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>
      button { background-color: rgb(0,0,0); transition: background-color 0.3s linear 0.2s; }
      button:hover, button:focus-visible { background-color: rgb(255,0,0); }
    </style><button id="target" style="padding:12px">Transition</button>`);
    for (const state of [':hover', ':focus-visible'] as const) {
      const result = await extractPseudoStateDelta(page, '#target', state);
      expect(result?.changes.backgroundColor).toEqual({ normal: 'rgb(0, 0, 0)', active: 'rgb(255, 0, 0)' });
      expect(result?.transition?.duration).toBe('0.3s');
      expect(await page.locator('#target').getAttribute('style')).toBe('padding:12px');
      expect(await page.locator('#target').evaluate((el, pseudo) => el.matches(pseudo), state)).toBe(false);
    }
  } finally { await page.close(); }
});

test('A04: tokens resolve active computed custom properties and cap :root variables at 50', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>
      :root { --accent:red; --base:12px; --alias:var(--base); }
    </style><div>Token test</div>`);
    await page.evaluate(() => document.documentElement.style.setProperty('--accent', 'purple'));
    const result = await runTokenAudit(page);
    expect(result!.cssVariables).toMatchObject({ '--accent': 'purple', '--base': '12px', '--alias': '12px' });
    const manyVars = Array.from({ length: 65 }, (_, i) => `--test-${i}:${i}px;`).join('');
    await page.setContent(`<style>:root { ${manyVars} }</style><div>Bounded</div>`);
    const bounded = (await runTokenAudit(page))!.cssVariables;
    expect(Object.keys(bounded)).toHaveLength(50);
  } finally { await page.close(); }
});

test('A05: breakpoint audits restore actual render metrics on success and runner failure', async () => {
  const page = await browser.newPage({ viewport: { width: 1111, height: 777 }, deviceScaleFactor: 2 });
  const manager = new CdpSessionManager();
  manager.page = page;
  const metrics = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  try {
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div>Viewport</div>');
    const before = await metrics();
    const during = await manager.withBreakpointMetrics(['mobile', 'desktop'], metrics);
    expect(during.map(m => m.width)).toEqual([375, 1440]);
    expect(await metrics()).toEqual(before);
    await assert.rejects(manager.withBreakpointMetrics(['tablet'], async () => { throw new Error('runner failed'); }), /runner failed/);
    expect(await metrics()).toEqual(before);
  } finally { await page.close(); }
}, 15000);

test('A05: native viewport stays unmanaged and restores scroll after audit', async () => {
  const page = await browser.newPage({ viewport: null });
  const manager = new CdpSessionManager();
  manager.page = page;
  const metrics = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scroll: scrollY }));
  try {
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="height:3000px">Native viewport</div>');
    await page.evaluate(() => window.scrollTo(0, 300));
    const before = await metrics();
    await manager.withBreakpointMetrics(['mobile', 'tablet', 'desktop'], metrics);
    expect(await metrics()).toEqual(before);
    expect(page.viewportSize()).toBeNull();
  } finally { await page.close(); }
});
