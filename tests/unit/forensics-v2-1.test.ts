import { describe, expect, test } from 'bun:test';
import { TelemetryStore } from '../../src/browser/telemetry-store.js';
import { RenderCapture } from '../../src/browser/render-capture.js';
import { BrowserOperationEngine } from '../../src/browser/operation-engine.js';
import { explainCssCascade } from '../../src/analyzers/cdp-styles.js';

describe('Spector Forensics Enhancements', () => {
  test('TelemetryStore isolates console and network logs by targetId without cross-tab merging', () => {
    const store = new TelemetryStore();
    store.addConsole('error', 'same-err', 'http://localhost:3000/app.js:10', 'target-1');
    store.addConsole('error', 'same-err', 'http://localhost:3000/app.js:10', 'target-2');
    store.addFailedNetwork({ method: 'GET', url: 'http://localhost:3000/api/a', resourceType: 'fetch', status: 500, targetId: 'target-1' });
    store.addFailedNetwork({ method: 'GET', url: 'http://localhost:3000/api/b', resourceType: 'fetch', status: 404, targetId: 'target-2' });

    const t1Console = store.getConsoleLogs('error', true, 50, 'target-1');
    expect(t1Console).toHaveLength(1);
    expect(t1Console[0].targetId).toBe('target-1');
    expect(store.getConsoleLogs('error', false, 50, 'target-2')).toHaveLength(1);

    const t1Net = store.getFailedNetworkLogs(true, 25, undefined, 'target-1');
    expect(t1Net).toHaveLength(1);
    expect(t1Net[0].pathname).toBe('/api/a');
    expect(store.getFailedNetworkLogs(false, 25, undefined, 'target-2')).toHaveLength(1);
  });

  test('withEmulatedMedia applies prefers-color-scheme and prefers-reduced-motion and resets on error', async () => {
    const commands: Array<{ method: string; params: unknown }> = [];
    let detached = false;
    const fakePage = {
      isClosed: () => false,
      url: () => 'http://localhost:3000/',
      on: () => {},
      off: () => {},
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string, params: unknown) => {
            commands.push({ method, params });
            return {};
          },
          detach: async () => {
            detached = true;
          }
        })
      })
    } as any;

    const renderer = new RenderCapture(
      new BrowserOperationEngine(() => {}),
      () => {}
    );

    await expect(
      renderer.withEmulatedMedia(fakePage, { colorScheme: 'dark', reducedMotion: true }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(detached).toBe(true);
    expect(commands).toEqual([
      {
        method: 'Emulation.setEmulatedMedia',
        params: {
          features: [
            { name: 'prefers-color-scheme', value: 'dark' },
            { name: 'prefers-reduced-motion', value: 'reduce' }
          ]
        }
      },
      {
        method: 'Emulation.setEmulatedMedia',
        params: { media: '', features: [] }
      }
    ]);
  });

  test('explainCssCascade supports custom properties and ::before/::after pseudoElements', async () => {
    const fakePage = {
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string) => {
            if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
            if (method === 'DOM.querySelector') return { nodeId: 42 };
            if (method === 'CSS.getComputedStyleForNode') {
              return { computedStyle: [{ name: 'gap', value: '16px' }] };
            }
            if (method === 'CSS.getMatchedStylesForNode') {
              return {
                matchedCSSRules: [
                  {
                    rule: {
                      origin: 'regular',
                      selectorList: { text: '.card' },
                      style: { cssProperties: [{ name: 'gap', value: '16px' }] }
                    }
                  }
                ],
                pseudoElements: [
                  {
                    pseudoType: 'before',
                    matches: [
                      {
                        rule: {
                          origin: 'regular',
                          selectorList: { text: '.card::before' },
                          style: { cssProperties: [{ name: 'border-radius', value: '8px' }] }
                        }
                      }
                    ]
                  }
                ]
              };
            }
            return {};
          },
          detach: async () => {}
        })
      })
    } as any;

    const report = await explainCssCascade(fakePage, '.card', ['gap', 'border-radius']);
    expect(report.properties.gap?.winningValue).toBe('16px');
    expect(report.pseudoElements?.before?.['border-radius']?.winningValue).toBe('8px');
    expect(report.pseudoElements?.after).toBeUndefined();
  });

  test('explainCssCascade deduplicates identical overridden rules and returns computedSummary when no author rules match', async () => {
    let matchedRules: any[] = [
      {
        rule: {
          origin: 'regular',
          selectorList: { text: 'aside.fixed' },
          style: { cssProperties: [{ name: 'width', value: '240px' }] }
        }
      },
      {
        rule: {
          origin: 'regular',
          selectorList: { text: 'aside.fixed' },
          style: { cssProperties: [{ name: 'width', value: '240px' }] }
        }
      },
      {
        rule: {
          origin: 'regular',
          selectorList: { text: 'aside.fixed.w-64' },
          style: { cssProperties: [{ name: 'width', value: '256px' }] }
        }
      },
      {
        rule: {
          origin: 'regular',
          selectorList: { text: 'aside.fixed.w-64' },
          style: { cssProperties: [{ name: 'width', value: '256px' }] }
        }
      }
    ];

    const fakePage = {
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string) => {
            if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
            if (method === 'DOM.querySelector') return { nodeId: 99 };
            if (method === 'CSS.getComputedStyleForNode') {
              return {
                computedStyle: [
                  { name: 'display', value: 'block' },
                  { name: 'width', value: '256px' },
                  { name: 'padding', value: '24px' }
                ]
              };
            }
            if (method === 'CSS.getMatchedStylesForNode') {
              return { matchedCSSRules: matchedRules, pseudoElements: [] };
            }
            return {};
          },
          detach: async () => {}
        })
      })
    } as any;

    const deduped = await explainCssCascade(fakePage, 'aside.fixed', ['width']);
    expect(deduped.properties.width?.winningValue).toBe('256px');
    expect(deduped.properties.width?.overridden).toEqual([
      { value: '240px', source: 'aside.fixed', reason: 'lower specificity or earlier rule order' }
    ]);

    matchedRules = [];
    const emptyAuthor = await explainCssCascade(fakePage, 'main');
    expect(emptyAuthor.properties).toEqual({});
    expect(emptyAuthor.note).toContain('No direct author CSS rules matched');
    expect(emptyAuthor.computedSummary).toEqual({
      display: 'block',
      width: '256px',
      padding: '24px'
    });
  });
});
