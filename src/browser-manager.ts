import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from 'playwright-core';
import type { ActiveTabInfo, ConsoleLogEntry, NetworkLogEntry, TabInfo, PickedElementInfo, TabSelectCriteria, MockRouteRule } from './types.js';
import { extractCompressedDom } from './utils/dom-compressor.js';
import { IN_BROWSER_COMPONENT_DETECTOR_FN } from './utils/framework-detector.js';
import { captureDomSnapshot, compareDomSnapshots, type DomSnapshotData, type DomDiffResult } from './utils/dom-differ.js';
import { resolveSourceLocation } from './utils/source-resolver.js';
import { logger } from './utils/logger.js';

function validateCdpEndpoint(endpoint: string): void {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const allowed = new Set(['127.0.0.1', 'localhost', '::1']);
    if (!allowed.has(hostname)) {
      throw new Error(`SecurityPolicyError: Remote CDP host "${hostname}" is denied. Only localhost/127.0.0.1 is permitted.`);
    }
  } catch (err: any) {
    if (err.message.includes('SecurityPolicyError')) throw err;
    throw new Error(`Invalid CDP URL format: "${endpoint}"`);
  }
}

function findChromeExecutable(): string | null {
  const platform = os.platform();
  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return 'chrome.exe';
  } else if (platform === 'darwin') {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(macPath)) return macPath;
    return 'google-chrome';
  } else {
    return 'google-chrome';
  }
}

async function waitForCdp(cdpUrl: string, maxWaitMs = 6000): Promise<boolean> {
  const endpoint = `${cdpUrl.replace(/\/$/, '')}/json/version`;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(600) });
      if (res.ok) return true;
    } catch {
      // Retry
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return false;
}

export class BrowserManager {
  private static instance: BrowserManager | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpUrl: string = 'http://localhost:9222';

  private consoleLogs: ConsoleLogEntry[] = [];
  private networkLogs: NetworkLogEntry[] = [];
  private lastPickedElement: PickedElementInfo | null = null;
  private lastDomSnapshot: DomSnapshotData | null = null;
  private mockRules = new Map<string, MockRouteRule>();
  private pendingRequests = new Map<
    Request,
    { start: number; method: string; url: string; resourceType: string; postData?: string }
  >();
  private attachedPages = new WeakSet<Page>();

  private readonly MAX_LOG_BUFFER = 100;

  private constructor() {}

  private sanitizePostData(raw?: string | null): string | undefined {
    if (!raw) return undefined;
    let text = raw.length > 500 ? raw.slice(0, 497) + '...' : raw;
    // Redact sensitive credentials and tokens in telemetry logs
    return text.replace(
      /(["']?(?:password|passwd|token|secret|apiKey|api_key|authorization|bearer|credit_card|cvv)["']?\s*[:=]\s*["']?)([^"',\s&]+)(["']?)/gi,
      '$1[REDACTED]$3'
    );
  }

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
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
    this.cdpUrl = cdpUrl;

    try {
      // Disconnect previous session if any
      if (this.browser) {
        try {
          await this.browser.close();
        } catch {
          // Ignore close error on stale handle
        }
        this.browser = null;
        this.context = null;
        this.page = null;
      }

      try {
        this.browser = await chromium.connectOverCDP(this.cdpUrl);
      } catch (connectError: any) {
        if (!autoLaunch) {
          throw connectError;
        }

        const chromeExe = findChromeExecutable();
        if (!chromeExe) {
          throw connectError;
        }

        const devProfile = path.join(os.tmpdir(), 'chrome_dev_profile');
        const child = spawn(
          chromeExe,
          [`--remote-debugging-port=9222`, `--user-data-dir=${devProfile}`],
          {
            detached: true,
            stdio: 'ignore'
          }
        );
        child.unref();

        const isReady = await waitForCdp(this.cdpUrl, 6000);
        if (isReady) {
          this.browser = await chromium.connectOverCDP(this.cdpUrl);
        } else {
          throw connectError;
        }
      }

      const contexts = this.browser.contexts();
      if (contexts.length === 0) {
        throw new Error('Connected to Chrome CDP, but no browser contexts are available.');
      }

      this.context = contexts[0];

      // Multi-tab listener: Automatically wire up listeners and hotkey for any new tabs opened in this window
      this.context.on('page', (newPage: Page) => {
        this.page = newPage; // Auto-align active pointer to newly opened tab (e.g. target="_blank" or window.open)
        const wireUpNewPage = () => {
          if (!newPage.isClosed()) {
            this.setupPageListeners(newPage);
          }
        };
        newPage.on('domcontentloaded', wireUpNewPage);
        wireUpNewPage();
      });

      const pages = this.context.pages();

      if (pages.length === 0) {
        this.page = await this.context.newPage();
      } else {
        // Select the last active tab or find focused tab
        this.page = autoSelectActiveTab ? pages[pages.length - 1] : pages[0];
      }

      // Wire up listeners & hotkey on all existing open tabs in this window
      for (const p of pages) {
        if (!p.isClosed()) {
          this.setupPageListeners(p);
        }
      }

      const title = await this.page.title();
      const url = this.page.url();
      const viewport = this.page.viewportSize();

      return {
        title: title || '(No Title)',
        url,
        viewport
      };
    } catch (error: any) {
      const msg = error?.message || String(error);
      throw new Error(
        `Failed to connect to Chrome at ${this.cdpUrl}.\n` +
          `Make sure Chrome is running with remote debugging enabled:\n` +
          `  Windows (PowerShell): & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\\chrome_dev_profile"\n` +
          `  Windows (CMD): start chrome --remote-debugging-port=9222 --user-data-dir="%TEMP%\\chrome_dev_profile"\n\n` +
          `Underlying error: ${msg}`
      );
    }
  }

  public async ensurePage(): Promise<Page> {
    // 1. If active page is valid and open, return immediately
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    // 2. If page closed or null, fallback to remaining open tabs without closing browser
    if (this.context) {
      try {
        const remainingPages = this.context.pages().filter(p => !p.isClosed());
        if (remainingPages.length > 0) {
          this.page = remainingPages[remainingPages.length - 1];
          return this.page;
        }
      } catch {
        // Stale context, continue to re-attach
      }
    }

    // 3. No remaining open pages or context dead: re-attach
    await this.attach(this.cdpUrl, true);
    if (!this.page) {
      throw new Error('No active page available. Please call spector_attach first.');
    }
    return this.page;
  }

  private setupPageListeners(page: Page): void {
    if (page.isClosed()) return;
    try {
      const currentUrl = page.url();
      if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://')) {
        return;
      }
    } catch {
      // Ignore URL read error
    }

    // Idempotency guard: prevent duplicate console / network listeners on the same page
    if (this.attachedPages.has(page)) {
      return;
    }
    this.attachedPages.add(page);

    // Auto-fallback if this page is closed
    page.on('close', () => {
      if (this.page === page && this.context) {
        try {
          const remaining = this.context.pages().filter(p => !p.isClosed() && p !== page);
          this.page = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        } catch {
          this.page = null;
        }
      }
    });

    // Clear old page-level request mappings
    this.pendingRequests.clear();

    // Register Alt+P hotkey inspector bridge
    this.setupHotkeyPicker(page).catch(() => {});

    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      const location = msg.location().url ? `${msg.location().url}:${msg.location().lineNumber}` : undefined;

      const last = this.consoleLogs[this.consoleLogs.length - 1];
      if (last && last.type === type && last.text === text && last.location === location) {
        last.count = (last.count || 1) + 1;
        last.timestamp = new Date().toISOString();
        return;
      }

      const entry: ConsoleLogEntry = {
        type,
        text,
        timestamp: new Date().toISOString(),
        location,
        count: 1
      };
      this.consoleLogs.push(entry);
      if (this.consoleLogs.length > this.MAX_LOG_BUFFER) {
        this.consoleLogs.shift();
      }
    });

    page.on('pageerror', error => {
      const text = `Uncaught Exception: ${error.message}\n${error.stack || ''}`;
      const last = this.consoleLogs[this.consoleLogs.length - 1];
      if (last && last.type === 'error' && last.text === text) {
        last.count = (last.count || 1) + 1;
        last.timestamp = new Date().toISOString();
        return;
      }

      const entry: ConsoleLogEntry = {
        type: 'error',
        text,
        timestamp: new Date().toISOString(),
        count: 1
      };
      this.consoleLogs.push(entry);
      if (this.consoleLogs.length > this.MAX_LOG_BUFFER) {
        this.consoleLogs.shift();
      }
    });

    page.on('request', req => {
      try {
        this.pendingRequests.set(req, {
          start: Date.now(),
          method: req.method(),
          url: req.url(),
          resourceType: req.resourceType(),
          postData: this.sanitizePostData(req.postData())
        });
      } catch {
        // Safe guard against disposed request
      }
    });

    page.on('response', async res => {
      try {
        const req = res.request();
        const reqUrl = req.url();
        const pending = this.pendingRequests.get(req);
        const duration = pending ? Date.now() - pending.start : undefined;
        this.pendingRequests.delete(req);

        let responseSummary = '';
        const contentType = res.headers()['content-type'] || '';
        if (contentType.includes('application/json') || contentType.includes('text/plain')) {
          try {
            const body = await res.text();
            if (res.status() >= 400 && contentType.includes('application/json')) {
              try {
                const parsed = JSON.parse(body);
                const errorPayload = parsed.error || parsed.errors || parsed.message || parsed.detail || parsed;
                responseSummary = typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload);
                if (responseSummary.length > 500) {
                  responseSummary = responseSummary.slice(0, 497) + '...';
                }
              } catch {
                responseSummary = body.length > 500 ? body.slice(0, 497) + '...' : body;
              }
            } else {
              responseSummary = body.length > 500 ? body.slice(0, 497) + '...' : body;
            }
          } catch {
            // Body may be unavailable or streamed
          }
        }

        const entry: NetworkLogEntry = {
          id: `${res.status()}-${Date.now()}`,
          method: req.method(),
          url: reqUrl,
          resourceType: req.resourceType(),
          status: res.status(),
          statusText: res.statusText(),
          contentType,
          durationMs: duration,
          timestamp: new Date().toISOString(),
          requestBodySummary: pending?.postData,
          responseBodySummary: responseSummary || undefined
        };

        this.networkLogs.push(entry);
        if (this.networkLogs.length > this.MAX_LOG_BUFFER) {
          this.networkLogs.shift();
        }
      } catch {
        // Safe guard against response parsing errors
      }
    });

    page.on('requestfailed', req => {
      try {
        const reqUrl = req.url();
        const pending = this.pendingRequests.get(req);
        const duration = pending ? Date.now() - pending.start : undefined;
        this.pendingRequests.delete(req);

        const entry: NetworkLogEntry = {
          id: `fail-${Date.now()}`,
          method: req.method(),
          url: reqUrl,
          resourceType: req.resourceType(),
          durationMs: duration,
          timestamp: new Date().toISOString(),
          error: req.failure()?.errorText || 'Request failed',
          requestBodySummary: pending?.postData
        };

        this.networkLogs.push(entry);
        if (this.networkLogs.length > this.MAX_LOG_BUFFER) {
          this.networkLogs.shift();
        }
      } catch {
        // Safe guard
      }
    });

    page.on('close', () => {
      if (this.page === page) {
        this.page = null;
      }
    });

    // Reapply any active ephemeral mock rules to newly attached page
    this.applyAllMockRules(page).catch(() => {});
  }

  public async getDomTree(
    selector?: string,
    includeBoundingBox: boolean = true,
    includeOffscreen: boolean = false
  ): Promise<string> {
    const page = await this.ensurePage();
    return await extractCompressedDom(page, { selector, includeBoundingBox, includeOffscreen });
  }

  public async captureScreenshot(selector?: string, fullPage: boolean = false): Promise<Buffer> {
    const page = await this.ensurePage();
    if (selector) {
      const locator = page.locator(selector).first();
      try {
        await locator.waitFor({ state: 'visible', timeout: 4000 });
      } catch {
        throw new Error(`Element with selector "${selector}" was not visible on the page after 4s timeout.`);
      }
      return await locator.screenshot();
    }
    return await page.screenshot({ fullPage });
  }

  public async listTabs(): Promise<TabInfo[]> {
    if (!this.browser || !this.browser.isConnected() || !this.context) {
      await this.attach(this.cdpUrl, true);
    }
    if (!this.context) {
      throw new Error('No active browser context available. Call spector_attach first.');
    }

    const pages = this.context.pages();
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (!p.isClosed()) {
        try {
          const title = await p.title();
          tabs.push({
            index: i,
            title: title || '(No Title)',
            url: p.url(),
            isActive: p === this.page
          });
        } catch {
          // Stale tab
        }
      }
    }
    return tabs;
  }

  public async selectTab(criteria: TabSelectCriteria): Promise<ActiveTabInfo> {
    if (!this.browser || !this.browser.isConnected() || !this.context) {
      await this.attach(this.cdpUrl, true);
    }
    if (!this.context) {
      throw new Error('No active browser context available. Call spector_attach first.');
    }

    const pages = this.context.pages().filter(p => !p.isClosed());
    if (pages.length === 0) {
      throw new Error('No open tabs found in the browser.');
    }

    let targetPage: Page | undefined;

    if (criteria.debugSessionId) {
      for (const p of pages) {
        try {
          const id = await p.evaluate(() => (window as any).__debugSessionId);
          if (id === criteria.debugSessionId) {
            targetPage = p;
            break;
          }
        } catch {
          // Ignore evaluation errors on special pages
        }
      }
    }

    if (!targetPage && criteria.index !== undefined) {
      if (criteria.index < 0 || criteria.index >= pages.length) {
        throw new Error(`Tab index ${criteria.index} is out of bounds (0-${pages.length - 1}).`);
      }
      targetPage = pages[criteria.index];
    } else if (!targetPage && criteria.urlPattern) {
      try {
        const regex = new RegExp(criteria.urlPattern, 'i');
        targetPage = pages.find(p => regex.test(p.url()));
      } catch (err: any) {
        throw new Error(`Invalid regex urlPattern "${criteria.urlPattern}": ${err.message}`);
      }
    } else if (!targetPage && criteria.url) {
      const urlQuery = criteria.url.toLowerCase();
      targetPage = pages.find(p => p.url().toLowerCase().includes(urlQuery));
    } else if (!targetPage && criteria.title) {
      const titleQuery = criteria.title.toLowerCase();
      for (const p of pages) {
        const t = (await p.title()).toLowerCase();
        if (t.includes(titleQuery)) {
          targetPage = p;
          break;
        }
      }
    }

    if (!targetPage) {
      throw new Error(`Target tab matching criteria ${JSON.stringify(criteria)} was not found.`);
    }

    await targetPage.bringToFront();
    this.page = targetPage;
    this.setupPageListeners(this.page);

    const title = await this.page.title();
    const url = this.page.url();
    const viewport = this.page.viewportSize();

    return {
      title: title || '(No Title)',
      url,
      viewport
    };
  }

  public getNetworkLogs(
    filter?: string,
    clearAfterRead: boolean = true,
    statusFilter?: 'all' | 'errors_only' | '4xx' | '5xx',
    includeStaticAssets: boolean = false,
    limit: number = 25
  ): NetworkLogEntry[] {
    let result = [...this.networkLogs];

    if (!includeStaticAssets) {
      const staticTypes = new Set(['image', 'font', 'stylesheet', 'media']);
      result = result.filter(log => !staticTypes.has(log.resourceType));
    }

    if (filter) {
      try {
        const regex = new RegExp(filter, 'i');
        result = result.filter(log => regex.test(log.url));
      } catch {
        result = result.filter(log => log.url.toLowerCase().includes(filter.toLowerCase()));
      }
    }
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'errors_only') {
        result = result.filter(log => (log.status !== undefined && log.status >= 400) || !!log.error);
      } else if (statusFilter === '4xx') {
        result = result.filter(log => log.status !== undefined && log.status >= 400 && log.status < 500);
      } else if (statusFilter === '5xx') {
        result = result.filter(log => (log.status !== undefined && log.status >= 500) || !!log.error);
      }
    }

    if (limit > 0 && result.length > limit) {
      result = result.slice(result.length - limit);
    }

    if (clearAfterRead) {
      this.networkLogs = [];
    }
    return result;
  }

  public getConsoleLogs(
    level: 'all' | 'error' | 'warn' = 'error',
    clearAfterRead: boolean = true,
    limit: number = 50
  ): ConsoleLogEntry[] {
    let result = [...this.consoleLogs];
    if (level === 'error') {
      result = result.filter(log => log.type === 'error');
    } else if (level === 'warn') {
      result = result.filter(log => log.type === 'error' || log.type === 'warning');
    }

    if (limit > 0 && result.length > limit) {
      result = result.slice(result.length - limit);
    }

    if (clearAfterRead) {
      this.consoleLogs = [];
    }
    return result;
  }

  public async interact(
    action: 'click' | 'type' | 'fill' | 'hover' | 'scroll' | 'scrollIntoView' | 'press_key',
    selector?: string,
    text?: string,
    key?: string,
    scrollDelta?: { x: number; y: number },
    clearFirst: boolean = false,
    waitForNavigation: boolean = false,
    waitForTimeoutMs: number = 0
  ): Promise<string> {
    const page = await this.ensurePage();

    if (action === 'scrollIntoView') {
      if (!selector) {
        throw new Error('Selector is required for action "scrollIntoView".');
      }
      const locator = page.locator(selector).first();
      try {
        await locator.waitFor({ state: 'attached', timeout: 4000 });
        await locator.evaluate((el: HTMLElement) => {
          el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        });
        if (waitForTimeoutMs > 0) {
          await page.waitForTimeout(waitForTimeoutMs);
        }
        return `Scrolled element "${selector}" into view (centered in viewport).`;
      } catch {
        throw new Error(`Cannot perform "scrollIntoView": Element "${selector}" not attached to DOM after 4s timeout.`);
      }
    }

    if (action === 'scroll') {
      const x = scrollDelta?.x ?? 0;
      const y = scrollDelta?.y ?? 300;
      if (selector) {
        const locator = page.locator(selector).first();
        try {
          await locator.waitFor({ state: 'attached', timeout: 4000 });
          await locator.evaluate((el, delta) => el.scrollBy(delta.x, delta.y), { x, y });
          if (waitForTimeoutMs > 0) {
            await page.waitForTimeout(waitForTimeoutMs);
          }
          return `Scrolled element "${selector}" by x=${x}, y=${y}.`;
        } catch {
          throw new Error(`Cannot perform "scroll": Element "${selector}" not attached to DOM after 4s timeout.`);
        }
      }
      await page.evaluate(delta => window.scrollBy(delta.x, delta.y), { x, y });
      if (waitForTimeoutMs > 0) {
        await page.waitForTimeout(waitForTimeoutMs);
      }
      return `Scrolled page by x=${x}, y=${y}.`;
    }

    if (action === 'press_key') {
      if (!key) {
        throw new Error('Key parameter is required for action "press_key".');
      }
      if (selector) {
        const locator = page.locator(selector).first();
        try {
          await locator.waitFor({ state: 'visible', timeout: 4000 });
          await locator.press(key);
          if (waitForTimeoutMs > 0) {
            await page.waitForTimeout(waitForTimeoutMs);
          }
          return `Pressed key "${key}" on element "${selector}".`;
        } catch {
          throw new Error(`Cannot perform "press_key": Element "${selector}" not visible after 4s timeout.`);
        }
      }
      await page.keyboard.press(key);
      if (waitForTimeoutMs > 0) {
        await page.waitForTimeout(waitForTimeoutMs);
      }
      return `Pressed key "${key}" on active page.`;
    }

    if (!selector) {
      throw new Error(`Selector is required for action "${action}".`);
    }

    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 4000 });
    } catch {
      throw new Error(`Cannot perform "${action}": Element with selector "${selector}" not visible after 4s timeout.`);
    }

    switch (action) {
      case 'click':
        if (waitForNavigation) {
          try {
            await Promise.all([
              page.waitForNavigation({ timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {}),
              locator.click()
            ]);
          } catch {
            await locator.click();
          }
        } else {
          await locator.click();
        }
        if (waitForTimeoutMs > 0) {
          await page.waitForTimeout(waitForTimeoutMs);
        }
        return `Clicked element "${selector}".`;
      case 'hover':
        await locator.hover();
        if (waitForTimeoutMs > 0) {
          await page.waitForTimeout(waitForTimeoutMs);
        }
        return `Hovered element "${selector}".`;
      case 'fill':
        if (text === undefined) {
          throw new Error('Text parameter is required for action "fill".');
        }
        await locator.fill(text);
        if (waitForTimeoutMs > 0) {
          await page.waitForTimeout(waitForTimeoutMs);
        }
        return `Filled element "${selector}" with "${text}".`;
      case 'type':
        if (text === undefined) {
          throw new Error('Text parameter is required for action "type".');
        }
        if (clearFirst) {
          await locator.fill('');
        }
        await locator.pressSequentially(text, { delay: 20 });
        if (waitForTimeoutMs > 0) {
          await page.waitForTimeout(waitForTimeoutMs);
        }
        return `Typed text into element "${selector}".`;
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  public async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load'
  ): Promise<{ url: string; title: string }> {
    const page = await this.ensurePage();

    if (url === 'reload') {
      await page.reload({ waitUntil });
    } else {
      const effectiveUrl = /^[a-zA-Z]+:\/\//.test(url) ? url : `http://${url}`;
      await page.goto(effectiveUrl, { waitUntil });
    }

    return {
      url: page.url(),
      title: (await page.title()) || '(No Title)'
    };
  }

  public async pickElement(
    timeoutMs: number = 30000,
    includeScreenshot: boolean = true,
    includeStyles: boolean = true
  ): Promise<PickedElementInfo> {
    const page = await this.ensurePage();

    const rawResult = await page.evaluate(
      ({ timeout, withStyles, detectorScript }) => {
        const detectFn = new Function(`${detectorScript}; return detectFrameworkComponent;`)();
        return new Promise<any>((resolve) => {
          const UI_PREFIX = 'data-spector-picker';

          // 1. Create Floating Banner
          const banner = document.createElement('div');
          banner.setAttribute(UI_PREFIX, 'banner');
          banner.style.cssText = `
            position: fixed;
            top: 16px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            background: rgba(15, 23, 42, 0.95);
            color: #ffffff;
            padding: 10px 20px;
            border-radius: 9999px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            gap: 10px;
            pointer-events: none;
            user-select: none;
            backdrop-filter: blur(8px);
            transition: all 0.2s ease;
          `;
          banner.innerHTML = `
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 8px #38bdf8;animation:pulse 1.5s infinite;"></span>
            <span><strong>Live-DOM Inspector:</strong> Hover & click any section/element to pick (Press <strong>Esc</strong> to cancel)</span>
          `;

          // 2. Create Highlight Box
          const highlightBox = document.createElement('div');
          highlightBox.setAttribute(UI_PREFIX, 'highlight');
          highlightBox.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 2147483645;
            border: 2px solid #0284c7;
            background: rgba(14, 165, 233, 0.12);
            border-radius: 4px;
            display: none;
            transition: all 0.05s ease-out;
            box-sizing: border-box;
          `;

          // 3. Create Tooltip Badge
          const badge = document.createElement('div');
          badge.setAttribute(UI_PREFIX, 'badge');
          badge.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 2147483646;
            background: #0284c7;
            color: #ffffff;
            font-family: monospace;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 4px;
            display: none;
            white-space: nowrap;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
          `;

          document.body.appendChild(banner);
          document.body.appendChild(highlightBox);
          document.body.appendChild(badge);

          let currentTarget: HTMLElement | null = null;

          function getCssSelector(el: Element): string {
            if (el.id) {
              return `#${CSS.escape(el.id)}`;
            }
            const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
            if (testId) {
              const attr = el.getAttribute('data-testid') ? 'data-testid' : (el.getAttribute('data-test') ? 'data-test' : 'data-cy');
              return `[${attr}="${CSS.escape(testId)}"]`;
            }

            const path: string[] = [];
            let curr: Element | null = el;
            while (curr && curr.nodeType === Node.ELEMENT_NODE && curr !== document.body && curr !== document.documentElement) {
              const tag = curr.tagName.toLowerCase();
              if (curr.id) {
                path.unshift(`#${CSS.escape(curr.id)}`);
                break;
              }
              const currTestId = curr.getAttribute('data-testid') || curr.getAttribute('data-test');
              if (currTestId) {
                const attr = curr.getAttribute('data-testid') ? 'data-testid' : 'data-test';
                path.unshift(`[${attr}="${CSS.escape(currTestId)}"]`);
                break;
              }
              const parent: Element | null = curr.parentElement;
              if (!parent) break;

              let classHint = '';
              if (curr.className && typeof curr.className === 'string') {
                const classes = curr.className.trim().split(/\s+/).filter(c => c && !c.includes(':') && !['flex', 'grid', 'hidden', 'block', 'relative', 'absolute'].includes(c));
                if (classes.length > 0) {
                  classHint = '.' + CSS.escape(classes[0]);
                }
              }

              const siblings = Array.from(parent.children).filter(c => c.tagName.toLowerCase() === tag);
              if (siblings.length > 1) {
                const index = siblings.indexOf(curr) + 1;
                path.unshift(`${tag}${classHint}:nth-of-type(${index})`);
              } else {
                path.unshift(`${tag}${classHint}`);
              }
              curr = parent;
            }
            return path.length > 0 ? path.join(' > ') : el.tagName.toLowerCase();
          }

          function cleanup() {
            window.removeEventListener('mousemove', onMouseMove, true);
            window.removeEventListener('click', onClick, true);
            window.removeEventListener('keydown', onKeyDown, true);
            banner.remove();
            highlightBox.remove();
            badge.remove();
          }

          function onMouseMove(e: MouseEvent) {
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (!el || el.hasAttribute(UI_PREFIX) || el.closest(`[${UI_PREFIX}]`)) {
              return;
            }
            currentTarget = el;
            const rect = el.getBoundingClientRect();

            highlightBox.style.display = 'block';
            highlightBox.style.left = `${rect.left}px`;
            highlightBox.style.top = `${rect.top}px`;
            highlightBox.style.width = `${rect.width}px`;
            highlightBox.style.height = `${rect.height}px`;

            badge.style.display = 'block';
            const badgeTop = rect.top > 30 ? rect.top - 24 : rect.bottom + 6;
            badge.style.left = `${Math.max(10, rect.left)}px`;
            badge.style.top = `${Math.max(10, badgeTop)}px`;

            const idStr = el.id ? `#${el.id}` : '';
            const classStr = el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : '';
            const comp = detectFn(el);
            const compPrefix = comp?.componentName ? `[${comp.componentName}] ` : '';
            badge.textContent = `${compPrefix}<${el.tagName.toLowerCase()}${idStr}${classStr}> (${Math.round(rect.width)}x${Math.round(rect.height)})`;
          }

          function onClick(e: MouseEvent) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            if (!currentTarget) {
              cleanup();
              resolve({ status: 'cancelled' });
              return;
            }

            const target = currentTarget;
            const rect = target.getBoundingClientRect();
            const selector = getCssSelector(target);
            const tagName = target.tagName.toLowerCase();
            const frameworkComponent = detectFn(target) || undefined;

            let computedStyles: Record<string, string> | undefined;
            if (withStyles) {
              const cs = window.getComputedStyle(target);
              const styles: Record<string, string> = {
                display: cs.display,
                width: `${Math.round(rect.width)}px`,
                height: `${Math.round(rect.height)}px`,
                color: cs.color
              };

              const addIf = (key: string, val: string, isDefault: (v: string) => boolean) => {
                if (!isDefault(val)) {
                  styles[key] = val;
                }
              };

              addIf('position', cs.position, v => v === 'static');
              addIf('zIndex', cs.zIndex, v => v === 'auto');
              addIf('overflow', cs.overflow, v => v === 'visible');
              addIf('visibility', cs.visibility, v => v === 'visible');
              addIf('opacity', cs.opacity, v => v === '1');
              addIf('pointerEvents', cs.pointerEvents, v => v === 'auto');
              addIf('cursor', cs.cursor, v => v === 'auto');
              addIf('flexDirection', cs.flexDirection, v => v === 'row');
              addIf('gridTemplateColumns', cs.gridTemplateColumns, v => v === 'none');
              addIf('gap', cs.gap, v => v === 'normal');
              addIf('padding', cs.padding, v => v === '0px');
              addIf('margin', cs.margin, v => v === '0px');
              addIf('backgroundColor', cs.backgroundColor, v => v === 'rgba(0, 0, 0, 0)' || v === 'transparent');
              addIf('borderRadius', cs.borderRadius, v => v === '0px');
              addIf('border', cs.border, v => v === 'none' || v.startsWith('0px'));
              addIf('boxShadow', cs.boxShadow, v => v === 'none');

              computedStyles = styles;
            }

            cleanup();
            resolve({
              status: 'selected',
              selector,
              tagName,
              frameworkComponent,
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              computedStyles
            });
          }

          function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
              e.preventDefault();
              cleanup();
              resolve({ status: 'cancelled' });
            }
          }

          window.addEventListener('mousemove', onMouseMove, true);
          window.addEventListener('click', onClick, true);
          window.addEventListener('keydown', onKeyDown, true);

          setTimeout(() => {
            cleanup();
            resolve({ status: 'timeout' });
          }, timeout);
        });
      },
      { timeout: timeoutMs, withStyles: includeStyles, detectorScript: IN_BROWSER_COMPONENT_DETECTOR_FN }
    );

    if (rawResult.status !== 'selected' || !rawResult.selector) {
      return rawResult as PickedElementInfo;
    }

    const result: PickedElementInfo = {
      status: 'selected',
      selector: rawResult.selector,
      tagName: rawResult.tagName,
      frameworkComponent: rawResult.frameworkComponent,
      rect: rawResult.rect,
      computedStyles: rawResult.computedStyles
    };

    // Enrich with physical source code location (Pick-to-Source)
    if (result.frameworkComponent) {
      const loc = resolveSourceLocation(
        result.frameworkComponent.sourceFile,
        result.frameworkComponent.componentName,
        result.frameworkComponent.sourceLine
      );
      if (loc) {
        result.frameworkComponent.sourceLocation = loc;
      }
    }

    // Extract token-lean semantic DOM tree for the picked element
    try {
      result.domTree = await extractCompressedDom(page, { selector: rawResult.selector, includeOffscreen: true });
    } catch (err: any) {
      logger.warn('picker_dom_compression_fallback', { selector: rawResult.selector, error: err.message });
    }

    // Capture precise screenshot of the picked section
    if (includeScreenshot) {
      try {
        const locator = page.locator(rawResult.selector).first();
        const screenshotBuf = await locator.screenshot();
        result.screenshotBase64 = screenshotBuf.toString('base64');
      } catch (err: any) {
        logger.warn('picker_screenshot_fallback', { selector: rawResult.selector, error: err.message });
      }
    }

    return result;
  }

  public getLastPickedElement(clearAfterRead: boolean = false): PickedElementInfo | null {
    const result = this.lastPickedElement;
    if (clearAfterRead) {
      this.lastPickedElement = null;
    }
    return result;
  }

  public async setNetworkMock(rule: {
    urlPattern: string;
    status?: number;
    contentType?: string;
    body?: string;
    headers?: Record<string, string>;
    delayMs?: number;
  }): Promise<MockRouteRule> {
    const page = await this.ensurePage();
    const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const mockRule: MockRouteRule = {
      id,
      urlPattern: rule.urlPattern,
      status: rule.status ?? 200,
      contentType: rule.contentType || (rule.body && rule.body.startsWith('{') ? 'application/json' : 'text/plain'),
      body: rule.body ?? '',
      headers: rule.headers || {},
      delayMs: rule.delayMs ?? 0,
      createdAt: new Date().toISOString()
    };

    // Store in active mock registry
    this.mockRules.set(mockRule.urlPattern, mockRule);

    // Apply route to active Playwright Page
    await this.applyMockRuleToPage(page, mockRule);

    return mockRule;
  }

  public async clearNetworkMock(urlPattern?: string): Promise<{ clearedCount: number; remaining: string[] }> {
    const page = this.page;
    if (urlPattern) {
      if (this.mockRules.has(urlPattern)) {
        this.mockRules.delete(urlPattern);
        if (page && !page.isClosed()) {
          try {
            await page.unroute(urlPattern);
          } catch {
            // Ignore unroute failure
          }
        }
        return { clearedCount: 1, remaining: Array.from(this.mockRules.keys()) };
      }
      return { clearedCount: 0, remaining: Array.from(this.mockRules.keys()) };
    } else {
      const count = this.mockRules.size;
      for (const pattern of this.mockRules.keys()) {
        if (page && !page.isClosed()) {
          try {
            await page.unroute(pattern);
          } catch {
            // Ignore
          }
        }
      }
      this.mockRules.clear();
      return { clearedCount: count, remaining: [] };
    }
  }

  public listNetworkMocks(): MockRouteRule[] {
    return Array.from(this.mockRules.values());
  }

  private async applyMockRuleToPage(page: Page, rule: MockRouteRule): Promise<void> {
    if (page.isClosed()) return;
    try {
      await page.route(rule.urlPattern, async (route: Route) => {
        if (rule.delayMs && rule.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
        }
        const headers: Record<string, string> = {
          'content-type': rule.contentType || 'application/json',
          'access-control-allow-origin': '*',
          ...rule.headers
        };
        await route.fulfill({
          status: rule.status,
          headers,
          body: rule.body
        });
      });
    } catch {
      // Ignore routing errors if page is transitioning
    }
  }

  public async applyAllMockRules(page: Page): Promise<void> {
    if (page.isClosed()) return;
    for (const rule of this.mockRules.values()) {
      await this.applyMockRuleToPage(page, rule);
    }
  }

  private async setupHotkeyPicker(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
      const currentUrl = page.url();
      if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://')) {
        return;
      }
    } catch {
      // Ignore URL read error
    }

    try {
      await page.exposeFunction('__spector_on_element_picked', async (data: any) => {
        // Automatically align active page pointer to the tab where developer picked the element
        this.page = page;

        const picked: PickedElementInfo = {
          status: 'selected',
          selector: data.selector,
          tagName: data.tagName,
          frameworkComponent: data.frameworkComponent,
          rect: data.rect,
          computedStyles: data.computedStyles,
          timestamp: new Date().toISOString()
        };

        // Enrich with physical source code location (Pick-to-Source)
        if (picked.frameworkComponent) {
          const loc = resolveSourceLocation(
            picked.frameworkComponent.sourceFile,
            picked.frameworkComponent.componentName,
            picked.frameworkComponent.sourceLine
          );
          if (loc) {
            picked.frameworkComponent.sourceLocation = loc;
          }
        }

        // Extract token-lean semantic DOM tree for the picked element
        try {
          picked.domTree = await extractCompressedDom(page, { selector: data.selector, includeOffscreen: true });
        } catch (err: any) {
          logger.warn('hotkey_picker_dom_compression_failed', { selector: data.selector, error: err.message });
        }

        // Capture screenshot of the picked section
        try {
          const locator = page.locator(data.selector).first();
          const screenshotBuf = await locator.screenshot();
          picked.screenshotBase64 = screenshotBuf.toString('base64');
        } catch (err: any) {
          logger.warn('hotkey_picker_screenshot_failed', { selector: data.selector, error: err.message });
        }

        this.lastPickedElement = picked;
        logger.info('element_picked_via_hotkey', {
          selector: picked.selector,
          component: picked.frameworkComponent?.componentName,
          sourceFile: picked.frameworkComponent?.sourceLocation?.resolvedFile,
          line: picked.frameworkComponent?.sourceLocation?.line
        });
      });
    } catch {
      // Function already exposed on this page, ignore
    }

    const hotkeyScript = `
      (() => {
        if (window.__spector_hotkey_registered) return;
        window.__spector_hotkey_registered = true;

        ${IN_BROWSER_COMPONENT_DETECTOR_FN}

        window.addEventListener('keydown', (e) => {
          if (e.altKey && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            e.stopPropagation();

            const UI_PREFIX = 'data-spector-picker';
            if (document.querySelector('[' + UI_PREFIX + ']')) return;

            // 1. Create Floating Banner
            const banner = document.createElement('div');
            banner.setAttribute(UI_PREFIX, 'banner');
            banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(15,23,42,0.95);color:#ffffff;padding:10px 20px;border-radius:9999px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:500;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);display:flex;align-items:center;gap:10px;pointer-events:none;user-select:none;backdrop-filter:blur(8px);';
            banner.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 8px #38bdf8;"></span><span><strong>Spector Inspector (Alt+P):</strong> Hover & click section to send to AI (Esc = Cancel)</span>';

            // 2. Create Highlight Box
            const highlightBox = document.createElement('div');
            highlightBox.setAttribute(UI_PREFIX, 'highlight');
            highlightBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #0284c7;background:rgba(14,165,233,0.12);border-radius:4px;display:none;box-sizing:border-box;';

            // 3. Create Tooltip Badge
            const badge = document.createElement('div');
            badge.setAttribute(UI_PREFIX, 'badge');
            badge.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;background:#0284c7;color:#ffffff;font-family:monospace;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;display:none;white-space:nowrap;box-shadow:0 4px 6px -1px rgba(0,0,0,0.2);';

            document.body.appendChild(banner);
            document.body.appendChild(highlightBox);
            document.body.appendChild(badge);

            let currentTarget = null;

            function getCssSelector(el) {
              if (el.id) return '#' + CSS.escape(el.id);
              const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
              if (testId) return '[' + (el.getAttribute('data-testid') ? 'data-testid' : (el.getAttribute('data-test') ? 'data-test' : 'data-cy')) + '="' + CSS.escape(testId) + '"]';

              const path = [];
              let curr = el;
              while (curr && curr.nodeType === Node.ELEMENT_NODE && curr !== document.body && curr !== document.documentElement) {
                const tag = curr.tagName.toLowerCase();
                if (curr.id) {
                  path.unshift('#' + CSS.escape(curr.id));
                  break;
                }
                const currTestId = curr.getAttribute('data-testid') || curr.getAttribute('data-test');
                if (currTestId) {
                  path.unshift('[' + (curr.getAttribute('data-testid') ? 'data-testid' : 'data-test') + '="' + CSS.escape(currTestId) + '"]');
                  break;
                }
                const parent = curr.parentElement;
                if (!parent) break;

                let classHint = '';
                if (curr.className && typeof curr.className === 'string') {
                  const classes = curr.className.trim().split(/\\s+/).filter(c => c && !c.includes(':') && !['flex', 'grid', 'hidden', 'block', 'relative', 'absolute'].includes(c));
                  if (classes.length > 0) {
                    classHint = '.' + CSS.escape(classes[0]);
                  }
                }

                const siblings = Array.from(parent.children).filter(c => c.tagName.toLowerCase() === tag);
                if (siblings.length > 1) {
                  const index = siblings.indexOf(curr) + 1;
                  path.unshift(tag + classHint + ':nth-of-type(' + index + ')');
                } else {
                  path.unshift(tag + classHint);
                }
                curr = parent;
              }
              return path.length > 0 ? path.join(' > ') : el.tagName.toLowerCase();
            }

            function cleanup() {
              window.removeEventListener('mousemove', onMouseMove, true);
              window.removeEventListener('click', onClick, true);
              window.removeEventListener('keydown', onKeyDown, true);
              banner.remove();
              highlightBox.remove();
              badge.remove();
            }

            function onMouseMove(ev) {
              const el = document.elementFromPoint(ev.clientX, ev.clientY);
              if (!el || el.hasAttribute(UI_PREFIX) || el.closest('[' + UI_PREFIX + ']')) return;
              currentTarget = el;
              const rect = el.getBoundingClientRect();

              highlightBox.style.display = 'block';
              highlightBox.style.left = rect.left + 'px';
              highlightBox.style.top = rect.top + 'px';
              highlightBox.style.width = rect.width + 'px';
              highlightBox.style.height = rect.height + 'px';

              badge.style.display = 'block';
              const badgeTop = rect.top > 30 ? rect.top - 24 : rect.bottom + 6;
              badge.style.left = Math.max(10, rect.left) + 'px';
              badge.style.top = Math.max(10, badgeTop) + 'px';

              const idStr = el.id ? '#' + el.id : '';
              const classStr = el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
                : '';
              badge.textContent = '<' + el.tagName.toLowerCase() + idStr + classStr + '> (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
            }

            function showToast(msg) {
              const toast = document.createElement('div');
              toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#059669;color:#ffffff;padding:12px 20px;border-radius:8px;font-family:sans-serif;font-size:13px;font-weight:500;box-shadow:0 10px 25px rgba(0,0,0,0.3);';
              toast.textContent = msg;
              document.body.appendChild(toast);
              setTimeout(() => toast.remove(), 3500);
            }

            function onClick(ev) {
              ev.preventDefault();
              ev.stopPropagation();
              ev.stopImmediatePropagation();

              if (!currentTarget) {
                cleanup();
                return;
              }

              const target = currentTarget;
              const rect = target.getBoundingClientRect();
              const selector = getCssSelector(target);
              const tagName = target.tagName.toLowerCase();
              const cs = window.getComputedStyle(target);
              const frameworkComponent = typeof detectFrameworkComponent === 'function' ? detectFrameworkComponent(target) : null;

              const computedStyles = {
                display: cs.display,
                position: cs.position !== 'static' ? cs.position : undefined,
                zIndex: cs.zIndex !== 'auto' ? cs.zIndex : undefined,
                overflow: cs.overflow !== 'visible' ? cs.overflow : undefined,
                visibility: cs.visibility !== 'visible' ? cs.visibility : undefined,
                opacity: cs.opacity !== '1' ? cs.opacity : undefined,
                pointerEvents: cs.pointerEvents !== 'auto' ? cs.pointerEvents : undefined,
                cursor: cs.cursor !== 'auto' ? cs.cursor : undefined,
                flexDirection: cs.flexDirection !== 'row' ? cs.flexDirection : undefined,
                gridTemplateColumns: cs.gridTemplateColumns !== 'none' ? cs.gridTemplateColumns : undefined,
                gap: cs.gap !== 'normal' ? cs.gap : undefined,
                width: Math.round(rect.width) + 'px',
                height: Math.round(rect.height) + 'px',
                padding: cs.padding !== '0px' ? cs.padding : undefined,
                margin: cs.margin !== '0px' ? cs.margin : undefined,
                backgroundColor: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : undefined,
                color: cs.color,
                borderRadius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
                border: cs.border !== 'none' && !cs.border.startsWith('0px') ? cs.border : undefined,
                boxShadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined
              };

              Object.keys(computedStyles).forEach(k => {
                if (computedStyles[k] === undefined) delete computedStyles[k];
              });

              cleanup();

              if (typeof window.__spector_on_element_picked === 'function') {
                window.__spector_on_element_picked({
                  selector,
                  tagName,
                  frameworkComponent,
                  rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                  },
                  computedStyles
                });
                showToast('✅ Element captured and synced to Spector AI!');
              }
            }

            function onKeyDown(ev) {
              if (ev.key === 'Escape') {
                ev.preventDefault();
                cleanup();
              }
            }

            window.addEventListener('mousemove', onMouseMove, true);
            window.addEventListener('click', onClick, true);
            window.addEventListener('keydown', onKeyDown, true);
          }
        }, true);
      })();
    `;

    try {
      await page.addInitScript(hotkeyScript);
    } catch {
      // Ignore if cannot add init script
    }

    try {
      await page.evaluate(hotkeyScript);
    } catch {
      // Ignore if document not ready
    }
  }

  public async diffDom(rootSelector?: string, resetBaseline: boolean = false): Promise<DomDiffResult> {
    const page = await this.ensurePage();
    const current = await captureDomSnapshot(page, rootSelector);

    if (resetBaseline || !this.lastDomSnapshot) {
      this.lastDomSnapshot = current;
      return {
        status: 'baseline_set',
        currentTimestamp: current.timestamp,
        summary: {
          addedCount: 0,
          removedCount: 0,
          mutatedCount: 0,
          textChangesCount: 0
        },
        changes: {
          added: [],
          removed: [],
          mutated: []
        }
      };
    }

    const diff = compareDomSnapshots(this.lastDomSnapshot, current);
    return diff;
  }

  public async disconnect(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore disconnect errors
      }
      this.browser = null;
      this.context = null;
      this.page = null;
      this.attachedPages = new WeakSet<Page>();
    }
  }
}
