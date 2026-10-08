import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { BrowserManager } from '../../src/browser-manager.js';

describe('BrowserManager Invariants (In-Memory / Unattached)', () => {
  it('instantiates cleanly in unattached state', () => {
    const manager = new BrowserManager();
    assert.strictEqual(manager.isAttached(), false);
    assert.strictEqual(manager.getLastPickedElement(), null);
  });

  it('filters network logs accurately by status code and error flags', () => {
    const manager = new BrowserManager();
    const logs = (manager as any).networkLogs;

    // Inject simulated network entries
    logs.push({
      id: '1',
      method: 'GET',
      url: 'http://localhost/api/ok',
      resourceType: 'fetch',
      status: 200,
      timestamp: new Date().toISOString()
    });
    logs.push({
      id: '2',
      method: 'POST',
      url: 'http://localhost/api/bad',
      resourceType: 'fetch',
      status: 500,
      timestamp: new Date().toISOString()
    });
    logs.push({
      id: '3',
      method: 'GET',
      url: 'http://localhost/api/failed',
      resourceType: 'fetch',
      error: 'net::ERR_CONNECTION_REFUSED',
      timestamp: new Date().toISOString()
    });

    // Test 5xx filter (positional: filter, clearAfterRead, statusFilter)
    const fiveXx = manager.getNetworkLogs(undefined, false, '5xx');
    assert.strictEqual(fiveXx.length, 1);
    assert.strictEqual(fiveXx[0].status, 500);

    // Test errorsOnly filter
    const errorsOnly = manager.getNetworkLogs(undefined, false, 'errorsOnly');
    assert.strictEqual(errorsOnly.length, 2); // 500 and connection error
  });

  it('clearAfterRead only clears logs that match the returned criteria', () => {
    const manager = new BrowserManager();
    const logs = (manager as any).networkLogs;

    logs.push({
      id: '1',
      method: 'GET',
      url: 'http://localhost/api/keep',
      resourceType: 'fetch',
      status: 200,
      timestamp: new Date().toISOString()
    });
    logs.push({
      id: '2',
      method: 'POST',
      url: 'http://localhost/api/delete',
      resourceType: 'fetch',
      status: 502,
      timestamp: new Date().toISOString()
    });

    // Query with filter and clearAfterRead = true
    const result = manager.getNetworkLogs(undefined, true, '5xx');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].status, 502);

    // The status 200 log must remain!
    const remaining = manager.getNetworkLogs(undefined, false);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].url, 'http://localhost/api/keep');
  });

  it('disconnect safely clears references without error', async () => {
    const manager = new BrowserManager();
    await manager.disconnect();
    assert.strictEqual(manager.isAttached(), false);
  });
});
