import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { jsonResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerTabsTools(server: McpServer): void {
  const listTabsHandler = instrumentHandler(
    'spector_list_tabs',
    async () => {
      const manager = BrowserManager.getInstance();
      const tabs = await manager.listTabs();

      return jsonResponse(tabs);
    }
  );

  const selectTabSchema = {
    index: z
      .number()
      .optional()
      .describe('Target tab index (from spector_list_tabs output)'),
    url: z
      .string()
      .optional()
      .describe('Target URL substring to match (e.g. "localhost:3000", "admin")'),
    urlPattern: z
      .string()
      .optional()
      .describe('Regex pattern to match target URL precisely (e.g. "^https?:\\/\\/.*\\/checkout")'),
    title: z
      .string()
      .optional()
      .describe('Target page title substring to match'),
    debugSessionId: z
      .string()
      .optional()
      .describe('Multi-tool correlation session ID (e.g. from window.__debugSessionId)')
  };

  const selectTabHandler = instrumentHandler(
    'spector_select_tab',
    async ({ index, url, urlPattern, title, debugSessionId }: any) => {
      const manager = BrowserManager.getInstance();
      const result = await manager.selectTab({ index, url, urlPattern, title, debugSessionId });

      return jsonResponse({
        status: 'tab_selected',
        activeTab: {
          title: result.title,
          url: result.url,
          viewport: result.viewport
        }
      });
    }
  );

  // Primary Spector tools
  server.tool(
    'spector_list_tabs',
    '[ROUTING: DISCOVER TABS] Lists all open tabs in the attached Chrome browser instance along with their active focus state.',
    {},
    listTabsHandler
  );

  server.tool(
    'spector_select_tab',
    '[ROUTING: SWITCH TAB] Switches active focus to a specific tab by index, URL filter, or page title.',
    selectTabSchema,
    selectTabHandler
  );

  // Backward-compatibility aliases
  server.tool('browser_list_tabs', '[Alias for spector_list_tabs]', {}, listTabsHandler);
  server.tool('browser_select_tab', '[Alias for spector_select_tab]', selectTabSchema, selectTabHandler);
}
