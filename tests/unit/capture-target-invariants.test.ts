import { expect, test, spyOn } from 'bun:test';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { failSafeResponse } from '../../src/utils/mcp-response.js';
import { instrumentHandler, sanitizeArgs } from '../../src/utils/tool-instrument.js';
import { logger } from '../../src/utils/logger.js';

test('CDP element capture timeout detaches the owning session', async () => {
  let detached = 0;
  const locator = { waitFor: async () => {}, scrollIntoViewIfNeeded: async () => {}, boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }) };
  const page = {
    url: () => 'http://fixture.test/',
    isClosed: () => false,
    on: () => {},
    off: () => {},
    locator: () => ({ first: () => locator }),
    evaluate: async (fn: Function) => fn.toString().includes('devicePixelRatio') ? 1 : ({ x: 0, y: 0 }),
    context: () => ({ newCDPSession: async () => ({ send: () => new Promise(() => {}), detach: async () => { detached++; } }) })
  };
  const manager = new CdpSessionManager();
  manager.page = page as any;
  await expect(manager.captureScreenshotBuffer(page as any, { selector: '#target', timeoutMs: 20 })).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
  expect(detached).toBe(1);
});

test('failed viewport restore is explicit at the MCP boundary', () => {
  const result = failSafeResponse('spector_capture_screenshot', new AggregateError([new Error('cleanup')], 'Breakpoint audit failed to restore the original viewport.'));
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain('VIEWPORT_RESTORE_FAILED');
});

test('input values and URL arguments do not leak through invocation or failure logs', async () => {
  expect(sanitizeArgs({ value: 'secret', expectedUrl: 'http://fixture/?token=secret' })).toEqual({ value: '[REDACTED]', expectedUrl: '[REDACTED]' });
  const logs: unknown[] = [];
  const spy = spyOn(logger, 'error').mockImplementation((...args) => { logs.push(args); });
  try {
    const result = await instrumentHandler('test_input', async () => { throw new Error('Playwright filling secret'); })({ value: 'secret' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('secret');
    expect(JSON.stringify(logs)).toContain('inputErrorRedacted');
  } finally { spy.mockRestore(); }
});
