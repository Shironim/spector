import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { jsonResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerNavigateTool(server: McpServer): void {
  const navigateSchema = {
    url: z
      .string()
      .describe('Target URL (e.g. "http://localhost:3000", "https://app.test") or "reload" to refresh current page'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle'])
      .optional()
      .describe('Navigation completion condition (default: "load")')
  };

  const navigateHandler = instrumentHandler(
    'spector_navigate',
    async ({ url, waitUntil }: any) => {
      const manager = BrowserManager.getInstance();
      const result = await manager.navigate(url, waitUntil ?? 'load');

      return jsonResponse({
        status: 'navigated',
        url: result.url,
        title: result.title
      });
    }
  );

  server.tool(
    'spector_navigate',
    '[NAVIGATION: ROUTE & RELOAD] Navigates browser to target URL (supports localhost:port, domain .test, .local, https) or reloads the page after code changes.',
    navigateSchema,
    navigateHandler
  );
}
