import { describe, expect, test } from 'bun:test';
import vm from 'node:vm';
import { runLayoutForensics } from '../../src/analyzers/layout-forensics.js';
import { runAccessibilityForensics } from '../../src/analyzers/accessibility-forensics.js';
import { compactDiagnoseReport } from '../../src/analyzers/diagnose-compactor.js';
import { DiagnoseBaselineStore, summarizeDiagnoseReport } from '../../src/browser/diagnose-baseline.js';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { registerDiagnoseTool } from '../../src/tools/diagnose.js';
import { registerInspectTools } from '../../src/tools/inspect.js';
import { DEVTOOLS_OVERLAY_SELECTORS } from '../../src/browser/render-capture.js';
import type { DiagnoseReport } from '../../src/types.js';

function createMockDomEnv(
  nodes: any[],
  options?: { viewportWidth?: number; viewportHeight?: number; docScrollHeight?: number }
) {
  class ElementMock {
    nodeType = 1;
    tagName = 'DIV';
    id = '';
    className = '';
    parentElement: any = null;
    children: any[] = [];
    childNodes: any[] = [];
    textContent = '';
    scrollWidth = 100;
    clientWidth = 100;
    _attrs: Record<string, string> = {};
    _cs: Record<string, string> = { display: 'block', visibility: 'visible', position: 'static', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', zIndex: 'auto', opacity: '1', backgroundColor: 'transparent', backgroundImage: 'none' };
    _rect = { x: 0, y: 0, width: 120, height: 40, left: 0, right: 120, top: 0, bottom: 40 };
    _hasTable = false;
    getBoundingClientRect() { return this._rect; }
    getAttribute(name: string) { return name in this._attrs ? this._attrs[name] : null; }
    closest() { return null; }
    contains(other: any) {
      let cur = other?.parentElement;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    }
    querySelector(sel: string) {
      if (sel === 'table' && this._hasTable) return {};
      return null;
    }
    querySelectorAll() { return []; }
  }
  class HTMLElementMock extends ElementMock {}
  class SVGElementMock extends ElementMock {}
  class HTMLImageElementMock extends HTMLElementMock {}

  const vw = options?.viewportWidth ?? 1440;
  const vh = options?.viewportHeight ?? 900;
  const scrollHeight = options?.docScrollHeight ?? vh;

  const htmlEl: any = new HTMLElementMock();
  htmlEl.tagName = 'HTML';
  htmlEl.clientWidth = vw;
  htmlEl.clientHeight = vh;
  htmlEl.scrollWidth = vw;
  htmlEl.scrollHeight = scrollHeight;
  htmlEl._cs = { ...htmlEl._cs, backgroundColor: 'rgb(255, 255, 255)' };

  const bodyEl: any = new HTMLElementMock();
  bodyEl.tagName = 'BODY';
  bodyEl.parentElement = htmlEl;
  bodyEl._cs = { ...bodyEl._cs, backgroundColor: 'rgb(255, 255, 255)' };

  const builtNodes = nodes.map(spec => {
    const el: any = new HTMLElementMock();
    Object.assign(el, spec);
    el._cs = { ...new HTMLElementMock()._cs, ...(spec._cs ?? {}) };
    el._rect = { ...new HTMLElementMock()._rect, ...(spec._rect ?? {}) };
    if (!el.parentElement) el.parentElement = bodyEl;
    return el;
  });

  // Wire parent.children arrays for :nth-of-type selector resolution
  for (const el of builtNodes) {
    if (el.parentElement && Array.isArray(el.parentElement.children)) {
      if (!el.parentElement.children.includes(el)) {
        el.parentElement.children.push(el);
      }
    }
  }

  const page = {
    evaluate: async (fnOrExpr: Function | string) =>
      vm.runInContext(
        typeof fnOrExpr === 'string' ? fnOrExpr : `(${fnOrExpr.toString()})()`,
        vm.createContext({
          URL,
          CSS: { escape: (s: string) => s },
          HTMLElement: HTMLElementMock,
          SVGElement: SVGElementMock,
          HTMLImageElement: HTMLImageElementMock,
          document: {
            documentElement: htmlEl,
            body: bodyEl,
            querySelector: (sel: string) => {
              if (sel.startsWith('#')) return builtNodes.find(n => n.id === sel.slice(1)) ?? null;
              return null;
            },
            querySelectorAll: (sel: string) => {
              if (sel === 'body *') return builtNodes;
              if (sel.startsWith('#')) return builtNodes.filter(n => n.id === sel.slice(1));
              return [];
            }
          },
          window: {
            innerWidth: vw,
            innerHeight: vh,
            getComputedStyle: (el: any) => el._cs
          }
        })
      )
  };

  return { page, builtNodes, bodyEl, HTMLElementMock };
}

describe('Wave 4 Audit Improvements (Spector Review)', () => {
  test('Item 2 & 4: detects internalHorizontalScroll, clippedInViewport, and extracts Vue/React sourceFile', async () => {
    const clipParent: any = {
      id: 'cashier-shell',
      tagName: 'DIV',
      _rect: { x: 0, y: 0, width: 400, height: 600, left: 0, right: 400, top: 0, bottom: 600 },
      _cs: { overflowY: 'hidden', overflowX: 'visible' }
    };

    const { page, builtNodes } = createMockDomEnv([
      {
        id: 'discount-table-wrap',
        tagName: 'DIV',
        scrollWidth: 1620,
        clientWidth: 1200,
        _hasTable: true,
        _rect: { x: 0, y: 100, width: 1200, height: 300, left: 0, right: 1200, top: 100, bottom: 400 },
        _cs: { overflowX: 'auto' },
        __vueParentComponent: {
          type: { __file: '/home/dev/erp/app/pages/admin/product/discount.vue' }
        }
      },
      clipParent,
      {
        id: 'pay-cta',
        tagName: 'BUTTON',
        _rect: { x: 20, y: 580, width: 200, height: 44, left: 20, right: 220, top: 580, bottom: 624 },
        _cs: { position: 'static' },
        __reactFiber$abc: {
          _debugSource: { fileName: '/workspace/src/components/CashierFooter.tsx', lineNumber: 88 }
        }
      },
      {
        id: 'sticky-bar',
        tagName: 'FOOTER',
        _rect: { x: 0, y: 880, width: 1440, height: 50, left: 0, right: 1440, top: 880, bottom: 930 },
        _cs: { position: 'fixed' },
        __reactFiber$r19: {
          _debugStack: {
            stack: 'Error: react-stack-top-frame\n    at StickyFooter (http://localhost:3000/src/components/StickyFooter.tsx:42:7)\n    at renderWithHooks (http://localhost:3000/node_modules/react-dom/index.js:10:1)'
          }
        }
      }
    ], { viewportWidth: 1440, viewportHeight: 900, docScrollHeight: 2000 });

    // Wire pay-cta parent to clipParent
    builtNodes[2].parentElement = builtNodes[1];

    const layout = await runLayoutForensics(page as any);
    expect(layout.internalHorizontalScroll).toHaveLength(1);
    expect(layout.internalHorizontalScroll![0].selector).toBe('#discount-table-wrap');
    expect(layout.internalHorizontalScroll![0].overflowPx).toBe(420);
    expect(layout.internalHorizontalScroll![0].hasTable).toBe(true);
    expect(layout.internalHorizontalScroll![0].sourceFile).toBe('app/pages/admin/product/discount.vue');

    expect(layout.clippedInViewport).toHaveLength(2);
    const payClip = layout.clippedInViewport!.find(c => c.selector === '#pay-cta');
    expect(payClip).toBeDefined();
    expect(payClip!.clippedBy).toBe('ancestor');
    expect(payClip!.ancestorSelector).toBe('#cashier-shell');
    expect(payClip!.edge).toBe('bottom');
    expect(payClip!.clippedPx).toBe(24);
    expect(payClip!.sourceFile).toBe('src/components/CashierFooter.tsx:88');

    const stickyClip = layout.clippedInViewport!.find(c => c.selector === '#sticky-bar');
    expect(stickyClip).toBeDefined();
    expect(stickyClip!.clippedBy).toBe('viewport');
    expect(stickyClip!.clippedPx).toBe(30);
    expect(stickyClip!.sourceFile).toBe('src/components/StickyFooter.tsx:42');
  });

  test('Item 5: samples repetitive tbody > tr rows when DOM exceeds maxElements so footer elements are still audited', async () => {
    const tbodySpec: any = { id: 'orders-body', tagName: 'TBODY' };
    const specs: any[] = [tbodySpec];
    // 20 rows, each with 2 cells = 60 table elements
    for (let r = 0; r < 20; r++) {
      specs.push({ tagName: 'TR', _rowIdx: r });
      specs.push({ tagName: 'TD', _rowIdx: r, childNodes: [{ nodeType: 3, textContent: `Row ${r}` }] });
      specs.push({ tagName: 'TD', _rowIdx: r });
    }
    // Footer button at the very end with missing accessible name
    specs.push({
      id: 'pagination-next',
      tagName: 'BUTTON',
      textContent: '',
      _rect: { x: 0, y: 500, width: 32, height: 32, left: 0, right: 32, top: 500, bottom: 532 }
    });

    const { page, builtNodes } = createMockDomEnv(specs, { viewportWidth: 375 });
    const tbodyEl = builtNodes[0];
    let currentTr: any = null;
    for (let i = 1; i < builtNodes.length - 1; i++) {
      const node = builtNodes[i];
      if (node.tagName === 'TR') {
        node.parentElement = tbodyEl;
        currentTr = node;
      } else {
        node.parentElement = currentTr;
      }
    }

    // maxElements = 30 is smaller than total 62 nodes, but after sampling 16 middle rows (48 nodes),
    // only 14 nodes remain — so #pagination-next at the end MUST be reached!
    const a11y = await runAccessibilityForensics(page as any, { maxElements: 30, checkTouchTargets: true });
    expect(a11y).toBeDefined();
    expect(a11y!.coverage.skippedRepetitiveElements).toBe(48);
    expect(a11y!.missingNames.some(m => m.selector === '#pagination-next')).toBe(true);
    expect(a11y!.touchTargetIssues.some(t => t.selector === '#pagination-next')).toBe(true);
  });

  test('Item 1: compactDiagnoseReport groups repetitive issues by normalized selector pattern', () => {
    const rawReport: DiagnoseReport = {
      detail: 'full',
      url: 'http://localhost:3001/admin/product/discount',
      viewport: { width: 1440, height: 900 },
      runtimeHealth: { scope: 'active-tab', consoleErrors: [], failedNetwork: [] },
      layoutForensics: {
        coverage: {
          scope: 'document-light-dom',
          candidateElements: 400,
          visitedElements: 400,
          elementLimitReached: false,
          issueLimitPerCategory: 15,
          categoriesAtLimit: [],
          excluded: ['iframe-documents']
        },
        horizontalOverflow: { hasOverflow: false, scrollWidth: 1440, clientWidth: 1440, culprits: [] },
        clippingTraps: [],
        internalHorizontalScroll: [],
        clippedInViewport: [],
        stackingTraps: [],
        brokenMedia: [],
        fontIssues: [],
        inactiveCss: [
          { selector: 'tbody > tr:nth-of-type(1) > td > span', property: 'gap', value: '8px', reason: 'no flex', sourceFile: 'app/pages/discount.vue' },
          { selector: 'tbody > tr:nth-of-type(2) > td > span', property: 'gap', value: '8px', reason: 'no flex', sourceFile: 'app/pages/discount.vue' },
          { selector: 'tbody > tr:nth-of-type(3) > td > span', property: 'gap', value: '8px', reason: 'no flex', sourceFile: 'app/pages/discount.vue' }
        ]
      },
      accessibility: {
        coverage: {
          scope: 'document-light-dom',
          scannedElements: 300,
          unverifiableContrastCount: 0,
          touchTargetsChecked: false,
          issueLimitPerCategory: 15
        },
        contrastIssues: [
          { selector: 'tbody > tr:nth-of-type(1) > td > div.muted', textSample: 'Rp 10.000', color: 'rgb(150,150,150)', backgroundColor: 'rgb(255,255,255)', ratio: 3.53, requiredRatio: 4.5, fontSize: '12px', fontWeight: '400', sourceFile: 'app/pages/discount.vue' },
          { selector: 'tbody > tr:nth-of-type(2) > td > div.muted', textSample: 'Rp 20.000', color: 'rgb(150,150,150)', backgroundColor: 'rgb(255,255,255)', ratio: 3.53, requiredRatio: 4.5, fontSize: '12px', fontWeight: '400', sourceFile: 'app/pages/discount.vue' }
        ],
        touchTargetIssues: [],
        missingNames: [],
        headingIssues: []
      }
    };

    const compact = compactDiagnoseReport(rawReport) as any;
    expect(compact.detail).toBe('compact');
    expect(compact.layoutForensics.coverage.scope).toBe('document-light-dom');
    expect(compact.layoutForensics.inactiveCss).toHaveLength(1);
    expect(compact.layoutForensics.inactiveCss[0].count).toBe(3);
    expect(compact.layoutForensics.inactiveCss[0].pattern).toBe('tbody > tr:nth-of-type(*) > td > span');
    expect(compact.layoutForensics.inactiveCss[0].sourceFile).toBe('app/pages/discount.vue');
    expect(compact.accessibility.contrastIssues).toHaveLength(1);
    expect(compact.accessibility.contrastIssues[0].count).toBe(2);
    expect(compact.accessibility.contrastIssues[0].ratio).toBe(3.53);
  });

  test('Item 3, 6 & 8: spector_diagnose supports viewport, mobile touchTargetIssues list, current-document scope, and before/after delta', async () => {
    const manager = new CdpSessionManager();
    let contrastCount = 2;
    let currentDocId = 'document-1';
    const seenBreakpoints: string[][] = [];

    const fakePage = {
      url: () => 'http://localhost:3001/cashier',
      viewportSize: () => null,
      isClosed: () => false,
      evaluate: async (script: string) => {
        if (typeof script === 'string' && script.includes('contrastIssues')) {
          return {
            coverage: { scope: 'document-light-dom', scannedElements: 100, unverifiableContrastCount: 0, touchTargetsChecked: true, issueLimitPerCategory: 15 },
            contrastIssues: Array.from({ length: contrastCount }, (_, i) => ({
              selector: `#c-${i}`, textSample: 'txt', color: 'rgb(180,180,180)', backgroundColor: 'rgb(255,255,255)', ratio: 3.1, requiredRatio: 4.5, fontSize: '12px', fontWeight: '400'
            })),
            touchTargetIssues: [
              { selector: '#tiny-btn', tag: 'button', width: 28, height: 28, minRequired: 44 }
            ],
            missingNames: [],
            headingIssues: []
          };
        }
        return {
          coverage: { scope: 'document-light-dom', candidateElements: 100, visitedElements: 100, elementLimitReached: false, issueLimitPerCategory: 15, categoriesAtLimit: [], excluded: [] },
          horizontalOverflow: { hasOverflow: false, scrollWidth: 375, clientWidth: 375, culprits: [] },
          clippingTraps: [],
          internalHorizontalScroll: [],
          clippedInViewport: [],
          stackingTraps: [],
          brokenMedia: [],
          fontIssues: [],
          inactiveCss: []
        };
      }
    } as any;

    manager.ensurePage = async () => fakePage;
    manager.pageUrl = () => 'http://localhost:3001/cashier';
    manager.documentId = () => currentDocId;
    manager.assertTarget = () => {};
    manager.captureMetadata = async () => ({ targetId: manager.targetId(fakePage), documentId: currentDocId, url: 'http://localhost:3001/cashier', viewport: { width: 1440, height: 900 }, capturedAt: '2026-11-27T00:00:00.000Z' } as any);
    manager.runBrowserOperation = (async (fn: () => Promise<unknown>) => fn()) as any;
    manager.withEmulatedMedia = (async (_m, fn) => fn()) as any;
    manager.withBreakpointMetrics = (async (bps, fn) => {
      seenBreakpoints.push(bps);
      const out = [];
      for (const bp of bps) {
        out.push(await fn(bp, { width: bp === 'mobile' ? 375 : 1440, height: 812 }, {} as any));
      }
      return out;
    }) as any;

    const tid = manager.targetId(fakePage);
    manager.telemetry.addConsole('error', 'old-doc-error', undefined, tid, 'document-1');
    manager.telemetry.addConsole('error', 'new-doc-error', undefined, tid, 'document-2');

    let handler!: Function;
    registerDiagnoseTool({ registerTool: (_name: string, _cfg: unknown, fn: Function) => { handler = fn; } } as any, manager);

    // Run 1: baseline recorded, mobile breakpoint returns touchTargetIssues selectors
    currentDocId = 'document-2';
    const res1 = await handler({ breakpoints: ['mobile'], runtimeScope: 'current-document' });
    const parsed1 = JSON.parse(res1.content[0].text);
    expect(parsed1.runtimeHealth.scope).toBe('current-document');
    expect(parsed1.runtimeHealth.consoleErrors).toHaveLength(1);
    expect(parsed1.runtimeHealth.consoleErrors[0].text).toBe('new-doc-error');
    expect(parsed1.viewport).toEqual({ width: 1440, height: 900 });
    expect(parsed1.breakpointAudits[0].touchTargetIssuesCount).toBe(1);
    expect(parsed1.breakpointAudits[0].touchTargetIssues[0].selector).toBe('#tiny-btn');
    expect(parsed1.delta).toBeUndefined();

    // Run 2: contrastIssues drops from 2 -> 0, delta block reports exact diff
    contrastCount = 0;
    const res2 = await handler({ runtimeScope: 'current-document' });
    const parsed2 = JSON.parse(res2.content[0].text);
    expect(parsed2.delta).toBeDefined();
    expect(parsed2.delta.changed).toBe(true);
    expect(parsed2.delta.changes.contrastIssues).toEqual({ before: 2, after: 0, diff: -2 });

    // Run 3: viewport: "mobile" invokes withBreakpointMetrics(['mobile'])
    const res3 = await handler({ viewport: 'mobile' });
    const parsed3 = JSON.parse(res3.content[0].text);
    expect(parsed3.viewport).toEqual({ width: 375, height: 812 });
    expect(seenBreakpoints[seenBreakpoints.length - 1]).toEqual(['mobile']);
  });

  test('Item 6: TelemetryStore.clearForTarget clears only the navigated tab logs', () => {
    const manager = new CdpSessionManager();
    manager.telemetry.addConsole('error', 'tab1-err', undefined, 'target-1', 'document-1');
    manager.telemetry.addConsole('error', 'tab2-err', undefined, 'target-2', 'document-2');
    manager.telemetry.addFailedNetwork({ method: 'GET', url: 'http://localhost:3001/api/fail', resourceType: 'fetch', status: 500, targetId: 'target-1', documentId: 'document-1' });

    manager.telemetry.clearForTarget('target-1');
    expect(manager.telemetry.getConsoleLogs('error', false, 50, 'target-1')).toHaveLength(0);
    expect(manager.telemetry.getFailedNetworkLogs(false, 25, undefined, 'target-1')).toHaveLength(0);
    expect(manager.telemetry.getConsoleLogs('error', false, 50, 'target-2')).toHaveLength(1);
  });

  test('Item 7: spector_capture_screenshot forwards hideDevtoolsOverlays & hideSelectors to withHiddenSelectors', async () => {
    const manager = new CdpSessionManager();
    let hiddenArg: string[] | undefined;
    const fakePage = { url: () => 'http://localhost:3001/admin' } as any;

    manager.ensurePage = async () => fakePage;
    manager.pageUrl = () => 'http://localhost:3001/admin';
    manager.assertTarget = () => {};
    manager.captureMetadata = async () => ({ url: 'http://localhost:3001/admin' } as any);
    manager.captureScreenshotBuffer = async () => Buffer.from('fake-png');
    manager.runBrowserOperation = (async (fn: () => Promise<unknown>) => fn()) as any;
    manager.withEmulatedMedia = (async (_m, fn) => fn()) as any;
    manager.withHiddenSelectors = (async (sels, fn) => {
      hiddenArg = sels;
      return await fn();
    }) as any;

    let handler!: Function;
    registerInspectTools({ registerTool: (_name: string, _cfg: unknown, fn: Function) => { handler = fn; } } as any, manager);

    const res = await handler({ hideDevtoolsOverlays: true, hideSelectors: ['.custom-toast'] });
    expect(res.isError).not.toBe(true);
    expect(hiddenArg).toBeDefined();
    expect(hiddenArg).toContain('#nuxt-devtools-container');
    expect(hiddenArg).toContain('.custom-toast');
    expect(hiddenArg!.length).toBe(DEVTOOLS_OVERLAY_SELECTORS.length + 1);
  });

  test('Item 8: DiagnoseBaselineStore enforces bounded FIFO eviction', () => {
    const store = new DiagnoseBaselineStore();
    const counts = summarizeDiagnoseReport({
      url: 'http://localhost:3001/',
      viewport: null,
      runtimeHealth: { consoleErrors: [], failedNetwork: [] },
      layoutForensics: {
        horizontalOverflow: { hasOverflow: false, scrollWidth: 100, clientWidth: 100, culprits: [] },
        clippingTraps: [],
        stackingTraps: [],
        brokenMedia: [],
        fontIssues: [],
        inactiveCss: []
      }
    });
    for (let i = 0; i < 55; i++) {
      store.record(`key-${i}`, counts, '2026-11-27T00:00:00.000Z');
    }
    expect(store.diffAgainstPrevious('key-0', counts)).toBeUndefined();
    expect(store.diffAgainstPrevious('key-54', counts)).toBeDefined();
  });
});
