import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Request } from 'playwright-core';
import type {
  ActiveTabInfo,
  ComparisonDiff,
  PickedElementInfo,
  PinRole,
  PinSelectionMode,
  TabInfo,
  TabSelectCriteria
} from '../types.js';
import { type BreakpointPreset, TIMEOUTS } from '../constants.js';
import { TelemetryStore } from './telemetry-store.js';
import { PinStore } from './pin-store.js';
import { extractCdpPort, launchChromeForCdp, validateCdpEndpoint } from './chrome-launcher.js';
import { dispatchPageInteraction, type InteractAction } from './interactions.js';
import { HOTKEY_BINDING_SCRIPT, OVERLAY_ENGINE_SCRIPT } from './overlay-script.js';
import { SpectorError } from '../utils/mcp-response.js';
import { logger } from '../utils/logger.js';
import { ActivityIndicator } from './activity-indicator.js';
import { BrowserOperationEngine } from './operation-engine.js';
import { DocumentRegistry } from './document-registry.js';
import { RenderCapture } from './render-capture.js';
import { parsePickerPayload, type BrowserPickedPin } from './picker-payload.js';
import { PickerEvidence } from './picker-evidence.js';

export { validateCdpEndpoint, extractCdpPort } from './chrome-launcher.js';

type TabMatcher = {
  key: keyof TabSelectCriteria;
  matches: (criteria: TabSelectCriteria, pages: Page[]) => Promise<Page | undefined>;
};

const TAB_MATCHERS: ReadonlyArray<TabMatcher> = [
  {
    key: 'index',
    matches: async (criteria, pages) => {
      const idx = criteria.index!;
      if (idx < 0 || idx >= pages.length) {
        throw new SpectorError('TAB_NOT_FOUND', `Tab index ${idx} is out of bounds (0-${pages.length - 1}).`);
      }
      return pages[idx];
    }
  },
  {
    key: 'url',
    matches: async (criteria, pages) => {
      const rawQuery = criteria.url!.trim();
      if (!rawQuery) return undefined;
      if (rawQuery.includes('*')) {
        const collapsed = rawQuery.replace(/\*+/g, '*');
        const escaped = collapsed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const globRe = new RegExp(escaped, 'i');
        return pages.find(p => globRe.test(p.url()));
      }
      const needle = rawQuery.toLowerCase();
      return pages.find(p => p.url().toLowerCase().includes(needle));
    }
  },
  {
    key: 'title',
    matches: async (criteria, pages) => {
      const titleQuery = criteria.title!.trim().toLowerCase();
      if (!titleQuery) return undefined;
      const needle = titleQuery;
      for (const p of pages) {
        if ((await p.title()).toLowerCase().includes(needle)) {
          return p;
        }
      }
      return undefined;
    }
  },
  {
    key: 'latest',
    matches: async (_criteria, pages) => pages[pages.length - 1]
  }
];

function serializeQueue<T>(tail: Promise<unknown>, fn: () => Promise<T>): { next: Promise<T>; updatedTail: Promise<unknown> } {
  const next = tail.then(fn, fn);
  return { next, updatedTail: next.catch(() => {}) };
}

function evidenceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:', 'about:'].includes(url.protocol)) return `${url.protocol}[REDACTED]`;
    url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    if (url.hash) url.hash = '[REDACTED]';
    return url.toString();
  } catch { return '[UNAVAILABLE]'; }
}

export class CdpSessionManager {
  private static instance: CdpSessionManager | null = null;

  public browser: Browser | null = null;
  public context: BrowserContext | null = null;
  public page: Page | null = null;
  private cdpUrl = 'http://localhost:9222';

  public readonly telemetry = new TelemetryStore();
  public readonly pins = new PinStore();
  public readonly activity = new ActivityIndicator();

  private requestStartTimes = new Map<Request, number>();
  private attachedPages = new WeakSet<Page>();
  private watchedPages = new WeakSet<Page>();
  private pageListeners = new Map<Page, Array<{ event: string; listener: (...args: any[]) => void }>>();
  private contextPageListener: ((page: Page) => void) | null = null;
  private pendingPageSetups = new Set<Promise<void>>();
  private attachQueue: Promise<unknown> = Promise.resolve();
  private targetIds = new WeakMap<Page, string>();
  private nextTargetId = 0;
  private readonly documents = new DocumentRegistry();
  private readonly operations = new BrowserOperationEngine(this.activity, (page, url, navigated) => this.assertTarget(page, url, navigated));
  private readonly renderer = new RenderCapture(this.operations, this.activity, (page, url, navigated) => this.assertTarget(page, url, navigated));
  private readonly evidence = new PickerEvidence(this.documents, this.pins,
    (page, options) => this.renderer.captureScreenshotBuffer(page, options),
    (page, url, changed) => this.assertTarget(page, url, changed), page => this.targetId(page),
    limit => this.operations.remainingTime(limit));

  public remainingTime(localLimit: number): number {
    return this.operations.remainingTime(localLimit);
  }

  public async runBrowserOperation<T>(operation: () => Promise<T>, allowNavigation = false, timeoutMs?: number): Promise<T> {
    const page = await this.ensurePage();
    return this.operations.run(page, operation, { allowNavigation, timeoutMs });
  }

  public targetId(page: Page): string {
    let id = this.targetIds.get(page);
    if (!id) { id = `target-${++this.nextTargetId}`; this.targetIds.set(page, id); }
    return id;
  }

  public assertTarget(page: Page, expectedUrl: string, documentChanged = false): void {
    this.operations.throwIfExpired();
    if (documentChanged || page.isClosed() || this.page !== page || page.url() !== expectedUrl) {
      throw new SpectorError('TARGET_CHANGED', 'Selected target changed during operation.', undefined, {
        details: { documentChanged, urlChanged: !page.isClosed() && page.url() !== expectedUrl, expected: { targetId: this.targetId(page), url: evidenceUrl(expectedUrl) },
          actual: this.page && !this.page.isClosed() ? { targetId: this.targetId(this.page), url: evidenceUrl(this.page.url()) } : null }
      });
    }
  }

  public async captureMetadata(page: Page, selector?: string) {
    return { targetId: this.targetId(page), documentId: this.documents.id(page), url: evidenceUrl(page.url()), selector,
      viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      capturedAt: new Date().toISOString() };
  }

  public constructor() {}

  public static getInstance(): CdpSessionManager {
    if (!CdpSessionManager.instance) {
      CdpSessionManager.instance = new CdpSessionManager();
    }
    return CdpSessionManager.instance;
  }

  public isAttached(): boolean {
    return (
      this.browser !== null &&
      this.browser.isConnected() &&
      this.context !== null &&
      this.page !== null &&
      !this.page.isClosed()
    );
  }

  public async attach(
    cdpUrl: string = 'http://localhost:9222',
    autoSelectActiveTab: boolean = true,
    autoLaunch: boolean = true
  ): Promise<ActiveTabInfo> {
    validateCdpEndpoint(cdpUrl);
    const { next, updatedTail } = serializeQueue(this.attachQueue, () =>
      this.attachInternal(cdpUrl, autoSelectActiveTab, autoLaunch)
    );
    this.attachQueue = updatedTail;
    return await next;
  }

  private async connectOrLaunchBrowser(targetUrl: string, autoLaunch: boolean): Promise<Browser> {
    try {
      return await chromium.connectOverCDP(targetUrl, { timeout: TIMEOUTS.CDP_CONNECT_MS });
    } catch (connectError: unknown) {
      const isWebSocket = targetUrl.startsWith('ws:') || targetUrl.startsWith('wss:');
      if (!autoLaunch || isWebSocket) throw connectError;
      const launched = await launchChromeForCdp(targetUrl);
      if (!launched) throw connectError;
      return await chromium.connectOverCDP(targetUrl, { timeout: TIMEOUTS.CDP_CONNECT_MS });
    }
  }

  private async attachInternal(
    targetUrl: string,
    autoSelectActiveTab: boolean,
    autoLaunch: boolean
  ): Promise<ActiveTabInfo> {
    if (this.browser?.isConnected() && this.cdpUrl === targetUrl && this.context) {
      if (!this.page || this.page.isClosed()) throw new SpectorError('TARGET_CHANGED', 'Select a tab explicitly after target loss.');
      const pages = this.context.pages().filter(p => !p.isClosed());
      for (const p of pages) {
        await this.setupPageListeners(p);
      }
      if (this.page) {
        return {
          title: (await this.page.title()) || '(No Title)',
          url: this.page.url(),
          viewport: this.page.viewportSize()
        };
      }
    }

    try {
      if (this.browser) await this.disconnect();

      const browser = await this.connectOrLaunchBrowser(targetUrl, autoLaunch);
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        await browser.close().catch(() => {});
        throw new SpectorError('BROWSER_CONTEXT_UNAVAILABLE', 'Connected to Chrome CDP, but no browser contexts are available.');
      }

      this.browser = browser;
      this.context = contexts[0];
      this.cdpUrl = targetUrl;

      this.contextPageListener = (newPage: Page) => {
        const wireUpNewPage = () => {
          if (!newPage.isClosed()) {
            void this.setupPageListeners(newPage);
          }
        };
        this.listenPage(newPage, 'domcontentloaded', wireUpNewPage);
        wireUpNewPage();
      };
      this.context.on('page', this.contextPageListener);

      const pages = this.context.pages();
      if (pages.length === 0) {
        this.page = await this.context.newPage();
      } else {
        this.page = autoSelectActiveTab ? pages[pages.length - 1] : pages[0];
      }

      for (const p of pages) {
        if (!p.isClosed()) {
          await this.setupPageListeners(p);
        }
      }

      return {
        title: (await this.page.title()) || '(No Title)',
        url: this.page.url(),
        viewport: this.page.viewportSize()
      };
    } catch (error: unknown) {
      if (error instanceof SpectorError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new SpectorError(
        'CHROME_CDP_UNAVAILABLE',
        `Failed to connect to Chrome at ${targetUrl}. Make sure Chrome is running with --remote-debugging-port=${extractCdpPort(targetUrl)}. Underlying error: ${msg}`,
        undefined,
        { cause: error }
      );
    }
  }

  public async ensurePage(): Promise<Page> {
    const bound = this.operations.currentPage;
    if (bound) {
      this.assertTarget(bound, bound.url());
      return bound;
    }
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (this.page || this.context) {
      throw new SpectorError('TARGET_CHANGED', 'Selected target is closed or unavailable. Select a tab explicitly.');
    }

    await this.attach(this.cdpUrl, true);
    if (!this.page) {
      throw new SpectorError('BROWSER_CONTEXT_UNAVAILABLE', 'No active page available. Please call spector_attach first.');
    }
    return this.page;
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (!this.browser || !this.browser.isConnected() || !this.context) {
      await this.attach(this.cdpUrl, true);
    }
    if (!this.context) {
      throw new SpectorError('BROWSER_CONTEXT_UNAVAILABLE', 'No active browser context available. Call spector_attach first.');
    }
    return this.context;
  }

  private listenPage(page: Page, event: string, listener: (...args: any[]) => void): void {
    page.on(event as any, listener as any);
    const listeners = this.pageListeners.get(page) || [];
    listeners.push({ event, listener });
    this.pageListeners.set(page, listeners);
  }

  public setupPageListeners(page: Page): Promise<void> {
    if (page.isClosed()) return Promise.resolve();
    try {
      const currentUrl = page.url();
      if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://')) {
        if (!this.watchedPages.has(page)) {
          this.watchedPages.add(page);
          this.listenPage(page, 'framenavigated', () => {
            void this.setupPageListeners(page);
          });
        }
        return Promise.resolve();
      }
    } catch {
      // Page URL unavailable mid-navigation; proceed with attachment attempt.
    }

    if (this.attachedPages.has(page)) {
      return Promise.resolve();
    }
    this.attachedPages.add(page);
    this.listenPage(page, 'close', () => {
      for (const { event, listener } of this.pageListeners.get(page) ?? []) page.off(event as any, listener as any);
      this.pageListeners.delete(page);
    });

    const hotkeySetup = this.setupHotkeyPicker(page)
      .catch(() => {})
      .finally(() => {
        this.pendingPageSetups.delete(hotkeySetup);
      });
    this.pendingPageSetups.add(hotkeySetup);

    this.listenPage(page, 'console', (msg) => {
      if (!this.pageListeners.has(page)) return;
      const loc = msg.location();
      const locationStr = loc?.url ? `${loc.url}:${loc.lineNumber}` : undefined;
      this.telemetry.addConsole(msg.type(), msg.text(), locationStr);
    });

    this.listenPage(page, 'pageerror', (error) => {
      if (!this.pageListeners.has(page)) return;
      this.telemetry.addPageError(error.message, error.stack);
    });

    this.listenPage(page, 'request', (req) => {
      try {
        this.requestStartTimes.set(req, Date.now());
      } catch {
        // Request reference unavailable during abrupt frame unload.
      }
    });

    this.listenPage(page, 'response', (res) => {
      try {
        const req = res.request();
        const start = this.requestStartTimes.get(req);
        const durationMs = start !== undefined ? Date.now() - start : undefined;
        this.requestStartTimes.delete(req);

        if (!this.pageListeners.has(page)) return;
        const status = res.status();
        if (status < 400) return;

        this.telemetry.addFailedNetwork({
          method: req.method(),
          url: req.url(),
          resourceType: req.resourceType(),
          status,
          statusText: res.statusText(),
          durationMs
        });
      } catch {
        // Response inspection skipped when frame is destroyed mid-flight.
      }
    });

    this.listenPage(page, 'requestfailed', (req) => {
      try {
        const start = this.requestStartTimes.get(req);
        const durationMs = start !== undefined ? Date.now() - start : undefined;
        this.requestStartTimes.delete(req);

        if (!this.pageListeners.has(page)) return;
        this.telemetry.addFailedNetwork({
          method: req.method(),
          url: req.url(),
          resourceType: req.resourceType(),
          durationMs,
          error: req.failure()?.errorText || 'Request failed'
        });
      } catch {
        // Request failure ignored during frame teardown.
      }
    });

    return hotkeySetup;
  }

  public async listTabs(): Promise<TabInfo[]> {
    const context = await this.ensureContext();
    const pages = context.pages();
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (!p.isClosed()) {
        try {
          tabs.push({
            targetId: this.targetId(p),
            index: i,
            title: (await p.title()) || '(No Title)',
            url: p.url(),
            isActive: p === this.page
          });
        } catch {
          // Tab closed while iterating open contexts.
        }
      }
    }
    return tabs;
  }

  public async selectTab(criteria: TabSelectCriteria): Promise<ActiveTabInfo> {
    const context = await this.ensureContext();
    const pages = context.pages().filter(p => !p.isClosed());
    if (pages.length === 0) {
      throw new SpectorError('TAB_NOT_FOUND', 'No open tabs found in the browser.');
    }

    const activeMatchers = TAB_MATCHERS.filter(m =>
      m.key === 'latest' ? criteria.latest === true : criteria[m.key] !== undefined
    );
    if (activeMatchers.length === 0) {
      throw new SpectorError('INVALID_TOOL_INPUT', 'Provide at least one tab criterion: index, url, title, or latest: true.');
    }

    let warning: string | undefined;
    if (activeMatchers.length > 1) {
      const names = activeMatchers.map(m => m.key);
      warning = `Multiple tab selection criteria provided (${names.join(', ')}). Evaluated by priority order: ${names[0]} took precedence.`;
      logger.warn('select_tab_multi_criteria', { provided: names, selectedBy: names[0] });
    }

    const targetPage = await activeMatchers[0].matches(criteria, pages);
    if (!targetPage) {
      throw new SpectorError('TAB_NOT_FOUND', `Target tab matching criteria ${JSON.stringify(criteria)} was not found.`);
    }

    await targetPage.bringToFront();
    this.page = targetPage;
    await this.setupPageListeners(this.page);

    return {
      title: (await this.page.title()) || '(No Title)',
      url: this.page.url(),
      viewport: this.page.viewportSize(),
      ...(warning ? { warning } : {})
    };
  }

  public async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load'
  ): Promise<{ url: string; title: string }> {
    const page = await this.ensurePage();
    const options = { waitUntil, timeout: TIMEOUTS.NAVIGATION_DEFAULT_MS };

    if (url === 'reload') {
      await page.reload(options);
    } else {
      const effectiveUrl = /^[a-zA-Z]+:\/\//.test(url) ? url : `http://${url}`;
      await page.goto(effectiveUrl, options);
    }

    return {
      url: page.url(),
      title: (await page.title()) || '(No Title)'
    };
  }

  public async interact(
    action: InteractAction,
    selector?: string,
    scrollDelta?: { x: number; y: number },
    waitForTimeoutMs: number = 0,
    value?: string,
    expectedUrl?: string
  ): Promise<string> {
    const page = await this.ensurePage();
    if (expectedUrl !== undefined) this.assertTarget(page, expectedUrl);
    const result = await dispatchPageInteraction(page, { action, selector, scrollDelta, waitForTimeoutMs, value });
    if (page.isClosed() || this.page !== page) throw new SpectorError('TARGET_CHANGED', 'Target changed after interaction; action may have occurred.');
    return result;
  }

  public async captureScreenshotBuffer(
    page: Page,
    options: { selector?: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number }; timeoutMs?: number } = {}
  ): Promise<Buffer> {
    return this.renderer.captureScreenshotBuffer(page, options);
  }


  public addPin(pin: PickedElementInfo): void {
    const page = this.page;
    this.pins.add(page && !page.isClosed() && (!pin.targetId || pin.targetId === this.targetId(page))
      ? { ...pin, targetId: this.targetId(page), documentId: pin.documentId ?? this.documents.id(page) } : pin);
  }

  private async collectAndStorePins(
    page: Page,
    documentId: string,
    items: BrowserPickedPin[],
    options: { includeScreenshot: boolean; includeHoverState: boolean | ((item: BrowserPickedPin) => boolean) }
  ): Promise<PickedElementInfo[]> {
    const collected: PickedElementInfo[] = [];
    await this.operations.run(page, async () => {
      this.assertTarget(page, page.url(), this.documents.id(page) !== documentId);
      for (const item of items) {
        const includeHoverState = typeof options.includeHoverState === 'function'
          ? options.includeHoverState(item)
          : options.includeHoverState;
        const pin = await this.evidence.collect(page, item, {
          includeScreenshot: options.includeScreenshot,
          includeHoverState
        });
        this.pins.add(pin);
        collected.push(pin);
      }
    });
    return collected;
  }

  public async pickElement(options: {
    timeoutMs?: number;
    includeScreenshot?: boolean;
    includeStyles?: boolean;
    includeHoverState?: boolean;
    role?: PinRole;
    selectionMode?: PinSelectionMode;
  } = {}): Promise<{ status: 'selected' | 'cancelled' | 'timeout'; pins: PickedElementInfo[]; comparison?: ComparisonDiff }> {
    const page = await this.ensurePage();
    const {
      timeoutMs = TIMEOUTS.PICKER_HOTKEY_DEFAULT_MS,
      includeScreenshot = true,
      includeStyles = true,
      includeHoverState = false,
      role = 'single',
      selectionMode = 'element'
    } = options;
    const documentId = this.documents.id(page);

    await page.evaluate(OVERLAY_ENGINE_SCRIPT);

    const rawResult: unknown = await this.activity.run(page, () => page.evaluate(
      ({ timeout, withStyles, pinRole, selMode }) => {
        return (window as any).__spectorOverlay.start({
          source: 'tool',
          timeoutMs: timeout,
          includeStyles: withStyles,
          role: pinRole,
          selectionMode: selMode
        });
      },
      { timeout: timeoutMs, withStyles: includeStyles, pinRole: role, selMode: selectionMode }
    ));

    const parsed = parsePickerPayload(rawResult);
    if (parsed.status !== 'selected') {
      return { status: parsed.status, pins: [] };
    }

    const enrichedPins = await this.collectAndStorePins(page, documentId, parsed.pins, {
      includeScreenshot,
      includeHoverState
    });

    const comparison = this.pins.buildComparison();

    return {
      status: 'selected',
      pins: enrichedPins,
      ...(comparison ? { comparison } : {})
    };
  }

  public async getLastPicked(options: {
    includeScreenshot?: boolean;
    clearAfterRead?: boolean;
    includeHoverState?: boolean;
    includeFocusState?: boolean;
  } = {}): Promise<{ pins: PickedElementInfo[]; comparison?: ComparisonDiff } | null> {
    if (this.pins.isEmpty()) return null;

    const snapshot = this.pins.getPins(false, options.includeScreenshot ?? true)!;

    if ((options.includeHoverState || options.includeFocusState) && this.page && !this.page.isClosed()) {
      const page = await this.ensurePage();
      await this.operations.run(page, () => this.evidence.enrich(page, snapshot.pins, options));
    }

    const comparison = this.pins.buildComparison(snapshot.pins);
    if (options.clearAfterRead) {
      this.pins.consume(snapshot.pins);
    }

    return {
      pins: snapshot.pins,
      ...(comparison ? { comparison } : {})
    };
  }

  public clearPins(): number {
    return this.pins.clear();
  }

  public async withBreakpointMetrics<T>(
    breakpoints: BreakpointPreset[],
    runner: (bp: BreakpointPreset, dims: { width: number; height: number }, cdp: CDPSession) => Promise<T>,
    target?: Page
  ): Promise<T[]> {
    return this.renderer.withBreakpointMetrics(breakpoints, runner, target ?? await this.ensurePage());
  }

  private async setupHotkeyPicker(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
      const currentUrl = page.url();
      if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://')) {
        return;
      }
    } catch {
      // Ignore transient URL read error before commit.
    }

    try {
      await page.exposeFunction('__spector_on_element_picked', async (data: unknown) => {
        if (!this.pageListeners.has(page)) return;
        const parsed = parsePickerPayload(data);
        if (parsed.status !== 'selected') return;
        this.page = page;

        const documentId = this.documents.id(page);
        const collected = await this.collectAndStorePins(page, documentId, parsed.pins, {
          includeScreenshot: true,
          includeHoverState: item => item.role === 'target' || item.role === 'reference'
        });
        for (const pin of collected) {
          logger.info('element_picked_via_hotkey', {
            id: pin.id,
            role: pin.role,
            pinMode: pin.pinMode,
            selector: pin.selector,
            component: pin.frameworkComponent?.componentName,
            sourceFile: pin.frameworkComponent?.sourceFile
          });
        }
      });
    } catch {
      // Function already exposed during earlier attach pass.
    }

    try {
      await page.addInitScript(HOTKEY_BINDING_SCRIPT);
    } catch {
      // Frame may close before init script binds.
    }

    try {
      await page.evaluate(HOTKEY_BINDING_SCRIPT);
    } catch {
      // Document not yet ready on empty initial tab.
    }
  }

  public async disconnect(): Promise<void> {
    this.documents.clear();
    await this.activity.clear();
    if (this.pendingPageSetups.size > 0) {
      await Promise.allSettled([...this.pendingPageSetups]);
      this.pendingPageSetups.clear();
    }

    if (this.context && this.contextPageListener) {
      this.context.off('page', this.contextPageListener);
    }
    this.contextPageListener = null;

    for (const [page, listeners] of this.pageListeners) {
      for (const { event, listener } of listeners) {
        page.off(event as any, listener as any);
      }
    }
    this.pageListeners.clear();

    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.attachedPages = new WeakSet<Page>();
    this.watchedPages = new WeakSet<Page>();
    this.requestStartTimes.clear();

    // Closing Playwright's CDP client detaches Spector without shutting down the user's physical Chrome process.
    if (browser?.isConnected()) {
      await browser.close();
    }
  }
}
