import { describe, expect, test } from 'bun:test';
import vm from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runAccessibilityForensics } from '../../src/analyzers/accessibility-forensics.js';
import { runTokenAudit } from '../../src/analyzers/token-audit.js';
import { createSpectorServer } from '../../src/index.js';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { registerInspectTools } from '../../src/tools/inspect.js';

function createMockDomEnv(nodes: any[], options?: { viewportWidth?: number; styleSheets?: any[]; rootMap?: Record<string, any> }) {
  class ElementMock {
    nodeType = 1;
    tagName = 'DIV';
    id = '';
    parentElement: any = null;
    childNodes: any[] = [];
    textContent = '';
    _attrs: Record<string, string> = {};
    _cs: Record<string, string> = {};
    _rect = { x: 0, y: 0, width: 120, height: 48, left: 0, right: 120 };
    _descendants: any[] = [];
    getBoundingClientRect() { return this._rect; }
    getAttribute(name: string) { return name in this._attrs ? this._attrs[name] : null; }
    closest() { return null; }
    querySelectorAll() { return this._descendants; }
  }
  class HTMLElementMock extends ElementMock {}

  const bodyEl: any = new HTMLElementMock();
  bodyEl.tagName = 'BODY';
  bodyEl._cs = { display: 'block', visibility: 'visible', backgroundColor: 'rgb(255, 255, 255)', opacity: '1', backgroundImage: 'none' };

  const htmlEl: any = new HTMLElementMock();
  htmlEl.tagName = 'HTML';
  htmlEl._cs = {
    display: 'block',
    visibility: 'visible',
    backgroundColor: 'rgb(255, 255, 255)',
    opacity: '1',
    backgroundImage: 'none',
    getPropertyValue: (prop: string) => ({ '--primary': '#2563eb', '--radius': '8px' }[prop] ?? '')
  };
  bodyEl.parentElement = htmlEl;

  const builtNodes = nodes.map(spec => {
    const el: any = new HTMLElementMock();
    Object.assign(el, spec);
    if (!el.parentElement) el.parentElement = bodyEl;
    return el;
  });

  const vw = options?.viewportWidth ?? 375;
  const page = {
    evaluate: async (fnOrExpr: Function | string) =>
      vm.runInContext(
        typeof fnOrExpr === 'string' ? fnOrExpr : `(${fnOrExpr.toString()})()`,
        vm.createContext({
          URL,
          CSS: { escape: (s: string) => s },
          HTMLElement: HTMLElementMock,
          document: {
            documentElement: Object.assign(htmlEl, { clientWidth: vw, scrollWidth: vw }),
            body: bodyEl,
            styleSheets: options?.styleSheets ?? [],
            querySelector: (sel: string) => {
              if (options?.rootMap && sel in options.rootMap) return options.rootMap[sel];
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
            getComputedStyle: (el: any) => el._cs
          }
        })
      )
  };

  return { page, builtNodes, bodyEl, HTMLElementMock };
}

describe('Wave 2 Forensics & Capture Upgrades', () => {
  test('runAccessibilityForensics detects WCAG AA contrast, mobile touch targets, missing names, and heading skips while skipping hidden ancestors', async () => {
    const { page } = createMockDomEnv([
      {
        id: 'low-contrast',
        tagName: 'P',
        childNodes: [{ nodeType: 3, textContent: 'Muted helper text' }],
        _cs: {
          display: 'block',
          visibility: 'visible',
          color: 'rgb(180 180 180 / 1)',
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          opacity: '1',
          fontSize: '14px',
          fontWeight: '400'
        }
      },
      {
        id: 'gradient-text',
        tagName: 'P',
        childNodes: [{ nodeType: 3, textContent: 'Over gradient' }],
        _cs: {
          display: 'block',
          visibility: 'visible',
          color: 'rgb(200, 200, 200)',
          backgroundColor: 'transparent',
          backgroundImage: 'linear-gradient(to right, #000, #fff)',
          opacity: '1',
          fontSize: '14px',
          fontWeight: '400'
        }
      },
      {
        id: 'tiny-icon-btn',
        tagName: 'BUTTON',
        textContent: '',
        _rect: { x: 0, y: 0, width: 28, height: 28, left: 0, right: 28 },
        _cs: { display: 'inline-flex', visibility: 'visible', backgroundColor: 'transparent', backgroundImage: 'none', opacity: '1' }
      },
      {
        id: 'title-h1',
        tagName: 'H1',
        childNodes: [{ nodeType: 3, textContent: 'Dashboard' }],
        _cs: { display: 'block', visibility: 'visible', color: 'rgb(15, 23, 42)', backgroundColor: 'transparent', backgroundImage: 'none', opacity: '1', fontSize: '28px', fontWeight: '700' }
      },
      {
        id: 'skipped-h3',
        tagName: 'H3',
        childNodes: [{ nodeType: 3, textContent: 'Section' }],
        _cs: { display: 'block', visibility: 'visible', color: 'rgb(15, 23, 42)', backgroundColor: 'transparent', backgroundImage: 'none', opacity: '1', fontSize: '18px', fontWeight: '600' }
      },
      {
        id: 'hidden-node',
        tagName: 'BUTTON',
        textContent: '',
        _rect: { x: 0, y: 0, width: 12, height: 12, left: 0, right: 12 },
        _cs: { display: 'none', visibility: 'visible' }
      }
    ], { viewportWidth: 375 });

    const report = await runAccessibilityForensics(page as any);
    expect(report).toBeDefined();
    expect(report!.coverage.touchTargetsChecked).toBe(true);
    expect(report!.coverage.unverifiableContrastCount).toBe(1);
    expect(report!.coverage.skippedHiddenElements).toBe(1);

    expect(report!.contrastIssues).toHaveLength(1);
    expect(report!.contrastIssues[0].selector).toBe('#low-contrast');
    expect(report!.contrastIssues[0].requiredRatio).toBe(4.5);

    expect(report!.touchTargetIssues).toHaveLength(1);
    expect(report!.touchTargetIssues[0].selector).toBe('#tiny-icon-btn');
    expect(report!.touchTargetIssues[0].width).toBe(28);

    expect(report!.missingNames).toHaveLength(1);
    expect(report!.missingNames[0].selector).toBe('#tiny-icon-btn');

    expect(report!.headingIssues).toHaveLength(1);
    expect(report!.headingIssues[0].issue).toBe('skipped-level');
  });

  test('runTokenAudit aggregates design tokens, :root CSS variables, and quantitative slopSignals', async () => {
    const radii = ['2px', '4px', '6px', '8px', '12px', '16px'];
    const nodes = radii.map((r, i) => ({
      id: `card-${i}`,
      tagName: 'DIV',
      _cs: {
        display: 'block',
        visibility: 'visible',
        fontFamily: 'Inter, sans-serif',
        fontSize: i % 2 === 0 ? '14px' : '16px',
        fontWeight: '400',
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(15, 23, 42)',
        borderTopWidth: '1px',
        borderTopColor: 'rgb(226, 232, 240)',
        borderRadius: r,
        padding: '16px',
        gap: '12px'
      }
    }));

    const { page } = createMockDomEnv(nodes, {
      styleSheets: [
        {
          cssRules: [
            {
              selectorText: ':root',
              style: Object.assign(['--primary', '--radius'], { length: 2 })
            }
          ]
        }
      ]
    });

    const tokens = await runTokenAudit(page as any);
    expect(tokens).toBeDefined();
    expect(tokens!.coverage.scannedElements).toBe(6);
    expect(tokens!.typography.uniqueFontFamilies).toEqual(['Inter, sans-serif']);
    expect(tokens!.radii).toHaveLength(6);
    expect(tokens!.cssVariables).toEqual({ '--primary': '#2563eb', '--radius': '8px' });
    expect(tokens!.slopSignals.some(s => s.includes('border-radius fragmentation'))).toBe(true);
  });

  test('spector_picker action:"snapshot" validates selector and registers a verifiable baseline over MCP', async () => {
    const manager = new CdpSessionManager();
    manager.snapshotSelector = async ({ selector, role, note }) => {
      const pin = {
        id: 'pin-snap-1',
        role: role ?? 'single',
        pinMode: 'element' as const,
        selector,
        ...(note ? { note } : {}),
        status: 'selected' as const,
        rect: { x: 0, y: 0, width: 200, height: 40 },
        computedStyles: { padding: '8px 16px' }
      };
      manager.pins.add(pin);
      return { pin };
    };

    const server = createSpectorServer(manager);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'wave2-snapshot-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const missingRes = await client.callTool({ name: 'spector_picker', arguments: { action: 'snapshot' } });
      expect(missingRes.isError).toBe(true);
      expect((missingRes.content as Array<{ text: string }>)[0].text).toContain('INVALID_TOOL_INPUT');

      const snapRes = await client.callTool({
        name: 'spector_picker',
        arguments: { action: 'snapshot', selector: '#cta-btn', note: 'baseline' }
      });
      expect(snapRes.isError).not.toBe(true);
      const parsed = JSON.parse((snapRes.content as Array<{ text: string }>)[0].text);
      expect(parsed.id).toBe('pin-snap-1');
      expect(parsed.selector).toBe('#cta-btn');
      expect(manager.pins.findForVerify('pin-snap-1')?.selector).toBe('#cta-btn');
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('spector_capture_screenshot supports batch colorSchemes:["light","dark"] across breakpoints', async () => {
    const manager = new CdpSessionManager();
    const seenSchemes: Array<string | undefined> = [];
    const fakePage = {
      url: () => 'http://localhost:3000/',
      evaluate: async () => ({ scrollWidth: 375, clientWidth: 375, hasOverflow: false })
    } as any;

    manager.ensurePage = async () => fakePage;
    manager.pageUrl = () => 'http://localhost:3000/';
    manager.assertTarget = () => {};
    manager.captureMetadata = async () => ({ url: 'http://localhost:3000/' } as any);
    manager.captureScreenshotBuffer = async () => Buffer.from('fake-png');
    manager.runBrowserOperation = (async (fn: () => Promise<unknown>) => fn()) as any;
    manager.withEmulatedMedia = (async (media, fn) => {
      seenSchemes.push(media?.colorScheme);
      return await fn();
    }) as any;
    manager.withBreakpointMetrics = (async (bps, fn) => {
      const out = [];
      for (const bp of bps) {
        out.push(await fn(bp, { width: bp === 'mobile' ? 375 : 1440, height: 812 }, {} as any));
      }
      return out;
    }) as any;

    let handler!: Function;
    registerInspectTools({ registerTool: (_name: string, _cfg: unknown, fn: Function) => { handler = fn; } } as any, manager);

    const res = await handler({ breakpoints: ['mobile', 'desktop'], colorSchemes: ['light', 'dark'] });
    expect(res.isError).not.toBe(true);
    expect(seenSchemes).toEqual(['light', 'dark']);
    const images = res.content.filter((c: any) => c.type === 'image');
    expect(images).toHaveLength(4);
    expect(res.content[0].text).toContain('Multi-theme & multi-breakpoint');
    expect(res.content[0].text).toContain('[light] mobile');
    expect(res.content[0].text).toContain('[dark] desktop');
  });
});
