import type { Page, Frame, CDPSession } from 'playwright-core';
import { TIMEOUTS, TOKEN_BUDGETS, VIEWPORT_PRESETS, type BreakpointPreset } from '../constants.js';
import type { EmulatedMediaOptions } from '../types.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import { SpectorError } from '../utils/mcp-response.js';
import { evaluateInPage, withCdpSession } from '../utils/cdp.js';
import type { BrowserOperationEngine } from './operation-engine.js';

export const DEVTOOLS_OVERLAY_SELECTORS: readonly string[] = [
  '#nuxt-devtools-container',
  '[data-nuxt-devtools]',
  'nuxt-devtools-frame',
  '#__vue-devtools-container__',
  '.vue-devtools__anchor',
  'nextjs-portal',
  '#__next-build-watcher',
  '[data-nextjs-toast]',
  '[data-nextjs-dialog-overlay]',
  'vite-error-overlay',
  '.tsqd-parent-container'
];

export class RenderCapture {
  public constructor(
    private readonly operations: BrowserOperationEngine,
    private readonly assertTarget: (page: Page, url: string, navigated?: boolean) => void,
    private readonly readUrl: (page: Page) => string = page => page.url()
  ) {}

  public async captureScreenshotBuffer(
    page: Page,
    options: { selector?: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number }; timeoutMs?: number } = {}
  ): Promise<Buffer> {
    return this.operations.run(page, () => this.captureProductScreenshot(page, options));
  }

  private async captureProductScreenshot(
    page: Page,
    options: {
      selector?: string;
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      timeoutMs?: number;
    } = {}
  ): Promise<Buffer> {
    const timeout = this.operations.remainingTime(options.timeoutMs ?? TIMEOUTS.SCREENSHOT_DEFAULT_MS);
    let clip = options.clip;
    if (!clip && options.selector) {
      const effectiveSelector = escapeTailwindSelector(options.selector);
      const locator = page.locator(effectiveSelector).first();
      try {
        await locator.waitFor({ state: 'visible', timeout });
      } catch (err) {
        throw new SpectorError(
          'ELEMENT_NOT_READY',
          `Element with selector "${options.selector}" was not visible on the page after ${timeout / 1000}s timeout.`,
          undefined,
          { cause: err }
        );
      }
      await locator.scrollIntoViewIfNeeded({ timeout });
      const box = await locator.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) throw new SpectorError('ELEMENT_NOT_READY', 'Element has no capture area.');
      const scroll = await evaluateInPage(page, () => ({ x: scrollX, y: scrollY }));
      clip = { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height };
    }
    if (!clip) {
      clip = await evaluateInPage(page, fullPage => fullPage
        ? { x: 0, y: 0, width: Math.max(innerWidth, document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0), height: Math.max(innerHeight, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) }
        : { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight }, options.fullPage ?? false);
    }
    const dpr = await evaluateInPage(page, () => window.devicePixelRatio);
    if (![clip.x, clip.y, clip.width, clip.height, dpr].every(Number.isFinite) || clip.width <= 0 || clip.height <= 0 || dpr <= 0) {
      throw new SpectorError('ELEMENT_NOT_READY', 'Capture geometry is not finite and positive.');
    }
    const pixels = Math.ceil(clip.width * dpr) * Math.ceil(clip.height * dpr);
    if (pixels > TOKEN_BUDGETS.MAX_SCREENSHOT_PIXELS) {
      throw new SpectorError('RESOURCE_LIMIT_EXCEEDED', 'Screenshot area exceeds the pixel budget.', undefined,
        { details: { pixels, limitPixels: TOKEN_BUDGETS.MAX_SCREENSHOT_PIXELS } });
    }
    return await withCdpSession(page, timeout, 'Screenshot capture', async (cdp) => {
      // Playwright screenshots can restore cached viewport sizes over CDP breakpoint emulation.
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { ...clip, scale: 1 }
      });
      if (Buffer.byteLength(result.data, 'base64') > TOKEN_BUDGETS.MAX_SCREENSHOT_BYTES) {
        throw new SpectorError('RESOURCE_LIMIT_EXCEEDED', 'Screenshot exceeds the encoded image byte budget.');
      }
      return Buffer.from(result.data, 'base64');
    });
  }

  public async withBreakpointMetrics<T>(
    breakpoints: BreakpointPreset[],
    runner: (bp: BreakpointPreset, dims: { width: number; height: number }, cdp: CDPSession) => Promise<T>,
    target: Page
  ): Promise<T[]> {
    const operationPage = target;
    const operationUrl = this.readUrl(operationPage);
    let navigated = false;
    const onNavigation = (frame: Frame) => { if (frame === operationPage.mainFrame()) navigated = true; };
    // Serialize CDP device emulation mutations so concurrent diagnose/screenshot calls cannot clobber each other.
    const collect = async () => {
      const page = operationPage;
      this.assertTarget(page, operationUrl, navigated);
      const viewport = page.viewportSize();
      const readMetrics = () => evaluateInPage(page, () => ({
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      }));
      const before = await readMetrics();
      const sameMetrics = (value: typeof before) =>
        value.width === before.width && value.height === before.height &&
        value.deviceScaleFactor === before.deviceScaleFactor &&
        value.screenWidth === before.screenWidth && value.screenHeight === before.screenHeight;
      const cdp = await page.context().newCDPSession(page);
      const results: T[] = [];
      let operationError: unknown;
      try {
        for (const bp of breakpoints) {
          this.assertTarget(page, operationUrl, navigated);
          const preset = VIEWPORT_PRESETS[bp];
          await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: preset.width,
            height: preset.height,
            deviceScaleFactor: preset.deviceScaleFactor,
            mobile: preset.mobile
          });
          await page.waitForTimeout(100);
          results.push(await runner(bp, { width: preset.width, height: preset.height }, cdp));
          this.assertTarget(page, operationUrl, navigated);
        }
      } catch (error) {
        operationError = error;
        throw error;
      } finally {
        try {
          try {
            await cdp.send('Emulation.clearDeviceMetricsOverride');
          } finally {
            await cdp.detach();
          }
          if (!navigated && this.readUrl(page) === operationUrl && viewport && !sameMetrics(await readMetrics())) {
            // Playwright caches its last metrics. A size change forces the owning session to reapply DPR too.
            await page.setViewportSize({ width: viewport.width + 1, height: viewport.height });
            await page.setViewportSize(viewport);
          }
          if (!navigated && this.readUrl(page) === operationUrl) {
            await evaluateInPage(page, ({ x, y }) => window.scrollTo(x, y), { x: before.scrollX, y: before.scrollY });
          }
          if (!navigated && this.readUrl(page) === operationUrl && !sameMetrics(await readMetrics())) {
            // CDP acknowledges clearing metrics before the renderer always observes the resize.
            await page.waitForFunction(expected =>
              innerWidth === expected.width && innerHeight === expected.height &&
              devicePixelRatio === expected.deviceScaleFactor &&
              screen.width === expected.screenWidth && screen.height === expected.screenHeight,
              before, { timeout: 1000 });
          }
        } catch (restoreError) {
          throw new AggregateError(
            operationError ? [operationError, restoreError] : [restoreError],
            'Breakpoint audit failed to restore the original viewport.'
          );
        }
      }
      return results;
    };
    return this.operations.run(operationPage, async () => {
      operationPage.on('framenavigated', onNavigation);
      try { return await collect(); }
      finally { operationPage.off('framenavigated', onNavigation); }
    });
  }

  public async withEmulatedMedia<T>(
    target: Page,
    media: EmulatedMediaOptions | undefined,
    runner: () => Promise<T>
  ): Promise<T> {
    if (!media || (media.colorScheme === undefined && media.reducedMotion === undefined)) {
      return await runner();
    }

    const features: Array<{ name: string; value: string }> = [];
    if (media.colorScheme !== undefined) {
      features.push({ name: 'prefers-color-scheme', value: media.colorScheme });
    }
    if (media.reducedMotion !== undefined) {
      features.push({ name: 'prefers-reduced-motion', value: media.reducedMotion ? 'reduce' : 'no-preference' });
    }

    return this.operations.run(target, async () => {
      const cdp = await target.context().newCDPSession(target);
      let operationError: unknown;
      try {
        await cdp.send('Emulation.setEmulatedMedia', { features });
        return await runner();
      } catch (error) {
        operationError = error;
        throw error;
      } finally {
        try {
          try {
            await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] });
          } finally {
            await cdp.detach();
          }
        } catch (restoreError) {
          throw new AggregateError(
            operationError ? [operationError, restoreError] : [restoreError],
            'Media emulation failed to restore original preferences.'
          );
        }
      }
    });
  }

  public async withHiddenSelectors<T>(
    target: Page,
    selectors: string[] | undefined,
    runner: () => Promise<T>
  ): Promise<T> {
    const cleaned = (selectors ?? []).map(s => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      return await runner();
    }

    const escapedSelectors = cleaned.map(s => escapeTailwindSelector(s));
    const cssText = `${escapedSelectors.join(', ')} { visibility: hidden !important; pointer-events: none !important; }`;

    await evaluateInPage(target, (css: string) => {
      let style = document.querySelector('style[data-spector-hide-overlay="true"]') as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement('style');
        style.setAttribute('data-spector-hide-overlay', 'true');
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = css;
    }, cssText);

    try {
      return await runner();
    } finally {
      await evaluateInPage(target, () => {
        const style = document.querySelector('style[data-spector-hide-overlay="true"]');
        if (style) style.remove();
      }).catch(() => {});
    }
  }

}
