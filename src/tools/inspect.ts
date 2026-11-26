import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import type { McpToolContent } from '../types.js';
import { SpectorError } from '../utils/mcp-response.js';
import type { BreakpointPreset } from '../constants.js';
import { instrumentHandler } from '../utils/tool-instrument.js';
import { evaluateInPage } from '../utils/cdp.js';
import { enforceResponseBudget } from '../utils/result-budget.js';
import { DEVTOOLS_OVERLAY_SELECTORS } from '../browser/render-capture.js';

export function registerInspectTools(
  server: McpServer,
  manager: CdpSessionManager
): void {
  const screenshotSchema = {
    selector: z
      .string()
      .optional()
      .describe('Element selector to capture at each requested breakpoint'),
    expectedUrl: z.string().optional().describe('Exact expected URL, including query and hash; checked before and after capture'),
    fullPage: z
      .boolean()
      .optional()
      .default(false)
      .describe('Capture entire scrollable page height (default: false)'),
    breakpoints: z
      .array(z.enum(['mobile', 'tablet', 'desktop']))
      .optional()
      .describe('Optional responsive viewport presets to capture (mobile=375x812, tablet=768x1024, desktop=1440x900). Restores original viewport afterward.'),
    colorScheme: z
      .enum(['light', 'dark'])
      .optional()
      .describe('Optional prefers-color-scheme media emulation for the capture (restored afterward).'),
    colorSchemes: z
      .array(z.enum(['light', 'dark']))
      .optional()
      .describe('Optional batch of prefers-color-scheme themes to capture in one call (e.g. ["light", "dark"]). Overrides colorScheme when provided.'),
    reducedMotion: z
      .boolean()
      .optional()
      .describe('Optional prefers-reduced-motion media emulation for the capture (restored afterward).'),
    hideDevtoolsOverlays: z
      .boolean()
      .optional()
      .default(false)
      .describe('Temporarily hide common framework DevTools overlays (Nuxt, Vue, Next.js, Vite, TanStack) during capture and restore afterward (default: false).'),
    hideSelectors: z
      .array(z.string())
      .optional()
      .describe('Optional CSS selectors to temporarily hide during screenshot capture and restore afterward.')
  };

  server.registerTool(
    'spector_capture_screenshot',
    {
      title: 'Capture Visual Screenshot',
      description: '[VISUAL AUDIT & MULTI-BREAKPOINT SNAPSHOT] Captures a screenshot of the active page, a target selector, multiple responsive breakpoints, and/or multiple color schemes (light/dark) via CDP Emulation (automatically restores original viewport & media).',
      inputSchema: screenshotSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    instrumentHandler<{
      selector?: string;
      expectedUrl?: string;
      fullPage?: boolean;
      breakpoints?: BreakpointPreset[];
      colorScheme?: 'light' | 'dark';
      colorSchemes?: Array<'light' | 'dark'>;
      reducedMotion?: boolean;
      hideDevtoolsOverlays?: boolean;
      hideSelectors?: string[];
    }>('spector_capture_screenshot', async ({ selector, expectedUrl, fullPage, breakpoints, colorScheme, colorSchemes, reducedMotion, hideDevtoolsOverlays, hideSelectors }) => {
      const page = await manager.ensurePage();

      const operationUrl = expectedUrl ?? manager.pageUrl(page);
      manager.assertTarget(page, operationUrl);

      const effectiveHideSelectors: string[] = [
        ...(hideDevtoolsOverlays === true ? DEVTOOLS_OVERLAY_SELECTORS : []),
        ...(Array.isArray(hideSelectors) ? hideSelectors : [])
      ];

      const resolvedThemes: Array<'light' | 'dark' | undefined> =
        Array.isArray(colorSchemes) && colorSchemes.length > 0
          ? [...new Set(colorSchemes)]
          : [colorScheme];
      const hasBreakpoints = Array.isArray(breakpoints) && breakpoints.length > 0;

      const runCapture = async () => {
        if (resolvedThemes.length === 1 && !hasBreakpoints) {
          return await manager.withEmulatedMedia({ colorScheme: resolvedThemes[0], reducedMotion }, async () => {
            const buffer = await manager.captureScreenshotBuffer(page, { selector, fullPage });
            manager.assertTarget(page, operationUrl);
            const metadata = await manager.captureMetadata(page, selector);
            manager.assertTarget(page, operationUrl);
            return enforceResponseBudget({
              content: [
                {
                  type: 'image',
                  data: buffer.toString('base64'),
                  mimeType: 'image/png'
                },
                {
                  type: 'text',
                  text: JSON.stringify(metadata) + '\n' + `Screenshot captured successfully${selector ? ` for selector "${selector}"` : ''} (${Math.round(buffer.length / 1024)} KB).`
                }
              ]
            });
          }, page);
        }

        const contentBlocks: McpToolContent[] = [];
        const summaryLines: string[] = [];
        let totalAttempts = 0;
        let totalSuccesses = 0;

        for (const theme of resolvedThemes) {
          const themePrefix = theme ? `[${theme}] ` : '';
          await manager.withEmulatedMedia({ colorScheme: theme, reducedMotion }, async () => {
            if (hasBreakpoints) {
              const captures = await manager.withBreakpointMetrics(breakpoints!, async (bp, dims) => {
                const overflowCheck = await evaluateInPage(page, () => {
                  const doc = document.documentElement;
                  return {
                    scrollWidth: doc.scrollWidth,
                    clientWidth: doc.clientWidth,
                    hasOverflow: doc.scrollWidth > doc.clientWidth + 1
                  };
                });
                let buffer: Buffer | undefined;
                let errorCode: string | undefined;
                try {
                  buffer = await manager.captureScreenshotBuffer(page, { selector, fullPage });
                } catch (error) {
                  manager.assertTarget(page, operationUrl);
                  if (!(error instanceof SpectorError) || error.code !== 'ELEMENT_NOT_READY') throw error;
                  errorCode = error.code;
                }
                manager.assertTarget(page, operationUrl);
                const metadata = await manager.captureMetadata(page, selector);
                manager.assertTarget(page, operationUrl);
                return { bp, dims, overflowCheck, buffer, metadata, errorCode };
              }, page);

              for (const item of captures) {
                totalAttempts++;
                if (!item.buffer) {
                  summaryLines.push(JSON.stringify({ ...item.metadata, ...(theme ? { colorScheme: theme } : {}), breakpoint: item.bp, status: 'failed', code: item.errorCode }));
                  continue;
                }
                totalSuccesses++;
                summaryLines.push(
                  JSON.stringify({ ...item.metadata, ...(theme ? { colorScheme: theme } : {}) }) + ' ' +
                  `${themePrefix}${item.bp} (${item.dims.width}x${item.dims.height}): ${Math.round(item.buffer.length / 1024)} KB` +
                    (item.overflowCheck.hasOverflow
                      ? ` [OVERFLOW: scrollWidth=${item.overflowCheck.scrollWidth} > clientWidth=${item.overflowCheck.clientWidth}]`
                      : ' [no horizontal overflow]')
                );
                contentBlocks.push({
                  type: 'image',
                  data: item.buffer.toString('base64'),
                  mimeType: 'image/png'
                });
              }
            } else {
              totalAttempts++;
              const buffer = await manager.captureScreenshotBuffer(page, { selector, fullPage });
              manager.assertTarget(page, operationUrl);
              const metadata = await manager.captureMetadata(page, selector);
              manager.assertTarget(page, operationUrl);
              totalSuccesses++;
              summaryLines.push(
                JSON.stringify({ ...metadata, ...(theme ? { colorScheme: theme } : {}) }) + ' ' +
                `${themePrefix}viewport: ${Math.round(buffer.length / 1024)} KB`
              );
              contentBlocks.push({
                type: 'image',
                data: buffer.toString('base64'),
                mimeType: 'image/png'
              });
            }
          }, page);
        }

        const status = totalSuccesses === totalAttempts ? 'valid' : totalSuccesses > 0 ? 'partial' : 'failed';
        const label = hasBreakpoints && resolvedThemes.length > 1
          ? 'Multi-theme & multi-breakpoint'
          : hasBreakpoints
            ? 'Multi-breakpoint'
            : 'Multi-theme';
        contentBlocks.unshift({
          type: 'text',
          text: `${label} capture status: ${status} (original viewport & media restored):\n${summaryLines.join('\n')}`
        });
        return enforceResponseBudget({
          content: contentBlocks,
          ...(totalSuccesses === 0 ? { isError: true } : {})
        });
      };

      return effectiveHideSelectors.length > 0
        ? await manager.withHiddenSelectors(effectiveHideSelectors, runCapture, page)
        : await runCapture();
    }, operation => manager.runBrowserOperation(operation))
  );
}
