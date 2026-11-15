import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { extractCompressedDom } from '../analyzers/dom-compressor.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import type { McpToolContent } from '../types.js';
import { textResponse, SpectorError } from '../utils/mcp-response.js';
import { TELEMETRY_LIMITS, type BreakpointPreset } from '../constants.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export interface InspectToolsOptions {
  includeDomTree?: boolean;
}

export function registerInspectTools(
  server: McpServer,
  manager: CdpSessionManager,
  options: InspectToolsOptions = {}
): void {
  const { includeDomTree = true } = options;

  if (includeDomTree) {
    const domSchema = {
      selector: z
        .string()
        .optional()
        .describe('Root CSS selector to scope inspection to a specific component or container (e.g. "#main-card", ".w-[200px]")'),
      includeBoundingBox: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include pixel bounding box coordinates [box=x,y,w,h] (default: true)'),
      includeOffscreen: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include elements outside active viewport or animating from opacity:0 (default: false)'),
      maxDepth: z
        .number()
        .int().min(0).max(64)
        .optional()
        .default(TELEMETRY_LIMITS.DOM_TREE_MAX_DEPTH)
        .describe('Maximum hierarchy traversal depth (default: 8)')
    };

    server.tool(
      'spector_get_dom_tree',
      '[TOKEN-LEAN SEMANTIC DOM] Retrieves a semantic DOM tree preserving relevant styling classes, bounding boxes [box=x,y,w,h], offscreen markers, Shadow DOM, and password masking.',
      domSchema,
      instrumentHandler<{
        selector?: string;
        includeBoundingBox?: boolean;
        includeOffscreen?: boolean;
        maxDepth?: number;
      }>('spector_get_dom_tree', async ({ selector, includeBoundingBox, includeOffscreen, maxDepth }) => {
        const page = await manager.ensurePage();
        const operationUrl = page.url();
        const effectiveSelector = selector ? escapeTailwindSelector(selector) : selector;
        const domTree = await extractCompressedDom(page, {
          selector: effectiveSelector,
          includeBoundingBox: includeBoundingBox ?? true,
          includeOffscreen: includeOffscreen ?? false,
          maxDepth: maxDepth ?? TELEMETRY_LIMITS.DOM_TREE_MAX_DEPTH
        });
        manager.assertTarget(page, operationUrl);
        const metadata = await manager.captureMetadata(page, selector);
        manager.assertTarget(page, operationUrl);
        return textResponse(JSON.stringify(metadata) + '\n' + domTree);
      }, operation => manager.runBrowserOperation(operation))
    );
  }

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
      .describe('Optional responsive viewport presets to capture (mobile=375x812, tablet=768x1024, desktop=1440x900). Restores original viewport afterward.')
  };

  server.tool(
    'spector_capture_screenshot',
    '[VISUAL AUDIT & MULTI-BREAKPOINT SNAPSHOT] Captures a screenshot of the active page, a target selector, or multiple responsive breakpoints via CDP Emulation (automatically restores original viewport).',
    screenshotSchema,
    instrumentHandler<{
      selector?: string;
      expectedUrl?: string;
      fullPage?: boolean;
      breakpoints?: BreakpointPreset[];
    }>('spector_capture_screenshot', async ({ selector, expectedUrl, fullPage, breakpoints }) => {
      const page = await manager.ensurePage();

      const operationUrl = expectedUrl ?? page.url();
      manager.assertTarget(page, operationUrl);

      if (Array.isArray(breakpoints) && breakpoints.length > 0) {
        const captures = await manager.withBreakpointMetrics(breakpoints, async (bp, dims) => {
          const overflowCheck = await page.evaluate(() => {
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
            JSON.stringify(item.metadata) + " " +
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
            text: JSON.stringify(metadata) + "\n" + `Screenshot captured successfully${selector ? ` for selector "${selector}"` : ''} (${Math.round(buffer.length / 1024)} KB).`
          }
        ]
      };
    }, operation => manager.runBrowserOperation(operation))
  );
}
