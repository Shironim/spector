import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import type { McpToolContent } from '../types.js';
import { SpectorError } from '../utils/mcp-response.js';
import type { BreakpointPreset } from '../constants.js';
import { instrumentHandler } from '../utils/tool-instrument.js';
import { evaluateInPage } from '../utils/cdp.js';

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
    reducedMotion: z
      .boolean()
      .optional()
      .describe('Optional prefers-reduced-motion media emulation for the capture (restored afterward).')
  };

  server.registerTool(
    'spector_capture_screenshot',
    {
      title: 'Capture Visual Screenshot',
      description: '[VISUAL AUDIT & MULTI-BREAKPOINT SNAPSHOT] Captures a screenshot of the active page, a target selector, or multiple responsive breakpoints via CDP Emulation (automatically restores original viewport).',
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
      reducedMotion?: boolean;
    }>('spector_capture_screenshot', async ({ selector, expectedUrl, fullPage, breakpoints, colorScheme, reducedMotion }) => {
      const page = await manager.ensurePage();

      const operationUrl = expectedUrl ?? manager.pageUrl(page);
      manager.assertTarget(page, operationUrl);

      return await manager.withEmulatedMedia({ colorScheme, reducedMotion }, async () => {
        if (Array.isArray(breakpoints) && breakpoints.length > 0) {
          const captures = await manager.withBreakpointMetrics(breakpoints, async (bp, dims) => {
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

          const contentBlocks: McpToolContent[] = [];
          const summaryLines: string[] = [];
          for (const item of captures) {
            if (!item.buffer) {
              summaryLines.push(JSON.stringify({ ...item.metadata, breakpoint: item.bp, status: 'failed', code: item.errorCode }));
              continue;
            }
            summaryLines.push(
              JSON.stringify(item.metadata) + ' ' +
              `${item.bp} (${item.dims.width}x${item.dims.height}): ${Math.round(item.buffer.length / 1024)} KB` +
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
          contentBlocks.unshift({
            type: 'text',
            text: `Multi-breakpoint capture status: ${captures.every(item => item.buffer) ? 'valid' : captures.some(item => item.buffer) ? 'partial' : 'failed'} (original viewport restored):\n${summaryLines.join('\n')}`
          });
          return { content: contentBlocks, ...(captures.every(item => !item.buffer) ? { isError: true } : {}) };
        }

        const buffer = await manager.captureScreenshotBuffer(page, { selector, fullPage });
        manager.assertTarget(page, operationUrl);
        const metadata = await manager.captureMetadata(page, selector);
        manager.assertTarget(page, operationUrl);
        return {
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
        };
      }, page);
    }, operation => manager.runBrowserOperation(operation))
  );
}
