import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { CdpSessionManager, extractCdpPort, validateCdpEndpoint } from '../../src/browser/cdp-session.js';
import { PinStore } from '../../src/browser/pin-store.js';
import { TelemetryStore, sanitizeNetworkPathname } from '../../src/browser/telemetry-store.js';
import { SpectorError } from '../../src/utils/mcp-response.js';
import { TOKEN_BUDGETS } from '../../src/constants.js';
import { evaluateInPage, setMainFrameCorrupted } from '../../src/utils/cdp.js';

describe('CdpSessionManager & TelemetryStore Invariants', () => {
  it('instantiates cleanly in unattached state', async () => {
    const manager = new CdpSessionManager();
    assert.equal(manager.isAttached(), false);
    assert.equal(await manager.getLastPicked(), null);
  });

  it('extracts dynamic remote debugging port from cdpUrl', () => {
    assert.equal(extractCdpPort('http://localhost:9222'), '9222');
    assert.equal(extractCdpPort('http://127.0.0.1:9333'), '9333');
    assert.equal(extractCdpPort('ws://127.0.0.1:9444/devtools/browser/abc'), '9444');
    assert.equal(extractCdpPort('http://localhost'), '9222');
    assert.equal(extractCdpPort('https://localhost'), '443');
    assert.equal(extractCdpPort('wss://localhost'), '443');
  });

  it('records only failed network requests (>=400 or requestfailed) as pathname-only', () => {
    const store = new TelemetryStore();

    assert.equal(
      store.addFailedNetwork({
        method: 'GET',
        url: 'http://localhost:3000/api/ok?token=SECRET',
        resourceType: 'fetch',
        status: 200
      }),
      null
    );
    assert.equal(
      store.addFailedNetwork({
        method: 'GET',
        url: 'http://localhost:3000/redirect',
        resourceType: 'document',
        status: 302
      }),
      null
    );

    const err422 = store.addFailedNetwork({
      method: 'POST',
      url: 'http://localhost:3000/api/orders?api_key=TOPSECRET#frag',
      resourceType: 'fetch',
      status: 422,
      statusText: 'Unprocessable Entity'
    });
    const errFail = store.addFailedNetwork({
      method: 'GET',
      url: 'https://api.example.com/v1/profile?password=123',
      resourceType: 'xhr',
      error: 'net::ERR_CONNECTION_REFUSED'
    });

    assert.ok(err422);
    assert.equal(err422.pathname, '/api/orders');
    assert.equal((err422 as any).url, undefined);
    assert.equal((err422 as any).requestBodySummary, undefined);

    assert.ok(errFail);
    assert.equal(errFail.pathname, '/v1/profile');
    assert.equal(TelemetryStore.formatFailedNetworkLine(err422), 'POST 422 /api/orders');
    assert.equal(
      TelemetryStore.formatFailedNetworkLine(errFail),
      'GET FAIL /v1/profile (net::ERR_CONNECTION_REFUSED)'
    );

    const logs = store.getFailedNetworkLogs(false);
    assert.equal(logs.length, 2);
  });

  it('clearAfterRead preserves unmatched sibling entries', () => {
    const store = new TelemetryStore();
    store.addFailedNetwork({
      method: 'GET',
      url: 'http://localhost/api/keep',
      resourceType: 'fetch',
      status: 500
    });
    store.addFailedNetwork({
      method: 'POST',
      url: 'http://localhost/api/delete',
      resourceType: 'fetch',
      status: 404
    });

    const filtered = store.getFailedNetworkLogs(true, 25, '/delete');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].pathname, '/api/delete');

    const remaining = store.getFailedNetworkLogs(false);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].pathname, '/api/keep');
  });

  it('deduplicates consecutive identical console messages with count', () => {
    const store = new TelemetryStore();
    store.addConsole('error', 'Hydration mismatch', 'app.ts:10');
    store.addConsole('error', 'Hydration mismatch', 'app.ts:10');
    store.addConsole('error', 'Hydration mismatch', 'app.ts:10');

    const logs = store.getConsoleLogs('error', false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].count, 3);
  });

  it('sanitizes malformed URLs and redacts inline secrets before truncating', () => {
    const clean = sanitizeNetworkPathname('not-a-valid-url/token=MY_SECRET?password=abc');
    assert.doesNotMatch(clean, /MY_SECRET|password|abc/);
    assert.match(clean, /\[REDACTED\]/);
  });

  it('disconnect safely clears references without error', async () => {
    const manager = new CdpSessionManager();
    await manager.disconnect();
    assert.equal(manager.isAttached(), false);
  });

  it('enforces protocol and loopback constraints in validateCdpEndpoint', () => {
    assert.doesNotThrow(() => validateCdpEndpoint('http://localhost:9222'));
    assert.doesNotThrow(() => validateCdpEndpoint('http://127.0.0.1:9333'));
    assert.doesNotThrow(() => validateCdpEndpoint('https://[::1]:9222'));
    assert.doesNotThrow(() => validateCdpEndpoint('ws://localhost:9222'));
    assert.doesNotThrow(() => validateCdpEndpoint('ws://127.0.0.1:9222/devtools/browser/abc'));

    assert.throws(
      () => validateCdpEndpoint('ftp://localhost:9222'),
      (err: unknown) => err instanceof SpectorError && err.code === 'CDP_ENDPOINT_DENIED'
    );
    assert.throws(
      () => validateCdpEndpoint('ws://192.168.1.25:9222/devtools/browser/abc'),
      (err: unknown) => err instanceof SpectorError && err.code === 'CDP_ENDPOINT_DENIED'
    );
    assert.throws(
      () => validateCdpEndpoint('file:///etc/passwd'),
      (err: unknown) => err instanceof SpectorError && err.code === 'CDP_ENDPOINT_DENIED'
    );
    assert.throws(
      () => validateCdpEndpoint('http://192.168.1.25:9222'),
      (err: unknown) => err instanceof SpectorError && err.code === 'CDP_ENDPOINT_DENIED'
    );
    assert.throws(
      () => validateCdpEndpoint('not a url'),
      (err: unknown) => err instanceof SpectorError && err.code === 'INVALID_CDP_ENDPOINT'
    );
  });

  it('manages slot semantics and queue budget eviction in PinStore', () => {
    const store = new PinStore();
    assert.equal(store.isEmpty(), true);

    store.add({ id: store.nextId(), role: 'single', status: 'selected', selector: '#s1' });
    store.add({ id: store.nextId(), role: 'target', status: 'selected', selector: '#t1' });
    store.add({ id: store.nextId(), role: 'target', status: 'selected', selector: '#t2' });
    store.add({ id: store.nextId(), role: 'reference', status: 'selected', selector: '#r1' });

    const pair = store.getPins(false);
    assert.ok(pair);
    assert.deepEqual(
      pair.pins.map(p => [p.role, p.selector]),
      [
        ['target', '#t2'],
        ['reference', '#r1']
      ]
    );
    assert.ok(pair.comparison);

    store.clear();
    for (let i = 1; i <= TOKEN_BUDGETS.MAX_PIN_QUEUE + 3; i++) {
      store.add({ id: store.nextId(), role: 'pin', status: 'selected', selector: `#q${i}` });
    }
    const queueSnap = store.getPins(true);
    assert.equal(queueSnap?.pins.length, TOKEN_BUDGETS.MAX_PIN_QUEUE);
    assert.equal(queueSnap?.pins[0].selector, '#q4');
    assert.equal(store.isEmpty(), true);
  });

  it('serializes concurrent withBreakpointMetrics calls and always clears CDP metrics override', async () => {
    const events: string[] = [];
    const manager = new CdpSessionManager();
    const fakeCdp = {
      send: async (method: string, params?: any) => {
        events.push(method === 'Emulation.setDeviceMetricsOverride' ? `set:${params.width}` : method);
        return {};
      },
      detach: async () => {
        events.push('detach');
      }
    };
    const fakePage: any = {
      url: () => "http://fixture.test/",
      on: () => {}, off: () => {},
      isClosed: () => false,
      waitForTimeout: async () => {},
      viewportSize: () => null,
      evaluate: async () => ({ width: 1024, height: 768, deviceScaleFactor: 1, screenWidth: 1024, screenHeight: 768, scrollX: 0, scrollY: 0 }),
      context: () => ({ newCDPSession: async () => fakeCdp })
    };
    manager.page = fakePage;

    const first = manager.withBreakpointMetrics(['mobile'], async (bp) => {
      events.push(`start:1:${bp}`);
      await new Promise(resolve => setTimeout(resolve, 20));
      events.push(`end:1:${bp}`);
      return bp;
    });
    const second = manager.withBreakpointMetrics(['desktop'], async (bp) => {
      events.push(`start:2:${bp}`);
      events.push(`end:2:${bp}`);
      return bp;
    });

    const [res1, res2] = await Promise.all([first, second]);
    assert.deepEqual(res1, ['mobile']);
    assert.deepEqual(res2, ['desktop']);
    assert.deepEqual(events, [
      'set:375',
      'start:1:mobile',
      'end:1:mobile',
      'Emulation.clearDeviceMetricsOverride',
      'detach',
      'set:1440',
      'start:2:desktop',
      'end:2:desktop',
      'Emulation.clearDeviceMetricsOverride',
      'detach'
    ]);
  });

  it('reports failed viewport cleanup, detaches, and recovers the emulation queue', async () => {
    const manager = new CdpSessionManager();
    let failCleanup = true;
    let detachCount = 0;
    const cdp = {
      send: async (method: string) => {
        if (method === 'Emulation.clearDeviceMetricsOverride' && failCleanup) throw new Error('CDP restore failed');
        return {};
      },
      detach: async () => { detachCount++; }
    };
    manager.page = {
      url: () => "http://fixture.test/",
      on: () => {}, off: () => {},
      isClosed: () => false,
      viewportSize: () => null,
      evaluate: async () => ({ width: 1024, height: 768, deviceScaleFactor: 1, screenWidth: 1024, screenHeight: 768, scrollX: 0, scrollY: 0 }),
      waitForTimeout: async () => {},
      context: () => ({ newCDPSession: async () => cdp })
    } as any;
    await assert.rejects(manager.withBreakpointMetrics(['mobile'], async () => { throw new Error('runner failed'); }), (error: any) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors.map((cause: Error) => cause.message), ['runner failed', 'CDP restore failed']);
      return true;
    });
    assert.equal(detachCount, 1);
    failCleanup = false;
    assert.deepEqual(await manager.withBreakpointMetrics(['tablet'], async () => 'recovered'), ['recovered']);
    assert.equal(detachCount, 2);
  });

  it('uses authoritative CDP Target.getTargetInfo in listTabs/selectTab when Playwright mainFrame is hijacked by an OOPIF', async () => {
    const manager = new CdpSessionManager();
    const makePage = (pwUrl: string, pwTitle: string, cdpInfo: { targetId: string; type: string; title: string; url: string }) => {
      const cdp = {
        send: async (method: string) => method === 'Target.getTargetInfo' ? { targetInfo: cdpInfo } : {},
        detach: async () => {}
      };
      return {
        url: () => pwUrl,
        title: async () => pwTitle,
        isClosed: () => false,
        viewportSize: () => null,
        bringToFront: async () => {},
        on: () => {},
        off: () => {},
        exposeFunction: async () => {},
        addInitScript: async () => {},
        evaluate: async () => {},
        context: () => ({ newCDPSession: async () => cdp })
      } as any;
    };

    const hijackedPage = makePage(
      'https://calendar.google.com/calendar/appointments/schedules/abc',
      'Book Meeting',
      { targetId: 'page-1', type: 'page', title: 'About', url: 'https://www.binar.co.id/about' }
    );
    const leakedIframe = makePage(
      'https://calendar.google.com/calendar/appointments/schedules/abc',
      'Book Meeting',
      { targetId: 'iframe-1', type: 'iframe', title: 'Book Meeting', url: 'https://calendar.google.com/calendar/appointments/schedules/abc' }
    );

    manager.browser = { isConnected: () => true, close: async () => {} } as any;
    manager.context = { pages: () => [hijackedPage, leakedIframe] } as any;
    manager.page = hijackedPage;

    const tabs = await manager.listTabs();
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].title, 'About');
    assert.equal(tabs[0].url, 'https://www.binar.co.id/about');
    assert.equal(tabs[0].isActive, true);

    const selected = await manager.selectTab({ url: '*binar.co.id*' });
    assert.equal(selected.title, 'About');
    assert.equal(selected.url, 'https://www.binar.co.id/about');
    manager.assertTarget(hijackedPage, 'https://www.binar.co.id/about');
  });

  it('falls back to CDP Runtime.evaluate in evaluateInPage when Playwright page.url() disagrees with CDP targetInfo', async () => {
    let pwEvalCalls = 0;
    let cdpEvalCalls = 0;
    const makeCdpPage = (pwUrl: string, cdpUrl: string) => {
      const cdp = {
        send: async (method: string, params?: any) => {
          if (method === 'Target.getTargetInfo') {
            return { targetInfo: { targetId: 'p1', type: 'page', title: 'About', url: cdpUrl } };
          }
          if (method === 'Runtime.evaluate') {
            cdpEvalCalls++;
            assert.equal(params.returnByValue, true);
            assert.equal(params.awaitPromise, true);
            return { result: { value: { source: 'cdp', exprLen: params.expression.length } } };
          }
          return {};
        },
        detach: async () => {}
      };
      return {
        url: () => pwUrl,
        evaluate: async () => { pwEvalCalls++; return { source: 'playwright' }; },
        context: () => ({ newCDPSession: async () => cdp })
      } as any;
    };

    const healthyPage = makeCdpPage('https://www.binar.co.id/about', 'https://www.binar.co.id/about');
    const healthyRes = await evaluateInPage(healthyPage, () => ({ ok: true }));
    assert.deepEqual(healthyRes, { source: 'playwright' });
    assert.equal(pwEvalCalls, 1);
    assert.equal(cdpEvalCalls, 0);

    const corruptedPage = makeCdpPage('https://calendar.google.com/embed', 'https://www.binar.co.id/about');
    setMainFrameCorrupted(corruptedPage, true);
    const corruptedRes = await evaluateInPage(corruptedPage, (n: number) => ({ n }), 42);
    assert.equal((corruptedRes as any).source, 'cdp');
    assert.equal(pwEvalCalls, 1);
    assert.equal(cdpEvalCalls, 1);

    const emptyUrlPage = makeCdpPage('', 'https://www.binar.co.id/about');
    const emptyUrlRes = await evaluateInPage(emptyUrlPage, () => ({ ok: true }));
    assert.equal((emptyUrlRes as any).source, 'cdp');
    assert.equal(cdpEvalCalls, 2);
  });
});
