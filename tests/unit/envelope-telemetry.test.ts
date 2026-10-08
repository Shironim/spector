import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { envelopeResponse, jsonResponse, textResponse } from '../../src/types.js';
import { TIMEOUTS, TELEMETRY_LIMITS, EXTENSION_CANDIDATES, SNIPPET_LIMITS } from '../../src/constants.js';

describe('Envelope & Telemetry Response Protocol', () => {
  it('formats textResponse without isError by default', () => {
    const res = textResponse('hello world');
    assert.strictEqual(res.content[0].type, 'text');
    assert.strictEqual(res.content[0].text, 'hello world');
    assert.strictEqual(res.isError, undefined);
  });

  it('formats jsonResponse with valid JSON text', () => {
    const res = jsonResponse({ status: 'ok', count: 42 });
    assert.strictEqual(res.content[0].type, 'text');
    const parsed = JSON.parse(res.content[0].text);
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.count, 42);
  });

  it('formats envelopeResponse with success, message, data, and non-disruptive isError=false', () => {
    const res = envelopeResponse(true, 'Action completed', { clickCount: 1 });
    assert.strictEqual(res.isError, undefined);
    const parsed = JSON.parse(res.content[0].text);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.message, 'Action completed');
    assert.strictEqual(parsed.data.clickCount, 1);
  });

  it('formats envelopeResponse on failure without throwing or breaking protocol by default', () => {
    const res = envelopeResponse(false, 'Target not found');
    assert.strictEqual(res.isError, undefined);
    const parsed = JSON.parse(res.content[0].text);
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.message, 'Target not found');
    assert.strictEqual(parsed.data, undefined);
  });

  it('preserves centralized timeout and limit constants', () => {
    assert.strictEqual(TIMEOUTS.CDP_CONNECT_MS, 10000);
    assert.strictEqual(TIMEOUTS.INTERACT_DEFAULT_MS, 7000);
    assert.strictEqual(SNIPPET_LIMITS.MAX_FILE_SIZE_BYTES, 200000);
    assert.ok(EXTENSION_CANDIDATES.includes('.vue'));
    assert.ok(EXTENSION_CANDIDATES.includes('.tsx'));
    assert.ok(EXTENSION_CANDIDATES.includes('.blade.php'));
    assert.ok(TELEMETRY_LIMITS.ARG_STRING_TRUNCATE_LEN > 0);
  });
});
