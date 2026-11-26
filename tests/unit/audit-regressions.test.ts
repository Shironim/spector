import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { extractCompressedDom } from '../../src/analyzers/dom-compressor.js';
import { escapeTailwindSelector } from '../../src/utils/selector.js';
import { sanitizeArgs } from '../../src/utils/tool-instrument.js';

function pageStub(initialUrl = 'https://fixture.invalid/') {
  const handlers = new Map<string, Function[]>();
  let currentUrl = initialUrl;
  return {
    handlers,
    isClosed: () => false,
    url: () => currentUrl,
    title: async () => 'fixture',
    async goto(url: string) {
      currentUrl = url;
      for (const handler of handlers.get('framenavigated') || []) handler({});
    },
    async reload() {
      for (const handler of handlers.get('framenavigated') || []) handler({});
    },
    on(event: string, handler: Function) {
      handlers.set(event, [...(handlers.get(event) || []), handler]);
    },
    off(event: string, handler: Function) {
      handlers.set(
        event,
        (handlers.get(event) || []).filter(h => h !== handler)
      );
    },
    async exposeFunction(name: string, handler: Function) {
      handlers.set(name, [handler]);
    },
    async addInitScript() {},
    async evaluate() {
      return '';
    },
    locator: () => ({
      first: () => ({ screenshot: async () => Buffer.from('fixture') })
    })
  };
}

describe('Spector v2 Security & Reliability Invariants', () => {
  // F02: Credential protection + Gap 2 full class preservation + no loc="..."
  it('F02 & Gap 2: masks password values, preserves ordinary field values, keeps >3 Tailwind classes, and omits loc="..."', async () => {
    class Element {}
    class HTMLElement extends Element {
      tagName = 'INPUT';
      id = '';
      className = 'flex items-center px-4 py-2 rounded-lg bg-slate-900 text-white border';
      childNodes: any[] = [];
      children: any[] = [];
      parentElement = null;
      disabled = false;
      checked = false;
      type = 'password';
      value = 'DUMMY_PASSWORD';
      getAttribute(name: string) {
        if (name === 'type') return this.type;
        if (name === 'class') return this.className;
        return null;
      }
      hasAttribute() {
        return false;
      }
      getBoundingClientRect() {
        return { x: 0, y: 0, width: 100, height: 20, left: 0, top: 0, right: 100, bottom: 20 };
      }
    }
    class HTMLInputElement extends HTMLElement {}
    class HTMLTextAreaElement extends HTMLElement {}
    class HTMLSelectElement extends HTMLElement {}

    const input = new HTMLInputElement();
    const page = {
      evaluate: async (fnOrExpr: Function | string, args?: any) =>
        vm.runInContext(
          typeof fnOrExpr === 'string' ? fnOrExpr : `(${fnOrExpr.toString()})(args)`,
          vm.createContext({
            args,
            Element,
            HTMLElement,
            HTMLInputElement,
            HTMLTextAreaElement,
            HTMLSelectElement,
            SVGElement: class extends Element {},
            Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
            document: { body: input, querySelector: () => input },
            window: {
              innerWidth: 800,
              innerHeight: 600,
              getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
            }
          })
        )
    };

    const passwordTree = await extractCompressedDom(page as any);
    assert.doesNotMatch(passwordTree, /DUMMY_PASSWORD/);
    assert.doesNotMatch(passwordTree, /\bloc="/);
    // Preserves classes beyond the old 3-class limit
    assert.match(passwordTree, /\.bg-slate-900/);
    assert.match(passwordTree, /\.text-white/);
    assert.match(passwordTree, /\.border/);

    input.type = 'text';
    input.value = 'ordinary-value';
    assert.match(await extractCompressedDom(page as any), /ordinary-value/);
  });

  // F03 & F08: Failed network (>=400 pathname-only) + monotonic unique IDs + sibling preservation
  it('F03 & F08: drops 2xx traffic, records only >=400/failed pathname-only without secrets, and assigns unique IDs', async () => {
    const manager: any = new CdpSessionManager();
    const page = pageStub();
    manager.setupPageListeners(page);

    const originalNow = Date.now;
    Date.now = () => 12345;
    try {
      const okReq = {
        method: () => 'GET',
        url: () => 'https://fixture.invalid/api/ok?token=QUERY_SECRET',
        resourceType: () => 'fetch'
      };
      await page.handlers.get('request')![0](okReq);
      await page.handlers.get('response')![0]({
        request: () => okReq,
        status: () => 200,
        statusText: () => 'OK'
      });

      for (const url of [
        'https://fixture.invalid/api/a?token=QUERY_SECRET',
        'https://fixture.invalid/api/b?password=SECRET_2'
      ]) {
        const req = { method: () => 'POST', url: () => url, resourceType: () => 'fetch' };
        await page.handlers.get('request')![0](req);
        await page.handlers.get('response')![0]({
          request: () => req,
          status: () => 422,
          statusText: () => 'Unprocessable Entity'
        });
      }
    } finally {
      Date.now = originalNow;
    }

    const allFailed = manager.telemetry.getFailedNetworkLogs(false);
    assert.equal(allFailed.length, 2);
    assert.notEqual(allFailed[0].id, allFailed[1].id);
    assert.equal(allFailed[0].pathname, '/api/a');
    assert.equal(allFailed[1].pathname, '/api/b');
    assert.doesNotMatch(JSON.stringify(allFailed), /QUERY_SECRET|SECRET_2|token|password/);

    // Filtered read clears only matched entry and preserves sibling
    const firstOnly = manager.telemetry.getFailedNetworkLogs(true, 25, '/api/a');
    assert.equal(firstOnly.length, 1);
    assert.equal(firstOnly[0].pathname, '/api/a');

    const remaining = manager.telemetry.getFailedNetworkLogs(false);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].pathname, '/api/b');
  });

  // F06: Tailwind & pseudo-class selector compatibility
  it('F06: preserves pseudo-class selectors and escapes supported Tailwind classes', () => {
    assert.equal(escapeTailwindSelector('.item:nth-of-type(2)'), '.item:nth-of-type(2)');
    assert.equal(escapeTailwindSelector('.btn:hover'), '.btn:hover');
    assert.equal(escapeTailwindSelector('.btn:focus-visible'), '.btn:focus-visible');
    assert.equal(escapeTailwindSelector('.hover:bg-blue-500'), '.hover\\:bg-blue-500');
    assert.equal(escapeTailwindSelector('.w-[200px]'), '.w-\\[200px\\]');
  });

  // F07: Listener lifecycle & physical Chrome survival
  it('F07: removes telemetry listeners and disconnects CDP client without closing Chrome', async () => {
    const manager: any = new CdpSessionManager();
    const page = pageStub();
    manager.setupPageListeners(page);
    manager.setupPageListeners(page);
    assert.equal(page.handlers.get('console')!.length, 1);

    let disconnected = false;
    manager.browser = {
      isConnected: () => true,
      close: async () => {
        disconnected = true;
      }
    };
    manager.page = page;
    await manager.disconnect();

    await page.handlers.get('console')![0]?.({
      type: () => 'error',
      text: () => 'stale',
      location: () => ({})
    });
    assert.equal(disconnected, true);
    assert.equal(manager.telemetry.getConsoleLogs('all', false).length, 0);
    assert.equal(page.handlers.get('console')!.length, 0);
  });

  it('F07: starts telemetry when navigation leaves a Chrome internal page', async () => {
    const manager: any = new CdpSessionManager();
    const page = pageStub('chrome://new-tab-page/');
    manager.page = page;
    manager.ensurePage = async () => page;
    manager.setupPageListeners(page);

    assert.equal(page.handlers.has('console'), false);
    await page.goto('https://fixture.invalid/');
    assert.equal(page.handlers.get('console')!.length, 1);
    assert.equal(page.handlers.get('request')!.length, 1);

    await page.reload();
    assert.equal(page.handlers.get('console')!.length, 1);
    page.handlers.get('console')![0]({
      type: () => 'log',
      text: () => 'after-navigation',
      location: () => ({})
    });
    assert.match(manager.telemetry.getConsoleLogs('all', false)[0].text, /after-navigation/);

    await manager.disconnect();
    assert.equal(page.handlers.get('framenavigated')!.length, 0);
  });

  // F08: Telemetry argument sanitization preserves key
  it('F08: redacts sensitive telemetry arguments while preserving keyboard key', () => {
    const clean = sanitizeArgs({ key: 'Escape', password: 'pw', authHeader: 'Bearer abc' });
    assert.equal(clean.key, 'Escape');
    assert.equal(clean.password, '[REDACTED]');
    assert.equal(clean.authHeader, '[REDACTED]');
  });

  // F03 console location query stripping
  it('F03: strips query secrets from console error locations', () => {
    const manager = new CdpSessionManager();
    manager.telemetry.addConsole('error', 'Failed to load resource', 'http://localhost:3000/img.png?secret=IMG_SECRET:0');
    const logs = manager.telemetry.getConsoleLogs('error', false);
    assert.equal(logs[0].location, 'http://localhost:3000/img.png:0');
    assert.doesNotMatch(JSON.stringify(logs), /IMG_SECRET/);
  });
});
