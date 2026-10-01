import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import type { McpToolContent } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerScreenshotTool(server: McpServer): void {
  const screenshotSchema = {
    selector: z
      .string()
      .optional()
      .describe('Specific element selector to capture only that targeted element (e.g. "#header", ".pricing-table")'),
    fullPage: z
      .boolean()
      .optional()
      .describe('Capture entire scrollable page height (default: false)')
  };

  const screenshotHandler = instrumentHandler(
    'spector_capture_screenshot',
    async ({ selector, fullPage }: any) => {
      const manager = BrowserManager.getInstance();
      const buffer = await manager.captureScreenshot(selector, fullPage ?? false);
      const base64Data = buffer.toString('base64');

      const contentBlocks: McpToolContent[] = [
        {
          type: 'image',
          data: base64Data,
          mimeType: 'image/png'
        },
        {
          type: 'text',
          text: `Screenshot captured successfully${selector ? ` for selector "${selector}"` : ''} (${Math.round(buffer.length / 1024)} KB).`
        }
      ];

      return {
        content: contentBlocks
      };
    }
  );

  server.tool(
    'spector_capture_screenshot',
    '[VISUAL AUDIT: PIXEL SNAPSHOT] Captures a screenshot of the active page or a specific target element for visual verification and layout inspection.',
    screenshotSchema,
    screenshotHandler
  );
}
