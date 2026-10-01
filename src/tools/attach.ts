import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { jsonResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerAttachTool(server: McpServer): void {
  const attachSchema = {
    cdpUrl: z
      .string()
      .optional()
      .describe('Chrome remote debugging endpoint (default: "http://localhost:9222")'),
    autoSelectActiveTab: z
      .boolean()
      .optional()
      .describe("Automatically attach to the developer's most recent active tab (default: true)"),
    autoLaunch: z
      .boolean()
      .optional()
      .describe('Automatically launch Chrome with remote debugging port enabled if not already running (default: true)')
  };

  const attachHandler = instrumentHandler(
    'spector_attach',
    async ({ cdpUrl, autoSelectActiveTab, autoLaunch }: any) => {
      const manager = BrowserManager.getInstance();
      const result = await manager.attach(
        cdpUrl,
        autoSelectActiveTab ?? true,
        autoLaunch ?? true
      );

      return jsonResponse({
        status: 'connected',
        activeTab: {
          title: result.title,
          url: result.url,
          viewport: result.viewport
        }
      });
    }
  );

  server.tool(
    'spector_attach',
    '[LIFECYCLE: CONNECT CHROME] Connects MCP server to a Google Chrome instance via Chrome DevTools Protocol (CDP port 9222). Automatically launches a dedicated Chrome dev profile if not currently running.',
    attachSchema,
    attachHandler
  );

  server.tool('browser_attach', '[Alias for spector_attach]', attachSchema, attachHandler);
}
