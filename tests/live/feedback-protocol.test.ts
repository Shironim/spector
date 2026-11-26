import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSpectorServer } from '../../src/index.js';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { coreToolNames } from '../tool-contract.js';

let browser: Browser;
let client: Client;
const manager = new CdpSessionManager();
let endpoint: string;
beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.SPECTOR_TEST_CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-automation', '--remote-debugging-port=0'] });
  const session = await browser.newBrowserCDPSession();
  const { arguments: args } = await session.send('Browser.getBrowserCommandLine');
  const profile = args.find(arg => arg.startsWith('--user-data-dir='))!.split('=')[1];
  const port = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0];
  endpoint = `http://127.0.0.1:${port}`;
  await session.detach();
  const server = createSpectorServer(manager);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'feedback-regression', version: '1' });
  await client.connect(clientTransport);
  await client.callTool({ name: 'spector_attach', arguments: { cdpUrl: endpoint, autoLaunch: false } });
});
afterAll(async () => { await client?.close(); await manager.disconnect(); await browser?.close(); });

test('actual CDP new tabs, popup, reattach and target closure preserve explicit selection', async () => {
  const a = await manager.ensurePage();
  await a.setContent('<a href="about:blank" target="_blank">Open</a>');
  const b = await manager.context!.newPage();
  expect(await manager.ensurePage()).toBe(a);
  const popupEvent = a.waitForEvent('popup'); await a.locator('a').click(); const popup = await popupEvent;
  expect(await manager.ensurePage()).toBe(a);
  await client.callTool({ name: 'spector_attach', arguments: { cdpUrl: endpoint, autoLaunch: false } });
  expect(await manager.ensurePage()).toBe(a);
  await a.close();
  const failed = await client.callTool({ name: 'spector_capture_screenshot', arguments: {} });
  expect(failed.isError).toBe(true); expect(JSON.stringify(failed.content)).toContain('TARGET_CHANGED');
  await client.callTool({ name: 'spector_tabs', arguments: { action: 'select', index: 0 } });
  expect(await manager.ensurePage()).toBe(b); await popup.close();
});

test('MCP returns partial responsive captures and metadata', async () => {
  const page = await manager.ensurePage();
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:white}.mobile{display:none}@media(max-width:500px){.mobile{display:block}}</style><button class="mobile">Mobile CTA</button>');
  const result = await client.callTool({ name: 'spector_capture_screenshot', arguments: { selector: '.mobile', breakpoints: ['desktop', 'mobile'] } });
  expect(result.isError).not.toBe(true);
  const content = result.content as Array<{ type: string; text?: string; data?: string }>;
  const summary = content.find(item => item.type === 'text')!.text!;
  expect(summary).toContain('partial'); expect(summary).toContain('ELEMENT_NOT_READY'); expect(summary).toContain(manager.targetId(page));
  expect(content.filter(item => item.type === 'image')).toHaveLength(1);
}, 15000);

test('failed diagnosis does not drain telemetry and reports its session-wide scope', async () => {
  manager.telemetry.addConsole('error', 'keep-on-failure');
  const failed = await client.callTool({ name: 'spector_diagnose', arguments: { selector: '#missing', clearLogs: true } });
  expect(failed.isError).toBe(true);
  expect(manager.telemetry.getConsoleLogs('error', false).some(log => log.text === 'keep-on-failure')).toBe(true);
  const result = await client.callTool({ name: 'spector_diagnose', arguments: { clearLogs: false, runtimeScope: 'browser-session' } });
  const report = JSON.parse((result.content as Array<{ text: string }>)[0].text);
  expect(report.runtimeHealth.scope).toBe('browser-session');
  expect(report.layoutForensics.coverage.scope).toBe('document-light-dom');
  expect(report.runtimeHealth.consoleErrors.some((log: { text: string }) => log.text === 'keep-on-failure')).toBe(true);
});

test('point-then-annotate picker, stale detection, and before/after verify work end-to-end', async () => {
  const page = await manager.ensurePage();
  await page.setContent('<style>button{padding:15px;background:black;color:white}button:hover{background:red}</style><button id="target">Human control</button>');
  const pending = client.callTool({ name: 'spector_picker', arguments: { action: 'pick', timeoutMs: 5000, includeScreenshot: false } });
  await page.locator('[data-spector-picker="toolbar"]').waitFor({ state: 'attached', timeout: 2000 });
  await page.locator('#target').click();
  await page.locator('[data-spector-picker="popover"] input').waitFor({ state: 'visible', timeout: 2000 });
  await page.keyboard.type('increase padding');
  await page.keyboard.press('Enter');

  const picked = JSON.parse(((await pending).content as Array<{ text: string }>)[0].text);
  expect(picked.documentId).toBeTruthy(); expect(picked.elementId).toBeTruthy();
  expect(picked.note).toBe('increase padding');
  expect(picked.sections.dom.status).toBe('captured'); expect(picked.sections.screenshot.status).toBe('not_requested');

  const fresh = await client.callTool({ name: 'spector_picker', arguments: { action: 'get', includeHoverState: true } });
  expect(JSON.parse((fresh.content as Array<{ text: string }>)[0].text).enrichment.hover.status).toBe('captured');

  // Mutate style and verify Before vs After delta
  await page.locator('#target').evaluate(el => { (el as HTMLElement).style.padding = '24px'; });
  const verified = await client.callTool({ name: 'spector_picker', arguments: { action: 'verify', includeScreenshot: false } });
  const verifyReport = JSON.parse((verified.content as Array<{ text: string }>)[0].text);
  expect(verifyReport.status).toBe('verified');
  expect(verifyReport.changed).toBe(true);
  expect(verifyReport.styleChanges.padding?.after).toBe('24px');

  // Replacing element marks hover enrichment stale
  await page.locator('#target').evaluate(el => { el.outerHTML = '<button id="target">Human control</button>'; });
  const stale = await client.callTool({ name: 'spector_picker', arguments: { action: 'get', includeHoverState: true } });
  const result = JSON.parse((stale.content as Array<{ text: string }>)[0].text);
  expect(result.enrichment.hover.status).toBe('stale'); expect(result.hoverState).toBeUndefined();
}, 15000);

test('over-budget cached images preserve pins and metadata-only recovery works', async () => {
  manager.clearPins();
  const image = 'A'.repeat(8 * 1024 * 1024);
  manager.addPin({ status: 'selected', role: 'pin', note: 'first', screenshotBase64: image });
  manager.addPin({ status: 'selected', role: 'pin', note: 'second', screenshotBase64: image });
  const failed = await client.callTool({ name: 'spector_picker', arguments: { action: 'get', clearAfterRead: true } });
  expect(failed.isError).toBe(true); expect(JSON.stringify(failed.content)).toContain('RESOURCE_LIMIT_EXCEEDED');
  expect(manager.pins.getPins()!.pins).toHaveLength(2);
  const recovered = await client.callTool({ name: 'spector_picker', arguments: { action: 'get', includeScreenshot: false, clearAfterRead: true } });
  expect(recovered.isError).not.toBe(true);
  const content = recovered.content as Array<{ type: string; text?: string }>;
  expect(content.every(item => item.type === 'text')).toBe(true);
  expect(JSON.parse(content[0].text!).pins.map((pin: { note: string }) => pin.note)).toEqual(['first', 'second']);
  expect(manager.pins.isEmpty()).toBe(true);
});

test('built artifact exposes the 5 core tools and performs responsive captures through MCP', async () => {
  const { createSpectorServer: createBuiltServer } = await import('../../dist/index.js');
  for (const createServer of [createSpectorServer, createBuiltServer]) {
    const srv = createServer();
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'core-contract', version: '1' });
    await srv.connect(serverSide);
    try {
      await testClient.connect(clientSide);
      expect((await testClient.listTools()).tools.map(tool => tool.name).sort()).toEqual(coreToolNames);
    } finally { await testClient.close(); await srv.close(); }
  }

  const server = createBuiltServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const builtClient = new Client({ name: 'artifact-feedback', version: '1' });
  await builtClient.connect(clientTransport);
  try {
    await builtClient.callTool({ name: 'spector_attach', arguments: { cdpUrl: endpoint, autoLaunch: false } });
    const result = await builtClient.callTool({ name: 'spector_capture_screenshot', arguments: { selector: 'button', breakpoints: ['mobile', 'desktop'], expectedUrl: 'about:blank' } });
    expect(result.isError).not.toBe(true);
    const blocks = result.content as Array<{ type: string; text?: string }>;
    expect(blocks.filter(item => item.type === 'image')).toHaveLength(2);
    expect(blocks.find(item => item.type === 'text')!.text).toContain('valid');
  } finally { await builtClient.close(); await server.close(); }
}, 15000);
