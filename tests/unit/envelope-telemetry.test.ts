import { describe, it } from 'bun:test';
import assert from 'node:assert';
import {
  SpectorError,
  envelopeResponse,
  failSafeResponse,
  jsonResponse,
  textResponse
} from '../../src/utils/mcp-response.js';
import { instrumentHandler, sanitizeArgs } from '../../src/utils/tool-instrument.js';
import { TIMEOUTS, TELEMETRY_LIMITS, TOKEN_BUDGETS, VIEWPORT_PRESETS } from '../../src/constants.js';

describe('Envelope & Telemetry Response Protocol', () => {
  it('formats textResponse without isError by default', () => {
    const res = textResponse('hello world');
    assert.strictEqual(res.isError, undefined);
    assert.deepStrictEqual(res.content, [{ type: 'text', text: 'hello world' }]);
  });

  it('formats jsonResponse with valid JSON text', () => {
    const res = jsonResponse({ ok: true, count: 42 });
    const parsed = JSON.parse(res.content[0].text as string);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.count, 42);
    assert.strictEqual(res.isError, undefined);
  });

  it('formats envelopeResponse with success, message, data, and non-disruptive isError=false', () => {
    const res = envelopeResponse(true, 'Operation completed', { id: '123' });
    assert.strictEqual(res.isError, undefined);
    const parsed = JSON.parse(res.content[0].text as string);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.message, 'Operation completed');
    assert.deepStrictEqual(parsed.data, { id: '123' });
  });

  it('formats envelopeResponse on failure without throwing or breaking protocol by default', () => {
    const res = envelopeResponse(false, 'Something failed softly');
    assert.strictEqual(res.isError, undefined);
    const parsed = JSON.parse(res.content[0].text as string);
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.message, 'Something failed softly');
    assert.strictEqual(parsed.data, undefined);
  });

  it('returns structured fail-safe guidance for common browser failures', () => {
    const res = failSafeResponse('spector_get_dom_tree', new Error('Failed to connect to Chrome: ECONNREFUSED'));
    const parsed = JSON.parse(res.content[0].text as string);
    assert.strictEqual(res.isError, true);
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.data.code, 'CHROME_CDP_UNAVAILABLE');
    assert.match(parsed.data.reason, /remote debugging endpoint/);
    assert.match(parsed.data.recommendation, /remote debugging/i);
    assert.doesNotMatch(res.content[0].text as string, /ECONNREFUSED/);
  });

  it('distinguishes blocked endpoints and missing browser contexts from connection failures', () => {
    const blocked = JSON.parse(
      failSafeResponse('spector_attach', new Error('SecurityPolicyError: Remote CDP host denied')).content[0].text as string
    );
    const noContext = JSON.parse(
      failSafeResponse('spector_attach', new Error('Connected to Chrome CDP, but no browser contexts are available.')).content[0].text as string
    );
    assert.strictEqual(blocked.data.code, 'CDP_ENDPOINT_DENIED');
    assert.match(blocked.data.recommendation, /localhost/);
    assert.strictEqual(noContext.data.code, 'BROWSER_CONTEXT_UNAVAILABLE');
    assert.match(noContext.data.recommendation, /Open a Chrome tab/);
  });

  it('converts thrown tool errors into fail-safe MCP responses', async () => {
    const handler = instrumentHandler('spector_test', async () => {
      throw new Error('No active page available.');
    });
    const res = await handler({});
    const parsed = JSON.parse(res.content[0].text as string);
    assert.strictEqual(res.isError, true);
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.data.code, 'BROWSER_CONTEXT_UNAVAILABLE');
    assert.match(parsed.data.reason, /available browser page/);
    assert.match(parsed.data.recommendation, /spector_attach/);
  });

  it('maps typed SpectorError instances directly and preserves cause without leaking internal messages', () => {
    const rawCause = new Error('raw socket failure detail');
    const typedErr = new SpectorError('PICKER_CANCELLED', 'internal detail should stay hidden', 'Retry picking.', {
      cause: rawCause
    });
    assert.strictEqual(typedErr.cause, rawCause);

    const res = failSafeResponse('spector_picker', typedErr);
    const parsed = JSON.parse(res.content[0].text as string);
    assert.strictEqual(res.isError, true);
    assert.strictEqual(parsed.data.code, 'PICKER_CANCELLED');
    assert.strictEqual(parsed.data.recommendation, 'Retry picking.');
    assert.doesNotMatch(res.content[0].text as string, /internal detail should stay hidden/);
  });

  it('sanitizes sensitive arguments recursively while preserving keyboard key name', () => {
    const sanitized = sanitizeArgs({
      key: 'Enter',
      apiKey: 'secret-api-key',
      token: 'secret-token',
      selector: '.btn',
      nested: {
        key: 'Escape',
        authHeader: 'Bearer nested-secret',
        items: [{ password: 'pw', safe: 'ok' }],
        deep: { a: { b: { c: { secret: 'too-deep' } } } }
      }
    }) as any;
    assert.strictEqual(sanitized.key, 'Enter');
    assert.strictEqual(sanitized.apiKey, '[REDACTED]');
    assert.strictEqual(sanitized.token, '[REDACTED]');
    assert.strictEqual(sanitized.selector, '.btn');
    assert.strictEqual(sanitized.nested.key, 'Escape');
    assert.strictEqual(sanitized.nested.authHeader, '[REDACTED]');
    assert.strictEqual(sanitized.nested.items[0].password, '[REDACTED]');
    assert.strictEqual(sanitized.nested.items[0].safe, 'ok');
    assert.strictEqual(sanitized.nested.deep.a.b.c, '[TRUNCATED]');
  });

  it('preserves centralized v2 timeouts, budgets, and viewport presets', () => {
    assert.strictEqual(TIMEOUTS.CDP_CONNECT_MS, 10000);
    assert.strictEqual(TIMEOUTS.INTERACT_DEFAULT_MS, 7000);
    assert.strictEqual(TIMEOUTS.PICKER_HOTKEY_DEFAULT_MS, 30000);
    assert.strictEqual(TELEMETRY_LIMITS.MAX_LOG_BUFFER, 100);
    assert.strictEqual(TOKEN_BUDGETS.MAX_INLINE_SVG_BYTES, 2048);
    assert.deepStrictEqual(VIEWPORT_PRESETS.mobile, {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: true
    });
    assert.strictEqual(VIEWPORT_PRESETS.tablet.width, 768);
    assert.strictEqual(VIEWPORT_PRESETS.desktop.width, 1440);
  });
});
