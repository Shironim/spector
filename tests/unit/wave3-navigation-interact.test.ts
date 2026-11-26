import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSpectorServer } from '../../src/index.js';
import { CdpSessionManager, validateNavigationUrl } from '../../src/browser/cdp-session.js';
import { SpectorError } from '../../src/utils/mcp-response.js';

describe('Wave 3 Read-Safe Navigation & Minimal Interaction', () => {
  test('validateNavigationUrl allows local dev hosts, relative paths, and same-origin routes while blocking external origins & dangerous protocols', () => {
    expect(validateNavigationUrl('http://localhost:3001/admin/product')).toBe('http://localhost:3001/admin/product');
    expect(validateNavigationUrl('http://127.0.0.1:8080/health')).toBe('http://127.0.0.1:8080/health');
    expect(validateNavigationUrl('https://pos.test/orders')).toBe('https://pos.test/orders');
    expect(validateNavigationUrl('/admin/product?page=2', 'http://localhost:3001/admin')).toBe('http://localhost:3001/admin/product?page=2');
    expect(validateNavigationUrl('https://staging.example.com/orders', 'https://staging.example.com/dashboard')).toBe('https://staging.example.com/orders');

    expect(() => validateNavigationUrl('https://evil.example.com/', 'http://localhost:3001/admin')).toThrow(/blocked/i);
    expect(() => validateNavigationUrl('javascript:alert(1)', 'http://localhost:3001/admin')).toThrow(/not allowed/i);
    expect(() => validateNavigationUrl('file:///etc/passwd', 'http://localhost:3001/admin')).toThrow(/not allowed/i);
    expect(() => validateNavigationUrl('chrome://settings', 'http://localhost:3001/admin')).toThrow(/not allowed/i);
    expect(() => validateNavigationUrl('   ', 'http://localhost:3001/admin')).toThrow(/required/i);
  });

  test('spector_tabs supports action:"navigate" and action:"reload" over MCP with origin enforcement', async () => {
    const manager = new CdpSessionManager();
    let currentUrl = 'http://localhost:3001/admin';
    const actions: string[] = [];

    const fakePage = {
      isClosed: () => false,
      url: () => currentUrl,
      title: async () => 'POS Admin',
      viewportSize: () => ({ width: 1440, height: 900 }),
      goto: async (url: string) => {
        actions.push(`goto:${url}`);
        currentUrl = url;
      },
      reload: async () => {
        actions.push('reload');
      },
      on: () => {},
      off: () => {}
    } as any;

    (manager as any).page = fakePage;
    manager.ensurePage = async () => fakePage;
    manager.pageUrl = () => currentUrl;
    (manager as any).setupPageListeners = async () => {};
    (manager as any).resolvePageInfo = async () => ({ title: 'POS Admin', url: currentUrl });

    const server = createSpectorServer(manager);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'wave3-tabs-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const navRes = await client.callTool({
        name: 'spector_tabs',
        arguments: { action: 'navigate', url: '/admin/product', waitUntil: 'networkidle' }
      });
      expect(navRes.isError).not.toBe(true);
      const navBody = JSON.parse((navRes.content as Array<{ text: string }>)[0].text);
      expect(navBody.status).toBe('navigated');
      expect(navBody.activeTab.url).toBe('http://localhost:3001/admin/product');

      const reloadRes = await client.callTool({
        name: 'spector_tabs',
        arguments: { action: 'reload' }
      });
      expect(reloadRes.isError).not.toBe(true);
      expect(JSON.parse((reloadRes.content as Array<{ text: string }>)[0].text).status).toBe('reloaded');

      const deniedRes = await client.callTool({
        name: 'spector_tabs',
        arguments: { action: 'navigate', url: 'https://external-untrusted.example/' }
      });
      expect(deniedRes.isError).toBe(true);
      expect((deniedRes.content as Array<{ text: string }>)[0].text).toContain('NAVIGATION_DENIED');

      expect(actions).toEqual(['goto:http://localhost:3001/admin/product', 'reload']);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('spector_interact handles click, hover, scrollTo, expectedUrl guard, and input validation over MCP', async () => {
    const manager = new CdpSessionManager();
    const calls: string[] = [];
    let scrollY = 0;

    const fakePage = {
      isClosed: () => false,
      url: () => 'http://localhost:3001/admin',
      locator: (sel: string) => ({
        first: () => ({
          click: async () => { calls.push(`click:${sel}`); },
          hover: async () => { calls.push(`hover:${sel}`); }
        })
      }),
      evaluate: async (_fn: Function, arg?: unknown) => {
        if (typeof arg === 'number') {
          scrollY = arg;
          calls.push(`scrollY:${arg}`);
          return undefined;
        }
        if (typeof arg === 'string') {
          calls.push(`scrollIntoView:${arg}`);
          return arg !== '#missing';
        }
        return { scrollY, activeElementTag: 'button' };
      }
    } as any;

    (manager as any).page = fakePage;
    manager.ensurePage = async () => fakePage;
    manager.pageUrl = () => 'http://localhost:3001/admin';
    manager.assertTarget = (_page, expectedUrl) => {
      if (expectedUrl !== 'http://localhost:3001/admin') {
        throw new SpectorError('TARGET_CHANGED', 'URL mismatch');
      }
    };
    manager.runBrowserOperation = (async (fn: () => Promise<unknown>) => fn()) as any;

    const server = createSpectorServer(manager);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'wave3-interact-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const clickRes = await client.callTool({
        name: 'spector_interact',
        arguments: { action: 'click', selector: '.w-[200px]', waitAfterMs: 0 }
      });
      expect(clickRes.isError).not.toBe(true);
      expect(JSON.parse((clickRes.content as Array<{ text: string }>)[0].text).status).toBe('ok');

      const hoverRes = await client.callTool({
        name: 'spector_interact',
        arguments: { action: 'hover', selector: '#menu-trigger', waitAfterMs: 0 }
      });
      expect(hoverRes.isError).not.toBe(true);

      const scrollRes = await client.callTool({
        name: 'spector_interact',
        arguments: { action: 'scrollTo', y: 420, waitAfterMs: 0 }
      });
      expect(scrollRes.isError).not.toBe(true);
      expect(JSON.parse((scrollRes.content as Array<{ text: string }>)[0].text).scrollY).toBe(420);

      const missingTargetRes = await client.callTool({
        name: 'spector_interact',
        arguments: { action: 'scrollTo', selector: '#missing', waitAfterMs: 0 }
      });
      expect(missingTargetRes.isError).toBe(true);
      expect((missingTargetRes.content as Array<{ text: string }>)[0].text).toContain('ELEMENT_NOT_READY');

      const wrongUrlRes = await client.callTool({
        name: 'spector_interact',
        arguments: { action: 'click', selector: '#btn', expectedUrl: 'http://localhost:3001/other', waitAfterMs: 0 }
      });
      expect(wrongUrlRes.isError).toBe(true);
      expect((wrongUrlRes.content as Array<{ text: string }>)[0].text).toContain('TARGET_CHANGED');

      const invalidRes = await client.callTool({
        name: 'spector_interact',
        arguments: { action: 'click' }
      });
      expect(invalidRes.isError).toBe(true);
      expect((invalidRes.content as Array<{ text: string }>)[0].text).toContain('INVALID_TOOL_INPUT');

      expect(calls).toEqual([
        'click:.w-\\[200px\\]',
        'hover:#menu-trigger',
        'scrollY:420',
        'scrollIntoView:#missing'
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
