import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  computePinVerificationDiff,
  summarizeCascadeOverrides
} from '../../src/analyzers/pin-forensics.js';
import { PinStore } from '../../src/browser/pin-store.js';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { createSpectorServer } from '../../src/index.js';
import type { PickedElementInfo } from '../../src/types.js';

describe('Phase 2: Auto-Forensics on Pin & Before/After Pin Verification', () => {
  test('summarizeCascadeOverrides returns undefined when no rules are overridden and extracts only overridden properties', () => {
    const clean = summarizeCascadeOverrides({
      selector: '.btn',
      properties: {
        padding: { winningValue: '12px', winningSource: '.btn', resolution: 'ranked', overridden: [] }
      }
    });
    expect(clean).toBeUndefined();

    const overridden = summarizeCascadeOverrides({
      selector: '.btn',
      properties: {
        padding: { winningValue: '12px', winningSource: '.btn', resolution: 'ranked', overridden: [] },
        color: {
          winningValue: 'blue',
          winningSource: '.btn-override',
          resolution: 'ranked',
          important: true,
          overridden: [
            { value: 'red', source: '.btn', reason: 'overridden by !important' }
          ]
        }
      }
    });
    expect(overridden).toEqual({
      color: {
        winningValue: 'blue',
        winningSource: '.btn-override',
        overriddenCount: 1,
        topOverridden: { value: 'red', source: '.btn', reason: 'overridden by !important' }
      }
    });
  });

  test('computePinVerificationDiff computes exact rect, style, and forensics deltas', () => {
    const beforePin: PickedElementInfo = {
      id: 'pin-1',
      status: 'selected',
      role: 'single',
      pinMode: 'element',
      selector: '#cta-btn',
      note: 'increase padding and fix overflow',
      rect: { x: 10, y: 20, width: 120, height: 40 },
      computedStyles: { padding: '8px', color: 'rgb(0, 0, 0)' },
      forensics: {
        layoutIssues: [
          { kind: 'horizontal-overflow', detail: 'Element extends 24px past viewport right edge.' }
        ]
      }
    };

    const unchanged = computePinVerificationDiff(beforePin, {
      rect: { x: 10, y: 20, width: 120, height: 40 },
      computedStyles: { padding: '8px', color: 'rgb(0, 0, 0)' },
      forensics: beforePin.forensics
    });
    expect(unchanged.changed).toBe(false);
    expect(unchanged.styleChanges).toEqual({});
    expect(unchanged.forensicsDelta?.resolvedIssues).toEqual([]);
    expect(unchanged.forensicsDelta?.remainingIssues).toHaveLength(1);

    const fixed = computePinVerificationDiff(beforePin, {
      rect: { x: 10, y: 20, width: 144, height: 48 },
      computedStyles: { padding: '16px', color: 'rgb(0, 0, 0)' },
      forensics: undefined
    });
    expect(fixed.changed).toBe(true);
    expect(fixed.note).toBe('increase padding and fix overflow');
    expect(fixed.rectDelta?.widthDiff).toBe(24);
    expect(fixed.rectDelta?.heightDiff).toBe(8);
    expect(fixed.styleChanges).toEqual({
      padding: { before: '8px', after: '16px' }
    });
    expect(fixed.forensicsDelta?.resolvedIssues).toEqual([
      'horizontal-overflow: Element extends 24px past viewport right edge.'
    ]);
    expect(fixed.forensicsDelta?.remainingIssues).toEqual([]);
    expect(fixed.forensicsDelta?.newIssues).toEqual([]);
  });

  test('PinStore.findForVerify prioritizes target > single > latest and skips region pins', () => {
    const store = new PinStore();
    store.add({ status: 'selected', role: 'pin', pinMode: 'region', selector: 'body', rect: { x: 0, y: 0, width: 100, height: 50 } });
    expect(store.findForVerify()).toBeUndefined();

    store.add({ id: 'pin-ref', status: 'selected', role: 'reference', pinMode: 'element', selector: '.ref' });
    store.add({ id: 'pin-target', status: 'selected', role: 'target', pinMode: 'element', selector: '.target' });
    expect(store.findForVerify()?.id).toBe('pin-target');
    expect(store.findForVerify('pin-ref')?.id).toBe('pin-ref');
    expect(store.findForVerify('missing')).toBeUndefined();
  });

  test('spector_picker action:"verify" works over InMemoryTransport MCP protocol and handles element_not_found', async () => {
    const manager = new CdpSessionManager();
    manager.addPin({
      id: 'pin-42',
      status: 'selected',
      role: 'single',
      pinMode: 'element',
      selector: '#hero-cta',
      note: 'make button wider',
      rect: { x: 0, y: 0, width: 100, height: 40 },
      computedStyles: { width: '100px', padding: '8px' }
    });

    let elementExists = true;
    const fakePage = {
      url: () => 'http://localhost:3000/',
      isClosed: () => false,
      on: () => {},
      off: () => {},
      context: () => ({
        newCDPSession: async () => ({
          send: async () => ({}),
          detach: async () => {}
        })
      }),
      evaluate: async (script: unknown) => {
        if (typeof script === 'string' && script.includes('extractDesignBlueprint')) {
          return elementExists
            ? { rect: { x: 0, y: 0, width: 160, height: 40 }, computedStyles: { width: '160px', padding: '12px' } }
            : null;
        }
        return [];
      }
    } as any;

    manager.page = fakePage;
    manager.ensurePage = async () => fakePage;

    const server = createSpectorServer(manager);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'verify-protocol-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const res = await client.callTool({
        name: 'spector_picker',
        arguments: { action: 'verify', pinId: 'pin-42', includeScreenshot: false }
      });
      expect(res.isError).not.toBe(true);
      const report = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(report.status).toBe('verified');
      expect(report.changed).toBe(true);
      expect(report.rectDelta.widthDiff).toBe(60);
      expect(report.styleChanges.padding).toEqual({ before: '8px', after: '12px' });

      elementExists = false;
      const missingRes = await client.callTool({
        name: 'spector_picker',
        arguments: { action: 'verify', includeScreenshot: false }
      });
      const missingReport = JSON.parse((missingRes.content as Array<{ text: string }>)[0].text);
      expect(missingReport.status).toBe('element_not_found');
      expect(missingReport.selector).toBe('#hero-cta');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
