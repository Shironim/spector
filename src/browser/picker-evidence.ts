import type { Page } from 'playwright-core';
import type { PickedElementInfo } from '../types.js';
import type { BrowserPickedPin } from './picker-payload.js';
import type { DocumentRegistry } from './document-registry.js';
import type { PinStore } from './pin-store.js';
import type { RenderCapture } from './render-capture.js';
import { extractCompressedDom } from '../analyzers/dom-compressor.js';
import { extractPseudoStateDelta } from '../analyzers/cdp-styles.js';
import { enrichFrameworkComponent } from '../utils/framework-detector.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import { SpectorError } from '../utils/mcp-response.js';
import { logger } from '../utils/logger.js';
import { TIMEOUTS } from '../constants.js';

export class PickerEvidence {
  public constructor(
    private readonly documents: DocumentRegistry,
    private readonly pins: PinStore,
    private readonly captureScreenshotBuffer: RenderCapture['captureScreenshotBuffer'],
    private readonly assertTarget: (page: Page, url: string, changed?: boolean) => void,
    private readonly targetId: (page: Page) => string,
    private readonly remainingTime: (localLimit: number) => number = (limit) => limit
  ) {}

  public async collect(
    page: Page,
    raw: BrowserPickedPin,
    options: { includeScreenshot: boolean; includeHoverState: boolean }
  ): Promise<PickedElementInfo> {
    const documentId = this.documents.id(page);
    const elementId = raw.selector && raw.pinMode !== 'region'
      ? await this.documents.elementId(page, escapeTailwindSelector(raw.selector)) : null;
    let tabUrl: string | undefined;
    let tabTitle: string | undefined;
    try {
      tabUrl = page.url();
      tabTitle = await page.title();
    } catch {
      // Tab metadata optional when page redirects during pick.
    }

    const picked: PickedElementInfo = {
      targetId: this.targetId(page),
      documentId,
      ...(elementId ? { elementId } : {}),
      id: this.pins.nextId(),
      role: raw.role,
      pinMode: raw.pinMode,
      ...(raw.note ? { note: raw.note } : {}),
      ...(tabUrl ? { tabUrl } : {}),
      ...(tabTitle ? { tabTitle } : {}),
      status: 'selected',
      selector: raw.selector,
      tagName: raw.tagName,
      frameworkComponent: enrichFrameworkComponent(raw.frameworkComponent),
      rect: raw.rect,
      computedStyles: raw.computedStyles,
      subtreeSummary: raw.subtreeSummary,
      assets: raw.assets,
      timestamp: new Date().toISOString()
    };
    picked.sections = {
      dom: { status: raw.selector && raw.pinMode !== 'region' ? 'failed' : 'unavailable' },
      screenshot: { status: options.includeScreenshot ? 'failed' : 'not_requested' }
    };

    if (raw.selector && raw.pinMode !== 'region') {
      try {
        const escaped = escapeTailwindSelector(raw.selector);
        picked.domTree = await extractCompressedDom(page, { selector: escaped, includeOffscreen: true });
        picked.sections.dom = { status: 'captured' };
      } catch (err: unknown) {
        logger.warn('picker_dom_compression_fallback', { selector: raw.selector, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (options.includeHoverState && raw.selector && raw.pinMode !== 'region') {
      picked.enrichment = { hover: { status: 'failed' } };
      try {
        picked.hoverState = await extractPseudoStateDelta(page, raw.selector, ':hover', this.remainingTime(TIMEOUTS.CDP_CONNECT_MS));
        picked.enrichment.hover = { status: 'captured', observedAt: new Date().toISOString() };
        if (picked.hoverState?.changes && picked.computedStyles) {
          for (const [prop, delta] of Object.entries(picked.hoverState.changes)) {
            if (prop in picked.computedStyles && delta.normal) {
              picked.computedStyles[prop] = delta.normal;
            }
          }
        }
      } catch (err: unknown) {
        logger.warn('picker_hover_state_fallback', { selector: raw.selector, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (options.includeScreenshot) {
      try {
        if (raw.pinMode === 'region' && raw.rect && raw.rect.width > 0 && raw.rect.height > 0) {
          const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
          const buf = await this.captureScreenshotBuffer(page, {
            clip: {
              x: Math.max(0, raw.rect.x + scroll.x),
              y: Math.max(0, raw.rect.y + scroll.y),
              width: raw.rect.width,
              height: raw.rect.height
            }
          });
          picked.screenshotBase64 = buf.toString('base64');
          picked.sections.screenshot = { status: 'captured' };
        } else if (raw.selector) {
          const buf = await this.captureScreenshotBuffer(page, { selector: raw.selector });
          picked.screenshotBase64 = buf.toString('base64');
          picked.sections.screenshot = { status: 'captured' };
        }
      } catch (err: unknown) {
        logger.warn('picker_screenshot_fallback', { selector: raw.selector, error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.assertTarget(page, tabUrl ?? page.url(), this.documents.id(page) !== documentId);
    if (elementId && raw.selector && await this.documents.elementId(page, escapeTailwindSelector(raw.selector)) !== elementId) {
      throw new SpectorError('ELEMENT_NOT_READY', 'Picked element changed while collecting evidence.');
    }
    return picked;
  }


  public async enrich(page: Page, pins: PickedElementInfo[], options: {includeHoverState?: boolean; includeFocusState?: boolean}): Promise<void> {
    const documentId = this.documents.id(page);
    for (const pin of pins) {
      for (const kind of ['hover', 'focus'] as const) {
        if (!(kind === 'hover' ? options.includeHoverState : options.includeFocusState)) continue;
        pin.enrichment ??= {};
        if (!pin.documentId || pin.documentId !== documentId || pin.targetId !== this.targetId(page)) {
          pin.enrichment[kind] = { status: 'stale' }; continue;
        }
        if (!pin.selector || pin.pinMode === 'region') {
          pin.enrichment[kind] = { status: 'unavailable' }; continue;
        }
        if (!pin.elementId || await this.documents.elementId(page, escapeTailwindSelector(pin.selector)) !== pin.elementId) {
          pin.enrichment[kind] = { status: 'stale' }; continue;
        }
        try {
          const delta = await extractPseudoStateDelta(
            page,
            pin.selector,
            kind === 'hover' ? ':hover' : ':focus-visible',
            this.remainingTime(TIMEOUTS.CDP_CONNECT_MS)
          );
          this.assertTarget(page, page.url(), this.documents.id(page) !== documentId);
          if (await this.documents.elementId(page, escapeTailwindSelector(pin.selector)) !== pin.elementId) {
            pin.enrichment[kind] = { status: 'stale' }; continue;
          }
          if (kind === 'hover') pin.hoverState = delta; else pin.focusState = delta;
          pin.enrichment[kind] = { status: 'captured', observedAt: new Date().toISOString() };
        } catch (error) {
          this.assertTarget(page, page.url(), this.documents.id(page) !== documentId);
          pin.enrichment[kind] = { status: 'failed' };
        }
      }
    }
  }
}
