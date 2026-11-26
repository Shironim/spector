import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Request } from 'playwright-core';
import type {
  ActiveTabInfo,
  BoundingRect,
  ComparisonDiff,
  PickedElementInfo,
  PinRole,
  PinSelectionMode,
  PinVerificationReport,
  TabInfo,
  TabSelectCriteria
} from '../types.js';
import { type BreakpointPreset, TIMEOUTS } from '../constants.js';
import { TelemetryStore } from './telemetry-store.js';
import { PinStore } from './pin-store.js';
import { extractCdpPort, launchChromeForCdp, validateCdpEndpoint } from './chrome-launcher.js';
import { HOTKEY_BINDING_SCRIPT, OVERLAY_ENGINE_SCRIPT } from './overlay-script.js';
import { SpectorError } from '../utils/mcp-response.js';
import { logger } from '../utils/logger.js';
import { BrowserOperationEngine } from './operation-engine.js';
import { DocumentRegistry } from './document-registry.js';
import { RenderCapture } from './render-capture.js';
import { parsePickerPayload, type BrowserPickedPin } from './picker-payload.js';
import { PickerEvidence } from './picker-evidence.js';
import { evaluateInPage, getCdpTargetInfo, setMainFrameCorrupted } from '../utils/cdp.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import { BLUEPRINT_LIMITS, IN_BROWSER_BLUEPRINT_EXTRACTOR_FN } from '../analyzers/design-blueprint.js';
import { collectPinForensics, computePinVerificationDiff } from '../analyzers/pin-forensics.js';

export { validateCdpEndpoint, extractCdpPort } from './chrome-launcher.js';

interface PageTabEntry {
  page: Page;
  targetId: string;
  title: string;
  url: string;
}

type TabMatcher = {
  key: keyof TabSelectCriteria;
  matches: (criteria: TabSelectCriteria, tabs: PageTabEntry[]) => Promise<PageTabEntry | undefined>;
};

const TAB_MATCHERS: ReadonlyArray<TabMatcher> = [
  {
    key: 'index',
    matches: async (criteria, tabs) => {
      const idx = criteria.index!;
      if (idx < 0 || idx >= tabs.length) {
        throw new SpectorError('TAB_NOT_FOUND', `Tab index ${idx} is out of bounds (0-${tabs.length - 1}).`);
      }
      return tabs[idx];
    }
  },
  {
    key: 'url',
    matches: async (criteria, tabs) => {
      const rawQuery = criteria.url!.trim();
      if (!rawQuery) return undefined;
      if (rawQuery.includes('*')) {
        const collapsed = rawQuery.replace(/\*+/g, '*');
        const escaped = collapsed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const globRe = new RegExp(escaped, 'i');
        return tabs.find(t => globRe.test(t.url));
      }
      const needle = rawQuery.toLowerCase();
      return tabs.find(t => t.url.toLowerCase().includes(needle));
    }
  },
  {
    key: 'title',
    matches: async (criteria, tabs) => {
      const titleQuery = criteria.title!.trim().toLowerCase();
      if (!titleQuery) return undefined;
      return tabs.find(t => t.title.toLowerCase().includes(titleQuery));
    }
  },
  {
    key: 'latest',
    matches: async (_criteria, tabs) => tabs[tabs.length - 1]
  }
];

function serializeQueue<T>(tail: Promise<unknown>, fn: () => Promise<T>): { next: Promise<T>; updatedTail: Promise<unknown> } {
  const next = tail.then(fn, fn);
  return { next, updatedTail: next.catch(() => {}) };
}

export function evidenceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:', 'about:'].includes(url.protocol)) return `${url.protocol}[REDACTED]`;
    url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    if (url.hash) url.hash = '[REDACTED]';
    return url.toString();
  } catch { return '[UNAVAILABLE]'; }
}

export function validateNavigationUrl(rawUrl: string, currentUrl?: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new SpectorError('INVALID_TOOL_INPUT', 'url is required when action is "navigate".');
  }

  let base: string | undefined;
  let currentParsed: URL | undefined;
  if (currentUrl) {
    try {
      const candidate = new URL(currentUrl);
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
        base = candidate.toString();
        currentParsed = candidate;
      }
    } catch {
      // Ignore non-parseable currentUrl.
    }
  }

  let parsed: URL;
  try {
    parsed = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    throw new SpectorError('INVALID_TOOL_INPUT', `Invalid navigation URL "${rawUrl}".`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SpectorError(
      'NAVIGATION_DENIED',
      `Protocol "${parsed.protocol}" is not allowed for spector_tabs navigation.`
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalDevHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.test') ||
    host.endsWith('.local');

  const isSameOrigin = Boolean(currentParsed && parsed.origin === currentParsed.origin);

  if (!isLocalDevHost && !isSameOrigin) {
    throw new SpectorError(
      'NAVIGATION_DENIED',
      `Navigation to external origin "${parsed.origin}" is blocked (allowed: localhost/local dev hosts or same-origin as active tab).`
    );
  }

  return parsed.toString();
}

export class CdpSessionManager {
  private static instance: CdpSessionManager | null = null;

  public browser: Browser | null = null;
  public context: BrowserContext | null = null;
  public page: Page | null = null;
  private cdpUrl = 'http://localhost:9222';

  public readonly telemetry = new TelemetryStore();
  public readonly pins = new PinStore();

  private requestStartTimes = new Map<Request, number>();
  private attachedPages = new WeakSet<Page>();
  private watchedPages = new WeakSet<Page>();
  private pageListeners = new Map<Page, Array<{ event: string; listener: (...args: any[]) => void }>>();
  private contextPageListener: ((page: Page) => void) | null = null;
  private pendingPageSetups = new Set<Promise<void>>();
  private attachQueue: Promise<unknown> = Promise.resolve();
  private targetIds = new WeakMap<Page, string>();
  private authoritativeUrls = new WeakMap<Page, string>();
  private nextTargetId = 0;
  private readonly documents = new DocumentRegistry();
  private readonly operations = new BrowserOperationEngine(
    (page, url, navigated) => this.assertTarget(page, url, navigated),
    page => this.pageUrl(page)
  );
  private readonly renderer = new RenderCapture(
    this.operations,
    (page, url, navigated) => this.assertTarget(page, url, navigated),
    page => this.pageUrl(page)
  );
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

  public pageUrl(page: Page): string {
    return this.authoritativeUrls.get(page) ?? page.url();
  }

  public async resolvePageInfo(page: Page): Promise<{ targetId: string; type: string; title: string; url: string }> {
    const cdpInfo = await getCdpTargetInfo(page);
    if (cdpInfo) {
      if (cdpInfo.type === 'page' && cdpInfo.url) {
        this.authoritativeUrls.set(page, cdpInfo.url);
      }
      const pwUrl = typeof (page as { url?: unknown }).url === 'function' ? page.url() : '';
      setMainFrameCorrupted(page, pwUrl === '' || pwUrl !== cdpInfo.url);
      return {
        targetId: this.targetId(page),
        type: cdpInfo.type,
        title: cdpInfo.title || '(No Title)',
        url: cdpInfo.url
      };
    }
    return {
      targetId: this.targetId(page),
      type: 'page',
      title: (typeof (page as { title?: unknown }).title === 'function' ? await page.title() : '') || '(No Title)',
      url: typeof (page as { url?: unknown }).url === 'function' ? page.url() : ''
    };
  }

  private async getPageTabs(context: BrowserContext): Promise<PageTabEntry[]> {
    const pages = context.pages();
    const tabs: PageTabEntry[] = [];
    for (const p of pages) {
      if (p.isClosed()) continue;
      try {
        const info = await this.resolvePageInfo(p);
        if (info.type !== 'page') continue;
        tabs.push({
          page: p,
          targetId: info.targetId,
          title: info.title,
          url: info.url
        });
      } catch {
        // Tab closed while iterating open contexts.
      }
    }
    return tabs;
  }

  public assertTarget(page: Page, expectedUrl: string, documentChanged = false): void {
    this.operations.throwIfExpired();
    const currentUrl = this.pageUrl(page);
    if (documentChanged || page.isClosed() || this.page !== page || currentUrl !== expectedUrl) {
      throw new SpectorError('TARGET_CHANGED', 'Selected target changed during operation.', undefined, {
        details: { documentChanged, urlChanged: !page.isClosed() && currentUrl !== expectedUrl, expected: { targetId: this.targetId(page), url: evidenceUrl(expectedUrl) },
          actual: this.page && !this.page.isClosed() ? { targetId: this.targetId(this.page), url: evidenceUrl(this.pageUrl(this.page)) } : null }
      });
    }
  }

  public async captureMetadata(page: Page, selector?: string) {
    const info = await this.resolvePageInfo(page);
    return { targetId: info.targetId, documentId: this.documents.id(page), url: evidenceUrl(info.url), selector,
      viewport: await evaluateInPage(page, () => ({ width: innerWidth, height: innerHeight })),
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
        const info = await this.resolvePageInfo(this.page);
        return {
          title: info.title,
          url: info.url,
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

      const tabs = await this.getPageTabs(this.context);
      if (tabs.length === 0) {
        const fallbackPages = this.context.pages().filter(p => !p.isClosed());
        this.page = fallbackPages.length === 0
          ? await this.context.newPage()
          : (autoSelectActiveTab ? fallbackPages[fallbackPages.length - 1] : fallbackPages[0]);
      } else {
        this.page = (autoSelectActiveTab ? tabs[tabs.length - 1] : tabs[0]).page;
      }

      for (const p of this.context.pages()) {
        if (!p.isClosed()) {
          await this.setupPageListeners(p);
        }
      }

      const activeInfo = await this.resolvePageInfo(this.page);
      return {
        title: activeInfo.title,
        url: activeInfo.url,
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
      if (this.browser) await this.resolvePageInfo(bound);
      this.assertTarget(bound, this.pageUrl(bound));
      return bound;
    }
    if (this.page && !this.page.isClosed()) {
      if (this.browser) await this.resolvePageInfo(this.page);
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
      this.telemetry.addConsole(msg.type(), msg.text(), locationStr, this.targetId(page));
    });

    this.listenPage(page, 'pageerror', (error) => {
      if (!this.pageListeners.has(page)) return;
      this.telemetry.addPageError(error.message, error.stack, this.targetId(page));
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
          durationMs,
          targetId: this.targetId(page)
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
          error: req.failure()?.errorText || 'Request failed',
          targetId: this.targetId(page)
        });
      } catch {
        // Request failure ignored during frame teardown.
      }
    });

    return hotkeySetup;
  }

  public async listTabs(): Promise<TabInfo[]> {
    const context = await this.ensureContext();
    const tabs = await this.getPageTabs(context);
    return tabs.map((t, index) => ({
      targetId: t.targetId,
      index,
      title: t.title,
      url: t.url,
      isActive: t.page === this.page
    }));
  }

  public async selectTab(criteria: TabSelectCriteria): Promise<ActiveTabInfo> {
    const context = await this.ensureContext();
    const tabs = await this.getPageTabs(context);
    if (tabs.length === 0) {
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

    const targetTab = await activeMatchers[0].matches(criteria, tabs);
    if (!targetTab) {
      throw new SpectorError('TAB_NOT_FOUND', `Target tab matching criteria ${JSON.stringify(criteria)} was not found.`);
    }

    await targetTab.page.bringToFront();
    this.page = targetTab.page;
    await this.setupPageListeners(this.page);
    const activeInfo = await this.resolvePageInfo(this.page);

    return {
      title: activeInfo.title,
      url: activeInfo.url,
      viewport: this.page.viewportSize(),
      ...(warning ? { warning } : {})
    };
  }

  public async navigateTab(options: {
    url: string;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    openInNewTab?: boolean;
    timeoutMs?: number;
  }): Promise<ActiveTabInfo> {
    const currentPage = await this.ensurePage();
    const currentUrl = this.pageUrl(currentPage);
    const resolvedUrl = validateNavigationUrl(options.url, currentUrl);
    const waitUntil = options.waitUntil ?? 'load';
    const timeout = options.timeoutMs ?? TIMEOUTS.NAVIGATION_DEFAULT_MS;

    if (options.openInNewTab) {
      const context = await this.ensureContext();
      const newPage = await context.newPage();
      this.page = newPage;
      await this.setupPageListeners(newPage);
      await this.operations.run(
        newPage,
        async () => {
          await newPage.goto(resolvedUrl, { waitUntil, timeout });
        },
        { allowNavigation: true, timeoutMs: timeout }
      );
      await newPage.bringToFront();
      await this.setupPageListeners(newPage);
      const info = await this.resolvePageInfo(newPage);
      return { title: info.title, url: info.url, viewport: newPage.viewportSize() };
    }

    await this.operations.run(
      currentPage,
      async () => {
        await currentPage.goto(resolvedUrl, { waitUntil, timeout });
      },
      { allowNavigation: true, timeoutMs: timeout }
    );
    await this.setupPageListeners(currentPage);
    const info = await this.resolvePageInfo(currentPage);
    return { title: info.title, url: info.url, viewport: currentPage.viewportSize() };
  }

  public async reloadTab(options: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    timeoutMs?: number;
  } = {}): Promise<ActiveTabInfo> {
    const page = await this.ensurePage();
    const waitUntil = options.waitUntil ?? 'load';
    const timeout = options.timeoutMs ?? TIMEOUTS.NAVIGATION_DEFAULT_MS;

    await this.operations.run(
      page,
      async () => {
        await page.reload({ waitUntil, timeout });
      },
      { allowNavigation: true, timeoutMs: timeout }
    );
    await this.setupPageListeners(page);
    const info = await this.resolvePageInfo(page);
    return { title: info.title, url: info.url, viewport: page.viewportSize() };
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
      this.assertTarget(page, this.pageUrl(page), this.documents.id(page) !== documentId);
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

    await evaluateInPage(page, OVERLAY_ENGINE_SCRIPT);

    const rawResult: unknown = await evaluateInPage(
      page,
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
    );

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

  public async snapshotSelector(options: {
    selector: string;
    role?: PinRole;
    note?: string;
    includeScreenshot?: boolean;
    includeHoverState?: boolean;
  }): Promise<{ pin: PickedElementInfo; comparison?: ComparisonDiff }> {
    const rawSelector = options.selector.trim();
    if (!rawSelector) {
      throw new SpectorError('INVALID_TOOL_INPUT', 'selector is required when action is "snapshot".');
    }
    const page = await this.ensurePage();
    const escaped = escapeTailwindSelector(rawSelector);
    const role: PinRole = options.role ?? 'single';
    const includeScreenshot = options.includeScreenshot ?? false;
    const includeHoverState = options.includeHoverState ?? false;

    return await this.operations.run(page, async () => {
      const extractScript = `(() => {
        ${IN_BROWSER_BLUEPRINT_EXTRACTOR_FN}
        const el = document.querySelector(${JSON.stringify(escaped)});
        if (!el) return null;
        const bp = extractDesignBlueprint(el, true, ${BLUEPRINT_LIMITS.maxSubtreeElements}, ${BLUEPRINT_LIMITS.maxInlineSvgBytes});
        return {
          tagName: el.tagName ? el.tagName.toLowerCase() : undefined,
          rect: bp.rect,
          computedStyles: bp.computedStyles,
          subtreeSummary: bp.subtreeSummary,
          assets: bp.assets
        };
      })()`;

      const extracted = await evaluateInPage(page, extractScript) as {
        tagName?: string;
        rect?: BoundingRect;
        computedStyles?: Record<string, string>;
        subtreeSummary?: PickedElementInfo['subtreeSummary'];
        assets?: PickedElementInfo['assets'];
      } | null;

      if (!extracted) {
        throw new SpectorError('ELEMENT_NOT_READY', `Element not found for snapshot selector "${rawSelector}".`);
      }

      const collected = await this.evidence.collect(
        page,
        {
          status: 'selected',
          role,
          pinMode: 'element',
          selector: rawSelector,
          ...(options.note ? { note: options.note } : {}),
          ...(extracted.tagName ? { tagName: extracted.tagName } : {}),
          ...(extracted.rect ? { rect: extracted.rect } : {}),
          ...(extracted.computedStyles ? { computedStyles: extracted.computedStyles } : {}),
          ...(extracted.subtreeSummary ? { subtreeSummary: extracted.subtreeSummary } : {}),
          ...(extracted.assets ? { assets: extracted.assets } : {})
        },
        { includeScreenshot, includeHoverState, includeForensics: true }
      );

      this.pins.add(collected);
      const comparison = this.pins.buildComparison();
      return {
        pin: collected,
        ...(comparison ? { comparison } : {})
      };
    });
  }

  public async verifyPin(options: {
    pinId?: string;
    includeScreenshot?: boolean;
  } = {}): Promise<{ report: PinVerificationReport; screenshotBase64?: string }> {
    const pin = this.pins.findForVerify(options.pinId);
    if (!pin || !pin.selector) {
      throw new SpectorError(
        'NO_PICKED_ELEMENT',
        options.pinId
          ? `No verifiable element pin found with id "${options.pinId}".`
          : 'No verifiable element pin is cached in Spector.',
        'Pin an element with Alt+P or spector_picker({ action: "pick" }) before running action: "verify".'
      );
    }

    const page = await this.ensurePage();
    const selector = pin.selector;
    const escaped = escapeTailwindSelector(selector);
    const includeScreenshot = options.includeScreenshot ?? true;

    return await this.operations.run(page, async () => {
      const snapshotScript = `(() => {
        ${IN_BROWSER_BLUEPRINT_EXTRACTOR_FN}
        const el = document.querySelector(${JSON.stringify(escaped)});
        if (!el) return null;
        const bp = extractDesignBlueprint(el, true, ${BLUEPRINT_LIMITS.maxSubtreeElements}, ${BLUEPRINT_LIMITS.maxInlineSvgBytes});
        return { rect: bp.rect, computedStyles: bp.computedStyles };
      })()`;

      const afterSnapshot = await evaluateInPage(page, snapshotScript) as {
        rect?: BoundingRect;
        computedStyles?: Record<string, string>;
      } | null;

      if (!afterSnapshot) {
        return {
          report: {
            status: 'element_not_found',
            pinId: pin.id,
            selector,
            ...(pin.note ? { note: pin.note } : {}),
            changed: true,
            styleChanges: {},
            verifiedAt: new Date().toISOString()
          }
        };
      }

      const afterForensics = await collectPinForensics(
        page,
        selector,
        this.operations.remainingTime(TIMEOUTS.CDP_CONNECT_MS)
      ).catch(() => undefined);

      const report = computePinVerificationDiff(pin, {
        rect: afterSnapshot.rect,
        computedStyles: afterSnapshot.computedStyles,
        forensics: afterForensics
      });

      let screenshotBase64: string | undefined;
      if (includeScreenshot) {
        try {
          const buf = await this.renderer.captureScreenshotBuffer(page, { selector });
          screenshotBase64 = buf.toString('base64');
        } catch (err: unknown) {
          logger.warn('verify_pin_screenshot_fallback', {
            selector,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      return { report, ...(screenshotBase64 ? { screenshotBase64 } : {}) };
    });
  }

  public async withBreakpointMetrics<T>(
    breakpoints: BreakpointPreset[],
    runner: (bp: BreakpointPreset, dims: { width: number; height: number }, cdp: CDPSession) => Promise<T>,
    target?: Page
  ): Promise<T[]> {
    return this.renderer.withBreakpointMetrics(breakpoints, runner, target ?? await this.ensurePage());
  }

  public async withEmulatedMedia<T>(
    media: import('../types.js').EmulatedMediaOptions | undefined,
    runner: () => Promise<T>,
    target?: Page
  ): Promise<T> {
    return this.renderer.withEmulatedMedia(target ?? await this.ensurePage(), media, runner);
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
            selector: pin.selector
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
      await evaluateInPage(page, HOTKEY_BINDING_SCRIPT);
    } catch {
      // Document not yet ready on empty initial tab.
    }
  }

  public async disconnect(): Promise<void> {
    this.documents.clear();
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
